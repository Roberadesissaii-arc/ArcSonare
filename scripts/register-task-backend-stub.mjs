/**
 * A working fake of the task half of the Rust backend, so the store can be
 * driven end to end under Node.
 *
 * `register-renderer-stub.mjs` deliberately makes `invoke` reject — nothing
 * there is allowed to reach the machine. But the task-deletion defect lives in
 * the round trip *between* the store and the database: write, commit, event,
 * rehydrate. A rejecting invoke cannot express that, and a test that only reads
 * SQLite proves the row is gone while the list on screen still shows it, which
 * is exactly the bug that shipped.
 *
 * So this implements the four task commands against an in-memory table with
 * the same soft-delete semantics as `src-tauri/src/database/tasks.rs`
 * (`WHERE deleted_at IS NULL`), and emits `arcsonare://tasks-changed` after the
 * "commit" the way the Rust commands do.
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

/** id → row. `deletedAt` is the soft-delete marker, as in SQLite. */
const rows = new Map();
/** callback id → handler, populated through `transformCallback`. */
const callbacks = new Map();
/** event name → Set of callback ids. */
const subscriptions = new Map();
let nextId = 1;

/** Counters a test can assert on — how many times each command actually ran. */
export const backendCalls = {
  list: 0,
  get: 0,
  upsert: 0,
  delete: 0,
  eventsEmitted: 0,
};

function emitEvent(name, payload) {
  backendCalls.eventsEmitted += 1;
  for (const id of subscriptions.get(name) ?? []) {
    const cb = callbacks.get(id);
    // Tauri delivers asynchronously; doing it synchronously here would hide
    // ordering bugs that only appear with a real IPC hop.
    if (cb) queueMicrotask(() => cb({ event: name, id, payload }));
  }
}

function toRow(task) {
  const now = new Date().toISOString();
  const existing = rows.get(task.id);
  return {
    id: task.id,
    title: task.title ?? "",
    description: task.note ?? null,
    status: task.completed ? "completed" : "open",
    priority: task.priority ?? "medium",
    dueAt: task.due ?? null,
    assignedAgentId: task.agentId ?? task.agent ?? null,
    progress: typeof task.progress === "number" ? task.progress : 0,
    tagsJson: JSON.stringify(task.tags ?? []),
    configurationJson: JSON.stringify(task),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: task.completed ? now : null,
    // An upsert never resurrects a deleted row on its own.
    deletedAt: existing?.deletedAt ?? null,
  };
}

const commands = {
  tasks_list_local() {
    backendCalls.list += 1;
    return [...rows.values()].filter((r) => r.deletedAt === null);
  },
  tasks_get_local({ taskId }) {
    backendCalls.get += 1;
    const row = rows.get(taskId);
    return row && row.deletedAt === null ? row : null;
  },
  tasks_upsert_local({ task }) {
    backendCalls.upsert += 1;
    const row = toRow(task);
    rows.set(row.id, row);
    emitEvent("arcsonare://tasks-changed", row.id);
    return row;
  },
  tasks_soft_delete_local({ taskId }) {
    backendCalls.delete += 1;
    const row = rows.get(taskId);
    if (row) row.deletedAt = new Date().toISOString();
    emitEvent("arcsonare://tasks-changed", taskId);
    return null;
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

/** Test helpers, reachable through `globalThis.__taskBackend`. */
export const taskBackend = {
  rows,
  reset() {
    rows.clear();
    backendCalls.list = 0;
    backendCalls.get = 0;
    backendCalls.upsert = 0;
    backendCalls.delete = 0;
    backendCalls.eventsEmitted = 0;
  },
  /** Rows the app would see — the `deleted_at IS NULL` query. */
  liveRows: () => [...rows.values()].filter((r) => r.deletedAt === null),
  /** True when the row exists but is soft-deleted: the durable half succeeded. */
  isSoftDeleted: (id) => Boolean(rows.get(id)?.deletedAt),
  calls: backendCalls,
  /** Let queued event callbacks and their async handlers run. */
  settle: async (turns = 6) => {
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
globalThis.__taskBackend = taskBackend;
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
