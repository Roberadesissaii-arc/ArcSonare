import type { ArcSonareTask, TaskActivity, TaskSubtask } from "../features/tasks/taskTypes";
import { newActivityId, newSubtaskId } from "../features/tasks/taskUtils";

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

/**
 * Rejects placeholder agent values.
 *
 * A model calling tasks.create emitted `agent_id: "null"` as a *string*, which
 * was stored verbatim and then displayed as an agent literally named "null".
 * Also repairs rows already persisted with such a value.
 */
export function cleanAgent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^(null|undefined|none|nil|n\/a|unassigned)$/i.test(trimmed)
    ? undefined
    : trimmed;
}

/** Normalize a partial / unknown task blob into a full ArcSonareTask. */
export function normalizeTaskFromUnknown(raw: unknown): ArcSonareTask {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<ArcSonareTask> & {
    id?: string;
  };
  const now = Date.now();
  const id = typeof obj.id === "string" && obj.id ? obj.id : `task-${now}`;
  const subtasks: TaskSubtask[] = Array.isArray(obj.subtasks)
    ? obj.subtasks.map((s, i) => ({
        id: s.id || newSubtaskId(),
        title: s.title || "Subtask",
        completed: Boolean(s.completed),
        order: typeof s.order === "number" ? s.order : i,
        createdAt: s.createdAt || new Date().toISOString(),
        completedAt: s.completedAt,
      }))
    : [];
  const activityList: TaskActivity[] = Array.isArray(obj.activity) ? obj.activity : [];
  return {
    id,
    title: obj.title?.trim() || "Untitled task",
    note: obj.note,
    priority: obj.priority === "high" || obj.priority === "low" ? obj.priority : "medium",
    due: obj.due,
    dueBucket: obj.dueBucket ?? "none",
    agent: cleanAgent(obj.agent),
    completed: Boolean(obj.completed),
    urgent: Boolean(obj.urgent),
    demo: obj.demo,
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : now,
    subtasks,
    progress: obj.progress,
    activity:
      activityList.length > 0
        ? activityList
        : [activity("created", `Task "${obj.title ?? "Untitled"}" was created`, "system")],
    tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === "string") : [],
  };
}
