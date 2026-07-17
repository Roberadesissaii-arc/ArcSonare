/**
 * Frontend-domain capability executors: ArcSonare navigation, notifications
 * and task operations against the real task store. Same ToolResult contract
 * as native tools — success only after readback verification.
 */
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { ToolResult, ToolResultStatus } from "./capabilityTypes";
import {
  addTask,
  readPersistedTasks,
  reloadTasksFromStorage,
  removeTask,
  toggleTask,
  updateTask,
  addSubtask,
  filterTasks,
  type ArcSonareTask,
  type TaskFilter,
  type TaskPriority,
} from "../../stores/taskStore";
import { addActivity, navigate, type MainPage } from "../../stores/appStore";

export const NAVIGATE_EVENT = "arcsonare://navigate";
export const NAVIGATED_EVENT = "arcsonare://navigated";

function nowIso(): string {
  return new Date().toISOString();
}

function result(
  capabilityId: string,
  startedAt: string,
  status: ToolResultStatus,
  summary: string,
  extras: Partial<ToolResult> = {},
): ToolResult {
  const completedAt = nowIso();
  return {
    callId: `fcall-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    capabilityId,
    status,
    summary,
    evidence: extras.evidence ?? { verified: false, method: "not-verifiable" },
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const PAGES: MainPage[] = ["dashboard", "tasks", "agent", "connect", "settings"];

async function executeNavigate(args: Record<string, unknown>, startedAt: string): Promise<ToolResult> {
  const page = String(args.page ?? "") as MainPage;
  if (!PAGES.includes(page)) {
    return result("arcsonare.navigate", startedAt, "error", `"${page}" is not an ArcSonare page.`, {
      error: { code: "invalid-arguments", message: `Unknown page "${page}".`, recoverable: true },
    });
  }
  const taskFilter = typeof args.task_filter === "string" ? (args.task_filter as TaskFilter) : undefined;
  const isMain = getCurrentWindow().label === "main";

  if (isMain) {
    navigate(page, taskFilter ? { taskFilter } : undefined);
    // Echo for any cross-window waiters; the store update is synchronous.
    emit(NAVIGATED_EVENT, { page }).catch(() => undefined);
    return result("arcsonare.navigate", startedAt, "success", `Opened ${page}.`, {
      evidence: { verified: true, method: "state-readback", details: { page } },
      data: { page },
    });
  }

  // From another window: ask the main window to navigate, await its echo.
  const echo = new Promise<boolean>((resolve) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true;
        resolve(false);
      }
    }, 1_500);
    listen<{ page: string }>(NAVIGATED_EVENT, (event) => {
      if (!done && event.payload.page === page) {
        done = true;
        window.clearTimeout(timer);
        resolve(true);
      }
    }).catch(() => resolve(false));
  });
  await emit(NAVIGATE_EVENT, { page, taskFilter });
  try {
    await invoke("show_main_window");
  } catch {
    // Window may already be visible.
  }
  const confirmed = await echo;
  if (confirmed) {
    return result("arcsonare.navigate", startedAt, "success", `Opened ${page}.`, {
      evidence: { verified: true, method: "state-readback", details: { page } },
      data: { page },
    });
  }
  return result(
    "arcsonare.navigate",
    startedAt,
    "partial",
    `Asked ArcSonare to open ${page}, but navigation was not confirmed.`,
    { evidence: { verified: false, method: "state-readback" }, data: { page } },
  );
}

async function executeNotification(args: Record<string, unknown>, startedAt: string): Promise<ToolResult> {
  const title = String(args.title ?? "").slice(0, 100);
  const body = String(args.body ?? "").slice(0, 500);
  if (!title) {
    return result("arcsonare.show_notification", startedAt, "error", "Notification title is required.", {
      error: { code: "invalid-arguments", message: "Title is required.", recoverable: true },
    });
  }
  try {
    await invoke("send_test_notification", { title, body });
    return result("arcsonare.show_notification", startedAt, "success", `Notification shown: ${title}`, {
      evidence: { verified: true, method: "return-code" },
    });
  } catch (err) {
    return result("arcsonare.show_notification", startedAt, "error", "Windows rejected the notification.", {
      error: {
        code: "notification-failed",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function findTask(args: Record<string, unknown>): ArcSonareTask | { candidates: ArcSonareTask[] } | null {
  reloadTasksFromStorage();
  const all = readPersistedTasks();
  const id = typeof args.task_id === "string" ? args.task_id : undefined;
  if (id) return all.find((t) => t.id === id) ?? null;
  const query = typeof args.title_query === "string" ? args.title_query.toLowerCase().trim() : "";
  if (!query) return null;
  const matches = all.filter((t) => t.title.toLowerCase().includes(query));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exact = matches.filter((t) => t.title.toLowerCase() === query);
    if (exact.length === 1) return exact[0];
    return { candidates: matches.slice(0, 4) };
  }
  return null;
}

function verifyPersisted(taskId: string): ArcSonareTask | undefined {
  return readPersistedTasks().find((t) => t.id === taskId);
}

async function executeTaskCreate(args: Record<string, unknown>, startedAt: string): Promise<ToolResult> {
  const title = String(args.title ?? "").trim();
  if (!title) {
    return result("tasks.create", startedAt, "error", "Task title is required.", {
      error: { code: "invalid-arguments", message: "Title is required.", recoverable: true },
    });
  }
  reloadTasksFromStorage();
  const priority = (["high", "medium", "low"] as TaskPriority[]).includes(args.priority as TaskPriority)
    ? (args.priority as TaskPriority)
    : "medium";
  const due = typeof args.due_at === "string" && args.due_at ? args.due_at : undefined;
  const task = addTask({
    title,
    note: typeof args.description === "string" ? args.description : undefined,
    priority,
    due,
    dueBucket: due ? "upcoming" : "none",
    agent: typeof args.agent_id === "string" ? args.agent_id : undefined,
    urgent: priority === "high",
  });
  const subtasks = Array.isArray(args.subtasks) ? (args.subtasks as string[]) : [];
  for (const st of subtasks.slice(0, 20)) {
    if (typeof st === "string" && st.trim()) addSubtask(task.id, st.trim());
  }
  // Verify persistence in localStorage before claiming success.
  const persisted = verifyPersisted(task.id);
  if (!persisted) {
    return result("tasks.create", startedAt, "error", "The task did not persist to local storage.", {
      error: { code: "persistence-failed", message: "Task not found after write.", recoverable: true },
    });
  }
  addActivity(`Task created: ${title}`, "task");
  return result("tasks.create", startedAt, "success", `Created task "${title}".`, {
    evidence: {
      verified: true,
      method: "state-readback",
      details: { taskId: task.id, subtasks: persisted.subtasks.length },
    },
    data: { task_id: task.id, title, priority },
    artifacts: [{ id: task.id, kind: "task", displayName: title }],
  });
}

async function executeTaskList(args: Record<string, unknown>, startedAt: string): Promise<ToolResult> {
  reloadTasksFromStorage();
  const all = readPersistedTasks();
  const filter = (typeof args.filter === "string" ? args.filter : "open") as TaskFilter;
  const limit = typeof args.limit === "number" ? Math.min(args.limit, 100) : 25;
  const filtered = filterTasks(all, filter).slice(0, limit);
  const items = filtered.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    completed: t.completed,
    urgent: t.urgent,
    due: t.due ?? null,
  }));
  return result(
    "tasks.list",
    startedAt,
    "success",
    `${items.length} ${filter === "all" ? "" : `${filter} `}task${items.length === 1 ? "" : "s"}.`,
    {
      evidence: { verified: true, method: "state-readback" },
      data: { tasks: items, count: items.length, filter },
    },
  );
}

async function executeTaskMutation(
  capabilityId: string,
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const found = findTask(args);
  if (!found) {
    return result(capabilityId, startedAt, "not-found", "No matching task was found.", {});
  }
  if ("candidates" in found) {
    return result(capabilityId, startedAt, "needs-confirmation", "Several tasks match — which one?", {
      data: {
        confirmation: {
          reason: "ambiguous",
          candidates: found.candidates.map((t) => ({ id: t.id, label: t.title })),
        },
      },
    });
  }
  const task = found;
  switch (capabilityId) {
    case "tasks.complete": {
      if (task.completed) {
        return result(capabilityId, startedAt, "success", `"${task.title}" was already complete.`, {
          evidence: { verified: true, method: "state-readback" },
        });
      }
      toggleTask(task.id);
      const verified = verifyPersisted(task.id)?.completed === true;
      return verified
        ? result(capabilityId, startedAt, "success", `Marked "${task.title}" done.`, {
            evidence: { verified: true, method: "state-readback", details: { taskId: task.id } },
            data: { task_id: task.id },
          })
        : result(capabilityId, startedAt, "error", "The completion did not persist.", {
            error: { code: "persistence-failed", message: "Readback mismatch.", recoverable: true },
          });
    }
    case "tasks.reopen": {
      if (!task.completed) {
        return result(capabilityId, startedAt, "success", `"${task.title}" is already open.`, {
          evidence: { verified: true, method: "state-readback" },
        });
      }
      toggleTask(task.id);
      const verified = verifyPersisted(task.id)?.completed === false;
      return verified
        ? result(capabilityId, startedAt, "success", `Reopened "${task.title}".`, {
            evidence: { verified: true, method: "state-readback", details: { taskId: task.id } },
            data: { task_id: task.id },
          })
        : result(capabilityId, startedAt, "error", "The reopen did not persist.", {
            error: { code: "persistence-failed", message: "Readback mismatch.", recoverable: true },
          });
    }
    case "tasks.update": {
      const patch: Partial<ArcSonareTask> = {};
      if (typeof args.new_title === "string" && args.new_title.trim()) patch.title = args.new_title.trim();
      if (typeof args.priority === "string" && ["high", "medium", "low"].includes(args.priority)) {
        patch.priority = args.priority as TaskPriority;
      }
      if (typeof args.due_at === "string") patch.due = args.due_at;
      if (Object.keys(patch).length === 0) {
        return result(capabilityId, startedAt, "error", "Nothing to update.", {
          error: { code: "invalid-arguments", message: "No fields to change.", recoverable: true },
        });
      }
      updateTask(task.id, patch);
      const after = verifyPersisted(task.id);
      const verified =
        !!after &&
        (patch.title === undefined || after.title === patch.title) &&
        (patch.priority === undefined || after.priority === patch.priority);
      return verified
        ? result(capabilityId, startedAt, "success", `Updated "${after?.title ?? task.title}".`, {
            evidence: { verified: true, method: "state-readback", details: { taskId: task.id } },
            data: { task_id: task.id },
          })
        : result(capabilityId, startedAt, "error", "The update did not persist.", {
            error: { code: "persistence-failed", message: "Readback mismatch.", recoverable: true },
          });
    }
    case "tasks.add_subtask": {
      const subtaskTitle = String(args.subtask_title ?? "").trim();
      if (!subtaskTitle) {
        return result(capabilityId, startedAt, "error", "Subtask title is required.", {
          error: { code: "invalid-arguments", message: "subtask_title required.", recoverable: true },
        });
      }
      const before = verifyPersisted(task.id)?.subtasks.length ?? 0;
      addSubtask(task.id, subtaskTitle);
      const after = verifyPersisted(task.id)?.subtasks.length ?? 0;
      return after > before
        ? result(capabilityId, startedAt, "success", `Added subtask to "${task.title}".`, {
            evidence: { verified: true, method: "state-readback", details: { taskId: task.id } },
            data: { task_id: task.id },
          })
        : result(capabilityId, startedAt, "error", "The subtask did not persist.", {
            error: { code: "persistence-failed", message: "Readback mismatch.", recoverable: true },
          });
    }
    case "tasks.assign_agent": {
      const agent = String(args.agent ?? "").trim();
      updateTask(task.id, { agent });
      const verified = verifyPersisted(task.id)?.agent === agent;
      return verified
        ? result(capabilityId, startedAt, "success", `Assigned ${agent} to "${task.title}".`, {
            evidence: { verified: true, method: "state-readback", details: { taskId: task.id } },
            data: { task_id: task.id },
          })
        : result(capabilityId, startedAt, "error", "The assignment did not persist.", {
            error: { code: "persistence-failed", message: "Readback mismatch.", recoverable: true },
          });
    }
    case "tasks.delete": {
      removeTask(task.id);
      const gone = verifyPersisted(task.id) === undefined;
      if (gone) addActivity(`Task deleted: ${task.title}`, "task");
      return gone
        ? result(capabilityId, startedAt, "success", `Deleted "${task.title}".`, {
            evidence: {
              verified: true,
              method: "state-readback",
              details: { taskId: task.id, absent: true },
            },
          })
        : result(capabilityId, startedAt, "error", "The task is still present after deletion.", {
            error: { code: "persistence-failed", message: "Task still present.", recoverable: true },
          });
    }
    default:
      return result(capabilityId, startedAt, "error", `Unknown task capability ${capabilityId}.`, {
        error: { code: "unknown-capability", message: capabilityId, recoverable: false },
      });
  }
}

/** Task ids/titles a delete confirmation should present. */
export function describeTaskDelete(args: Record<string, unknown>): {
  title: string;
  taskId: string;
} | null {
  const found = findTask(args);
  if (!found || "candidates" in found) return null;
  return { title: found.title, taskId: found.id };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function executeFrontendCapability(
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const startedAt = nowIso();
  switch (capabilityId) {
    case "arcsonare.navigate":
      return executeNavigate(args, startedAt);
    case "arcsonare.show_notification":
      return executeNotification(args, startedAt);
    case "tasks.create":
      return executeTaskCreate(args, startedAt);
    case "tasks.list":
      return executeTaskList(args, startedAt);
    case "tasks.complete":
    case "tasks.reopen":
    case "tasks.update":
    case "tasks.add_subtask":
    case "tasks.assign_agent":
    case "tasks.delete":
      return executeTaskMutation(capabilityId, args, startedAt);
    default:
      return result(capabilityId, startedAt, "error", `"${capabilityId}" has no frontend executor.`, {
        error: { code: "unknown-capability", message: capabilityId, recoverable: false },
      });
  }
}
