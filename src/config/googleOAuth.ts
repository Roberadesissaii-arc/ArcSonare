/**
 * Google OAuth Client ID resolution + Connect helpers.
 * Prefs override wins (paste in Settings → Integrations); else Vite env.
 *
 * One Google sign-in covers the services implemented in the integration
 * reference: Gmail, Calendar, and Drive.
 * Tokens live under a shared Credential Manager key (Rust).
 */
import { getPrefs } from "../stores/settingsStore";
import type { IntegrationId } from "./iconRegistry";

/** Shared token + metadata account for all Google Workspace cards. */
export const GOOGLE_SHARED_ACCOUNT_ID = "local:google";

export const GOOGLE_INTEGRATION_IDS: IntegrationId[] = [
  "gmail",
  "googleCalendar",
  "googleDrive",
];

export function isGoogleIntegration(id: string): boolean {
  return (GOOGLE_INTEGRATION_IDS as string[]).includes(id);
}

export function getGoogleOAuthClientId(): string {
  const fromPrefs = getPrefs().integrations.googleOAuthClientId.trim();
  if (fromPrefs) return fromPrefs;
  return (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? "";
}

export function hasGoogleOAuthClientId(): boolean {
  return getGoogleOAuthClientId().length > 0;
}

/** Full Google scope set — one consent connects every Google card. */
export function allGoogleScopes(): string[] {
  return [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "email",
  ];
}

/** @deprecated Prefer allGoogleScopes() — kept for call sites that pass an id. */
export function googleScopesForIntegration(_integrationId: string): string[] {
  return allGoogleScopes();
}

export type GoogleOAuthConnectResult = {
  accountId: string;
  email?: string | null;
  accountLabel: string;
  scopes: string[];
};

export type GoogleOAuthStatus = {
  connected: boolean;
  email?: string | null;
  scopes: string[];
};
