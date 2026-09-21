/**
 * The active watch scope, per conversation.
 *
 * Rust owns it. This is a cache with React bindings, and every mutation is a
 * round trip — there is deliberately no local write path, because a second
 * authority is exactly what made the voice overlay and the Dashboard disagree.
 *
 * The distinction this file exists to hold:
 *
 *   running  → detected. Authorises nothing.
 *   watched  → the user added it. Survives the application closing.
 *   active   → attached to THIS conversation. Only this drives Watch-mode turns.
 *
 * Before the scope existed there was no third state, so a generic question
 * ("what can you do?") scored zero against every watched application's
 * vocabulary, all of them were dropped, and the model answered from the global
 * feature list.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Ability, ApplicationAbilities } from "./watchAbilityTypes";

export interface ActiveWatchEntry {
  appCatalogId: string;
  displayName: string;
  boundInstanceKey?: string;
  running: boolean;
  /**
   * Position in the conversation's activation order — 0 is the most recent.
   *
   * Supplied by Rust so every surface sorts the same way. Optional only because
   * the closed and inactive entries the prompt builder synthesises never came
   * from the scope table and have no place in that order.
   */
  activatedSequence?: number;
}

export interface ActiveWatchScope {
  accountId: string;
  conversationId: string;
  entries: ActiveWatchEntry[];
  mode: "single" | "multiple";
  updatedAt: string;
}

export interface WatchScopeResult {
  scope: ActiveWatchScope;
  abilities: ApplicationAbilities[];
  /** Capability ids the model may be offered this turn. Nothing else. */
  capabilityIds: string[];
  /** Claimed ids that failed validation — a stale UI, not a secret. */
  rejectedClaims: string[];
  /** True when the scope was inferred rather than chosen. */
  implicit: boolean;
}

const EMPTY: WatchScopeResult = {
  scope: {
    accountId: "",
    conversationId: "",
    entries: [],
    mode: "single",
    updatedAt: "",
  },
  abilities: [],
  capabilityIds: [],
  rejectedClaims: [],
  implicit: false,
};

/** conversationId → last known scope. */
const byConversation = new Map<string, WatchScopeResult>();
const listeners = new Set<() => void>();
let currentConversationId: string | null = null;
/** Referentially stable snapshot for `useSyncExternalStore`. */
let snapshot: WatchScopeResult = EMPTY;
const inFlight = new Map<string, Promise<WatchScopeResult>>();

function emit() {
  snapshot = currentConversationId
    ? (byConversation.get(currentConversationId) ?? EMPTY)
    : EMPTY;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Tell the store which conversation the UI is showing.
 *
 * The composer indicator and the message badge both read "the active scope",
 * and without this they would read whichever conversation last refreshed.
 */
export function setCurrentConversation(conversationId: string | null): void {
  if (currentConversationId === conversationId) return;
  currentConversationId = conversationId;
  emit();
  if (conversationId) void refreshWatchScope(conversationId);
}

export function currentConversation(): string | null {
  return currentConversationId;
}

export function getWatchScope(conversationId?: string): WatchScopeResult {
  const id = conversationId ?? currentConversationId;
  if (!id) return EMPTY;
  return byConversation.get(id) ?? EMPTY;
}

/**
 * Read the scope from Rust, validating any ids we believe are active.
 *
 * Concurrent calls for one conversation share a single request: the composer,
 * the card and the send path all ask at once on first paint, and three
 * identical round trips would be three chances to render a different answer.
 */
export async function refreshWatchScope(
  conversationId: string,
  claimedApplicationIds?: string[],
): Promise<WatchScopeResult> {
  const existing = inFlight.get(conversationId);
  if (existing) return existing;

  const request = (async () => {
    try {
      const result = await invoke<WatchScopeResult>("watch_scope_get", {
        conversationId,
        claimedApplicationIds: claimedApplicationIds ?? null,
      });
      byConversation.set(conversationId, result);
      emit();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // No user database yet (before sign-in). An empty scope is correct there
      // — nothing is watched, so nothing can be active.
      if (!message.includes("No local database is open")) {
        console.error("[ArcSonare] watch scope read failed:", err);
      }
      byConversation.set(conversationId, EMPTY);
      emit();
      return EMPTY;
    } finally {
      inFlight.delete(conversationId);
    }
  })();

  inFlight.set(conversationId, request);
  return request;
}


/**
 * Everything that must be forgotten when the active application changes.
 *
 * The reported bug: with Spotify active the user activated Discord, asked
 * "tell me what's going on", and got the old Spotify summary. Switching the
 * scope is not enough on its own — the previous application's prompt block,
 * capability envelope, instance key and adapter snapshot were all still
 * cached, and the next turn happily reused them.
 *
 * Old messages stay: they are history. What must not survive is any of it
 * being treated as *current* state.
 */
async function invalidateForScopeChange(): Promise<void> {
  // Bumped first, so anything already in flight is stale the moment the set
  // changes rather than when the clearing finishes.
  scopeVersion += 1;
  await Promise.all([
    import("./watchContextBroker")
      .then(({ invalidateWatchSnapshots }) => invalidateWatchSnapshots())
      .catch(() => undefined),
    import("./watchPromptContext")
      .then(({ clearWatchTurnMemory }) => clearWatchTurnMemory())
      .catch(() => undefined),
  ]);
}

/**
 * Which generation of the active set the app is on.
 *
 * Clearing caches is necessary but not sufficient: a read that was already
 * in flight when the user switched from Spotify to Discord will still resolve,
 * and without a version to check against, its result looks exactly like a fresh
 * one. Anything long-running captures this before it starts and compares after,
 * and discards itself if the number moved.
 *
 * Monotonic and process-wide. A per-conversation counter would let a switch in
 * one conversation silently validate a stale read in another.
 */
let scopeVersion = 0;

export function currentScopeVersion(): number {
  return scopeVersion;
}

/** Did the active set change since `version` was taken? */
export function isScopeVersionStale(version: number): boolean {
  return version !== scopeVersion;
}

export async function setWatchScope(
  conversationId: string,
  appCatalogIds: string[],
): Promise<WatchScopeResult> {
  const result = await invoke<WatchScopeResult>("watch_scope_set", {
    conversationId,
    appCatalogIds,
  });
  byConversation.set(conversationId, result);
  await invalidateForScopeChange();
  emit();
  return result;
}

export async function toggleWatchScope(
  conversationId: string,
  appCatalogId: string,
): Promise<WatchScopeResult> {
  const result = await invoke<WatchScopeResult>("watch_scope_toggle", {
    conversationId,
    appCatalogId,
  });
  byConversation.set(conversationId, result);
  await invalidateForScopeChange();
  emit();
  return result;
}

export async function bindScopeInstance(
  conversationId: string,
  appCatalogId: string,
  instanceKey: string | null,
): Promise<WatchScopeResult> {
  const result = await invoke<WatchScopeResult>("watch_scope_bind_instance", {
    conversationId,
    appCatalogId,
    instanceKey,
  });
  byConversation.set(conversationId, result);
  await invalidateForScopeChange();
  emit();
  return result;
}

/** Drop everything on account switch — a rendered scope is a visible leak. */
export function clearAllWatchScopes(): void {
  byConversation.clear();
  emit();
}

/** Re-read every conversation we hold, after a watch change elsewhere. */
export async function revalidateWatchScopes(): Promise<void> {
  const ids = [...byConversation.keys()];
  await Promise.all(ids.map((id) => refreshWatchScope(id)));
}

// ---------------------------------------------------------------------------
// Derived reads
// ---------------------------------------------------------------------------

/** True when this conversation is scoped to at least one application. */
export function isWatchScoped(conversationId?: string): boolean {
  return getWatchScope(conversationId).scope.entries.length > 0;
}

/**
 * The structured identifiers a message envelope must carry.
 *
 * Deliberately ids and instance keys rather than labels: the backend reloads
 * them, and a label cannot be reloaded.
 */
export function watchEnvelopeFor(conversationId: string): {
  contextMode: "watch" | "global";
  activeWatchedApplicationIds: string[];
  activeInstanceIds: string[];
} {
  const { scope } = getWatchScope(conversationId);
  if (scope.entries.length === 0) {
    return {
      contextMode: "global",
      activeWatchedApplicationIds: [],
      activeInstanceIds: [],
    };
  }
  return {
    contextMode: "watch",
    activeWatchedApplicationIds: scope.entries.map((e) => e.appCatalogId),
    activeInstanceIds: scope.entries
      .map((e) => e.boundInstanceKey)
      .filter((k): k is string => Boolean(k)),
  };
}

/** Abilities usable right now, across every active application. */
export function abilitiesAvailableNow(conversationId?: string): Ability[] {
  return getWatchScope(conversationId)
    .abilities.flatMap((app) => app.abilities)
    .filter((a) => a.availability === "now");
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useWatchScope(): WatchScopeResult {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** The applications shown on the composer pill. */
export function useActiveWatchedApps(): ActiveWatchEntry[] {
  return useWatchScope().scope.entries;
}
