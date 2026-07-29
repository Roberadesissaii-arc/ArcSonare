/**
 * The local account — stored in localStorage only. No network, no cloud
 * account. Maps to its own local SQLite database (see database_open_for_user).
 * The account record survives logout; only the session marker is cleared,
 * so signing back in only requires username + password, not re-creation.
 */

const LOCAL_ACCOUNT_KEY = "arcsonare.localAccount.v1";
const SESSION_KEY = "arcsonare.session.v1";

export interface LocalAccount {
  userId: string;
  displayName: string;
  username: string;
  passwordHash: string;
}

export function loadLocalAccount(): LocalAccount | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalAccount>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.displayName !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.passwordHash !== "string"
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      displayName: parsed.displayName,
      username: parsed.username,
      passwordHash: parsed.passwordHash,
    };
  } catch {
    return null;
  }
}

export function saveLocalAccount(account: LocalAccount): void {
  window.localStorage.setItem(LOCAL_ACCOUNT_KEY, JSON.stringify(account));
}

export function clearLocalAccount(): void {
  window.localStorage.removeItem(LOCAL_ACCOUNT_KEY);
}

/** Whether this device currently has an unlocked session (vs. signed out). */
export function hasActiveSession(): boolean {
  return window.localStorage.getItem(SESSION_KEY) === "1";
}

export function markSessionActive(): void {
  window.localStorage.setItem(SESSION_KEY, "1");
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}
