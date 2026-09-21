/**
 * Maps ArcSonare tasks ↔ SQLite rows via Tauri commands.
 * Full task payload lives in configuration_json for round-trip fidelity.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ArcSonareTask, TaskPriority } from "../features/tasks/taskTypes";
import { normalizeTaskFromUnknown } from "../stores/taskNormalize";

export type LocalTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  assignedAgentId: string | null;
  progress: number;
  tagsJson: string;
  configurationJson: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
};

function parseIsoMs(iso: string | null | undefined, fallback: number): number {
  if (!iso) return fallback;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : fallback;
}

export function rowToTask(row: LocalTaskRow): ArcSonareTask {
  try {
    const raw = JSON.parse(row.configurationJson) as unknown;
    if (raw && typeof raw === "object" && "id" in (raw as object)) {
      return normalizeTaskFromUnknown(raw);
    }
  } catch {
    // fall through to column mapping
  }

  let priority: TaskPriority = "medium";
  if (row.priority === "high" || row.priority === "low" || row.priority === "medium") {
    priority = row.priority;
  }
  const urgent = row.priority === "urgent";
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tagsJson) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === "string");
  } catch {
    tags = [];
  }

  return normalizeTaskFromUnknown({
    id: row.id,
    title: row.title,
    note: row.description ?? undefined,
    priority,
    due: row.dueAt ?? undefined,
    dueBucket: "none",
    agent: row.assignedAgentId ?? undefined,
    completed: row.status === "completed",
    urgent,
    progress: row.progress,
    tags,
    createdAt: parseIsoMs(row.createdAt, Date.now()),
    updatedAt: parseIsoMs(row.updatedAt, Date.now()),
  });
}

export function taskToPayload(task: ArcSonareTask): Record<string, unknown> {
  return {
    ...task,
    agentId: task.agent ?? null,
  };
}

export async function listTasksFromDb(): Promise<ArcSonareTask[]> {
  const rows = await invoke<LocalTaskRow[] | null>("tasks_list_local");
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((r) => r && typeof r.id === "string")
    .map((r) => {
      try {
        return rowToTask(r);
      } catch (err) {
        console.error("[ArcSonare] bad task row", r?.id, err);
        return normalizeTaskFromUnknown({
          id: r.id,
          title: r.title || r.id,
        });
      }
    });
}

export async function upsertTaskToDb(task: ArcSonareTask): Promise<ArcSonareTask> {
  const row = await invoke<LocalTaskRow | null>("tasks_upsert_local", {
    task: taskToPayload(task),
  });
  // Some hosts return void/null after a successful write — keep the input task.
  if (!row || typeof row !== "object" || !("id" in row)) {
    return task;
  }
  try {
    return rowToTask(row);
  } catch (err) {
    console.error("[ArcSonare] task upsert row parse failed:", err);
    return task;
  }
}

/**
 * Read one task straight back out of SQLite.
 *
 * The point is that it does not consult any in-memory cache. `readPersistedTasks()`
 * returns the module's own array, so using it to confirm a write proved only
 * that the write had touched the array — which is how a task that never reached
 * the database came to be announced as created.
 */
export async function getTaskFromDb(taskId: string): Promise<ArcSonareTask | null> {
  const row = await invoke<LocalTaskRow | null>("tasks_get_local", { taskId });
  if (!row || typeof row !== "object" || !("id" in row)) return null;
  try {
    return rowToTask(row);
  } catch (err) {
    console.error("[ArcSonare] task read-back parse failed:", err);
    return null;
  }
}

export async function softDeleteTaskInDb(taskId: string): Promise<void> {
  await invoke("tasks_soft_delete_local", { taskId });
}
