/**
 * Local account profile — stored on-device only. No cloud account exists yet.
 */
import { setProfileDisplayName } from "../../stores/appStore";

export const PROFILE_KEY = "arcsonare.accountProfile.v1";

export interface AccountProfile {
  fullName: string;
  displayName: string;
  email: string;
  timeZone: string;
  language: string;
  pronunciation: string;
  avatarDataUrl: string;
}

export const DEFAULT_PROFILE: AccountProfile = {
  fullName: "Robera",
  displayName: "Robera",
  email: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  language: "English",
  pronunciation: "",
  avatarDataUrl: "",
};

export function loadAccountProfile(): AccountProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    // ignore corrupt storage
  }
  return { ...DEFAULT_PROFILE };
}

export function saveAccountProfile(profile: AccountProfile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  setProfileDisplayName(profile.displayName || profile.fullName || "Robera");
}

export function clearAccountProfile() {
  window.localStorage.removeItem(PROFILE_KEY);
  setProfileDisplayName("Robera");
}

/** Sync Dashboard greeting from the saved local profile (call once at boot). */
export function hydrateProfileDisplayName() {
  const profile = loadAccountProfile();
  setProfileDisplayName(profile.displayName || profile.fullName || "Robera");
}

export function profileInitials(profile: AccountProfile): string {
  const source = profile.displayName || profile.fullName || "A";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
