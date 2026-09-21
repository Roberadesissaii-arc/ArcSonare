/**
 * A working fake of the watch half of the Rust backend.
 *
 * Modelled on `register-task-backend-stub.mjs`, and for the same reason: the
 * defects in this area live in the *round trip* — write, reconcile, event,
 * re-read — and a rejecting `invoke` cannot express any of them. A test that
 * only asserts on frontend state would happily pass while the two windows still
 * disagreed, which is the bug being fixed.
 *
 * The semantics below mirror `src-tauri/src/watch/{store,commands}.rs`:
 *
 *  - watches are soft-deleted, so a stop/restart keeps the privacy policy;
 *  - an application with no running instances becomes `app-closed` rather than
 *    disappearing;
 *  - `paused` survives reconciliation;
 *  - every mutation broadcasts `arcsonare://watch-changed` after it commits;
 *  - each simulated account has its own table, the way each account has its own
 *    SQLite file.
 */
import { register } from "node:module";

register("./asset-stub-loader.mjs", import.meta.url);

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const callbacks = new Map();
const subscriptions = new Map();
let nextId = 1;

export const backendCalls = {
  snapshot: 0,
  add: 0,
  remove: 0,
  resolve: 0,
  scopeGet: 0,
  eventsEmitted: 0,
  /** Adapter capability calls, to prove watch events do not cause provider hits. */
  capabilityExecute: 0,
};

/** account id → Map<appCatalogId, watched row> */
const accounts = new Map();
let currentAccount = "account-a";
/** Instances the fake machine is running. Tests drive this directly. */
let running = [];
/** conversation id → app catalog id */
const sessions = new Map();

function table() {
  if (!accounts.has(currentAccount)) accounts.set(currentAccount, new Map());
  return accounts.get(currentAccount);
}

function emitEvent(name, payload) {
  backendCalls.eventsEmitted += 1;
  for (const id of subscriptions.get(name) ?? []) {
    const cb = callbacks.get(id);
    if (cb) queueMicrotask(() => cb({ event: name, id, payload }));
  }
}

function broadcast(kind, appCatalogId, extra = {}) {
  emitEvent("arcsonare://watch-changed", {
    kind,
    appCatalogId,
    at: new Date().toISOString(),
    ...extra,
  });
}

const SENSITIVE = ["discord", "slack", "outlook", "teams"];

function defaultPolicy(appCatalogId) {
  const sensitive = SENSITIVE.includes(appCatalogId);
  return {
    appIdentity: true,
    windowTitle: !sensitive,
    visibleControls: true,
    visibleText: false,
    documentIdentity: false,
    notifications: false,
    messageContent: false,
    terminalOutput: false,
    sourceCode: false,
    screenshots: false,
    shareWithModelProvider: true,
    redactPaths: sensitive,
  };
}

const DISPLAY_NAMES = {
  spotify: "Spotify",
  vscode: "VS Code",
  cursor: "Cursor",
  discord: "Discord",
  chrome: "Chrome",
  edge: "Edge",
  youtube: "YouTube",
};

const ADAPTERS = {
  spotify: "spotify-desktop",
  vscode: "vscode-bridge",
  cursor: "vscode-bridge",
  discord: "discord-desktop",
  chrome: "browser-window",
  edge: "browser-window",
  youtube: "browser-youtube",
};

function instancesFor(appCatalogId) {
  return running.filter((i) => i.appCatalogId === appCatalogId);
}

/** The reconciliation Rust performs on every snapshot. */
function reconcile() {
  for (const row of table().values()) {
    if (row.deletedAt) continue;
    const live = instancesFor(row.appCatalogId);
    if (row.state === "paused") continue;
    const next = live.length === 0 ? "app-closed" : "watching";
    if (row.state !== next) {
      if (next === "app-closed") {
        broadcast("app-instance-stopped", row.appCatalogId);
      } else {
        broadcast("app-instance-rebound", row.appCatalogId, {
          instanceKey: live[0].instanceKey,
        });
      }
      row.state = next;
    }
  }
}

function snapshotRows() {
  reconcile();
  return [...table().values()]
    .filter((r) => !r.deletedAt)
    .map((r) => ({ ...r, instances: instancesFor(r.appCatalogId) }));
}

function rankRelevant(requestText, activeApp) {
  const lower = requestText.toLowerCase();
  const media = ["play", "pause", "resume", "next", "previous", "playing", "song", "track", "music", "volume"];
  const dev = ["code", "build", "run this", "error", "errors", "crash", "task", "terminal", "debug", "file", "editing"];
  const chat = ["channel", "server", "message", "send", "unread", "chat"];
  const browsing = ["tab", "page", "browser", "back", "forward", "site"];
  const hits = (words) => words.filter((w) => lower.includes(w)).length * 20;

  return snapshotRows()
    .filter((r) => r.state !== "paused")
    .map((r) => {
      let score = 0;
      if (lower.includes(r.displayName.toLowerCase())) score += 100;
      if (lower.includes(r.appCatalogId.replace("-", " "))) score += 90;
      if (activeApp === r.appCatalogId) score += 60;
      if (["spotify", "netflix", "youtube"].includes(r.appCatalogId)) score += hits(media);
      if (["vscode", "cursor"].includes(r.appCatalogId)) score += hits(dev);
      if (["discord", "slack", "teams"].includes(r.appCatalogId)) score += hits(chat);
      if (["chrome", "edge", "firefox", "brave"].includes(r.appCatalogId)) score += hits(browsing);
      if (r.state !== "watching" && r.state !== "stale") score -= 40;
      return { score, row: r };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row);
}

function resolveInstance(row) {
  const live = instancesFor(row.appCatalogId);
  if (live.length === 0 || (row.state !== "watching" && row.state !== "stale")) {
    return { kind: "notRunning", displayName: row.displayName };
  }
  if (row.preferredInstanceKey) {
    const pinned = live.find((i) => i.instanceKey === row.preferredInstanceKey);
    if (pinned) return { kind: "resolved", instance: pinned, reason: "pinned" };
  }
  if (live.length === 1) {
    return { kind: "resolved", instance: live[0], reason: "only-instance" };
  }
  return { kind: "ambiguous", candidates: live };
}

/** conversation id -> active app catalog ids. */
const scopes = new Map();
/** `conversation:app` -> instance key. */
const boundInstances = new Map();

/** Mirrors `abilities_for` closely enough to assert scoping behaviour. */
function abilitiesFor(appCatalogId, displayName, running, messageContent) {
  const now = (label, capabilityId) => ({ label, capabilityId, availability: "now" });
  const no = (label, note) => ({ label, availability: "unsupported", note });
  let list;
  switch (appCatalogId) {
    case "spotify":
      list = [
        now("See what is playing - track, artist and album", "spotify.get_playback"),
        now("Play", "spotify.play"),
        now("Pause", "spotify.pause"),
        now("Skip to the next track", "spotify.next"),
        now("Go back to the previous track", "spotify.previous"),
        now("Bring Spotify to the front", "applications.focus_watched"),
        no("Change the volume", "Windows exposes the mixer level, not Spotify's slider."),
      ];
      break;
    case "discord":
      list = [
        now("See which controls the Discord window exposes", "discord_desktop.get_visible_controls"),
        now("Tell you which server and channel the window says you are in", "discord_desktop.get_current_location"),
        now("Bring Discord to the front", "applications.focus_watched"),
        now("Prepare a message for the channel that is open, and send it after you confirm", "discord_desktop.prepare_message"),
        messageContent
          ? now("Read the messages visible in the window", "discord_desktop.get_visible_messages")
          : no("Read message content", "Turned off in this application's privacy settings."),
        no("Use Discord's API - servers, history, other channels", "ArcSonare has no working Discord connector."),
      ];
      break;
    case "vscode":
    case "cursor":
      list = [
        now("See which file you are editing", "vscode.get_context"),
        now("Read the errors and warnings in this workspace", "vscode.get_diagnostics"),
        now("List the tasks this workspace has configured", "vscode.list_tasks"),
        now("Run one of those configured tasks by name", "vscode.run_task"),
        now("Bring this workspace to the front", "applications.focus_watched"),
        no("Run an arbitrary shell command", "Only declared tasks can be run."),
      ];
      break;
    case "youtube":
      list = [
        now("Tell you which video or channel page is open", "browser.get_page_context"),
        now("Bring the browser window to the front", "applications.focus_watched"),
        now("Go back, forward or reload", "browser.navigate"),
        now("Look up channel details, latest uploads and publish dates", "youtube.list_channel_videos"),
        no("Read the page or the address bar", "That needs a browser extension."),
      ];
      break;
    case "chrome":
    case "edge":
      list = [
        now("Tell you which page this window is showing", "browser.get_page_context"),
        now("Bring this browser window to the front", "applications.focus_watched"),
        now("Go back, forward or reload", "browser.navigate"),
        no("Read the address bar or list the tabs", "That needs a browser extension."),
      ];
      break;
    default:
      list = [
        now("Tell you it is running, and what its window is called", "applications.get_window_context"),
        now("Bring it to the front", "applications.focus_watched"),
        no("Read or control anything inside it", "No adapter has been built for this application."),
      ];
  }
  if (!running) {
    list = list.map((a) =>
      a.availability === "now" ? { ...a, availability: "after-reopening" } : a,
    );
  }
  return {
    appCatalogId,
    displayName,
    running,
    abilities: list,
    summary: running
      ? displayName + " - watched context."
      : displayName + " is watched but isn't running right now.",
  };
}

function buildScope(conversationId, claimed) {
  reconcile();
  const live = new Set(running.map((i) => i.appCatalogId));
  const watchedNow = [...table().values()].filter((r) => !r.deletedAt);

  // Any activated application that is no longer watched drops out here, so a
  // Stop Watching cannot leave a conversation still carrying it. An
  // application that has *closed* is retired the same way — it keeps its watch
  // permission, but it stops being what the conversation is about, mirroring
  // `active_scope` in `scope.rs`.
  let ids = (scopes.get(conversationId) ?? []).filter(
    (id) => watchedNow.some((r) => r.appCatalogId === id) && live.has(id),
  );
  scopes.set(conversationId, [...ids]);
  // No implicit adoption, mirroring `scope_result`. Watched is a standing
  // permission; active is an explicit per-conversation choice and starts empty.
  const implicit = false;

  const rejected = claimed.filter((id) => !ids.includes(id));

  const entries = ids.map((id) => {
    const row = watchedNow.find((r) => r.appCatalogId === id);
    const instances = running.filter((i) => i.appCatalogId === id);
    const boundKey =
      boundInstances.get(conversationId + ":" + id) ??
      (instances.length === 1 ? instances[0].instanceKey : undefined);
    return {
      appCatalogId: id,
      displayName: (row && row.displayName) || id,
      boundInstanceKey: boundKey ?? undefined,
      running: live.has(id),
      // Position in the conversation's activation order; 0 is most recent.
      activatedSequence: ids.indexOf(id),
    };
  });

  const abilities = entries.map((e) => {
    const row = watchedNow.find((r) => r.appCatalogId === e.appCatalogId);
    return abilitiesFor(
      e.appCatalogId,
      e.displayName,
      e.running,
      Boolean(row && row.privacyPolicy && row.privacyPolicy.messageContent),
    );
  });

  const capabilityIds = [
    ...new Set(
      abilities
        .flatMap((a) => a.abilities)
        .filter((a) => a.availability === "now")
        .map((a) => a.capabilityId)
        .filter(Boolean),
    ),
  ].sort();

  return {
    scope: {
      accountId: currentAccount,
      conversationId,
      entries,
      mode: entries.length > 1 ? "multiple" : "single",
      updatedAt: new Date().toISOString(),
    },
    abilities,
    capabilityIds,
    rejectedClaims: rejected,
    implicit,
  };
}

const commands = {
  watch_snapshot() {
    backendCalls.snapshot += 1;
    return {
      watched: snapshotRows(),
      running: [...running],
      capturedAt: new Date().toISOString(),
    };
  },
  watch_running_instances: () => [...running],
  watch_add({ appCatalogId }) {
    backendCalls.add += 1;
    const existing = table().get(appCatalogId);
    if (existing) {
      // Revival keeps the policy and the pin — the soft-delete semantics.
      existing.deletedAt = null;
      existing.state = "watching";
    } else {
      table().set(appCatalogId, {
        id: `wa-${appCatalogId}`,
        appCatalogId,
        displayName: DISPLAY_NAMES[appCatalogId] ?? appCatalogId,
        state: "watching",
        preferredInstanceKey: undefined,
        privacyPolicy: defaultPolicy(appCatalogId),
        enabledContextProviders: [],
        enabledActionProviders: [],
        adapterId: ADAPTERS[appCatalogId],
        adapterHealth: "unknown",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        instances: [],
      });
    }
    broadcast("watched-app-added", appCatalogId);
    return { ...table().get(appCatalogId), instances: instancesFor(appCatalogId) };
  },
  watch_remove({ appCatalogId }) {
    backendCalls.remove += 1;
    const row = table().get(appCatalogId);
    if (!row || row.deletedAt) return false;
    row.deletedAt = new Date().toISOString();
    for (const [conversation, app] of sessions) {
      if (app === appCatalogId) sessions.delete(conversation);
    }
    broadcast("watched-app-removed", appCatalogId);
    return true;
  },
  watch_set_paused({ appCatalogId, paused }) {
    const row = table().get(appCatalogId);
    if (!row) return false;
    row.state = paused ? "paused" : "watching";
    broadcast("watched-app-updated", appCatalogId);
    return true;
  },
  watch_pin_instance({ appCatalogId, instanceKey }) {
    const row = table().get(appCatalogId);
    if (row) row.preferredInstanceKey = instanceKey ?? undefined;
    broadcast("watched-app-updated", appCatalogId);
    return null;
  },
  watch_set_privacy({ appCatalogId, policy }) {
    const row = table().get(appCatalogId);
    if (row) row.privacyPolicy = { ...policy };
    broadcast("watched-app-updated", appCatalogId);
    return null;
  },
  watch_report_adapter_health({ appCatalogId, health, message }) {
    const row = table().get(appCatalogId);
    if (row) {
      row.adapterHealth = health;
      row.adapterMessage = message;
    }
    broadcast(health === "error" ? "app-adapter-error" : "watched-app-updated", appCatalogId);
    return null;
  },
  watch_resolve({ request }) {
    backendCalls.resolve += 1;
    const active = request.conversationId ? sessions.get(request.conversationId) : undefined;
    const rows = request.appCatalogId
      ? snapshotRows().filter((r) => r.appCatalogId === request.appCatalogId)
      : rankRelevant(request.requestText ?? "", active);
    const candidates = rows.map((row) => ({
      application: row,
      resolution: resolveInstance(row),
    }));
    const liveCount = candidates.filter(
      (c) => c.application.state === "watching" || c.application.state === "stale",
    ).length;
    return {
      candidates,
      needsClarification:
        liveCount > 1 || candidates.some((c) => c.resolution.kind === "ambiguous"),
      capturedAt: new Date().toISOString(),
    };
  },
  watch_bind({ conversationId, appCatalogId }) {
    sessions.set(conversationId, appCatalogId);
    broadcast("active-watched-app-changed", appCatalogId, { conversationId });
    return null;
  },

  // ---- active conversation scope -----------------------------------------
  // Mirrors `src-tauri/src/watch/{scope,abilities}.rs`: ids are validated
  // against the watch table, an unwatched id cannot be activated, and a single
  // watched application is adopted implicitly so a generic question still
  // resolves to it instead of falling through to the global feature list.
  watch_scope_get({ conversationId, claimedApplicationIds }) {
    backendCalls.scopeGet += 1;
    return buildScope(conversationId, claimedApplicationIds ?? []);
  },
  watch_scope_set({ conversationId, appCatalogIds }) {
    for (const id of appCatalogIds) {
      const row = table().get(id);
      if (!row || row.deletedAt) {
        throw new Error(id + " is not being watched, so it cannot be activated.");
      }
    }
    scopes.set(conversationId, [...appCatalogIds]);
    broadcast("active-watched-app-changed", undefined, { conversationId });
    return buildScope(conversationId, []);
  },
  watch_scope_toggle({ conversationId, appCatalogId }) {
    const row = table().get(appCatalogId);
    if (!row || row.deletedAt) {
      throw new Error(appCatalogId + " is not being watched, so it cannot be activated.");
    }
    const current = scopes.get(conversationId) ?? [];
    // Newest activation first, mirroring `active_scope`'s
    // `ORDER BY s.created_at DESC`. The list is stored in that order so the
    // stub and Rust hand the frontend the same sequence.
    scopes.set(
      conversationId,
      current.includes(appCatalogId)
        ? current.filter((id) => id !== appCatalogId)
        : [appCatalogId, ...current],
    );
    broadcast("active-watched-app-changed", appCatalogId, { conversationId });
    return buildScope(conversationId, []);
  },
  watch_scope_bind_instance({ conversationId, appCatalogId, instanceKey }) {
    boundInstances.set(conversationId + ":" + appCatalogId, instanceKey ?? null);
    return buildScope(conversationId, []);
  },
  watch_clear_conversation({ conversationId }) {
    sessions.delete(conversationId);
    return null;
  },
  watch_focus_instance({ instanceKey }) {
    const found = running.find((i) => i.instanceKey === instanceKey);
    if (!found) throw new Error("That instance is no longer running.");
    watchBackend.focusCalls.push(instanceKey);
    return { focused: true, instanceKey, processId: found.processId };
  },
  watch_account_changed: () => null,
  capability_execute({ capabilityId }) {
    backendCalls.capabilityExecute += 1;
    watchBackend.capabilityCalls.push(capabilityId);
    const handler = watchBackend.capabilityResponses[capabilityId];
    if (handler) return handler();
    return {
      callId: "c1",
      capabilityId,
      status: "unsupported",
      summary: `no stub for ${capabilityId}`,
      evidence: { verified: false, method: "not-verifiable" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
  },
  "plugin:event|listen"({ event, handler }) {
    if (!subscriptions.has(event)) subscriptions.set(event, new Set());
    subscriptions.get(event).add(handler);
    return handler;
  },
  "plugin:event|unlisten"({ event, eventId }) {
    subscriptions.get(event)?.delete(eventId);
    return null;
  },
  database_open_guest: () => null,
};

export const watchBackend = {
  /** Replace the fake machine's running instances. */
  setRunning(instances) {
    running = instances.map((i) => ({
      id: `inst-${i.instanceKey}`,
      processId: 1000,
      executableName: `${i.appCatalogId}.exe`,
      state: "running",
      lastSeenAt: new Date().toISOString(),
      ...i,
    }));
  },
  /** Simulate an application quitting. */
  stopApp(appCatalogId) {
    running = running.filter((i) => i.appCatalogId !== appCatalogId);
  },
  switchAccount(id) {
    currentAccount = id;
    sessions.clear();
    scopes.clear();
    boundInstances.clear();
  },
  currentAccount: () => currentAccount,
  rows: () => [...table().values()],
  scopeOf: (conversationId) => scopes.get(conversationId) ?? [],
  /** Rows including soft-deleted ones — proves a stop did not hard-delete. */
  rawRow: (appCatalogId) => table().get(appCatalogId) ?? null,
  focusCalls: [],
  capabilityCalls: [],
  capabilityResponses: {},
  calls: backendCalls,
  reset() {
    accounts.clear();
    sessions.clear();
    running = [];
    scopes.clear();
    boundInstances.clear();
    currentAccount = "account-a";
    store.clear();
    watchBackend.focusCalls.length = 0;
    watchBackend.capabilityCalls.length = 0;
    watchBackend.capabilityResponses = {};
    for (const key of Object.keys(backendCalls)) backendCalls[key] = 0;
  },
  settle: async (turns = 8) => {
    for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0));
  },
};

const noop = () => {};
globalThis.window = globalThis;
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.dispatchEvent = () => true;
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener: noop,
  removeEventListener: noop,
});
globalThis.__watchBackend = watchBackend;
globalThis.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  invoke: async (cmd, args) => {
    const handler = commands[cmd];
    if (!handler) throw new Error(`no stub for command "${cmd}"`);
    return handler(args ?? {});
  },
  transformCallback: (callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  },
  convertFileSrc: (p) => p,
};
