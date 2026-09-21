/**
 * Real connection status for any Connect integration.
 *
 * "Is YouTube connected?" used to reach `web.search` and open a browser tab —
 * the app answered a question about its own state by leaving the app. The
 * question is answerable locally: Connect already writes Google OAuth tokens
 * and per-integration credentials, and `integrationStatusService` reads exactly
 * what the Connect page reads. This exposes that read as a capability so the
 * model has something correct to choose.
 *
 * Nothing here returns a secret. Credential *presence* is a boolean; the value
 * is never read, let alone returned.
 */

import { INTEGRATIONS } from "../../data/demoData";
import { CAPABILITY_REGISTRY } from "./capabilityRegistry";
import type { IntegrationId } from "../../config/iconRegistry";
import { credentialSpecFor } from "../../config/integrationCatalog";
import { isGoogleIntegration } from "../../config/googleOAuth";
import { getConnectedIntegrationIds } from "../../services/integrationStatusService";
import { getConnectionSnapshot } from "../orchestration/ConnectionBroker";
import {
  connectorProfile,
  connectorState,
  describeState,
  type ConnectorImplementation,
  type ConnectorState,
} from "./connectorRegistry";

export type ConnectionState =
  | "connected"
  | "not-connected"
  | "needs-reauth"
  | "error"
  | "unknown-service";

export interface ServiceConnectionStatus {
  /** Connect integration id, when the name resolved to one. */
  serviceId?: IntegrationId;
  /** What the user calls it — "YouTube". Echoes their words when unresolved. */
  displayName: string;
  state: ConnectionState;
  /** A credential or OAuth token exists on this device. Never its value. */
  credentialPresent: boolean;
  /** Account identity, when the provider gives one. */
  account?: string;
  /** ISO timestamp of the last successful validation, when one is recorded. */
  lastValidatedAt?: string;
  /** What ArcSonare can do with it once connected. */
  capabilities: string[];
  /** Present when the connection exists but could not be verified. */
  errorMessage?: string;
}

/**
 * Extra names people actually type. Only aliases that cannot collide — an
 * alias that matched two integrations would silently answer about the wrong
 * one, which is the failure this capability exists to end.
 */
const ALIASES: Partial<Record<IntegrationId, string[]>> = {
  gmail: ["gmail", "google mail", "email", "mail", "inbox"],
  googleCalendar: ["google calendar", "calendar", "gcal"],
  googleDrive: ["google drive", "drive", "gdrive"],
  googleDocs: ["google docs", "docs"],
  googleSheets: ["google sheets", "sheets"],
  googleMeet: ["google meet", "meet"],
  youtube: ["youtube", "you tube", "yt"],
  x: ["x", "twitter"],
  homeAssistant: ["home assistant", "homeassistant"],
  smtp: ["smtp", "smtp email"],
  openweather: ["openweather", "open weather", "weather api"],
  elevenlabs: ["elevenlabs", "eleven labs"],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a spoken/typed service name to a Connect integration id. */
export function resolveServiceId(raw: string): IntegrationId | null {
  const n = normalize(raw)
    .replace(/^(?:my|the)\s+/, "")
    .replace(/\s+(?:account|integration|connection|service|api)$/, "")
    .trim();
  if (!n) return null;

  for (const integration of INTEGRATIONS) {
    if (normalize(integration.name) === n) return integration.id;
    if (normalize(integration.id) === n) return integration.id;
  }
  for (const [id, aliases] of Object.entries(ALIASES)) {
    if (aliases?.some((a) => normalize(a) === n)) return id as IntegrationId;
  }
  // Last resort: a single integration whose name contains the whole phrase.
  const contained = INTEGRATIONS.filter((i) => normalize(i.name).includes(n));
  return contained.length === 1 ? contained[0].id : null;
}

function displayNameFor(id: IntegrationId): string {
  return INTEGRATIONS.find((i) => i.id === id)?.name ?? id;
}

/**
 * Read the real state of one service.
 *
 * Google integrations answer from the OAuth status plus the broker's validation
 * record; everything else answers from Windows Credential Manager. Both are the
 * same sources the Connect page renders, so chat and Connect cannot disagree.
 */
export async function readServiceConnection(
  rawName: string,
): Promise<ServiceConnectionStatus> {
  const serviceId = resolveServiceId(rawName);
  if (!serviceId) {
    return {
      displayName: rawName.trim() || "that service",
      state: "unknown-service",
      credentialPresent: false,
      capabilities: [],
    };
  }

  const displayName = displayNameFor(serviceId);
  // What ArcSonare has BUILT, not what the service offers. `capabilitiesFor`
  // is Discover card copy; returning it here is how "is Discord connected?"
  // could imply a feature list that does not exist.
  const capabilities = connectorProfile(serviceId).available;

  let connectedIds: Set<IntegrationId>;
  try {
    connectedIds = await getConnectedIntegrationIds();
  } catch (err) {
    return {
      serviceId,
      displayName,
      state: "error",
      credentialPresent: false,
      capabilities,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const credentialPresent = connectedIds.has(serviceId);

  if (!credentialPresent) {
    // An integration with no credential form cannot be connected at all; say so
    // as "not connected" rather than inventing a setup step that does not exist.
    return {
      serviceId,
      displayName,
      state: "not-connected",
      credentialPresent: false,
      capabilities,
      errorMessage: credentialSpecFor(serviceId)
        ? undefined
        : `${displayName} has no credential setup in Connect yet.`,
    };
  }

  // Google services carry a validation record; the broker is the only place a
  // "connected but expired" state is observable.
  if (isGoogleIntegration(serviceId)) {
    const google = getConnectionSnapshot().find((a) => a.provider === "google");
    const account = google
      ? { ...google, accountLabel: google.accountLabel ?? google.emailAddress }
      : undefined;
    if (account?.status === "authentication-required") {
      return {
        serviceId,
        displayName,
        state: "needs-reauth",
        credentialPresent: true,
        account: account.accountLabel,
        lastValidatedAt: account.lastValidatedAt,
        capabilities,
        errorMessage: account.error?.message,
      };
    }
    if (account?.status === "error") {
      return {
        serviceId,
        displayName,
        state: "error",
        credentialPresent: true,
        account: account.accountLabel,
        lastValidatedAt: account.lastValidatedAt,
        capabilities,
        errorMessage: account.error?.message,
      };
    }
    return {
      serviceId,
      displayName,
      state: "connected",
      credentialPresent: true,
      account: account?.accountLabel,
      lastValidatedAt: account?.lastValidatedAt,
      capabilities,
    };
  }

  return {
    serviceId,
    displayName,
    state: "connected",
    credentialPresent: true,
    capabilities,
  };
}

/**
 * Every connector that is actually connected, with what it can do.
 *
 * Derived from `connectorRegistry`, which computes capabilities from the
 * capability registry itself — so this cannot claim a connector works after
 * someone deletes its tools, and cannot miss one after someone adds them.
 *
 * Reads the connection registry, never the Discover catalogue. A credential
 * with nothing behind it is reported as such rather than counted as working.
 */
export interface ConnectedAppRecord {
  serviceId: IntegrationId;
  displayName: string;
  state: ConnectorState;
  stateLabel: string;
  implementation: ConnectorImplementation;
  accessLevel: string;
  available: string[];
  unavailable: string[];
  /**
   * What each origin may actually invoke.
   *
   * "Which tools can I use through voice?" was answered from the connector list
   * — right by coincidence, since YouTube's tools all support voice. It needs to
   * come from the origin policy, which also withholds destructive capabilities
   * from voice regardless of connector.
   */
  availableInChat: string[];
  availableInVoice: string[];
  lastValidatedAt?: string;
  error?: string;
}

/** Display names for a set of capability ids. Never the ids themselves. */
function namesFor(ids: string[]): string[] {
  return ids
    .map((id) => CAPABILITY_REGISTRY.find((c) => c.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));
}

export async function listConnectedApps(): Promise<ConnectedAppRecord[]> {
  let connectedIds: Set<IntegrationId>;
  try {
    connectedIds = await getConnectedIntegrationIds();
  } catch {
    return [];
  }

  const records: ConnectedAppRecord[] = [];
  for (const integration of INTEGRATIONS) {
    if (!connectedIds.has(integration.id)) continue;
    const status = await readServiceConnection(integration.name);
    const profile = connectorProfile(integration.id);
    const state = connectorState(integration.id, {
      credentialPresent: status.credentialPresent,
      // A credential that has never been exercised is configured, not verified.
      validated: Boolean(status.lastValidatedAt) || !isGoogleIntegration(integration.id),
      errored: status.state === "error" || status.state === "needs-reauth",
    });
    records.push({
      serviceId: integration.id,
      displayName: integration.name,
      state,
      stateLabel: describeState(state),
      implementation: profile.implementation,
      accessLevel: profile.accessLevel,
      available: profile.available,
      unavailable: profile.unavailable,
      availableInChat: namesFor(profile.chatCapabilityIds),
      availableInVoice: namesFor(profile.voiceCapabilityIds),
      lastValidatedAt: status.lastValidatedAt,
      error: status.errorMessage,
    });
  }
  return records;
}

/** True when a connector has real tools, not just a Connect card. */
export function hasRealCapabilities(id: IntegrationId): boolean {
  return connectorProfile(id).available.length > 0;
}

/** The capability detail for one service, for "what can YouTube do?". */
export function capabilityDetailFor(id: IntegrationId) {
  const profile = connectorProfile(id);
  return profile.available.length === 0 && profile.unavailable.length === 0
    ? null
    : {
        access: profile.accessLevel,
        implemented: profile.available,
        unavailable: profile.unavailable,
      };
}

/** One-sentence ground truth for the reply. Never a secret, never a guess. */
export function summarizeConnection(status: ServiceConnectionStatus): string {
  switch (status.state) {
    case "connected": {
      // A credential with no tools behind it is connected and unusable. Saying
      // only "connected and ready to use" is the claim that made a catalogue
      // card indistinguishable from a working integration.
      const profile = status.serviceId ? connectorProfile(status.serviceId) : null;
      if (profile && profile.available.length === 0) {
        return (
          `${status.displayName}: the credential is saved, but ArcSonare ` +
          `doesn't have ${status.displayName} tools yet — nothing can be done with it so far.`
        );
      }
      const access = profile ? ` (${profile.accessLevel})` : "";
      const can = profile?.available.length
        ? ` It can: ${profile.available.join(", ")}.`
        : "";
      return status.account
        ? `${status.displayName} is connected${access} as ${status.account}.${can}`
        : `${status.displayName} is connected${access}.${can}`;
    }
    case "not-connected":
      return `${status.displayName} is not connected yet.`;
    case "needs-reauth":
      return `${status.displayName} is connected, but the sign-in expired and needs reconnecting.`;
    case "error":
      return `${status.displayName} is connected, but ArcSonare could not verify it right now.`;
    case "unknown-service":
      return `${status.displayName} is not one of the services in Connect.`;
  }
}
