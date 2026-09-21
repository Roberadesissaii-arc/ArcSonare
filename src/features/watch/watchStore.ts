/**
 * The watched-application store. Rust-owned, account-scoped, event-synced.
 *
 * Replaces `contextActivationStore`, which held a `Set<string>` of catalog ids
 * in `localStorage`. That store had three defects no frontend change could fix:
 *
 *  - `sonare-overlay` is a separate WebView2 heap, so the voice agent and the
 *    Dashboard held two different sets and neither saw the other change;
 *  - browser storage is keyed by origin, not by account, so signing out left
 *    the previous account's watches in place;
 *  - it was pruned against the running-process list on every poll, so closing
 *    an application silently deleted the user's choice.
 *
 * Everything here is a cache of what Rust says. Mutations go to Rust and the
 * refreshed snapshot comes back through `arcsonare://watch-changed`, which is
 * the one signal every window genuinely shares.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  PrivacyPolicy,
  ResolveOutcome,
  RunningAppInstance,
  WatchEvent,
  WatchSnapshot,
  WatchedApplication,
} from "./watchTypes";

/** Keys the old localStorage store used. Removed once, never written again. */
const LEGACY_ACTIVE_KEY = "arcsonare.dashboard.contextApps.active.v1";
const LEGACY_WATCH_ALL_KEY = "arcsonare.dashboard.contextApps.watchAll.v1";
const LEGACY_MIGRATED_FLAG = "arcsonare.watch.migratedFromLocalStorage.v1";

const EMPTY: WatchSnapshot = { watched: [], running: [], capturedAt: "" };

let snapshot: WatchSnapshot = EMPTY;
let hydrated = false;
let inFlight: Promise<WatchSnapshot> | null = null;
/** A change landed while a read was in flight, so that read is already stale. */
let refreshAgain = false;

const listeners = new Set<() => void>();
const eventListeners = new Set<(event: WatchEvent) => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Subscribe to raw watch events (instance started/stopped, adapter errors). */
export function onWatchEvent(cb: (event: WatchEvent) => void): () => void {
  eventListeners.add(cb);
  return () => {
    eventListeners.delete(cb);
  };
}

export function getWatchSnapshot(): WatchSnapshot {
  return snapshot;
}

export function isWatchHydrated(): boolean {
  return hydrated;
}

/**
 * Read the authoritative snapshot from Rust.
 *
 * Follows `taskStore`'s discipline for the same reason: a snapshot requested
 * before a write commits does not contain that write, and answering a change
 * event with an older read is how a stale list survives on screen.
 */
export async function refreshWatchSnapshot(): Promise<WatchSnapshot> {
  if (inFlight) {
    refreshAgain = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        refreshAgain = false;
        await readOnce();
      } while (refreshAgain);
    } finally {
      inFlight = null;
    }
    return snapshot;
  })();
  return inFlight;
}

async function readOnce(): Promise<void> {
  try {
    snapshot = await invoke<WatchSnapshot>("watch_snapshot");
    hydrated = true;
    emit();
    await migrateLegacyWatchesOnce();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Before sign-in there is no user database, but the machine still has
    // applications running. Showing an empty list there would be a lie about
    // the computer, so the running half is read on its own.
    if (message.includes("No local database is open")) {
      try {
        const running = await invoke<RunningAppInstance[]>("watch_running_instances");
        snapshot = { watched: [], running, capturedAt: new Date().toISOString() };
        hydrated = true;
        emit();
        return;
      } catch (fallbackErr) {
        console.error("[ArcSonare] running-instance read failed:", fallbackErr);
      }
    }
    console.error("[ArcSonare] watch snapshot failed:", err);
    hydrated = true;
    emit();
  }
}

/**
 * Move any watches the user made under the old store into the real one, once.
 *
 * Deliberately additive and one-way: it never deletes a Rust-side watch, and it
 * runs only when the account has none, so a user who has already curated their
 * watch list is not overwritten by a stale browser key.
 */
async function migrateLegacyWatchesOnce(): Promise<void> {
  let legacy: string[] = [];
  try {
    if (window.localStorage.getItem(LEGACY_MIGRATED_FLAG) === "1") return;
    if (snapshot.watched.length > 0) {
      window.localStorage.setItem(LEGACY_MIGRATED_FLAG, "1");
      window.localStorage.removeItem(LEGACY_ACTIVE_KEY);
      window.localStorage.removeItem(LEGACY_WATCH_ALL_KEY);
      return;
    }
    const raw = window.localStorage.getItem(LEGACY_ACTIVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    legacy = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return;
  }

  for (const id of legacy) {
    try {
      await invoke("watch_add", { appCatalogId: id });
    } catch (err) {
      console.warn(`[ArcSonare] could not migrate watch "${id}":`, err);
    }
  }
  try {
    window.localStorage.setItem(LEGACY_MIGRATED_FLAG, "1");
    window.localStorage.removeItem(LEGACY_ACTIVE_KEY);
    window.localStorage.removeItem(LEGACY_WATCH_ALL_KEY);
  } catch {
    // Quota or private mode — the flag is an optimisation, not a correctness
    // requirement; the `snapshot.watched.length > 0` guard covers a repeat.
  }
  if (legacy.length > 0) await readOnce();
}

/**
 * Listen for watch changes from any window.
 *
 * Idempotent — every window calls it once at start-up and a second call
 * attaches one listener, not two.
 */
let unlistenWatch: (() => void) | null = null;

export async function listenForWatchChanges(): Promise<void> {
  if (unlistenWatch) return;
  unlistenWatch = () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const stop = await listen<WatchEvent>("arcsonare://watch-changed", (message) => {
      const event = message.payload;
      // An instance that stopped or rebound invalidates anything waiting on it:
      // an approval given for a window that has since closed must not execute
      // against whatever replaced it.
      if (
        event.instanceKey &&
        (event.kind === "app-instance-stopped" ||
          event.kind === "app-instance-rebound")
      ) {
        void import("./watchPendingActions").then(
          ({ invalidateActionsForInstance }) => {
            invalidateActionsForInstance(event.instanceKey!);
          },
        );
        void import("./watchContextBroker").then(({ invalidateWatchSnapshots }) => {
          invalidateWatchSnapshots(event.instanceKey);
        });
      }
      if (event.kind === "watched-app-removed") {
        void import("./watchContextBroker").then(({ invalidateWatchSnapshots }) => {
          invalidateWatchSnapshots();
        });
      }
      // An application that stopped keeps its watch permission but loses every
      // trace of what it *was* doing. Without this the turn memory still named
      // it, so "pause it" after Spotify quit resolved to Spotify and the prompt
      // could still be answered from the track it had been playing.
      if (event.kind === "app-instance-stopped") {
        void import("./watchPromptContext").then(({ clearWatchTurnMemory }) => {
          clearWatchTurnMemory();
        });
      }
      eventListeners.forEach((l) => {
        try {
          l(event);
        } catch (err) {
          console.error("[ArcSonare] watch event listener failed:", err);
        }
      });
      void refreshWatchSnapshot();
    });
    unlistenWatch = stop;
  } catch (err) {
    // No Tauri host (tests, browser preview). Local reads still work; there is
    // simply no other window to hear from.
    unlistenWatch = null;
    console.warn("[ArcSonare] watch change events unavailable:", err);
  }
}

// ---------------------------------------------------------------------------
// Mutations — every one goes to Rust, none mutate the cache directly
// ---------------------------------------------------------------------------

export async function watchApplication(appCatalogId: string): Promise<void> {
  await invoke("watch_add", { appCatalogId });
  await refreshWatchSnapshot();
}

export async function stopWatchingApplication(appCatalogId: string): Promise<void> {
  await invoke("watch_remove", { appCatalogId });
  await refreshWatchSnapshot();
}

export async function setWatchPaused(
  appCatalogId: string,
  paused: boolean,
): Promise<void> {
  await invoke("watch_set_paused", { appCatalogId, paused });
  await refreshWatchSnapshot();
}

export async function pinWatchInstance(
  appCatalogId: string,
  instanceKey: string | null,
): Promise<void> {
  await invoke("watch_pin_instance", { appCatalogId, instanceKey });
  await refreshWatchSnapshot();
}

export async function setWatchPrivacy(
  appCatalogId: string,
  policy: PrivacyPolicy,
): Promise<void> {
  await invoke("watch_set_privacy", { appCatalogId, policy });
  await refreshWatchSnapshot();
}

export async function reportAdapterHealth(
  appCatalogId: string,
  health: "healthy" | "degraded" | "unavailable" | "error",
  message?: string,
): Promise<void> {
  await invoke("watch_report_adapter_health", { appCatalogId, health, message });
}

export async function focusWatchedInstance(
  instanceKey: string,
): Promise<{ focused: boolean }> {
  return invoke<{ focused: boolean }>("watch_focus_instance", { instanceKey });
}

export async function resolveWatchContext(input: {
  requestText: string;
  conversationId?: string;
  appCatalogId?: string;
}): Promise<ResolveOutcome> {
  return invoke<ResolveOutcome>("watch_resolve", { request: input });
}

export async function bindConversationToApp(input: {
  conversationId: string;
  appCatalogId: string;
  instanceKey?: string;
}): Promise<void> {
  await invoke("watch_bind", input);
}

export async function clearConversationWatchContext(
  conversationId: string,
): Promise<void> {
  await invoke("watch_clear_conversation", { conversationId });
}

/**
 * Drop everything when the signed-in account changes.
 *
 * The database file changes on sign-in, so rows are already isolated. This
 * clears the *rendered* state: a window still showing the previous account's
 * list would be a cross-account leak on screen even though storage is clean.
 */
export async function resetWatchStateForAccountChange(): Promise<void> {
  snapshot = EMPTY;
  hydrated = false;
  emit();
  try {
    await invoke("watch_account_changed");
  } catch {
    // Non-Tauri host; the local reset above is the part that matters.
  }
  await refreshWatchSnapshot();
}

// ---------------------------------------------------------------------------
// Derived reads
// ---------------------------------------------------------------------------

/** Watched applications that can supply live context right now. */
export function liveWatchedApplications(): WatchedApplication[] {
  return snapshot.watched.filter(
    (w) => w.state === "watching" || w.state === "stale",
  );
}

export function watchedApplication(
  appCatalogId: string,
): WatchedApplication | undefined {
  return snapshot.watched.find((w) => w.appCatalogId === appCatalogId);
}

export function isWatched(appCatalogId: string): boolean {
  return snapshot.watched.some((w) => w.appCatalogId === appCatalogId);
}

/** Catalog ids currently running, deduplicated. Order follows discovery. */
export function runningCatalogIds(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const instance of snapshot.running) {
    if (seen.has(instance.appCatalogId)) continue;
    seen.add(instance.appCatalogId);
    out.push(instance.appCatalogId);
  }
  return out;
}

export function instancesOf(appCatalogId: string): RunningAppInstance[] {
  return snapshot.running.filter((i) => i.appCatalogId === appCatalogId);
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useWatchSnapshot(): WatchSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function useWatchedApplications(): WatchedApplication[] {
  return useWatchSnapshot().watched;
}

/** True when at least one application is actively watched. */
export function useWatchModeOn(): boolean {
  const watched = useWatchSnapshot().watched;
  return watched.some((w) => w.state !== "paused");
}
