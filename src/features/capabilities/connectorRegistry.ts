/**
 * What each connector can actually do — derived, not asserted.
 *
 * The Discover page lists 42 services. Five of them have working tools. The gap
 * between those numbers is the whole problem: a catalogue card, a credential
 * form and a working integration look identical to a user, and until now they
 * looked identical to the assistant too.
 *
 * The important property here is that almost nothing is hand-written. A
 * connector's implemented capabilities are computed from the capability
 * registry itself, so status cannot drift: add a `slack.*` capability and Slack
 * stops reporting AUTH_ONLY on the next render, with no list to remember to
 * update. The only hand-maintained fact is which id prefixes belong to which
 * connector, which is small, explicit, and checked by a test.
 */

import { CAPABILITY_REGISTRY } from "./capabilityRegistry";
import type { CapabilityDefinition } from "./capabilityTypes";
import { capabilitiesForWatchContext } from "../watch/watchCapabilityGate";
import type { WatchedApplication } from "../watch/watchTypes";
import type { IntegrationId } from "../../config/iconRegistry";
import { credentialSpecFor } from "../../config/integrationCatalog";
import { isGoogleIntegration } from "../../config/googleOAuth";

/**
 * How truthful a connector's presence in the UI is.
 *
 * `AUTH_ONLY` is the category that did not exist before and matters most: a
 * credential form the user can fill in, storing a real secret, behind which
 * nothing is built. Twenty-one connectors are in that state.
 */
export type ConnectorImplementation =
  | "COMPLETE"
  | "PARTIAL"
  | "AUTH_ONLY"
  | "UI_ONLY"
  | "NOT_IMPLEMENTED";

/** What the user's connection is worth right now. */
export type ConnectorState =
  | "CONNECTED_VERIFIED"
  | "CONNECTED_LIMITED"
  | "CONFIGURED_UNVERIFIED"
  | "ERROR"
  | "DISCONNECTED"
  | "COMING_SOON"
  | "UI_ONLY";

/**
 * Capability id prefixes owned by each connector.
 *
 * Hand-maintained on purpose — a prefix is a naming decision, not something to
 * infer. Everything else is derived from it.
 */
const CONNECTOR_DOMAINS: Partial<Record<IntegrationId, string[]>> = {
  gmail: ["email."],
  googleCalendar: ["calendar."],
  googleDrive: ["drive."],
  googleDocs: ["docs."],
  youtube: ["youtube."],
};

/** What a connector cannot do, and why — stated so the UI need not guess. */
const KNOWN_LIMITS: Partial<Record<IntegrationId, { access: string; unavailable: string[] }>> = {
  youtube: {
    access: "Public read-only",
    // An API key identifies a Google Cloud project, not a person. Nothing
    // account-scoped is reachable with one, however the user connects it.
    unavailable: ["Subscriptions", "Watch history", "Likes", "Private playlists"],
  },
  googleDrive: { access: "Account read-only", unavailable: ["Upload", "Share", "Delete"] },
  gmail: { access: "Account read + send", unavailable: [] },
  googleCalendar: { access: "Account read + write", unavailable: [] },
  googleDocs: { access: "Account read + write", unavailable: [] },
};

/** Every capability this connector actually registers. Derived. */
export function connectorCapabilities(id: IntegrationId): CapabilityDefinition[] {
  const prefixes = CONNECTOR_DOMAINS[id];
  if (!prefixes) return [];
  return CAPABILITY_REGISTRY.filter(
    (c) =>
      prefixes.some((p) => c.id.startsWith(p)) && c.availability !== "unsupported",
  );
}

/**
 * How complete this connector is, computed from what exists.
 *
 * A credential form with no capabilities behind it is `AUTH_ONLY`: the user can
 * store a secret and get nothing, which is worse than an honest "coming soon"
 * because it looks like it worked.
 */
export function connectorImplementation(id: IntegrationId): ConnectorImplementation {
  const capabilities = connectorCapabilities(id);
  const hasCredentialPath = Boolean(credentialSpecFor(id)) || isGoogleIntegration(id);
  if (capabilities.length === 0) {
    return hasCredentialPath ? "AUTH_ONLY" : "UI_ONLY";
  }
  const limits = KNOWN_LIMITS[id];
  return limits && limits.unavailable.length > 0 ? "PARTIAL" : "COMPLETE";
}

export interface ConnectorProfile {
  id: IntegrationId;
  implementation: ConnectorImplementation;
  /** Whether a user could even be shown a working Connect action. */
  connectable: boolean;
  accessLevel: string;
  /** Plain-language descriptions of what works. Derived from the registry. */
  available: string[];
  unavailable: string[];
  capabilityIds: string[];
  /** Capabilities the model may be offered in each origin. */
  chatCapabilityIds: string[];
  voiceCapabilityIds: string[];
}

/** Everything the UI and the assistant need to describe one connector. */
export function connectorProfile(id: IntegrationId): ConnectorProfile {
  const capabilities = connectorCapabilities(id);
  const implementation = connectorImplementation(id);
  const limits = KNOWN_LIMITS[id];
  return {
    id,
    implementation,
    // A card with nothing behind it must never offer a Connect action that
    // implies it will work.
    connectable: implementation !== "UI_ONLY",
    accessLevel:
      limits?.access ??
      (implementation === "AUTH_ONLY"
        ? "Credential can be saved, but no tools are built yet"
        : implementation === "UI_ONLY"
          ? "Not available yet"
          : "Full access"),
    available: capabilities.map((c) => c.displayName),
    unavailable: limits?.unavailable ?? [],
    capabilityIds: capabilities.map((c) => c.id),
    chatCapabilityIds: capabilities.filter((c) => c.supportsChat).map((c) => c.id),
    voiceCapabilityIds: capabilities.filter((c) => c.supportsVoice).map((c) => c.id),
  };
}

/**
 * Resolve the live state of a connector.
 *
 * `connected` comes from the connection registry — a credential existing. The
 * distinction this draws is the one that was missing: a stored credential with
 * no tools behind it is CONFIGURED_UNVERIFIED at best, never "connected".
 */
export function connectorState(
  id: IntegrationId,
  input: { credentialPresent: boolean; validated: boolean; errored: boolean },
): ConnectorState {
  const implementation = connectorImplementation(id);
  if (implementation === "UI_ONLY") return "UI_ONLY";
  if (implementation === "AUTH_ONLY") {
    // Real credential, real storage, nothing to use it with.
    return input.credentialPresent ? "COMING_SOON" : "COMING_SOON";
  }
  if (!input.credentialPresent) return "DISCONNECTED";
  if (input.errored) return "ERROR";
  if (!input.validated) return "CONFIGURED_UNVERIFIED";
  return implementation === "PARTIAL" ? "CONNECTED_LIMITED" : "CONNECTED_VERIFIED";
}

/** Human label for a state, for UI and for the assistant's facts. */
export function describeState(state: ConnectorState): string {
  switch (state) {
    case "CONNECTED_VERIFIED":
      return "Connected";
    case "CONNECTED_LIMITED":
      return "Connected";
    case "CONFIGURED_UNVERIFIED":
      return "Configured, not yet verified";
    case "ERROR":
      return "Connection error";
    case "DISCONNECTED":
      return "Not connected";
    case "COMING_SOON":
      return "Coming soon";
    case "UI_ONLY":
      return "Coming soon";
  }
}

/**
 * Is this capability allowed to be offered to the model in this origin?
 *
 * The single gate every surface must consult. Chat and voice previously decided
 * independently, which is how voice came to claim tools that do not exist.
 */
export function capabilityAllowedForOrigin(
  capability: CapabilityDefinition,
  origin: "chat" | "voice",
): boolean {
  // Delegates to the risk-aware policy rather than re-deciding.
  //
  // These were briefly two gates: this one checked only `supportsVoice`, while
  // `originPolicy` also refused destructive actions by voice. They disagreed,
  // and the voice tool list still contained `filesystem.delete` and
  // `tasks.delete` — a second allowlist drifting from the first, which is the
  // exact failure the shared gate was built to end.
  return originPolicy(capability, origin).allowed;
}

/** Connectors that register at least one working capability. */
export function implementedConnectorIds(): IntegrationId[] {
  return (Object.keys(CONNECTOR_DOMAINS) as IntegrationId[]).filter(
    (id) => connectorCapabilities(id).length > 0,
  );
}

/**
 * The single gate every surface consults before offering tools to a model.
 *
 * Chat and voice each had their own inline filter. They agreed by coincidence,
 * not by construction, and neither checked connector state — so voice offered
 * `email.*` tools with Gmail disconnected, then had to explain away a tool it
 * had just advertised. That is the "voice says the tool does not exist" report.
 *
 * `connectedConnectors` is passed in rather than read here: this module stays
 * synchronous and dependency-light, and the caller already knows the connection
 * state it wants to apply.
 */
export function capabilitiesForOrigin(
  origin: "chat" | "voice",
  connectedConnectors: ReadonlySet<IntegrationId>,
  /**
   * Watched applications that are live right now.
   *
   * The desktop equivalent of `connectedConnectors`, and here for the same
   * reason: `spotify.play` offered with Spotify closed is a tool the model will
   * call and cannot succeed at, exactly as `email.list_messages` was offered
   * with Gmail disconnected. Gating it here rather than in each surface is what
   * keeps chat and voice narrowing identically — a second filter in one of them
   * is a second allowlist, which is the drift this function exists to end.
   *
   * Defaults to none, so a caller that forgets to pass it offers no
   * watched-application tools rather than offering all of them.
   */
  watchedApplications: readonly WatchedApplication[] = [],
): CapabilityDefinition[] {
  const watchedIds = new Set(
    capabilitiesForWatchContext([...watchedApplications]).map((c) => c.id),
  );
  return CAPABILITY_REGISTRY.filter((capability) => {
    if (!capabilityAllowedForOrigin(capability, origin)) return false;
    if (capability.category === "watched-app") return watchedIds.has(capability.id);
    const required = connectorFor(capability.id);
    if (!required) return true;
    // Questions *about* a connection must survive the connection being absent —
    // otherwise "is Gmail connected?" becomes unanswerable exactly when the
    // answer is no.
    if (/\.get_connection_status$/.test(capability.id)) return true;
    return connectedConnectors.has(required);
  });
}

/** Which connector, if any, a capability needs. Derived from its id prefix. */
export function connectorFor(capabilityId: string): IntegrationId | null {
  for (const [id, prefixes] of Object.entries(CONNECTOR_DOMAINS)) {
    if (prefixes?.some((p) => capabilityId.startsWith(p))) return id as IntegrationId;
  }
  return null;
}

/**
 * Why a capability is not on offer, for an honest refusal.
 *
 * "There is no such tool" is the wrong answer when the tool exists and the
 * connector is simply not connected, or when the connector has no tools built.
 */
export function explainUnavailable(
  capabilityId: string,
  connectedConnectors: ReadonlySet<IntegrationId>,
): string | null {
  const capability = CAPABILITY_REGISTRY.find((c) => c.id === capabilityId);
  if (!capability) return null;
  const required = connectorFor(capabilityId);
  if (required && !connectedConnectors.has(required)) {
    return `${required} is not connected yet, so that isn't available.`;
  }
  if (capability.availability === "unsupported") {
    return "That isn't implemented yet.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Origin policy
// ---------------------------------------------------------------------------

/** Where a capability may be invoked from. */
export type CapabilityOrigin = "chat" | "voice" | "direct-ui" | "background";

/**
 * Whether an origin may invoke a capability, and why not when it may not.
 *
 * Derived from properties the capability already declares rather than from four
 * new flags on 97 definitions: a policy computed from risk and reversibility
 * stays correct when a capability's risk changes, whereas four hand-set booleans
 * quietly do not.
 */
export function originPolicy(
  capability: CapabilityDefinition,
  origin: CapabilityOrigin,
): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
  if (capability.availability === "unsupported") {
    return { allowed: false, requiresConfirmation: false, reason: "not implemented" };
  }

  const destructive = capability.riskLevel === "destructive";
  const sensitive = capability.riskLevel === "sensitive";
  const readOnly = capability.riskLevel === "read-only";

  switch (origin) {
    case "chat":
      return {
        allowed: capability.supportsChat,
        requiresConfirmation: destructive || sensitive,
        reason: capability.supportsChat ? undefined : "not available in chat",
      };

    case "voice":
      // Voice has no reliable way to show what is about to happen before it
      // happens, so a destructive action cannot be authorised by speech alone.
      if (destructive) {
        return {
          allowed: false,
          requiresConfirmation: true,
          reason: "destructive actions need the screen, not just speech",
        };
      }
      return {
        allowed: capability.supportsVoice,
        requiresConfirmation: sensitive,
        reason: capability.supportsVoice ? undefined : "not available by voice",
      };

    case "direct-ui":
      // The user clicked a control that names the action. Nothing is inferred,
      // so nothing needs re-confirming except a destructive step.
      return { allowed: true, requiresConfirmation: destructive };

    case "background":
      // Nobody is watching. Only reads may run unattended.
      return {
        allowed: readOnly,
        requiresConfirmation: false,
        reason: readOnly ? undefined : "only read-only capabilities run unattended",
      };
  }
}

/** Capabilities a given origin may be offered, with connector state applied. */
export function capabilitiesForAnyOrigin(
  origin: CapabilityOrigin,
  connectedConnectors: ReadonlySet<IntegrationId>,
  watchedApplications: readonly WatchedApplication[] = [],
): CapabilityDefinition[] {
  const watchedIds = new Set(
    capabilitiesForWatchContext([...watchedApplications]).map((c) => c.id),
  );
  return CAPABILITY_REGISTRY.filter((capability) => {
    if (!originPolicy(capability, origin).allowed) return false;
    if (capability.category === "watched-app") return watchedIds.has(capability.id);
    const required = connectorFor(capability.id);
    if (!required) return true;
    if (/\.get_connection_status$/.test(capability.id)) return true;
    return connectedConnectors.has(required);
  });
}
