/**
 * Task state — hydrated from SQLite (Tauri) with a one-time localStorage migrate.
 * Demo seeding is disabled for production honesty.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ArcSonareTask,
  Task,
  TaskActivity,
  TaskFilter,
  TaskPrefs,
  TaskSubtask,
} from "../features/tasks/taskTypes";
import {
  computeTaskProgress,
  makeSubtask,
  newActivityId,
  newSubtaskId,
} from "../features/tasks/taskUtils";
import {
  listTasksFromDb,
  softDeleteTaskInDb,
  upsertTaskToDb,
  getTaskFromDb,
} from "../services/taskPersistence";
import { normalizeTaskFromUnknown } from "./taskNormalize";

export type {
  ArcSonareTask,
  DueBucket,
  Task,
  TaskActivity,
  TaskFilter,
  TaskGroupMode,
  TaskPriority,
  TaskPrefs,
  TaskSortMode,
  TaskSubtask,
  TaskViewMode,
} from "../features/tasks/taskTypes";

const STORAGE_KEY = "arcsonare.tasks.v2";
const LEGACY_KEY = "arcsonare.tasks.v1";
const PREFS_KEY = "arcsonare.tasks.prefs.v1";
const MIGRATED_FLAG = "arcsonare.tasks.sqliteMigrated.v1";

const listeners = new Set<() => void>();
const prefsListeners = new Set<() => void>();

const DEFAULT_PREFS: TaskPrefs = {
  sort: "due",
  group: "due",
  view: "list",
  collapsedGroups: [],
  lastSelectedId: null,
};

function activity(
  type: TaskActivity["type"],
  text: string,
  actorType: TaskActivity["actorType"] = "user",
): TaskActivity {
  return {
    id: newActivityId(),
    type,
    text,
    createdAt: new Date().toISOString(),
    actorType,
  };
}

function normalizeTask(
  raw: Partial<ArcSonareTask> & { id: string },
): ArcSonareTask {
  return normalizeTaskFromUnknown(raw);
}

function loadPrefs(): TaskPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TaskPrefs>;
      return { ...DEFAULT_PREFS, ...parsed };
    }
  } catch (err) {
    console.error("[ArcSonare] failed to load task prefs:", err);
  }
  return { ...DEFAULT_PREFS };
}

function readLocalStorageTasks(): ArcSonareTask[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tasks?: unknown } | unknown[];
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { tasks?: unknown }).tasks)
          ? (parsed as { tasks: unknown[] }).tasks
          : null;
      if (list) {
        return list
          .map((item) => normalizeTask(item as Partial<ArcSonareTask> & { id: string }))
          .filter((t) => !t.demo);
      }
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const list = JSON.parse(legacy) as unknown[];
      if (Array.isArray(list)) {
        return list
          .map((item) => normalizeTask(item as Partial<ArcSonareTask> & { id: string }))
          .filter((t) => !t.demo);
      }
    }
  } catch (err) {
    console.error("[ArcSonare] failed to read local tasks:", err);
  }
  return [];
}

let tasks: ArcSonareTask[] = [];
let prefs: TaskPrefs = loadPrefs();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
/** A change landed while a read was in flight, so that read is already stale. */
let hydrateAgain = false;

function persistPrefs() {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error("[ArcSonare] failed to persist task prefs:", err);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function emitPrefs() {
  persistPrefs();
  prefsListeners.forEach((l) => l());
}

function syncTaskAsync(task: ArcSonareTask) {
  void upsertTaskToDb(task).catch((err) =>
    console.error("[ArcSonare] task upsert failed:", err),
  );
}

function deleteTaskAsync(id: string) {
  void softDeleteTaskInDb(id).then(
    () => tombstoneCommitted(id),
    (err) => {
      // The row is still in the database, so stop hiding it from the next
      // snapshot — otherwise a failed delete looks exactly like a successful one.
      untombstone(id);
      console.error("[ArcSonare] task delete failed:", err);
    },
  );
}

function patchTask(
  id: string,
  updater: (task: ArcSonareTask) => ArcSonareTask,
): void {
  let next: ArcSonareTask | null = null;
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    next = { ...updater(t), updatedAt: Date.now(), demo: undefined };
    return next;
  });
  emit();
  if (next) syncTaskAsync(next);
}

/**
 * Load tasks from SQLite. Migrates non-demo localStorage tasks once when DB is empty.
 */
/**
 * Mutations made while a hydration was in flight.
 *
 * Hydration replaces the whole in-memory list with a DB snapshot, and a snapshot
 * taken before a write commits does not contain that write. Anything added in
 * that window would be wiped — which is what made AI-created tasks report
 * success and then vanish — so creates are merged back in when it finishes.
 *
 * Deletes have the mirrored problem and had no mirrored fix: a snapshot taken
 * before the soft-delete committed still contains the row, so when it landed it
 * put the task back on screen. That is the defect where a task was deleted from
 * SQLite and stayed visible in Tasks, Up Next and the galaxy until a reload.
 *
 * Both are timestamped rather than simply cleared at the start of hydration:
 * only a snapshot requested *after* a mutation is guaranteed to reflect it, so
 * that is the condition for dropping the record.
 */
let writesDuringHydration: Array<{ task: ArcSonareTask; at: number }> = [];
/**
 * Deleted ids, held until a snapshot is known to reflect the deletion.
 *
 * `committedAt` stays null until the database write returns. A tombstone is only
 * safe to forget once a hydration was *started after the commit* — anything
 * earlier may still be carrying a snapshot that contains the row.
 */
const tombstones = new Map<string, { committedAt: number | null }>();
/** When the in-flight snapshot was requested. */
let hydrationStartedAt = 0;

/**
 * Apply mutations the snapshot is too old to know about, and forget the ones it
 * already reflects.
 */
function reconcileHydration(snapshot: ArcSonareTask[]): ArcSonareTask[] {
  const startedAt = hydrationStartedAt;

  const deleted = new Set<string>();
  for (const [id, { committedAt }] of tombstones) {
    if (committedAt !== null && startedAt > committedAt) {
      tombstones.delete(id);
    } else {
      deleted.add(id);
    }
  }

  const kept = deleted.size ? snapshot.filter((t) => !deleted.has(t.id)) : snapshot;

  const pending = writesDuringHydration.filter(({ at }) => at >= startedAt);
  writesDuringHydration = pending;
  if (pending.length === 0) return kept;

  const known = new Set(kept.map((t) => t.id));
  const missing = pending
    .filter(({ task }) => !known.has(task.id) && !deleted.has(task.id))
    .map(({ task }) => task);
  return missing.length ? [...missing, ...kept] : kept;
}

/** Start hiding a task that is being deleted, before the write is confirmed. */
function tombstone(id: string) {
  tombstones.set(id, { committedAt: null });
}

/** The write landed; a snapshot taken from now on will already reflect it. */
function tombstoneCommitted(id: string) {
  if (tombstones.has(id)) tombstones.set(id, { committedAt: Date.now() });
}

/** Forget a delete that was rolled back, so hydration stops hiding the task. */
function untombstone(id: string) {
  tombstones.delete(id);
}

export async function hydrateTasksFromDb(): Promise<void> {
  if (hydratePromise) {
    // Do not hand back the in-flight read. Its snapshot was requested before
    // this call, so it cannot contain whatever prompted the call — and what
    // prompts it is usually a `tasks-changed` event announcing a commit that
    // just happened in another window. Answering that with an older snapshot is
    // how a task deleted in the voice overlay stayed on screen here: the local
    // tombstones cannot help, because this window never ran the delete. Ask for
    // one more read instead, and resolve only once it has landed.
    hydrateAgain = true;
    return hydratePromise;
  }
  hydratePromise = (async () => {
    try {
      do {
        hydrateAgain = false;
        // Per pass, not per sequence: tombstone pruning turns on whether the
        // snapshot was requested after the write committed.
        hydrationStartedAt = Date.now();
        await runHydrationPass();
      } while (hydrateAgain);
    } finally {
      // Allow a later call (e.g. after sign-in opens the user DB).
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

/** One read of the database, folded into the list. */
async function runHydrationPass(): Promise<void> {
  try {
    let fromDb = await listTasksFromDb();
    fromDb = fromDb.filter((t) => !t.demo);

    const migrated = window.localStorage.getItem(MIGRATED_FLAG) === "1";
    if (fromDb.length === 0 && !migrated) {
      const local = readLocalStorageTasks();
      for (const task of local) {
        try {
          await upsertTaskToDb({ ...task, demo: undefined });
        } catch (err) {
          console.error("[ArcSonare] migrate task failed:", err);
        }
      }
      window.localStorage.setItem(MIGRATED_FLAG, "1");
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_KEY);
      fromDb = await listTasksFromDb();
    } else if (!migrated) {
      window.localStorage.setItem(MIGRATED_FLAG, "1");
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_KEY);
    }

    tasks = reconcileHydration(fromDb.filter((t) => !t.demo));
    hydrated = true;
    emit();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No local database is open")) {
      try {
        await invoke("database_open_guest");
        const fromDb = await listTasksFromDb();
        tasks = reconcileHydration(fromDb.filter((t) => !t.demo));
        hydrated = true;
        emit();
        return;
      } catch (retryErr) {
        console.error("[ArcSonare] hydrate tasks retry failed:", retryErr);
      }
    }
    console.error("[ArcSonare] hydrate tasks failed:", err);
    // Fallback: non-demo local only (never re-seed demos).
    tasks = reconcileHydration(readLocalStorageTasks());
    hydrated = true;
    emit();
  }
}

export function reloadTasksFromStorage() {
  void hydrateTasksFromDb();
}

/**
 * Re-read the task list whenever any window changes it.
 *
 * Voice runs in the `sonare-overlay` webview and the Tasks page runs in `main`.
 * Those are separate JavaScript heaps: a task created by voice mutated an array
 * the Dashboard could never see, so nothing appeared until a restart. Rust emits
 * `arcsonare://tasks-changed` after the transaction commits, which is the one
 * signal both windows genuinely share.
 *
 * Idempotent — every window calls it once at start-up, and calling it twice
 * attaches one listener.
 */
let tasksChangedUnlisten: (() => void) | null = null;

export async function listenForTaskChanges(): Promise<void> {
  if (tasksChangedUnlisten) return;
  // Placeholder so a second caller during the await does not attach a second
  // listener.
  tasksChangedUnlisten = () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>("arcsonare://tasks-changed", () => {
      void hydrateTasksFromDb();
    });
    tasksChangedUnlisten = unlisten;
  } catch (err) {
    // No Tauri host (tests, browser preview). Local writes still work; there is
    // simply no other window to hear from.
    tasksChangedUnlisten = null;
    console.warn("[ArcSonare] task change events unavailable:", err);
  }
}

export function readPersistedTasks(): ArcSonareTask[] {
  return tasks.slice();
}

export function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addTask(
  input: Omit<
    ArcSonareTask,
    | "id"
    | "completed"
    | "createdAt"
    | "updatedAt"
    | "subtasks"
    | "activity"
    | "tags"
  > & {
    subtasks?: TaskSubtask[];
    tags?: string[];
  },
): ArcSonareTask {
  const task: ArcSonareTask = {
    ...input,
    id: newTaskId(),
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    subtasks: input.subtasks ?? [],
    tags: input.tags ?? [],
    demo: undefined,
    activity: [activity("created", `Created task "${input.title}"`, "user")],
  };
  cacheNewTask(task);
  // Optimistic: correct for a button press, where a later failure is visible
  // and recoverable. `createTaskDurable` deliberately does not come through
  // here, because a tool call turns the return value into a spoken sentence.
  syncTaskAsync(task);
  return task;
}

/**
 * Put a task into the in-memory list without writing it anywhere.
 *
 * Split out so the durable path can own its own write. Calling `addTask` and
 * then writing again produced *two* upserts, and the fire-and-forget one
 * succeeded even when the awaited one failed — so a rejected task was still
 * saved. The durability suite caught that.
 */
function cacheNewTask(task: ArcSonareTask): void {
  tasks = [task, ...tasks];
  // A hydration already in flight holds a DB snapshot taken before this task
  // existed; without this the snapshot would overwrite it and the task would
  // silently disappear from the UI despite being saved.
  if (hydratePromise) writesDuringHydration.push({ task, at: Date.now() });
  emit();
}

/** Build a task record without touching the list or the database. */
function buildTask(input: Parameters<typeof addTask>[0]): ArcSonareTask {
  return {
    ...input,
    id: newTaskId(),
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    subtasks: input.subtasks ?? [],
    tags: input.tags ?? [],
    demo: undefined,
    activity: [activity("created", `Created task "${input.title}"`, "user")],
  };
}

/** What a create attempt actually achieved. Never a bare boolean. */
export type CreateTaskOutcome =
  | { success: true; taskId: string; task: ArcSonareTask; persisted: true }
  | { success: false; errorCode: string; message: string };

/**
 * Create a task and do not return until the database says it exists.
 *
 * `addTask` fires the write and returns immediately, which is correct for a
 * button press — the UI is optimistic and a later failure is recoverable. It is
 * not correct for a tool call, because the caller turns the return value into a
 * spoken sentence. So this awaits the write and then reads the row back from
 * SQLite by id, through a path that touches no in-memory cache.
 *
 * On failure the optimistic task is rolled out of the cache, so a task the user
 * was told could not be saved does not sit in the list until the next reload.
 */
export async function createTaskDurable(
  input: Parameters<typeof addTask>[0],
  options: { idempotencyKey?: string } = {},
): Promise<CreateTaskOutcome> {
  const title = String(input.title ?? "").trim();
  if (!title) {
    return {
      success: false,
      errorCode: "invalid-arguments",
      message: "A task needs a title.",
    };
  }

  // Exactly-once. Voice and tool transports both retry, and a retry must not
  // produce a second task. Keyed on the caller's own request identity because
  // only the caller knows which deliveries are the same request.
  const key = options.idempotencyKey?.trim();
  if (key) {
    const existingId = createdByKey.get(key);
    if (existingId) {
      const already = await getTaskFromDb(existingId).catch(() => null);
      if (already) {
        return { success: true, taskId: already.id, task: already, persisted: true };
      }
    }
  }

  // Built and cached, but not written by `addTask` — this function owns the
  // write so it can await it and act on the failure.
  const task = buildTask({ ...input, title });
  cacheNewTask(task);
  try {
    await upsertTaskToDb(task);
  } catch (err) {
    rollbackTask(task.id);
    return {
      success: false,
      errorCode: "persistence-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const stored = await getTaskFromDb(task.id).catch(() => null);
  if (!stored) {
    rollbackTask(task.id);
    return {
      success: false,
      errorCode: "persistence-failed",
      message: "The task was written but could not be read back.",
    };
  }
  if (key) createdByKey.set(key, stored.id);
  return { success: true, taskId: stored.id, task: stored, persisted: true };
}

/** Idempotency keys seen this session, mapped to the task they created. */
const createdByKey = new Map<string, string>();

/** What a mutation actually achieved. Same discipline as `CreateTaskOutcome`. */
export type MutateTaskOutcome =
  | { success: true; taskId: string; task: ArcSonareTask; persisted: true }
  | { success: false; errorCode: string; message: string };

export type DeleteTaskOutcome =
  | { success: true; taskId: string; persisted: true }
  | { success: false; errorCode: string; message: string };

/** Replace one task in the cache without writing anything. */
function cacheReplace(next: ArcSonareTask): void {
  tasks = tasks.map((t) => (t.id === next.id ? next : t));
  emit();
}

/** Put a removed task back, in its original position where possible. */
function cacheRestore(task: ArcSonareTask, index: number): void {
  const without = tasks.filter((t) => t.id !== task.id);
  const at = Math.max(0, Math.min(index, without.length));
  tasks = [...without.slice(0, at), task, ...without.slice(at)];
  emit();
}

/**
 * Change a task and do not return until SQLite agrees.
 *
 * The mutation equivalent of `createTaskDurable`, and it exists for the same
 * reason: the previous check re-read the in-memory array the change had just
 * been applied to, so "the update did not persist" was unreachable and a failed
 * write was reported as success.
 *
 * `verify` is given the row as SQLite returned it. Each caller asserts its own
 * postcondition there — completed is true, the priority is what was asked for —
 * because "the write returned" and "the field actually changed" are different
 * claims.
 */
export async function mutateTaskDurable(
  id: string,
  updater: (task: ArcSonareTask) => ArcSonareTask,
  verify: (stored: ArcSonareTask) => boolean,
): Promise<MutateTaskOutcome> {
  const previous = tasks.find((t) => t.id === id);
  if (!previous) {
    return { success: false, errorCode: "not-found", message: "That task no longer exists." };
  }
  const next: ArcSonareTask = { ...updater(previous), updatedAt: Date.now(), demo: undefined };
  cacheReplace(next);

  try {
    await upsertTaskToDb(next);
  } catch (err) {
    cacheReplace(previous);
    return {
      success: false,
      errorCode: "persistence-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const stored = await getTaskFromDb(id).catch(() => null);
  if (!stored) {
    cacheReplace(previous);
    return {
      success: false,
      errorCode: "persistence-failed",
      message: "The change was written but the task could not be read back.",
    };
  }
  if (!verify(stored)) {
    // The row exists but does not carry the change. Rolling the cache back keeps
    // the UI honest rather than showing an edit the database never accepted.
    cacheReplace(previous);
    return {
      success: false,
      errorCode: "persistence-mismatch",
      message: "The saved task does not reflect the change.",
    };
  }
  cacheReplace(stored);
  return { success: true, taskId: stored.id, task: stored, persisted: true };
}

/**
 * Delete a task and confirm it is gone from SQLite.
 *
 * Absence is the postcondition, so it is checked by asking the database for the
 * id and requiring nothing back — not by checking that the cache no longer has
 * it, which the removal guaranteed a line earlier.
 */
export async function deleteTaskDurable(id: string): Promise<DeleteTaskOutcome> {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) {
    return { success: false, errorCode: "not-found", message: "That task no longer exists." };
  }
  const previous = tasks[index];
  const previousSelected = prefs.lastSelectedId;

  tasks = tasks.filter((t) => t.id !== id);
  if (prefs.lastSelectedId === id) {
    prefs = { ...prefs, lastSelectedId: null };
    emitPrefs();
  }
  emit();

  const restore = () => {
    untombstone(id);
    cacheRestore(previous, index);
    if (previousSelected === id) {
      prefs = { ...prefs, lastSelectedId: previousSelected };
      emitPrefs();
    }
  };

  // Recorded before the await, not after: any hydration whose snapshot was
  // requested from here on must not be allowed to put the row back, and the
  // snapshot for one already in flight predates the commit.
  tombstone(id);

  try {
    await softDeleteTaskInDb(id);
  } catch (err) {
    restore();
    return {
      success: false,
      errorCode: "persistence-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const stillThere = await getTaskFromDb(id).catch(() => null);
  if (stillThere) {
    restore();
    return {
      success: false,
      errorCode: "persistence-failed",
      message: "The task is still in the database after deletion.",
    };
  }
  tombstoneCommitted(id);
  return { success: true, taskId: id, persisted: true };
}

/** Remove an optimistic task that turned out not to be saved. */
function rollbackTask(id: string) {
  tasks = tasks.filter((t) => t.id !== id);
  writesDuringHydration = writesDuringHydration.filter((w) => w.task.id !== id);
  emit();
}

export function toggleTask(id: string) {
  patchTask(id, (t) => {
    const completed = !t.completed;
    return {
      ...t,
      completed,
      activity: [
        activity(
          completed ? "completed" : "reopened",
          completed ? `Marked "${t.title}" complete` : `Reopened "${t.title}"`,
        ),
        ...t.activity,
      ],
    };
  });
}

export function updateTask(id: string, patch: Partial<ArcSonareTask>) {
  patchTask(id, (t) => {
    const next = { ...t, ...patch, demo: undefined };
    const entries: TaskActivity[] = [];
    if (patch.priority && patch.priority !== t.priority) {
      entries.push(
        activity("priority-changed", `Changed priority to ${patch.priority}`),
      );
    }
    if (patch.agent !== undefined && patch.agent !== t.agent) {
      entries.push(
        activity(
          "agent-assigned",
          patch.agent ? `Assigned to ${patch.agent}` : "Cleared agent assignment",
        ),
      );
    }
    if (patch.title && patch.title !== t.title) {
      entries.push(activity("updated", `Renamed task to "${patch.title}"`));
    }
    if (entries.length > 0) {
      next.activity = [...entries, ...t.activity];
    }
    return next;
  });
}

export function removeTask(id: string) {
  tasks = tasks.filter((t) => t.id !== id);
  // Same reason as `deleteTaskDurable`: a snapshot already in flight predates
  // this removal and would put the task straight back. The delete button on the
  // Tasks page goes through here, not through the durable path.
  tombstone(id);
  if (prefs.lastSelectedId === id) {
    prefs = { ...prefs, lastSelectedId: null };
    emitPrefs();
  }
  emit();
  deleteTaskAsync(id);
}

/**
 * Add a subtask and confirm SQLite has it.
 *
 * Same contract as the other mutations: the count is compared against the row
 * the database returns, never against the array the insert just touched.
 */
export async function addSubtaskDurable(
  taskId: string,
  title: string,
): Promise<MutateTaskOutcome> {
  const trimmed = title.trim();
  if (!trimmed) {
    return { success: false, errorCode: "invalid-arguments", message: "A subtask needs a title." };
  }
  const before = tasks.find((t) => t.id === taskId)?.subtasks.length ?? 0;
  return mutateTaskDurable(
    taskId,
    (t) => ({
      ...t,
      subtasks: [...t.subtasks, makeSubtask(trimmed, t.subtasks.length)],
      activity: [activity("subtask-added", `Added subtask "${trimmed}"`), ...t.activity],
    }),
    (stored) => stored.subtasks.length > before && stored.subtasks.some((s) => s.title === trimmed),
  );
}

export function addSubtask(taskId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;
  patchTask(taskId, (t) => {
    const sub = makeSubtask(trimmed, t.subtasks.length);
    return {
      ...t,
      subtasks: [...t.subtasks, sub],
      activity: [
        activity("subtask-added", `Added subtask "${trimmed}"`),
        ...t.activity,
      ],
    };
  });
}

export function toggleSubtask(taskId: string, subtaskId: string) {
  patchTask(taskId, (t) => {
    const subtasks = t.subtasks.map((s) => {
      if (s.id !== subtaskId) return s;
      const completed = !s.completed;
      return {
        ...s,
        completed,
        completedAt: completed ? new Date().toISOString() : undefined,
      };
    });
    const target = subtasks.find((s) => s.id === subtaskId);
    const next: ArcSonareTask = { ...t, subtasks };
    if (target) {
      next.activity = [
        activity(
          target.completed ? "subtask-completed" : "updated",
          target.completed
            ? `Completed subtask "${target.title}"`
            : `Reopened subtask "${target.title}"`,
        ),
        ...t.activity,
      ];
      if (
        !t.completed &&
        subtasks.length > 0 &&
        subtasks.every((s) => s.completed)
      ) {
        next.completed = true;
        next.activity = [
          activity("completed", "All subtasks done — marked complete"),
          ...next.activity,
        ];
      }
    }
    return next;
  });
}

export function removeSubtask(taskId: string, subtaskId: string) {
  patchTask(taskId, (t) => ({
    ...t,
    subtasks: t.subtasks.filter((s) => s.id !== subtaskId),
  }));
}

export function filterTasks(all: Task[], filter: TaskFilter): Task[] {
  switch (filter) {
    case "open":
      return all.filter((t) => !t.completed);
    case "today":
      return all.filter((t) => t.dueBucket === "today" && !t.completed);
    case "upcoming":
      return all.filter((t) => t.dueBucket === "upcoming" && !t.completed);
    case "urgent":
      return all.filter(
        (t) => !t.completed && (t.urgent || t.priority === "high"),
      );
    case "completed":
      return all.filter((t) => t.completed);
    default:
      return all;
  }
}

export function getTaskProgress(task: Task): number {
  return computeTaskProgress(task);
}

export function setTaskPrefs(patch: Partial<TaskPrefs>) {
  prefs = { ...prefs, ...patch };
  emitPrefs();
}

export function toggleCollapsedGroup(label: string) {
  const set = new Set(prefs.collapsedGroups);
  if (set.has(label)) set.delete(label);
  else set.add(label);
  prefs = { ...prefs, collapsedGroups: [...set] };
  emitPrefs();
}

export function useTasks(): Task[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => tasks,
  );
}

export function useTaskPrefs(): TaskPrefs {
  return useSyncExternalStore(
    (cb) => {
      prefsListeners.add(cb);
      return () => {
        prefsListeners.delete(cb);
      };
    },
    () => prefs,
  );
}

export function areTasksHydrated(): boolean {
  return hydrated;
}

export { newSubtaskId };
