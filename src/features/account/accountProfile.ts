/**
 * Local account profile — stored on-device. Cloud fields overlay when signed in.
 */
import { setProfileDisplayName } from "../../stores/appStore";
import { loadLocalAccount } from "../../auth/localAccount";

export const PROFILE_KEY = "arcsonare.accountProfile.v1";
export const PROFILE_CHANGED_EVENT = "arcsonare:account-profile-changed";

export interface AccountProfile {
  fullName: string;
  displayName: string;
  timeZone: string;
  language: string;
  pronunciation: string;
  avatarDataUrl: string;
}

export const DEFAULT_PROFILE: AccountProfile = {
  fullName: "",
  displayName: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  language: "English",
  pronunciation: "",
  avatarDataUrl: "",
};

const LEGACY_DEMO_NAMES = new Set(["robera", "demo", "guest user", "test user"]);

function isLegacyDemoName(value: string): boolean {
  return LEGACY_DEMO_NAMES.has(value.trim().toLowerCase());
}

/** Older builds seeded a fake "Robera" profile. Strip it on load. */
function stripLegacyDemoName(profile: AccountProfile): AccountProfile {
  const fullIsDemo = isLegacyDemoName(profile.fullName);
  const displayIsDemo = isLegacyDemoName(profile.displayName);
  if (!fullIsDemo && !displayIsDemo) return profile;

  return {
    ...profile,
    fullName: fullIsDemo ? "" : profile.fullName,
    displayName: displayIsDemo ? "" : profile.displayName,
  };
}

export function loadAccountProfile(): AccountProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const cleaned = stripLegacyDemoName({
        ...DEFAULT_PROFILE,
        ...JSON.parse(raw),
      });
      // Persist the cleanup so the fake name does not keep coming back.
      const original = JSON.parse(raw) as Partial<AccountProfile>;
      if (
        original.fullName !== cleaned.fullName ||
        original.displayName !== cleaned.displayName
      ) {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify(cleaned));
      }
      return cleaned;
    }
  } catch {
    // ignore corrupt storage
  }
  return { ...DEFAULT_PROFILE };
}

export function saveAccountProfile(profile: AccountProfile) {
  const cleaned = stripLegacyDemoName(profile);
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(cleaned));
  const label = cleaned.displayName.trim() || cleaned.fullName.trim();
  setProfileDisplayName(label);
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

export function clearAccountProfile() {
  window.localStorage.removeItem(PROFILE_KEY);
  setProfileDisplayName("");
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

/** Sync Dashboard greeting from the saved local profile (call once at boot). */
export function hydrateProfileDisplayName() {
  const profile = loadAccountProfile();
  // Fall back to the account username. A freshly created account has no
  // profile yet, which left the dashboard greeting as "Good evening," with
  // nothing after the comma.
  const account = loadLocalAccount();
  // Prefer the full name the person typed at sign-up (stored on the account as
  // displayName). The username is a login handle, not what to greet them by —
  // it made the dashboard say "Good evening, hunter22".
  setProfileDisplayName(
    profile.displayName.trim() ||
      profile.fullName.trim() ||
      account?.displayName.trim() ||
      account?.username.trim() ||
      "",
  );
}

export function profileInitials(profile: AccountProfile): string {
  const source = profile.displayName.trim() || profile.fullName.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/** Prefer the signed-in account's name; keep local avatar / edits. */
export function mergeAuthIntoProfile(
  local: AccountProfile,
  auth: { displayName?: string | null } | null,
): AccountProfile {
  if (!auth) return stripLegacyDemoName(local);
  const accountName = auth.displayName?.trim() || "";
  return {
    ...local,
    displayName: local.displayName.trim() || accountName,
    fullName: local.fullName.trim() || accountName,
  };
}
