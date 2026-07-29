import { invoke } from "@tauri-apps/api/core";
import { setAuthState } from "./authStore";
import { patchPrefs } from "../stores/settingsStore";
import {
  clearLocalAccount,
  clearSession,
  hasActiveSession,
  loadLocalAccount,
  markSessionActive,
  saveLocalAccount,
  type LocalAccount,
} from "./localAccount";

/** Single-flight bootstrap — AuthWelcome must not re-enter "initializing". */
let authBootstrap: Promise<void> | null = null;

function unlockOverlay() {
  patchPrefs("general", { overlayUnlocked: true });
  void invoke("set_overlay_unlocked", { unlocked: true }).catch((err) => {
    console.error("[ArcSonare] set_overlay_unlocked failed:", err);
  });
}

function lockOverlay() {
  patchPrefs("general", { overlayUnlocked: false });
  void invoke("set_overlay_unlocked", { unlocked: false }).catch((err) => {
    console.error("[ArcSonare] set_overlay_unlocked failed:", err);
  });
}

async function openUserDatabase(userId: string): Promise<void> {
  await invoke("database_open_for_user", { userId }).catch((err) => {
    console.error("[ArcSonare] database_open_for_user failed:", err);
  });
  // Dashboard hydrates on shell mount (often while still on auth). Refresh after
  // the user DB is actually open so tasks/agents load for the signed-in account.
  void import("../stores/taskStore").then((m) => m.hydrateTasksFromDb());
  void import("../features/agents/agentStore").then((m) => m.hydrateAgentsFromDb());
}

export async function initializeAuth(): Promise<void> {
  if (authBootstrap) return authBootstrap;
  authBootstrap = runAuthBootstrap();
  return authBootstrap;
}

async function runAuthBootstrap(): Promise<void> {
  const account = loadLocalAccount();
  if (!account) {
    setAuthState("signed-out", { error: null, user: null });
    return;
  }

  if (hasActiveSession()) {
    // Still in an active session (app relaunch, not an explicit sign-out) —
    // macOS-style lock screen: just the password, name/avatar already known.
    setAuthState("locked", {
      user: { id: account.userId, email: null, displayName: account.displayName },
      error: null,
    });
    return;
  }

  // Signed out earlier — the account survives, but signing back in needs
  // username + password rather than full re-creation.
  setAuthState("needs-sign-in", { error: null, user: null });
}

async function completeSignIn(userId: string, displayName: string): Promise<void> {
  await openUserDatabase(userId);
  unlockOverlay();
  markSessionActive();
  setAuthState("signed-in", {
    user: { id: userId, email: null, displayName },
    lastValidatedAt: new Date().toISOString(),
    error: null,
  });
}

/** Creates the local account on this device. No network calls, no plaintext at rest. */
export async function createLocalAccount(
  displayName: string,
  username: string,
  password: string,
): Promise<void> {
  const trimmedName = displayName.trim();
  if (!trimmedName) {
    throw new Error("Enter a name to create your account.");
  }
  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    throw new Error("Choose a username.");
  }
  if (password.length < 4) {
    throw new Error("Choose a password with at least 4 characters.");
  }
  setAuthState("signing-in", { error: null });
  const userId = crypto.randomUUID();
  const passwordHash = await invoke<string>("hash_local_password", { password });
  saveLocalAccount({
    userId,
    displayName: trimmedName,
    username: trimmedUsername,
    passwordHash,
  });
  await completeSignIn(userId, trimmedName);
}

/** Verifies the password for the account already known this session and signs in. */
export async function unlockWithPassword(password: string): Promise<void> {
  const account = loadLocalAccount();
  if (!account) {
    throw new Error("No local account found on this device.");
  }
  const ok = await invoke<boolean>("verify_local_password", {
    password,
    hash: account.passwordHash,
  });
  if (!ok) {
    throw new Error("That password isn't right. Try again.");
  }
  await completeSignIn(account.userId, account.displayName);
}

/** Signs back in after an explicit logout — requires username + password. */
export async function signInWithUsername(
  username: string,
  password: string,
): Promise<void> {
  const account = loadLocalAccount();
  if (!account) {
    throw new Error("No local account found on this device.");
  }
  if (account.username !== username.trim()) {
    throw new Error("That username isn't right. Try again.");
  }
  const ok = await invoke<boolean>("verify_local_password", {
    password,
    hash: account.passwordHash,
  });
  if (!ok) {
    throw new Error("That password isn't right. Try again.");
  }
  await completeSignIn(account.userId, account.displayName);
}

function nextSignedOutState(account: LocalAccount | null) {
  setAuthState(account ? "needs-sign-in" : "signed-out", {
    user: null,
    lastValidatedAt: null,
    error: null,
  });
}

export async function signOut(options?: {
  removeLocalData?: boolean;
}): Promise<void> {
  clearSession();
  await invoke("database_close_current_user").catch(() => undefined);
  if (options?.removeLocalData) {
    clearLocalAccount();
    await invoke("database_remove_current_user_files").catch(() => undefined);
  }
  await invoke("database_open_guest").catch(() => undefined);
  lockOverlay();
  nextSignedOutState(loadLocalAccount());
}
