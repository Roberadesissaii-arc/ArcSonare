/**
 * Local task state, persisted to localStorage. Seeded once with demo tasks
 * (marked via `demo: true`) so the dashboard has content before any real
 * integration exists.
 */
import { useSyncExternalStore } from "react";
import { DEMO_TASKS } from "../data/demoData";
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
const SCHEMA_VERSION = 2;

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
  const now = Date.now();
  const subtasks = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  const activityList = Array.isArray(raw.activity) ? raw.activity : [];
  return {
    id: raw.id,
    title: raw.title ?? "Untitled task",
    note: raw.note,
    priority: raw.priority ?? "medium",
    due: raw.due,
    dueBucket: raw.dueBucket ?? "none",
    agent: raw.agent,
    completed: Boolean(raw.completed),
    urgent: Boolean(raw.urgent),
    demo: raw.demo,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    subtasks,
    progress: raw.progress,
    activity:
      activityList.length > 0
        ? activityList
        : [
            activity(
              "created",
              `Task "${raw.title ?? "Untitled"}" was created`,
              "system",
            ),
          ],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

function seedFromDemo(): ArcSonareTask[] {
  return DEMO_TASKS.map((t, index) => {
    const base = normalizeTask({
      ...t,
      createdAt: t.createdAt || Date.now() - (index + 1) * 3_600_000,
      updatedAt: Date.now() - (index + 1) * 1_800_000,
    });

    if (base.id === "demo-investor-update") {
      base.subtasks = [
        makeSubtask("Draft email content", 0),
        makeSubtask("Review key highlights", 1),
        makeSubtask("Attach supporting documents", 2),
        makeSubtask("Get manager approval", 3),
        makeSubtask("Send email to client", 4),
      ];
      base.subtasks[0] = {
        ...base.subtasks[0],
        completed: true,
        completedAt: new Date(Date.now() - 3_600_000).toISOString(),
      };
      base.subtasks[1] = {
        ...base.subtasks[1],
        completed: true,
        completedAt: new Date(Date.now() - 1_200_000).toISOString(),
      };
      base.activity = [
        activity("created", "Task created from workspace", "system"),
        {
          ...activity(
            "agent-suggestion",
            "AI Assistant suggested key highlights",
            "agent",
          ),
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
          actorId: "ai-assistant",
        },
        {
          ...activity(
            "updated",
            "Project Manager updated progress to 40%",
            "agent",
          ),
          createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
          actorId: "project-manager",
        },
        {
          ...activity(
            "priority-changed",
            "User changed priority to High",
            "user",
          ),
          createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        },
      ];
    } else if (base.id === "demo-budget-approval") {
      base.subtasks = [
        makeSubtask("Collect vendor quotes", 0),
        makeSubtask("Review against Q3 budget", 1),
        makeSubtask("Submit for approval", 2),
      ];
      base.subtasks[0] = {
        ...base.subtasks[0],
        completed: true,
        completedAt: new Date().toISOString(),
      };
    }

    return base;
  });
}

function enrichKnownDemo(task: ArcSonareTask): ArcSonareTask {
  if (!task.demo || task.subtasks.length > 0) return task;
  if (task.id === "demo-investor-update") {
    const seeded = seedFromDemo().find((t) => t.id === task.id);
    if (seeded) {
      return {
        ...task,
        subtasks: seeded.subtasks,
        activity: task.activity.length > 1 ? task.activity : seeded.activity,
      };
    }
  }
  if (task.id === "demo-budget-approval") {
    const seeded = seedFromDemo().find((t) => t.id === task.id);
    if (seeded) return { ...task, subtasks: seeded.subtasks };
  }
  return task;
}

function migrateLegacy(raw: unknown): ArcSonareTask[] {
  if (!Array.isArray(raw)) return seedFromDemo();
  return raw.map((item) =>
    enrichKnownDemo(
      normalizeTask(item as Partial<ArcSonareTask> & { id: string }),
    ),
  );
}

function load(): ArcSonareTask[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        version?: number;
        tasks?: unknown;
      };
      if (Array.isArray(parsed?.tasks)) {
        return migrateLegacy(parsed.tasks);
      }
      if (Array.isArray(parsed)) {
        return migrateLegacy(parsed);
      }
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacy(JSON.parse(legacy));
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: SCHEMA_VERSION, tasks: migrated }),
      );
      return migrated;
    }
  } catch (err) {
    console.error("[ArcSonare] failed to load tasks:", err);
  }
  return seedFromDemo();
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

let tasks: ArcSonareTask[] = load();
let prefs: TaskPrefs = loadPrefs();

function persist() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, tasks }),
    );
  } catch (err) {
    console.error("[ArcSonare] failed to persist tasks:", err);
  }
}

function persistPrefs() {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error("[ArcSonare] failed to persist task prefs:", err);
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

function emitPrefs() {
  persistPrefs();
  prefsListeners.forEach((l) => l());
}

function patchTask(
  id: string,
  updater: (task: ArcSonareTask) => ArcSonareTask,
): void {
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    return { ...updater(t), updatedAt: Date.now() };
  });
  emit();
}

/**
 * Re-read tasks from localStorage. Used by the capability engine when a
 * different window (voice overlay) may have written tasks, and to verify
 * persistence after a capability-driven mutation.
 */
export function reloadTasksFromStorage() {
  tasks = load();
  listeners.forEach((l) => l());
}

/** Read the persisted task list directly (verification readback). */
export function readPersistedTasks(): ArcSonareTask[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tasks?: unknown };
      if (Array.isArray(parsed?.tasks)) return parsed.tasks as ArcSonareTask[];
    }
  } catch (err) {
    console.error("[ArcSonare] failed to read persisted tasks:", err);
  }
  return [];
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
    activity: [activity("created", `Created task "${input.title}"`, "user")],
  };
  tasks = [task, ...tasks];
  emit();
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
          completed
            ? `Marked "${t.title}" complete`
            : `Reopened "${t.title}"`,
        ),
        ...t.activity,
      ],
    };
  });
}

export function updateTask(id: string, patch: Partial<ArcSonareTask>) {
  patchTask(id, (t) => {
    const next = { ...t, ...patch };
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
          patch.agent
            ? `Assigned to ${patch.agent}`
            : "Cleared agent assignment",
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

export { newSubtaskId };
