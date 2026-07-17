import type {
  ArcSonareTask,
  TaskGroupMode,
  TaskPriority,
  TaskSortMode,
  TaskSubtask,
} from "./taskTypes";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const BUCKET_RANK = { today: 0, upcoming: 1, none: 2 } as const;

export function computeTaskProgress(task: ArcSonareTask): number {
  if (task.completed) return 100;
  if (task.subtasks.length > 0) {
    const done = task.subtasks.filter((s) => s.completed).length;
    return Math.round((done / task.subtasks.length) * 100);
  }
  if (typeof task.progress === "number") {
    return Math.max(0, Math.min(100, Math.round(task.progress)));
  }
  return 0;
}

export function subtaskProgressLabel(task: ArcSonareTask): string {
  if (task.subtasks.length === 0) return `${computeTaskProgress(task)}%`;
  const done = task.subtasks.filter((s) => s.completed).length;
  return `${done}/${task.subtasks.length}`;
}

export function matchesTaskQuery(task: ArcSonareTask, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    task.title,
    task.note ?? "",
    task.agent ?? "",
    task.due ?? "",
    ...task.tags,
    ...task.subtasks.map((s) => s.title),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function sortTasks(
  list: ArcSonareTask[],
  mode: TaskSortMode,
): ArcSonareTask[] {
  const copy = [...list];
  switch (mode) {
    case "due":
      return copy.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const bucket = BUCKET_RANK[a.dueBucket] - BUCKET_RANK[b.dueBucket];
        if (bucket !== 0) return bucket;
        return (a.due ?? "").localeCompare(b.due ?? "");
      });
    case "priority":
      return copy.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      });
    case "created":
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case "updated":
      return copy.sort((a, b) => b.updatedAt - a.updatedAt);
    case "progress":
      return copy.sort(
        (a, b) => computeTaskProgress(b) - computeTaskProgress(a),
      );
    case "name":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "agent":
      return copy.sort((a, b) =>
        (a.agent ?? "zzz").localeCompare(b.agent ?? "zzz"),
      );
    case "manual":
    default:
      return copy;
  }
}

export function groupKeyForTask(
  task: ArcSonareTask,
  mode: TaskGroupMode,
): string {
  switch (mode) {
    case "due":
      if (task.completed) return "Completed";
      if (task.dueBucket === "today") return "Today";
      if (task.dueBucket === "upcoming") return "Upcoming";
      return "No due date";
    case "priority":
      return task.priority === "high"
        ? "High"
        : task.priority === "medium"
          ? "Medium"
          : "Low";
    case "agent":
      return task.agent ?? "Unassigned";
    case "status":
      if (task.completed) return "Completed";
      if (task.urgent) return "Urgent";
      return "Open";
    case "none":
    default:
      return "All tasks";
  }
}

export function groupOrderKey(label: string, mode: TaskGroupMode): number {
  if (mode === "due") {
    const order = ["Today", "Upcoming", "No due date", "Completed"];
    const i = order.indexOf(label);
    return i === -1 ? 99 : i;
  }
  if (mode === "priority") {
    const order = ["High", "Medium", "Low"];
    const i = order.indexOf(label);
    return i === -1 ? 99 : i;
  }
  if (mode === "status") {
    const order = ["Urgent", "Open", "Completed"];
    const i = order.indexOf(label);
    return i === -1 ? 99 : i;
  }
  return label.localeCompare(label);
}

export function groupTasks(
  list: ArcSonareTask[],
  mode: TaskGroupMode,
): [string, ArcSonareTask[]][] {
  const map = new Map<string, ArcSonareTask[]>();
  for (const task of list) {
    const key = groupKeyForTask(task, mode);
    const bucket = map.get(key) ?? [];
    bucket.push(task);
    map.set(key, bucket);
  }
  return [...map.entries()].sort(
    (a, b) => groupOrderKey(a[0], mode) - groupOrderKey(b[0], mode) || a[0].localeCompare(b[0]),
  );
}

export function relativeTime(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function newSubtaskId(): string {
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function newActivityId(): string {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeSubtask(title: string, order: number): TaskSubtask {
  return {
    id: newSubtaskId(),
    title,
    completed: false,
    order,
    createdAt: new Date().toISOString(),
  };
}

export function summarizeCounts(tasks: ArcSonareTask[]) {
  const openTasks = tasks.filter((t) => !t.completed);
  const urgentIds = new Set<string>();
  for (const t of openTasks) {
    if (t.urgent || t.priority === "high") urgentIds.add(t.id);
  }
  return {
    open: openTasks.length,
    today: openTasks.filter((t) => t.dueBucket === "today").length,
    urgent: urgentIds.size,
    completed: tasks.filter((t) => t.completed).length,
  };
}
