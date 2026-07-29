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
  const rows = await invoke<LocalTaskRow[]>("tasks_list_local");
  return rows.map(rowToTask);
}

export async function upsertTaskToDb(task: ArcSonareTask): Promise<ArcSonareTask> {
  const row = await invoke<LocalTaskRow>("tasks_upsert_local", {
    task: taskToPayload(task),
  });
  return rowToTask(row);
}

export async function softDeleteTaskInDb(taskId: string): Promise<void> {
  await invoke("tasks_soft_delete_local", { taskId });
}
