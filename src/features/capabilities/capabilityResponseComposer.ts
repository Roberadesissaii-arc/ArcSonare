/**
 * Deterministic answer templates. Pure deterministic capabilities never go
 * back to a model just to phrase a sentence — the ToolResult composes the
 * response locally, and the text always reflects the real status.
 */
import type { ToolResult } from "./capabilityTypes";

interface DatetimeData {
  time?: string;
  date?: string;
  local_datetime?: string;
  timezone_name?: string;
  utc_offset?: string;
  weekday?: string;
}

interface ListingData {
  path?: string;
  total_items?: number;
  counts?: { folders?: number; files?: number; shortcuts?: number };
  items?: Array<{ name?: string; type?: string }>;
}

function composeDatetime(result: ToolResult, request: string): string {
  const data = (result.data ?? {}) as DatetimeData;
  const q = request.toLowerCase();
  if (/timezone/.test(q)) {
    return `You're in ${data.timezone_name ?? "an unknown timezone"} (UTC${data.utc_offset ?? ""}).`;
  }
  if (/\b(day|date)\b/.test(q)) {
    return `Today is ${data.date ?? data.local_datetime ?? "unknown"}.`;
  }
  return `It's ${data.time ?? data.local_datetime ?? "unknown"}.`;
}

function composeListing(result: ToolResult): string {
  const data = (result.data ?? {}) as ListingData;
  const total = data.total_items ?? 0;
  const counts = data.counts ?? {};
  const parts: string[] = [];
  if (counts.folders) parts.push(`${counts.folders} folder${counts.folders === 1 ? "" : "s"}`);
  if (counts.files) parts.push(`${counts.files} file${counts.files === 1 ? "" : "s"}`);
  if (counts.shortcuts) parts.push(`${counts.shortcuts} shortcut${counts.shortcuts === 1 ? "" : "s"}`);
  const folderNames = (data.items ?? [])
    .filter((i) => i.type === "directory")
    .slice(0, 3)
    .map((i) => i.name)
    .filter(Boolean);
  let text = `That folder has ${total} item${total === 1 ? "" : "s"}`;
  if (data.path && /desktop/i.test(data.path)) {
    text = `Your desktop has ${total} item${total === 1 ? "" : "s"}`;
  }
  if (parts.length > 0) text += `: ${parts.join(", ")}`;
  text += ".";
  if (folderNames.length > 0) {
    text += ` The folders include ${folderNames.join(", ")}.`;
  }
  return text;
}

/**
 * Compose the user-facing sentence for a completed run. Voice callers slice
 * this to the essentials; chat shows it with the result card.
 */
export function composeResponse(result: ToolResult, request: string): string {
  // Non-success statuses always speak honestly from the result itself.
  if (result.status === "partial") {
    return result.summary;
  }
  if (result.status === "not-found") {
    return result.summary;
  }
  if (result.status === "unsupported") {
    return result.summary;
  }
  if (result.status === "denied") {
    return result.summary;
  }
  if (result.status === "error") {
    return result.error?.message
      ? `That didn't work: ${result.error.message}`
      : result.summary;
  }
  if (result.status === "needs-confirmation") {
    return result.summary;
  }

  switch (result.capabilityId) {
    case "system.get_local_datetime":
      return composeDatetime(result, request);
    case "filesystem.list_known_folder":
    case "filesystem.list_directory":
      return composeListing(result);
    case "applications.open": {
      const data = (result.data ?? {}) as { application?: string; method?: string; action?: string };
      if (data.action === "focused-existing") {
        return `${data.application ?? "It"} was already running — I brought it to the front.`;
      }
      if (data.method === "web-fallback") {
        return result.summary;
      }
      return `I opened ${data.application ?? "it"}.`;
    }
    case "screen.capture":
      return "Here's the screenshot.";
    case "arcsonare.navigate": {
      const data = (result.data ?? {}) as { page?: string };
      return `Opened ${data.page ?? "the page"}.`;
    }
    case "tasks.create":
      return result.summary;
    default:
      return result.summary;
  }
}

/** Short spoken variant for the voice overlay. */
export function composeSpokenResponse(result: ToolResult, request: string): string {
  const text = composeResponse(result, request);
  // Keep speech brief: first sentence, capped length.
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
}
