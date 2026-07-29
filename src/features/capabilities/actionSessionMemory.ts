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
  actions = [
    {
      at: Date.now(),
      userRequest: userRequest.trim().slice(0, 200),
      capabilityId,
      summary: result.summary.slice(0, 400),
      path: extractPath(result),
      status: result.status,
    },
    ...actions,
  ].slice(0, MAX_ACTIONS);
}

export function getRecentSessionActions(limit = 6): SessionAction[] {
  return actions.slice(0, limit);
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
  return [
    "Recent actions YOU already performed in this session (ground truth — you called these tools):",
    ...lines,
    "If the user asks where something was created, what you did, or similar follow-ups, answer from this list using the Full path when present. Do not invent paths or actions that are not listed. Do not call create/delete tools again just to answer a follow-up.",
  ].join("\n");
}

export function clearSessionActions() {
  actions = [];
}
