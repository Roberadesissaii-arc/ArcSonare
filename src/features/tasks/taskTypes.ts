export type TaskPriority = "high" | "medium" | "low";
export type TaskFilter =
  | "all"
  | "open"
  | "today"
  | "upcoming"
  | "urgent"
  | "completed";
export type DueBucket = "today" | "upcoming" | "none";
export type TaskSortMode =
  | "due"
  | "priority"
  | "created"
  | "updated"
  | "progress"
  | "name"
  | "agent"
  | "manual";
export type TaskGroupMode =
  | "due"
  | "priority"
  | "agent"
  | "status"
  | "none";
export type TaskViewMode = "list" | "grid";

export type TaskActivityType =
  | "created"
  | "updated"
  | "completed"
  | "reopened"
  | "priority-changed"
  | "agent-assigned"
  | "subtask-added"
  | "subtask-completed"
  | "agent-suggestion"
  | "comment";

export interface TaskSubtask {
  id: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: string;
  completedAt?: string;
}

export interface TaskActivity {
  id: string;
  type: TaskActivityType;
  text: string;
  createdAt: string;
  actorType: "user" | "agent" | "system";
  actorId?: string;
}

export interface ArcSonareTask {
  id: string;
  title: string;
  note?: string;
  priority: TaskPriority;
  /** Human-readable due label ("Today, 12:00 PM"). */
  due?: string;
  dueBucket: DueBucket;
  agent?: string;
  completed: boolean;
  urgent: boolean;
  demo?: boolean;
  createdAt: number;
  updatedAt: number;
  subtasks: TaskSubtask[];
  /** Explicit 0–100 when no subtasks; otherwise derived. */
  progress?: number;
  activity: TaskActivity[];
  tags: string[];
}

/** @deprecated Prefer ArcSonareTask — kept as alias for store imports. */
export type Task = ArcSonareTask;

export interface TaskPrefs {
  sort: TaskSortMode;
  group: TaskGroupMode;
  view: TaskViewMode;
  collapsedGroups: string[];
  lastSelectedId: string | null;
}
