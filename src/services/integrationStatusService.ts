/**
 * Real connection status for integrations — the same checks ConnectGrid uses
 * (Google OAuth status, Windows Credential Manager for everything else),
 * exposed as a plain async function so the assistant's system context can
 * report ground truth instead of guessing.
 */
import { invoke } from "@tauri-apps/api/core";
import { INTEGRATIONS } from "../data/demoData";
import { credentialSpecFor, integrationSecureKey } from "../config/integrationCatalog";
import type { IntegrationId } from "../config/iconRegistry";
import {
  GOOGLE_INTEGRATION_IDS,
  GOOGLE_SHARED_ACCOUNT_ID,
  isGoogleIntegration,
  type GoogleOAuthStatus,
} from "../config/googleOAuth";
import {
  CONNECTION_FRESH_MS,
  removeAccount,
  upsertAccount,
} from "../features/orchestration/ConnectionBroker";
import type { ConnectedServiceKind } from "../features/orchestration/IntentContract";

export async function getConnectedIntegrationIds(): Promise<Set<IntegrationId>> {
  const connected = new Set<IntegrationId>();

  try {
    const googleStatus = await invoke<GoogleOAuthStatus>("google_oauth_status");
    if (googleStatus.connected) {
      GOOGLE_INTEGRATION_IDS.forEach((id) => connected.add(id));
    }
  } catch (error) {
    console.error("[integrationStatus] failed to read Google OAuth status", error);
  }

  await Promise.all(
    INTEGRATIONS.filter(
      (integration) =>
        !isGoogleIntegration(integration.id) && credentialSpecFor(integration.id),
    ).map(async (integration) => {
      const key = integrationSecureKey(integration.id);
      try {
        const stored = await invoke<boolean>("secure_storage_has", { key });
        if (stored) connected.add(integration.id);
      } catch (error) {
        console.error(
          `[integrationStatus] failed to read ${integration.id} credential state`,
          error,
        );
      }
    }),
  );

  return connected;
}

/**
 * Bridge real integration status into ConnectionBroker's cache so
 * orchestration (resolveConnection, used by IntentOrchestrator) reflects
 * reality instead of permanently reporting "not-connected". Safe to call
 * repeatedly — it's a resync, not a one-time hydration.
 */
export async function syncConnectionBrokerFromIntegrations(): Promise<void> {
  const connectedIds = await getConnectedIntegrationIds();
  const services: ConnectedServiceKind[] = [];
  const scopes: string[] = [];
  if (connectedIds.has("gmail")) {
    services.push("email");
    scopes.push("email.read", "email.compose");
  }
  if (connectedIds.has("googleCalendar")) {
    services.push("calendar");
    scopes.push("calendar.read");
  }
  if (connectedIds.has("googleDrive")) {
    services.push("drive");
    scopes.push("drive.read");
  }

  if (services.length === 0) {
    removeAccount(GOOGLE_SHARED_ACCOUNT_ID);
    return;
  }

  const now = new Date().toISOString();
  upsertAccount({
    id: GOOGLE_SHARED_ACCOUNT_ID,
    provider: "google",
    services,
    scopes,
    status: "connected",
    lastValidatedAt: now,
    validationExpiresAt: new Date(Date.now() + CONNECTION_FRESH_MS).toISOString(),
  });
}

/** One-line summary for the assistant's system prompt — e.g. "Gmail, Discord". */
export async function connectedIntegrationsSummary(): Promise<string> {
  const connectedIds = await getConnectedIntegrationIds();
  if (connectedIds.size === 0) return "No integrations are connected yet.";
  const names = INTEGRATIONS.filter((integration) => connectedIds.has(integration.id)).map(
    (integration) => integration.name,
  );
  return `Connected integrations: ${names.join(", ")}. Everything else is not connected.`;
}
