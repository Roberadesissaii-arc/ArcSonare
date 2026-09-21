/**
 * Short-lived session memory of actions ArcSonare actually executed.
 * Injected into the assistant / tool-loop prompts so follow-ups like
 * “where did you create that?” can be answered honestly.
 */
import type { ToolResult } from "./capabilityTypes";

export interface SessionAction {
  at: number;
  userRequest: string;
  capabilityId: string;
  summary: string;
  /** Absolute path or other key location from the tool result, when present. */
  path?: string;
  /** App/site name for deictic follow-ups (“screenshot that”). */
  application?: string;
  status: ToolResult["status"];
}

const MAX_ACTIONS = 12;
let actions: SessionAction[] = [];

function extractPath(result: ToolResult): string | undefined {
  const data = result.data as
    | { path?: string; paths?: string[]; target?: string }
    | undefined;
  if (typeof data?.path === "string" && data.path.trim()) return data.path;
  if (Array.isArray(data?.paths) && typeof data.paths[0] === "string") {
    return data.paths[0];
  }
  if (typeof data?.target === "string" && data.target.trim()) return data.target;
  const artifactPath = result.artifacts?.find((a) => a.path)?.path;
  return artifactPath || undefined;
}

function extractApplication(
  capabilityId: string,
  result: ToolResult,
): string | undefined {
  const data = result.data as
    | {
        application?: string;
        site?: string;
        target_description?: string;
      }
    | undefined;
  if (typeof data?.application === "string" && data.application.trim()) {
    return data.application.trim();
  }
  if (capabilityId.startsWith("web.") && data?.site === "youtube") {
    return "YouTube";
  }
  if (typeof data?.target_description === "string") {
    return data.target_description.trim();
  }
  return undefined;
}

/** Record a verified (or partial) capability outcome for later Q&A. */
export function recordSessionAction(
  userRequest: string,
  capabilityId: string,
  result: ToolResult,
) {
  if (
    result.status !== "success" &&
    result.status !== "partial" &&
    result.status !== "not-found"
  ) {
    return;
  }
  const application = extractApplication(capabilityId, result);
  if (application) {
    void import("./focusContext").then(({ rememberFocusedApp }) => {
      rememberFocusedApp(application);
    });
  }
  actions = [
    {
      at: Date.now(),
      userRequest: userRequest.trim().slice(0, 200),
      capabilityId,
      summary: result.summary.slice(0, 400),
      path: extractPath(result),
      application,
      status: result.status,
    },
    ...actions,
  ].slice(0, MAX_ACTIONS);
}

export function getRecentSessionActions(limit = 6): SessionAction[] {
  return actions.slice(0, limit);
}

/** Capabilities that leave a file behind the user may refer to next turn. */
const FILE_PRODUCING = new Set([
  "filesystem.create_file",
  "filesystem.write_text_file",
  "filesystem.modify_file",
  "filesystem.rename",
  "filesystem.copy",
  "filesystem.move",
]);

/**
 * The file "that file" most likely means.
 *
 * ArcSonare created it minutes ago and recorded where — so resolving the
 * reference is a lookup, not a search. Hunting the desktop for a file whose
 * path is already known is both slower and capable of finding the wrong one.
 */
export function recentFileArtifact(): SessionAction | undefined {
  return actions.find(
    (a) => FILE_PRODUCING.has(a.capabilityId) && !!a.path && a.status !== "not-found",
  );
}

/** Prompt block for the model — empty string when nothing has run yet. */
export function formatSessionActionContext(limit = 6): string {
  const recent = getRecentSessionActions(limit);
  if (recent.length === 0) return "";
  const lines = recent.map((a, i) => {
    const when = new Date(a.at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    const where = a.path ? ` Full path: ${a.path}.` : "";
    return `${i + 1}. [${when}] You performed: ${a.capabilityId} — ${a.summary}${where} (user had asked: “${a.userRequest}”)`;
  });
  const file = recentFileArtifact();
  const fileLine = file
    ? [
        `The file you most recently created or changed is: ${file.path}`,
        "If the user says “fix that file”, “fix the bug in it”, “update the script” or names that file, they mean THAT path. Call filesystem.read_for_edit on it, then filesystem.modify_file with a patch. Do NOT call filesystem.create_file — the file already exists on purpose, and its existence is not a problem to ask about. Do not search the screen for it; the path is right here.",
      ]
    : [];
  return [
    "Recent actions YOU already performed in this session (ground truth — you called these tools):",
    ...lines,
    ...fileLine,
    "Follow-ups: resolve words like “that”, “it”, “that app”, “that window” using the most recent app/site above or WATCHED apps. “Screenshot that” means capture that app’s window. “Open the second video” means on YouTube if YouTube was just opened. Do not invent paths or actions that are not listed.",
  ].join("\n");
}

export function clearSessionActions() {
  actions = [];
}
