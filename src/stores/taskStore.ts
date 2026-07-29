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
  void softDeleteTaskInDb(id).catch((err) =>
    console.error("[ArcSonare] task delete failed:", err),
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
export async function hydrateTasksFromDb(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
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

      tasks = fromDb.filter((t) => !t.demo);
      hydrated = true;
      emit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("No local database is open")) {
        try {
          await invoke("database_open_guest");
          const fromDb = await listTasksFromDb();
          tasks = fromDb.filter((t) => !t.demo);
          hydrated = true;
          emit();
          return;
        } catch (retryErr) {
          console.error("[ArcSonare] hydrate tasks retry failed:", retryErr);
        }
      }
      console.error("[ArcSonare] hydrate tasks failed:", err);
      // Fallback: non-demo local only (never re-seed demos).
      tasks = readLocalStorageTasks();
      hydrated = true;
      emit();
    } finally {
      // Allow a later call (e.g. after sign-in opens the user DB).
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export function reloadTasksFromStorage() {
  void hydrateTasksFromDb();
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
  tasks = [task, ...tasks];
  emit();
  syncTaskAsync(task);
  return task;
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
  if (prefs.lastSelectedId === id) {
    prefs = { ...prefs, lastSelectedId: null };
    emitPrefs();
  }
  emit();
  deleteTaskAsync(id);
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
