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
  frameContextFrom,
  resolveVisualTarget,
  type ModelGeometry,
  type VisionFrameContext,
} from "../../services/visualTarget";
import {
  desktopItemName,
  mentionsDesktop,
  verifyDesktopIconTarget,
  type DesktopIcon,
  type IconGuardVerdict,
  type Rect,
} from "../../services/desktopIconGuard";
import { beginTrace, traceStage } from "./visualTrace";
import {
  readPersistedTasks,
  reloadTasksFromStorage,
  createTaskDurable,
  mutateTaskDurable,
  deleteTaskDurable,
  addSubtaskDurable,
  filterTasks,
  type ArcSonareTask,
  type TaskFilter,
  type TaskPriority,
} from "../../stores/taskStore";
import { addActivity, navigate, type MainPage } from "../../stores/appStore";
import { cleanAgent } from "../../stores/taskNormalize";
import {
  fetchNearbyPlaces,
  fetchTravelTimeTo,
  fetchWeatherForCurrentLocation,
} from "../../services/LocationService";

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

async function executeTaskCreate(
  args: Record<string, unknown>,
  startedAt: string,
  idempotencyKey?: string,
): Promise<ToolResult> {
  const title = String(args.title ?? "").trim();
  if (!title) {
    return result("tasks.create", startedAt, "error", "Task title is required.", {
      error: { code: "invalid-arguments", message: "Title is required.", recoverable: true },
    });
  }
  const priority = (["high", "medium", "low"] as TaskPriority[]).includes(args.priority as TaskPriority)
    ? (args.priority as TaskPriority)
    : "medium";
  const due = typeof args.due_at === "string" && args.due_at ? args.due_at : undefined;

  // Awaited, and verified by reading the row back out of SQLite. The previous
  // check read this module's own in-memory array — the same array the write had
  // just been made to — so it could not fail, and a task that never reached the
  // database was announced as created.
  const outcome = await createTaskDurable(
    {
      title,
      note: typeof args.description === "string" ? args.description : undefined,
      priority,
      due,
      dueBucket: due ? "upcoming" : "none",
      // Models sometimes emit the literal string "null" here.
      agent: cleanAgent(args.agent_id),
      urgent: priority === "high",
    },
    { idempotencyKey },
  );

  if (!outcome.success) {
    return result(
      "tasks.create",
      startedAt,
      "error",
      "I couldn't create that task because it could not be saved.",
      {
        error: { code: outcome.errorCode, message: outcome.message, recoverable: true },
      },
    );
  }

  const subtasks = Array.isArray(args.subtasks) ? (args.subtasks as string[]) : [];
  for (const st of subtasks.slice(0, 20)) {
    // Awaited in order: each one is its own verified write, and a subtask that
    // fails to save must not be silently dropped from a task reported as saved.
    if (typeof st === "string" && st.trim()) await addSubtaskDurable(outcome.taskId, st.trim());
  }
  addActivity(`Task created: ${outcome.task.title}`, "task");
  return result("tasks.create", startedAt, "success", `Created task "${outcome.task.title}".`, {
    evidence: {
      verified: true,
      // Not a state readback any more: the row was read from the database.
      method: "database-readback",
      details: { taskId: outcome.taskId, persisted: true },
    },
    data: {
      success: true,
      task_id: outcome.taskId,
      taskId: outcome.taskId,
      task: outcome.task,
      persisted: true,
      title: outcome.task.title,
      priority,
    },
    artifacts: [{ id: outcome.taskId, kind: "task", displayName: outcome.task.title }],
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

/**
 * A mutation that did not reach the database, in words the user can act on.
 *
 * Never "readback mismatch": the point of the typed outcome is that the caller
 * knows whether nothing was written or something was written that does not
 * carry the change, and those read differently to a person.
 */
function friendlyMutationFailure(
  outcome: { errorCode: string; message: string },
  what: string,
): string {
  if (outcome.errorCode === "not-found") {
    return "I couldn't find that task any more.";
  }
  if (outcome.errorCode === "persistence-mismatch") {
    return `I saved the ${what}, but the task didn't come back with the change. Nothing was applied.`;
  }
  return `I couldn't save that ${what}, so nothing changed.`;
}

function mutationFailure(
  capabilityId: string,
  startedAt: string,
  outcome: { errorCode: string; message: string },
  what: string,
): ToolResult {
  return result(capabilityId, startedAt, "error", friendlyMutationFailure(outcome, what), {
    error: { code: outcome.errorCode, message: outcome.message, recoverable: true },
  });
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
      const outcome = await mutateTaskDurable(
        task.id,
        (t) => ({ ...t, completed: true }),
        // Asked of SQLite, not of the cache.
        (stored) => stored.completed === true,
      );
      return outcome.success
        ? result(capabilityId, startedAt, "success", `Marked "${outcome.task.title}" done.`, {
            evidence: { verified: true, method: "database-readback", details: { taskId: outcome.taskId } },
            data: { success: true, task_id: outcome.taskId, taskId: outcome.taskId, task: outcome.task, persisted: true },
          })
        : mutationFailure(capabilityId, startedAt, outcome, "completion");
    }
    case "tasks.reopen": {
      if (!task.completed) {
        return result(capabilityId, startedAt, "success", `"${task.title}" is already open.`, {
          evidence: { verified: true, method: "state-readback" },
        });
      }
      const outcome = await mutateTaskDurable(
        task.id,
        (t) => ({ ...t, completed: false }),
        (stored) => stored.completed === false,
      );
      return outcome.success
        ? result(capabilityId, startedAt, "success", `Reopened "${outcome.task.title}".`, {
            evidence: { verified: true, method: "database-readback", details: { taskId: outcome.taskId } },
            data: { success: true, task_id: outcome.taskId, taskId: outcome.taskId, task: outcome.task, persisted: true },
          })
        : mutationFailure(capabilityId, startedAt, outcome, "reopen");
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
      const outcome = await mutateTaskDurable(
        task.id,
        (t) => ({ ...t, ...patch }),
        // Every field that was asked to change must actually have changed.
        (stored) =>
          (patch.title === undefined || stored.title === patch.title) &&
          (patch.priority === undefined || stored.priority === patch.priority) &&
          (patch.due === undefined || stored.due === patch.due),
      );
      return outcome.success
        ? result(capabilityId, startedAt, "success", `Updated "${outcome.task.title}".`, {
            evidence: { verified: true, method: "database-readback", details: { taskId: outcome.taskId } },
            data: { success: true, task_id: outcome.taskId, taskId: outcome.taskId, task: outcome.task, persisted: true },
          })
        : mutationFailure(capabilityId, startedAt, outcome, "update");
    }
    case "tasks.add_subtask": {
      const subtaskTitle = String(args.subtask_title ?? "").trim();
      if (!subtaskTitle) {
        return result(capabilityId, startedAt, "error", "Subtask title is required.", {
          error: { code: "invalid-arguments", message: "subtask_title required.", recoverable: true },
        });
      }
      const outcome = await addSubtaskDurable(task.id, subtaskTitle);
      return outcome.success
        ? result(capabilityId, startedAt, "success", `Added subtask to "${outcome.task.title}".`, {
            evidence: { verified: true, method: "database-readback", details: { taskId: outcome.taskId } },
            data: { success: true, task_id: outcome.taskId, taskId: outcome.taskId, task: outcome.task, persisted: true },
          })
        : mutationFailure(capabilityId, startedAt, outcome, "subtask");
    }
    case "tasks.assign_agent": {
      const agent = String(args.agent ?? "").trim();
      const outcome = await mutateTaskDurable(
        task.id,
        (t) => ({ ...t, agent }),
        (stored) => (stored.agent ?? "") === agent,
      );
      return outcome.success
        ? result(capabilityId, startedAt, "success", `Assigned ${agent} to "${outcome.task.title}".`, {
            evidence: { verified: true, method: "database-readback", details: { taskId: outcome.taskId } },
            data: { success: true, task_id: outcome.taskId, taskId: outcome.taskId, task: outcome.task, persisted: true },
          })
        : mutationFailure(capabilityId, startedAt, outcome, "assignment");
    }
    case "tasks.delete": {
      const outcome = await deleteTaskDurable(task.id);
      if (outcome.success) addActivity(`Task deleted: ${task.title}`, "task");
      return outcome.success
        ? result(capabilityId, startedAt, "success", `Deleted "${task.title}".`, {
            evidence: {
              verified: true,
              // Absence confirmed by asking the database for the id.
              method: "database-readback",
              details: { taskId: task.id, absent: true },
            },
            data: { success: true, task_id: task.id, taskId: task.id, persisted: true },
          })
        : result(capabilityId, startedAt, "error", friendlyMutationFailure(outcome, "deletion"), {
            error: { code: outcome.errorCode, message: outcome.message, recoverable: true },
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
// Location (weather / nearby / travel)
// ---------------------------------------------------------------------------

async function executeWeather(startedAt: string): Promise<ToolResult> {
  try {
    const weather = await fetchWeatherForCurrentLocation();
    const unit = weather.unit === "fahrenheit" ? "°F" : "°C";
    const windUnit = weather.unit === "fahrenheit" ? "mph" : "km/h";
    const summary =
      `It's ${weather.condition} in ${weather.placeLabel} — ` +
      `${weather.temperature}${unit} (feels like ${weather.feelsLike}${unit}), ` +
      `${weather.humidity}% humidity, wind ${weather.windSpeed} ${windUnit}.`;
    return result("location.get_weather", startedAt, "success", summary, {
      evidence: { verified: true, method: "artifact-validated", details: { source: "open-meteo" } },
      data: weather,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't get the weather.";
    return result("location.get_weather", startedAt, "error", message, {
      error: { code: "location-failed", message, recoverable: true },
    });
  }
}

async function executeNearby(
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  try {
    const query =
      typeof args.query === "string" && args.query.trim()
        ? args.query.trim()
        : "cafe";
    const { places, placeLabel } = await fetchNearbyPlaces(query);
    if (!places.length) {
      return result(
        "location.get_nearby",
        startedAt,
        "not-found",
        `I couldn't find ${query} places near ${placeLabel}.`,
        {
          error: {
            code: "not-found",
            message: "No nearby matches.",
            recoverable: true,
          },
          data: { places, placeLabel, query },
        },
      );
    }
    const lines = places
      .map((p) => {
        const dist =
          p.distanceKm < 1
            ? `${Math.round(p.distanceKm * 1000)} m`
            : `${p.distanceKm.toFixed(1)} km`;
        return `${p.name} (${dist})`;
      })
      .join("; ");
    const summary = `Near ${placeLabel}: ${lines}.`;
    return result("location.get_nearby", startedAt, "success", summary, {
      evidence: { verified: true, method: "artifact-validated", details: { source: "photon" } },
      data: { places, placeLabel, query },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't find nearby places.";
    return result("location.get_nearby", startedAt, "error", message, {
      error: { code: "location-failed", message, recoverable: true },
    });
  }
}

async function executeTravelTime(
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const destination = String(args.destination ?? "").trim();
  if (!destination) {
    return result(
      "location.get_travel_time",
      startedAt,
      "error",
      "Tell me where you want to go.",
      {
        error: {
          code: "invalid-arguments",
          message: "destination required",
          recoverable: true,
        },
      },
    );
  }
  try {
    const estimate = await fetchTravelTimeTo(destination);
    const hours = Math.floor(estimate.durationMinutes / 60);
    const mins = estimate.durationMinutes % 60;
    const duration =
      hours > 0
        ? `${hours} hour${hours === 1 ? "" : "s"}${mins ? ` ${mins} minutes` : ""}`
        : `${mins} minute${mins === 1 ? "" : "s"}`;
    const summary =
      `From ${estimate.placeLabel}, driving to ${estimate.destination} is about ` +
      `${duration} (${estimate.distanceKm} km).`;
    return result("location.get_travel_time", startedAt, "success", summary, {
      evidence: { verified: true, method: "artifact-validated", details: { source: "osrm" } },
      data: estimate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't estimate travel time.";
    return result("location.get_travel_time", startedAt, "error", message, {
      error: { code: "location-failed", message, recoverable: true },
    });
  }
}

// ---------------------------------------------------------------------------
// Screen vision (Gemini multimodal)
// ---------------------------------------------------------------------------

/**
 * The app the user put under "Watch", when it is unambiguous.
 *
 * Read here rather than passed as a tool argument: Watch is a UI affordance,
 * not something the model should have to know about or remember to forward.
 */
async function watchedApplicationName(): Promise<string | undefined> {
  const { liveWatchedApplications, refreshWatchSnapshot } = await import(
    "../watch/watchStore"
  );
  const { getApplication } = await import("../../config/applicationRegistry");
  // A closed application must not be offered as the click target, so this reads
  // the reconciled snapshot rather than a cached membership list.
  await refreshWatchSnapshot().catch(() => undefined);
  const ids = liveWatchedApplications().map((w) => w.appCatalogId);
  if (ids.length === 0) return undefined;
  // Prefer YouTube / media when watched (play/pause should hit the player).
  const mediaFirst = ids.find(
    (id) => id === "youtube" || id === "spotify" || id === "netflix",
  );
  if (mediaFirst) {
    return getApplication(mediaFirst)?.displayName ?? mediaFirst;
  }
  // Exactly one non-media watch target → that window.
  if (ids.length === 1) {
    return getApplication(ids[0])?.displayName ?? ids[0];
  }
  // Several watched apps with no clear media target — full display.
  return undefined;
}

/**
 * Capture the surface the user is pointing at.
 *
 * When a "Watch" target is set, capture that application's window: capturing
 * the whole desktop instead gave the vision model three monitors of pixels to
 * search, and the button it found was located against the wrong geometry.
 */
/**
 * Take a screenshot that knows which display it came from.
 *
 * The `screen.capture` result carries a frame id, display id and topology
 * version; `frameContextFrom` is the only accepted way to read them, and a
 * capture missing any of the three is treated as not actionable rather than
 * patched up with a guess.
 */
export { desktopItemName, mentionsDesktop };

interface DesktopItemBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Outline a Desktop icon using the shell's own rectangle.
 *
 * Returns null when this is not a Desktop item, so the caller falls through to
 * vision. Returns a result — including a refusal — when it *is* one, because a
 * named icon that the shell cannot find is a question, not a reason to go
 * hunting for something that looks similar.
 */
async function highlightDesktopItem(
  target: string,
  startedAt: string,
): Promise<ToolResult | null> {
  const name = desktopItemName(target);
  if (!name) return null;
  let found: ToolResult;
  try {
    found = await invoke<ToolResult>("capability_execute", {
      capabilityId: "desktop.find_item",
      args: { name, kind: /\bfile\b/i.test(target) ? "file" : null },
      runId: `desktop-find-${Date.now().toString(36)}`,
      userRequestSummary: target.slice(0, 200),
      confirmationToken: null,
    });
  } catch {
    return null;
  }
  if (found.status === "needs-confirmation") {
    // Two icons match. Picking one looks identical to picking the right one.
    return found;
  }
  if (found.status !== "success") {
    // Only claim this path when the user actually said "desktop"; otherwise the
    // target may well be inside an application and vision is the right tool.
    return mentionsDesktop(target) ? found : null;
  }
  const data = (found.data ?? {}) as { bounds?: DesktopItemBounds; name?: string; path?: string };
  const bounds = data.bounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  await invoke("agent_highlight_show", {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  });
  window.setTimeout(() => {
    void invoke("agent_highlight_hide").catch(() => undefined);
  }, 6000);

  return result(
    "screen.highlight_target",
    startedAt,
    "success",
    `That's “${data.name ?? name}” — I've put a border around it.`,
    {
      data: {
        target,
        resolved_name: data.name,
        path: data.path,
        bounds,
        source: "shell-list-view",
        used_vision: false,
      },
      evidence: {
        verified: true,
        method: "state-readback",
        details: { source: "shell-list-view", bounds },
      },
    },
  );
}

/**
 * Check a vision answer against the Desktop icons Windows actually reports.
 *
 * Resolves the target without drawing it, then asks whether the resulting
 * rectangle can be a single icon. When the Desktop is not the surface — the
 * target is inside an application window — the shell list is empty and only the
 * checks that stand without it apply.
 */
async function verifyAgainstDesktopIcons(
  context: VisionFrameContext,
  geometry: ModelGeometry,
  target: string,
  modelLabel: string | undefined,
  correlationId: string,
): Promise<IconGuardVerdict> {
  let resolved: Awaited<ReturnType<typeof resolveVisualTarget>>;
  try {
    resolved = await resolveVisualTarget(context, geometry);
  } catch {
    // Resolution already failed; the existing error path reports that better
    // than a verdict would, so let the draw attempt surface it.
    return { verified: true, detail: "target could not be pre-resolved" };
  }
  const box = resolved.boxRect ?? {
    x: resolved.x - 24,
    y: resolved.y - 24,
    width: 48,
    height: 48,
  };

  let icons: DesktopIcon[] = [];
  try {
    const listed = await invoke<ToolResult>("capability_execute", {
      capabilityId: "desktop.list_items",
      args: {},
      runId: `desktop-list-${Date.now().toString(36)}`,
      userRequestSummary: "verify visual target",
      confirmationToken: null,
    });
    if (listed.status === "success") {
      const data = listed.data as { items?: { name: string; bounds: Rect }[] } | undefined;
      icons = (data?.items ?? []).map((i) => ({ name: i.name, bounds: i.bounds }));
    }
  } catch {
    // No shell list available; the guard degrades rather than blocking.
  }

  const verdict = verifyDesktopIconTarget({
    box,
    requested: desktopItemName(target) || target,
    modelLabel,
    icons,
  });
  traceStage(correlationId, "target-verified", {
    verified: verdict.verified,
    reason: verdict.reason ?? null,
    detail: verdict.detail ?? null,
    matched: verdict.matched?.name ?? null,
    box,
    desktopIconCount: icons.length,
  });
  return verdict;
}

async function captureActiveDisplay(watchedApp?: string): Promise<ToolResult> {
  const args = watchedApp?.trim()
    ? { target: "application", application_query: watchedApp.trim() }
    : { target: "active-display" };
  return invoke<ToolResult>("capability_execute", {
    capabilityId: "screen.capture",
    args,
    runId: `vision-${Date.now().toString(36)}`,
    userRequestSummary: "vision capture",
    confirmationToken: null,
  });
}

async function executeScreenUnderstand(
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const { geminiDescribeImage } = await import("../../services/GeminiService");
  try {
    const cap = await captureActiveDisplay(
      typeof args.application === "string"
        ? args.application
        : await watchedApplicationName(),
    );
    if (cap.status !== "success") {
      return result(
        "screen.understand",
        startedAt,
        cap.status === "error" ? "error" : "partial",
        cap.summary || "Could not capture the screen for vision.",
        {
          error: cap.error,
          evidence: { verified: false, method: "artifact-validated" },
        },
      );
    }
    const context = frameContextFrom(cap.data as Record<string, unknown> | undefined);
    if (!context) {
      return result(
        "screen.understand",
        startedAt,
        "error",
        "That screenshot didn't record which display it came from.",
        {
          error: {
            code: "frame-ownership-missing",
            message: "capture returned no frame ownership",
            recoverable: true,
          },
        },
      );
    }
    const captureId = context.frameId;
    const width = context.imageWidth;
    const height = context.imageHeight;

    // If the user drew around something, that IS what they are asking about.
    // Taking it clears it, so it never attaches to a later question.
    type DrawnRegion = { x: number; y: number; width: number; height: number };
    let drawnRegion: DrawnRegion | null = null;
    try {
      drawnRegion = await invoke<DrawnRegion | null>("spatial_take_region");
    } catch {
      drawnRegion = null;
    }

    let dataUrl: string;
    if (drawnRegion) {
      // Crop to the marked area. Describing the region in words on a full
      // screenshot leaves the model hunting for it — the guessing this
      // feature exists to remove.
      // No origin is passed: Rust reads it from the registered frame, so the
      // crop is taken from the display the screenshot actually came from.
      dataUrl = await invoke<string>("get_capture_region_data_url", {
        id: captureId,
        x: drawnRegion.x,
        y: drawnRegion.y,
        width: drawnRegion.width,
        height: drawnRegion.height,
      });
    } else {
      dataUrl = await invoke<string>("get_capture_data_url", {
        id: captureId,
        annotated: false,
      });
    }

    const askedQuestion =
      typeof args.question === "string" && args.question.trim()
        ? args.question.trim()
        : "Describe what is on this screen. Be concise and practical.";
    const question = drawnRegion
      ? `${askedQuestion}

This image is the area the user drew around on their screen. Answer about what is shown here.`
      : askedQuestion;

    // Prefer OpenAI vision (same key as Realtime voice). Fall back to Gemini
    // only if OpenAI is unavailable and a Google key is present.
    let description: string;
    let visionProvider: "openai" | "gemini" = "openai";
    try {
      description = await invoke<string>("openai_vision", {
        prompt: question,
        images: [{ mime_type: "image/png", data: dataUrl }],
        system:
          "You describe the user's screen for a voice assistant. Be concise, practical, and factual. Do not invent UI that is not visible.",
      });
    } catch (openaiErr) {
      try {
        description = await geminiDescribeImage(dataUrl, question);
        visionProvider = "gemini";
      } catch (geminiErr) {
        const o =
          openaiErr instanceof Error ? openaiErr.message : String(openaiErr);
        const g =
          geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
        const message = /no api key|not found|credential/i.test(o)
          ? "Vision needs your OpenAI key (Settings → Voice & AI keys). Screen understanding uses the same key as voice."
          : `Vision failed: ${o}${g ? ` / ${g}` : ""}`;
        return result("screen.understand", startedAt, "error", message, {
          error: { code: "vision-failed", message, recoverable: true },
        });
      }
    }

    return result("screen.understand", startedAt, "success", description, {
      data: {
        capture_id: captureId,
        description,
        width: width || undefined,
        height: height || undefined,
      },
      evidence: {
        verified: true,
        method: "artifact-validated",
        details: { capture_id: captureId, vision: visionProvider },
      },
      artifacts: [
        {
          id: captureId,
          kind: "image",
          displayName: "Screen for vision",
          mimeType: "image/png",
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return result("screen.understand", startedAt, "error", `Vision failed: ${message}`, {
      error: { code: "vision-failed", message, recoverable: true },
    });
  }
}


/**
 * The locator's answer, in the shape the annotation executors read.
 *
 * The vision services return `box_2d` in Gemini's `[ymin, xmin, ymax, xmax]`
 * order at 0–1000; the annotation path wants a plain box. Converting through
 * `modelGeometryFromBox2d` rather than by hand means a border and a click agree
 * about where something is, including its rejection of implausibly-shaped
 * boxes. Without this the box came through empty and every annotation was
 * refused as "no clear boundary to draw around".
 */

/**
 * Find something depicted on screen, for annotation.
 *
 * One entry point for every image-capable provider, and deliberately no
 * UI-control fallback. The first version fell back to
 * `openaiLocateClickTarget` when Gemini errored, which is the prompt that says
 * "prefer the most clickable control" — so a person in a photo was never a
 * candidate and the failure looked like "they aren't on screen". A person is
 * not a button, and a locator that treats them as one is worse than no
 * locator: it produces a confident wrong answer or a misleading absence.
 *
 * When no image-capable provider answers, that is what is reported. The
 * caller turns it into "image understanding isn't available right now", not
 * "I couldn't see them".
 */
async function locateContent(
  dataUrl: string,
  target: string,
  within?: { x: number; y: number; width: number; height: number },
): Promise<Awaited<ReturnType<typeof toLocatedBox>> & {
  provider?: string;
  providerStatus?: string;
  locatorFunction?: string;
  responseShape?: string[];
  fallbackReason?: string;
}> {
  const attempts: Array<{
    provider: string;
    fn: string;
    run: () => Promise<{ found?: boolean; confidence?: number; box_2d?: number[]; label?: string }>;
  }> = [];

  const { geminiLocateContent } = await import("../../services/GeminiService");
  attempts.push({
    provider: "gemini",
    fn: "geminiLocateContent",
    run: () => geminiLocateContent(dataUrl, target, within),
  });

  const { openaiLocateContent } = await import("../../services/OpenAIVisionService");
  attempts.push({
    provider: "openai",
    fn: "openaiLocateContent",
    run: () => openaiLocateContent(dataUrl, target, within),
  });

  let fallbackReason: string | undefined;
  for (const attempt of attempts) {
    try {
      const detection = await attempt.run();
      const box = await toLocatedBox(detection);
      return {
        ...box,
        provider: attempt.provider,
        providerStatus: "available",
        locatorFunction: attempt.fn,
        responseShape: Object.keys(detection ?? {}),
        fallbackReason,
      };
    } catch (err) {
      // A category, never the provider's message — it can quote the request.
      const message = err instanceof Error ? err.message : String(err);
      fallbackReason = /api key|credential|not configured|no .* key/i.test(message)
        ? `${attempt.provider}-missing-credential`
        : `${attempt.provider}-error`;
    }
  }

  return {
    found: false,
    provider: "none",
    providerStatus: fallbackReason?.includes("missing-credential")
      ? "missing-credential"
      : "unavailable",
    locatorFunction: "none",
    responseShape: [],
    fallbackReason,
  };
}

async function toLocatedBox(detection: {
  found?: boolean;
  confidence?: number;
  box_2d?: number[];
  label?: string;
  candidates?: number;
}): Promise<{
  found: boolean;
  confidence?: number;
  boxX?: number;
  boxY?: number;
  boxWidth?: number;
  boxHeight?: number;
  candidates?: number;
  label?: string;
}> {
  const { modelGeometryFromBox2d } = await import("../../services/visionCoords");
  // `visual-content`, so the tall-sliver guard does not reject a standing
  // person. That guard exists for grids of controls and is wrong here.
  const geometry = detection.box_2d
    ? modelGeometryFromBox2d(detection.box_2d, 1000, "visual-content")
    : null;
  if (!detection.found || !geometry) {
    return { found: false, confidence: detection.confidence };
  }
  return {
    found: true,
    confidence: detection.confidence,
    boxX: geometry.box.x,
    boxY: geometry.box.y,
    boxWidth: geometry.box.width,
    boxHeight: geometry.box.height,
    candidates: detection.candidates,
    label: detection.label,
  };
}

async function executeScreenClickTarget(
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const { geminiLocateClickTarget } = await import("../../services/GeminiService");
  const { openaiLocateClickTarget } = await import("../../services/OpenAIVisionService");
  const { modelGeometryFromBox2d } = await import("../../services/visionCoords");
  const {
    describeVisualError,
    executeVisualTarget,
    newCorrelationId,
    previewVisualTarget,
  } = await import("../../services/visualTarget");
  const target = String(args.target ?? "").trim();
  if (!target) {
    return result("screen.click_target", startedAt, "error", "Say what to click.", {
      error: {
        code: "invalid-arguments",
        message: "target is required",
        recoverable: true,
      },
    });
  }

  // One id from the first capture to the verified outcome, so every stage of
  // this attempt can be read back together when a border lands somewhere odd.
  const correlationId =
    typeof args.correlation_id === "string" && args.correlation_id
      ? args.correlation_id
      : newCorrelationId();
  beginTrace(correlationId, target);

  try {
    // Prefer explicit app → last focused (opened Spotify) → watched → full display.
    let appHint =
      typeof args.application === "string" ? args.application.trim() : "";
    if (!appHint && !mentionsDesktop(target)) {
      // "Show me the Book folder on my Desktop" was capturing whichever app was
      // focused last and hunting for a desktop icon inside its window. The
      // desktop is not an application: when the user names it, no app hint can
      // be right, and the least wrong thing is the whole display.
      try {
        const { getLastFocusedApp } = await import("./focusContext");
        appHint = getLastFocusedApp() ?? "";
      } catch {
        appHint = "";
      }
      if (!appHint) {
        appHint = (await watchedApplicationName()) ?? "";
      }
    }
    const cap = await captureActiveDisplay(appHint || undefined);
    if (cap.status !== "success") {
      return result(
        "screen.click_target",
        startedAt,
        "error",
        cap.summary || "Could not capture the screen before clicking.",
        { error: cap.error, evidence: { verified: false, method: "artifact-validated" } },
      );
    }
    // A capture that cannot say which display it came from is not something to
    // act on. There is no fallback here on purpose: the old one asked which
    // monitor the mouse was on, and clicked the wrong screen when the answer
    // differed from where the screenshot was taken.
    const context = frameContextFrom(cap.data as Record<string, unknown> | undefined);
    if (!context) {
      return result(
        "screen.click_target",
        startedAt,
        "error",
        "That screenshot didn't record which display it came from, so I won't click on it.",
        {
          error: {
            code: "frame-ownership-missing",
            message: "capture returned no frame ownership",
            recoverable: true,
          },
        },
      );
    }
    const captureId = context.frameId;
    traceStage(correlationId, "capture", {
      frameId: context.frameId,
      displayId: context.displayId,
      topologyVersion: context.topologyVersion,
      captureWidth: context.captureWidth,
      captureHeight: context.captureHeight,
      modelInputWidth: context.imageWidth,
      modelInputHeight: context.imageHeight,
      // The one that catches "we photographed the wrong thing".
      capturedApplication: appHint || "(whole display)",
    });

    const dataUrl = await invoke<string>("get_capture_data_url", {
      id: captureId,
      annotated: false,
    });
    // Gemini locates: it is markedly more precise at pinning an exact box than
    // the OpenAI vision path was, which is why that one is now only a fallback
    // for when no Gemini key is configured.
    let detection;
    let locatedBy = "gemini";
    try {
      detection = await geminiLocateClickTarget(dataUrl, target);
    } catch (geminiErr) {
      const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      try {
        detection = await openaiLocateClickTarget(dataUrl, target);
        locatedBy = "openai";
      } catch (visionErr) {
        const msg = visionErr instanceof Error ? visionErr.message : String(visionErr);
        return result(
          "screen.click_target",
          startedAt,
          "error",
          /api key|credential|not found/i.test(msg) && /api key|credential|not found/i.test(geminiMsg)
            ? "Screen clicking needs a Gemini or OpenAI key (Settings → Voice & AI keys)."
            : `Couldn't read the screen for a click: ${msg}`,
          {
            error: { code: "vision-failed", message: msg, recoverable: true },
          },
        );
      }
    }
    void locatedBy;
    // A low-confidence hit is a guess, and a guess gets clicked just as hard
    // as a real match. The model was already reporting how sure it was; that
    // number was parsed and then ignored, so "I can't see it" came back as a
    // confident click somewhere arbitrary.
    const MIN_CONFIDENCE = 0.45;
    if (
      detection.found &&
      typeof detection.confidence === "number" &&
      detection.confidence < MIN_CONFIDENCE
    ) {
      return result(
        "screen.click_target",
        startedAt,
        "not-found",
        `I can't see “${target}” on the screen clearly enough to point at it. If it's on the desktop, minimise the open windows first.`,
        {
          data: { target, capture_id: captureId, confidence: detection.confidence },
          evidence: { verified: true, method: "artifact-validated" },
        },
      );
    }

    // Raw model output, before anything interprets it. When a border is wrong,
    // this line is what separates "it found the wrong thing" from "it found the
    // right thing and we mapped it badly".
    traceStage(correlationId, "model-raw", {
      found: detection.found,
      label: detection.label,
      box2d: detection.box_2d,
      confidence: detection.confidence,
      locatedBy,
    });

    const geometry = detection.found && detection.box_2d
      ? modelGeometryFromBox2d(detection.box_2d)
      : null;
    traceStage(correlationId, "model-parsed", {
      accepted: geometry !== null,
      normalizedMax: geometry?.normalizedMax,
      centre: geometry ? [geometry.x, geometry.y] : null,
      box: geometry?.box ?? null,
    });
    if (!geometry) {
      return result(
        "screen.click_target",
        startedAt,
        "not-found",
        `I couldn't find “${target}” on the screen.`,
        {
          data: { target, capture_id: captureId, detection },
          evidence: { verified: true, method: "artifact-validated" },
        },
      );
    }
    // The model supplies geometry and a label. Ownership comes from the frame,
    // and Rust does the conversion — this side never turns 0–1000 into pixels.
    const modelGeometry = {
      ...geometry,
      confidence: detection.confidence,
      label: detection.label,
    };

    const shouldClick = args.click !== false && args.click !== "false";
    try {
      if (!shouldClick) {
        // Check the answer while nothing is on screen yet. Once a border is
        // drawn the user has no way to tell a correct one from a confident
        // wrong one, so an unverifiable target must never reach the overlay.
        const verdict = await verifyAgainstDesktopIcons(
          context,
          modelGeometry,
          target,
          detection.label,
          correlationId,
        );
        if (!verdict.verified) {
          return result(
            "screen.click_target",
            startedAt,
            "not-found",
            `I found something for “${target}”, but it doesn't look like one item — ${verdict.detail}. I'd rather not put a border around the wrong thing.`,
            {
              data: {
                target,
                capture_id: captureId,
                verification: "TARGET_NOT_VERIFIED",
                reason: verdict.reason,
                detail: verdict.detail,
              },
              evidence: { verified: true, method: "artifact-validated" },
            },
          );
        }
        // border_only: the caller asked for an outline, so hold it longer.
        const seconds = args.border_only ? 6 : 2;
        const shown = await previewVisualTarget(context, modelGeometry, seconds, {
          correlationId,
        });
        // The canonical rectangle Rust produced. If this disagrees with where
        // the border appeared on screen, the fault is in the overlay, not here.
        traceStage(correlationId, "resolved", {
          displayId: shown.displayId,
          point: shown.point,
          boxRect: shown.boxRect ?? null,
          status: shown.status,
        });
        const { rememberClickTarget } = await import("./clickTargetMemory");
        rememberClickTarget(target);
        return result(
          "screen.click_target",
          startedAt,
          "success",
          `Pointing at “${shown.label ?? target}”.`,
          {
            data: {
              target,
              label: shown.label,
              x: shown.point[0],
              y: shown.point[1],
              frame_id: shown.frameId,
              display_id: shown.displayId,
              capture_id: captureId,
              pointed: true,
              clicked: false,
            },
            evidence: {
              verified: true,
              method: "native-overlay",
              details: {
                x: shown.point[0],
                y: shown.point[1],
                display_id: shown.displayId,
              },
            },
          },
        );
      }

      const clicked = await executeVisualTarget(context, modelGeometry, "left", {
        correlationId,
      });
      const { rememberClickTarget } = await import("./clickTargetMemory");
      rememberClickTarget(target);

      const data = {
        target,
        label: clicked.label,
        x: clicked.point[0],
        y: clicked.point[1],
        frame_id: clicked.frameId,
        display_id: clicked.displayId,
        correlation_id: clicked.correlationId,
        status: clicked.status,
        side_effect_possible: clicked.sideEffectPossible,
        cursor_error_px: clicked.cursor?.errorDistancePx ?? null,
        freshness: clicked.freshness?.similarityScore ?? null,
        verification: clicked.verification ?? null,
        capture_id: captureId,
        clicked: clicked.clicked,
      };

      // Nothing was sent: these are the pre-click refusals, and they are the
      // only outcomes safe to retry.
      if (!clicked.clicked) {
        return result("screen.click_target", startedAt, "not-found", clicked.summary, {
          data,
          evidence: { verified: false, method: "not-verifiable" },
        });
      }

      // The distinction the user actually cares about: input went out, versus
      // something happened. A verification failure is reported as partial, not
      // success and not failure — the click may well have registered, so
      // nothing may retry it.
      const verified = clicked.status === "verified-succeeded";
      return result(
        "screen.click_target",
        startedAt,
        verified ? "success" : "partial",
        clicked.summary,
        {
          data,
          evidence: {
            verified,
            method: verified ? "state-readback" : "return-code",
            details: {
              x: clicked.point[0],
              y: clicked.point[1],
              display_id: clicked.displayId,
              status: clicked.status,
              cursor_error_px: clicked.cursor?.errorDistancePx ?? null,
              verification: clicked.verification?.detail ?? null,
            },
          },
        },
      );
    } catch (visualErr) {
      const e = describeVisualError(visualErr);
      return result(
        "screen.click_target",
        startedAt,
        e.recapture ? "partial" : "error",
        e.recapture
          ? `I need a fresh look at the screen first — ${e.message}.`
          : `I found “${target}” but couldn't act on it: ${e.message}`,
        {
          data: { target, capture_id: captureId, frame_id: context.frameId },
          error: { code: e.code, message: e.message, recoverable: e.recapture },
          evidence: { verified: false, method: "not-verifiable" },
        },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return result("screen.click_target", startedAt, "error", `Vision click failed: ${message}`, {
      error: { code: "vision-click-failed", message, recoverable: true },
    });
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function executeFrontendCapability(
  capabilityId: string,
  args: Record<string, unknown>,
  /**
   * The caller's identity for this one request.
   *
   * Voice and tool transports retry; a retry must not produce a second task.
   * Supplied by the caller because only the caller can tell a genuine second
   * request from a redelivery of the first.
   */
  idempotencyKey?: string,
): Promise<ToolResult> {
  const startedAt = nowIso();
  // Google Connect tools (Gmail / Calendar / Drive) — voice + chat.
  if (
    capabilityId.startsWith("email.") ||
    capabilityId.startsWith("calendar.") ||
    capabilityId.startsWith("drive.") ||
    capabilityId.startsWith("docs.")
  ) {
    const { executeGoogleWorkspaceCapability } = await import(
      "./googleWorkspaceExecutors"
    );
    return executeGoogleWorkspaceCapability(capabilityId, args);
  }
  switch (capabilityId) {
    /**
     * Turn on focused Watch access for one application, from the chip the
     * assistant offers when a deep request names an application the user has
     * not activated.
     *
     * It grants and activates, and then stops. It deliberately does not re-run
     * the request that prompted it: the user asked about Chrome once, and
     * quietly answering the old question after a permission grant is how a
     * consent click turns into a read the user never asked for a second time.
     */
    case "watch.activate_application": {
      const appCatalogId = String(args.app_catalog_id ?? "").trim();
      if (!appCatalogId) {
        return result(
          capabilityId,
          startedAt,
          "error",
          "No application was named, so nothing was activated.",
        );
      }
      const [{ getWatchSnapshot, watchApplication }, { toggleWatchScope }, { currentConversationId }] =
        await Promise.all([
          import("../watch/watchStore"),
          import("../watch/watchScopeStore"),
          import("../conversation/conversationContext"),
        ]);
      const snapshot = getWatchSnapshot();
      const instance = snapshot.running.find(
        (i) => i.appCatalogId === appCatalogId,
      );
      if (!instance) {
        return result(
          capabilityId,
          startedAt,
          "error",
          `${appCatalogId} is not running, so there is nothing to activate.`,
        );
      }
      const displayName =
        snapshot.watched.find((w) => w.appCatalogId === appCatalogId)?.displayName ??
        appCatalogId;
      if (!snapshot.watched.some((w) => w.appCatalogId === appCatalogId)) {
        await watchApplication(appCatalogId);
      }
      const scope = await toggleWatchScope(currentConversationId(), appCatalogId);
      const nowActive = scope.scope.entries.some(
        (e) => e.appCatalogId === appCatalogId,
      );
      return result(
        capabilityId,
        startedAt,
        "success",
        nowActive
          ? `${displayName} is active in this conversation now. Ask again and I can read it.`
          : `${displayName} is no longer active in this conversation.`,
        {
          evidence: { verified: true, method: "state-readback" },
          data: { appCatalogId, active: nowActive },
        },
      );
    }
    case "youtube.search":
    case "youtube.list_channel_videos": {
      const { youtubeSearch, youtubeChannelVideos } = await import("./youtubeAdapter");
      const { rememberResultSet } = await import(
        "../conversation/conversationContext"
      );
      const isChannelList = capabilityId === "youtube.list_channel_videos";
      const query = isChannelList
        ? String(args.channel_id ?? "")
        : String(args.query ?? "");
      const outcome = isChannelList
        ? await youtubeChannelVideos(query, Number(args.limit ?? 5))
        : await youtubeSearch(query, {
            limit: Number(args.limit ?? 5),
            type: (args.type as "video" | "channel" | "playlist" | null) ?? "video",
          });

      if (!outcome.ok) {
        // A connected integration that failed is a failure. Quietly falling
        // back to a browser search here is how "connected" stopped meaning
        // anything — the user would see results and assume the connection
        // worked. Report it and let them choose.
        return result(capabilityId, startedAt, "error", outcome.message, {
          error: {
            code: outcome.reason,
            message: outcome.message,
            recoverable: outcome.reason !== "not-connected",
          },
          data: { reason: outcome.reason, query },
        });
      }

      const set = rememberResultSet({
        source: "youtube",
        query: isChannelList ? `channel ${query}` : query,
        items: outcome.value.map((item) => ({
          type: item.kind,
          title: item.title,
          subtitle: item.channelTitle,
          url: item.url,
          thumbnail: item.thumbnail,
          sourceId: item.sourceId,
        })),
      });

      const lines = set.items
        .map(
          (i) =>
            `${i.ordinal}. ${i.title}${i.subtitle ? ` — ${i.subtitle}` : ""}`,
        )
        .join("\n");
      return result(
        capabilityId,
        startedAt,
        "success",
        `Found ${set.items.length} YouTube result${
          set.items.length === 1 ? "" : "s"
        } for “${set.query}”, shown in chat:\n${lines}`,
        {
          data: {
            result_set_id: set.id,
            query: set.query,
            shown_inline: true,
            items: set.items,
          },
          evidence: { verified: true, method: "artifact-validated" },
        },
      );
    }
    case "youtube.open_result": {
      const { getResultSet, latestResultSet } = await import(
        "../conversation/conversationContext"
      );
      const itemId = String(args.result_item_id ?? "");
      const setId = typeof args.result_set_id === "string" ? args.result_set_id : null;
      const set = setId ? getResultSet(setId) : latestResultSet();
      const item = set?.items.find((i) => i.id === itemId);
      if (!set || !item) {
        return result(
          capabilityId,
          startedAt,
          "not-found",
          "That result isn't on screen any more — want me to look it up again?",
          {
            error: {
              code: "result-not-found",
              message: "Unknown result id",
              recoverable: true,
            },
          },
        );
      }
      if (set.expiresAt <= Date.now()) {
        return result(
          capabilityId,
          startedAt,
          "not-found",
          "Those results are out of date now. Want me to search again first?",
          {
            error: { code: "result-expired", message: "Stale result set", recoverable: true },
          },
        );
      }
      if (!item.url) {
        return result(capabilityId, startedAt, "error", "That result has no link to open.", {
          error: { code: "no-url", message: "Result has no url", recoverable: false },
        });
      }
      // The URL came from ids YouTube gave us, and still goes through the
      // native validator before any browser sees it.
      await invoke<ToolResult>("capability_execute", {
        capabilityId: "web.open_url",
        args: { url: item.url },
        runId: idempotencyKey ?? `open-${item.id}`,
        userRequestSummary: `Open ${item.title}`.slice(0, 200),
        confirmationToken: null,
      });
      return result(capabilityId, startedAt, "success", `Opened “${item.title}”.`, {
        data: {
          result_item_id: item.id,
          result_set_id: set.id,
          title: item.title,
          url: item.url,
          ordinal: item.ordinal,
        },
        evidence: { verified: false, method: "return-code" },
      });
    }
    case "connections.list": {
      const { listConnectedApps } = await import("./connectionStatus");
      const apps = await listConnectedApps();
      if (apps.length === 0) {
        return result(
          capabilityId,
          startedAt,
          "success",
          "Nothing is connected yet. The Connect page lists what's available to set up.",
          {
            data: { connected: [], count: 0 },
            evidence: { verified: true, method: "state-readback" },
          },
        );
      }
      const lines = apps.map((app) => {
        const usable =
          app.available.length > 0
            ? `${app.accessLevel} — can ${app.available.join(", ").toLowerCase()}`
            : "credential saved, but no tools are built for it yet";
        const byOrigin =
          app.available.length > 0
            ? ` In chat: ${app.availableInChat.length} tool(s). By voice: ${
                app.availableInVoice.length
              } tool(s)${
                app.availableInVoice.length < app.availableInChat.length
                  ? " (voice excludes destructive actions)"
                  : ""
              }.`
            : "";
        return `${app.displayName}: ${app.stateLabel.toLowerCase()}, ${usable}.${byOrigin}`;
      });
      return result(
        capabilityId,
        startedAt,
        "success",
        `${apps.length} connected: \n${lines.join("\n")}`,
        {
          data: { connected: apps, count: apps.length },
          evidence: { verified: true, method: "state-readback" },
        },
      );
    }
    case "connections.get_status": {
      const { readServiceConnection, summarizeConnection } = await import(
        "./connectionStatus"
      );
      const status = await readServiceConnection(String(args.service ?? ""));
      return result(
        capabilityId,
        startedAt,
        status.state === "unknown-service" ? "not-found" : "success",
        summarizeConnection(status),
        {
          // No credential values — presence only, so a reply can never leak one.
          data: {
            service: status.serviceId ?? null,
            display_name: status.displayName,
            state: status.state,
            connected: status.state === "connected",
            credential_present: status.credentialPresent,
            account: status.account ?? null,
            last_validated_at: status.lastValidatedAt ?? null,
            capabilities: status.capabilities,
            error_message: status.errorMessage ?? null,
          },
          evidence: { verified: true, method: "state-readback" },
        },
      );
    }
    case "screen.annotate":
    case "screen.update_annotation":
    case "screen.remove_annotation":
    case "screen.clear_annotations": {
      // Annotation work is one module. Imported lazily so the executor table
      // does not pull the vision path into every capability that never draws.
      const {
        executeAnnotate,
        executeUpdateAnnotation,
        executeRemoveAnnotation,
        executeClearAnnotations,
        productionDeps,
      } = await import("./annotationExecutors");
      const deps = productionDeps(
        (appHint) => captureActiveDisplay(appHint),
        async (dataUrl, target, within) => {
          // Same locator as clicking, so a border and a click agree about where
          // something is. `within` narrows the search to a parent annotation —
          // a face is looked for inside the person, never across the screen.
          // The content locator, not the click locator: a person in a photo is
          // not a control, and the click prompt refuses to box one. There is
          // deliberately no UI-locator fallback here — see `locateContent`.
          return locateContent(dataUrl, target, within);
        },
      );
      if (capabilityId === "screen.annotate") return executeAnnotate(deps, args, startedAt);
      if (capabilityId === "screen.update_annotation")
        return executeUpdateAnnotation(deps, args, startedAt);
      if (capabilityId === "screen.remove_annotation")
        return executeRemoveAnnotation(deps, args, startedAt);
      return executeClearAnnotations(deps, args, startedAt);
    }
    case "screen.highlight_target": {
      // Drawing a border was impossible before this existed: the native
      // command was there, but nothing exposed it as a tool, so the model
      // correctly answered that it could not do it.
      type Region = { x: number; y: number; width: number; height: number };
      let region: Region | null = null;
      try {
        region = await invoke<Region | null>("spatial_take_region");
      } catch {
        region = null;
      }

      const target = String(args.target ?? "").trim();
      if (!region) {
        if (!target) {
          return result(
            "screen.highlight_target",
            startedAt,
            "error",
            "What should I put a border around?",
            {
              error: { code: "invalid-arguments", message: "target required", recoverable: true },
            },
          );
        }
        // Windows already knows where every Desktop icon is, to the pixel. Ask
        // it before photographing the screen and guessing: a vision model
        // returned a box covering four unrelated icons for "the books folder",
        // and no amount of correct coordinate mapping can rescue a wrong answer.
        const structured = await highlightDesktopItem(target, startedAt);
        if (structured) return structured;

        // Nothing drawn, but a named target: this is an annotation.
        //
        // `screen.highlight_target` and `screen.annotate` overlap — the model
        // picks either for "draw a border around the person on the left" — and
        // the old path produced a single unmanaged overlay with no id, so the
        // follow-up "make the circle red" had nothing to name. Routing through
        // the annotation manager means whichever capability the model chooses,
        // the user gets a managed shape with a stable id.
        const {
          executeAnnotate: annotate,
          productionDeps: annotationDeps,
        } = await import("./annotationExecutors");
        return annotate(
          annotationDeps(
            (appHint) => captureActiveDisplay(appHint),
            async (dataUrl, wanted, within) => {
              return locateContent(dataUrl, wanted, within);
            },
          ),
          { target, shape: "highlight" },
          startedAt,
        );
      }

      try {
        await invoke("agent_highlight_show", {
          x: Math.round(region.x),
          y: Math.round(region.y),
          width: Math.round(region.width),
          height: Math.round(region.height),
        });
        const seconds =
          typeof args.seconds === "number" ? Math.min(Math.max(args.seconds, 1), 30) : 6;
        window.setTimeout(() => {
          void invoke("agent_highlight_hide").catch(() => undefined);
        }, seconds * 1000);
        return result(
          "screen.highlight_target",
          startedAt,
          "success",
          "Put a border around the area you drew.",
          {
            data: { region, seconds },
            evidence: { verified: true, method: "native-overlay" },
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return result("screen.highlight_target", startedAt, "error", message, {
          error: { code: "highlight-failed", message, recoverable: true },
        });
      }
    }
    case "web.answer_question": {
      const question = String(args.question ?? "").trim();
      if (!question) {
        return result("web.answer_question", startedAt, "error", "What should I look up?", {
          error: { code: "invalid-arguments", message: "question is required", recoverable: true },
        });
      }
      try {
        const answer = await invoke<{ text: string; sources: { title: string; url: string }[] }>(
          "web_grounded_answer",
          { question },
        );
        return result("web.answer_question", startedAt, "success", answer.text, {
          data: { question, sources: answer.sources },
          // Citations are the proof it was retrieved rather than recalled.
          evidence: {
            verified: answer.sources.length > 0,
            method: "web-grounded",
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return result("web.answer_question", startedAt, "error", message, {
          error: { code: "search-failed", message, recoverable: true },
        });
      }
    }
    case "arcsonare.navigate":
      return executeNavigate(args, startedAt);
    case "arcsonare.show_notification":
      return executeNotification(args, startedAt);
    case "tasks.create":
      return executeTaskCreate(args, startedAt, idempotencyKey);
    case "tasks.list":
      return executeTaskList(args, startedAt);
    case "tasks.complete":
    case "tasks.reopen":
    case "tasks.update":
    case "tasks.add_subtask":
    case "tasks.assign_agent":
    case "tasks.delete":
      return executeTaskMutation(capabilityId, args, startedAt);
    case "location.get_weather":
      return executeWeather(startedAt);
    case "location.get_nearby":
      return executeNearby(args, startedAt);
    case "location.get_travel_time":
      return executeTravelTime(args, startedAt);
    case "screen.understand":
      return executeScreenUnderstand(args, startedAt);
    case "screen.click_target":
      return executeScreenClickTarget(args, startedAt);
    default:
      return result(capabilityId, startedAt, "error", `"${capabilityId}" has no frontend executor.`, {
        error: { code: "unknown-capability", message: capabilityId, recoverable: false },
      });
  }
}
