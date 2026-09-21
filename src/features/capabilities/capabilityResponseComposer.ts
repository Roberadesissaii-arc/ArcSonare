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
  return `The current time is ${data.time ?? data.local_datetime ?? "unknown"}.`;
}

/** Folders the user calls "my <name>" — everything else is named directly. */
const KNOWN_FOLDER_LABELS = new Set([
  "desktop",
  "downloads",
  "documents",
  "pictures",
  "videos",
  "music",
]);

function composeListing(result: ToolResult): string {
  const data = (result.data ?? {}) as ListingData;
  const total = data.total_items ?? 0;
  const counts = data.counts ?? {};
  // Name the folder that was actually read. Testing for "desktop" anywhere in
  // the path labelled every subfolder of the Desktop "Your desktop", so
  // listing Desktop\Fantastic announced the wrong folder entirely.
  const leaf = (data.path ?? "").split(/[\\/]+/).filter(Boolean).pop() ?? "";
  const where = !data.path
    ? "That folder"
    : KNOWN_FOLDER_LABELS.has(leaf.toLowerCase())
      ? `Your ${leaf.toLowerCase()}`
      : leaf;
  const lines: string[] = [
    `**${where}** — ${total} item${total === 1 ? "" : "s"}`,
  ];
  if (counts.folders || counts.files || counts.shortcuts) {
    const bits: string[] = [];
    if (counts.folders) bits.push(`${counts.folders} folder${counts.folders === 1 ? "" : "s"}`);
    if (counts.files) bits.push(`${counts.files} file${counts.files === 1 ? "" : "s"}`);
    if (counts.shortcuts) {
      bits.push(`${counts.shortcuts} shortcut${counts.shortcuts === 1 ? "" : "s"}`);
    }
    lines.push(bits.join(" · "));
  }
  const items = (data.items ?? []).slice(0, 12);
  if (items.length > 0) {
    lines.push("");
    for (const item of items) {
      const name = item.name?.trim() || "(unnamed)";
      const kind =
        item.type === "directory" ? "folder" : item.type === "file" ? "file" : item.type || "item";
      lines.push(`- **${name}** · ${kind}`);
    }
    if (total > items.length) {
      lines.push(`- _…and ${total - items.length} more_`);
    }
  }
  return lines.join("\n");
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
    // A missing file or folder is not a missing app. Routing every not-found
    // through the app branch produced "I couldn't find an app called
    // "C:\...\reports" does not exist.". If you meant a YouTube video…".
    if (result.capabilityId?.startsWith("filesystem.")) {
      const data = (result.data ?? {}) as { path?: string };
      // On a miss the path is usually only in the summary, not in data.
      const fromSummary = result.summary.match(/["“]?([A-Za-z]:[\\/][^"”]*?)["”]?\s+does not exist/);
      const path = data.path || fromSummary?.[1] || "";
      const leaf = path.split(/[\\/]+/).filter(Boolean).pop();
      return leaf
        ? `I couldn't find “${leaf}” — there's no folder by that name there.`
        : "I couldn't find that folder.";
    }
    // Never surface raw “installed app” errors for video / media phrasing.
    const q = request.toLowerCase();
    if (/\bvideo\b/.test(q) || /theird|third|second|first|2nd|3rd|1st/.test(q)) {
      return "I couldn't open that YouTube video from the list. Try “open the third video” again, or name the video.";
    }
    // Only the "<name> was not found as an installed app" shape may be reworded
    // into "I couldn't find an app called X". Applying it to every not-found
    // wrapped whole sentences into nonsense, e.g. 'I couldn't find an app
    // called "No visible window matched "spotify". Is the app running?"'.
    const appMiss = result.summary
      .trim()
      .match(/^"?(.+?)"?\s+was not found as an installed app or known service\.?$/i);
    if (appMiss) {
      return `I couldn't find an app called “${appMiss[1]}”.`;
    }
    // Anything else is already a complete, readable message — leave it alone.
    return result.summary;
  }
  if (result.status === "unsupported") {
    return result.summary;
  }
  if (result.status === "denied") {
    return result.summary;
  }
  if (result.status === "error") {
    // YouTube list pick — short, actionable, no schema noise.
    if (result.capabilityId === "web.activate_listed_item") {
      const q = request.toLowerCase();
      const which =
        q.match(/\b(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\b/i)?.[1] ??
        "that";
      const raw = (result.error?.message || result.summary || "").trim();
      if (/only found \d+/i.test(raw)) {
        return raw;
      }
      return `I couldn't open the ${which} video on YouTube right now. Try “search youtube for …” first, then “open the ${which} video” again.`;
    }
    const raw = result.error?.message || result.summary;
    // Never echo internal tool ids or raw schema noise to the user.
    const cleaned = raw
      .replace(/\b[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*\b/gi, "")
      .replace(/\bArguments were rejected:?\s*/gi, "")
      .replace(/\bInvalid arguments:?\s*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (result.error?.code === "invalid-arguments") {
      return "I couldn't complete that with the details I had. Please try asking again.";
    }
    return cleaned
      ? `That didn't work: ${cleaned}`
      : "That didn't work. Please try again.";
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
    case "filesystem.create_directory": {
      const data = (result.data ?? {}) as { path?: string };
      if (data.path) {
        const leaf = data.path.split(/[/\\]/).filter(Boolean).pop() ?? "folder";
        return `Created the “${leaf}” folder.`;
      }
      return result.summary;
    }
    case "filesystem.create_file": {
      const data = (result.data ?? {}) as { path?: string };
      if (data.path) {
        const leaf = data.path.split(/[/\\]/).filter(Boolean).pop() ?? "file";
        return `Created “${leaf}”.`;
      }
      return result.summary;
    }
    case "filesystem.open_item":
    case "filesystem.reveal_in_explorer": {
      const data = (result.data ?? {}) as { path?: string };
      if (data.path) {
        const leaf = data.path.split(/[/\\]/).filter(Boolean).pop() ?? "it";
        return result.capabilityId === "filesystem.reveal_in_explorer"
          ? `Showing “${leaf}” in File Explorer.`
          : `Opened “${leaf}” for you.`;
      }
      return result.summary
        .replace(/^Opened "/, "Opened “")
        .replace(/" with its default app\./, "” for you.")
        .replace(/^Showing "/, "Showing “")
        .replace(/" in File Explorer\./, "” in File Explorer.");
    }
    case "applications.open": {
      const data = (result.data ?? {}) as { application?: string; method?: string; action?: string };
      const name = data.application ?? "it";
      if (data.action === "focused-existing") {
        return `${name} was already open — brought it up.`;
      }
      if (data.method === "web-fallback") {
        return `Opened ${name}.`;
      }
      return `Opened ${name}.`;
    }
    case "screen.capture": {
      const data = (result.data ?? {}) as { target_description?: string };
      if (data.target_description) {
        return `Got a screenshot of ${data.target_description}.`;
      }
      return "Got the screenshot.";
    }
    case "screen.understand": {
      const data = (result.data ?? {}) as { description?: string };
      return (data.description || result.summary || "Here's what I see on your screen.").trim();
    }
    case "screen.click_target": {
      const data = (result.data ?? {}) as {
        label?: string;
        target?: string;
        x?: number;
        y?: number;
        pointed?: boolean;
        clicked?: boolean;
      };
      if (data.pointed && data.clicked === false) {
        const name = data.label || data.target || "that";
        return `Pointing at “${name}”.`;
      }
      const t = `${data.target ?? ""} ${data.label ?? ""}`.toLowerCase();
      if (/\bplay\b/.test(t) && !/\bpause\b/.test(t)) {
        return "Playing the video.";
      }
      if (/\bpause\b/.test(t) || /\bstop\b/.test(t)) {
        return "Paused the video.";
      }
      if (data.label) {
        return `Clicked “${data.label}”.`;
      }
      if (data.target) {
        return `Clicked “${data.target}”.`;
      }
      return result.summary;
    }
    case "connections.list":
    case "connections.get_status":
    case "email.list_messages":
    case "email.read_message":
    case "email.get_connection_status":
    case "calendar.list_events":
    case "calendar.create_event":
    case "calendar.get_connection_status":
    case "drive.list_files":
    case "drive.get_connection_status":
      return result.summary;
    case "input.click_at": {
      const data = (result.data ?? {}) as { x?: number; y?: number };
      if (typeof data.x === "number" && typeof data.y === "number") {
        return `Clicked at (${data.x}, ${data.y}).`;
      }
      return result.summary;
    }
    case "web.fetch_page": {
      const data = (result.data ?? {}) as {
        title?: string;
        url?: string;
        text?: string;
        chars?: number;
        images?: string[];
      };
      if (result.status !== "success") {
        return result.summary || "Could not read that page.";
      }
      const title = data.title?.trim();
      const text = (data.text ?? "").trim();
      const imageList = Array.isArray(data.images)
        ? data.images.filter((u) => typeof u === "string" && u.startsWith("http"))
        : [];
      // Redact destination URL for model-facing facts (local fetch used the real one).
      const parts = [
        title ? `Page title: ${title}` : "Page title: (none extracted)",
        `Images extracted for UI: ${imageList.length}`,
        imageList.length
          ? "The chat UI will show the real image(s) under your reply — describe them briefly and naturally; do not invent image content you cannot see."
          : "No preview images were extracted.",
        text
          ? `Extracted text:\n${text}`
          : "No readable text was extracted (images-only page is fine).",
      ];
      return parts.join("\n\n");
    }
    case "web.activate_listed_item": {
      const data = (result.data ?? {}) as {
        title?: string;
        index?: number;
        url?: string;
      };
      if (data.title) {
        const t = data.title.replace(/^"|"$/g, "");
        return `Playing “${t}” on YouTube.`;
      }
      if (data.index) {
        return `Playing video #${data.index} on YouTube.`;
      }
      // Prefer the Rust summary ("Playing … on YouTube.") when present.
      if (/playing /i.test(result.summary)) return result.summary;
      return result.summary;
    }
    case "arcsonare.navigate": {
      const data = (result.data ?? {}) as { page?: string };
      return `Opened ${data.page ?? "the page"}.`;
    }
    case "tasks.create":
      return result.summary;
    case "location.get_weather":
    case "location.get_nearby":
    case "location.get_travel_time":
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
