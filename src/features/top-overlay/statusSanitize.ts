/**
 * Keep overlay status / transcript free of tool dumps and internal error codes.
 * The model sometimes leaks these into spoken text; we never show them in the capsule.
 */

const LEAKY =
  /\b(invalid-arguments|invalid_arguments|needs-confirmation|function_call|tool_call|filesystem__|screen__|applications__|input__|capability|box_2d|parent_path|__known_parent)\b/i;

const TOOLISH_JSON = /^\s*[{\[]/;

export function isLeakyStatus(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (LEAKY.test(t)) return true;
  if (TOOLISH_JSON.test(t) && t.length > 20) return true;
  if (/filesystem\.[a-z_]+/i.test(t)) return true;
  return false;
}

/** Clean line for the capsule status strip (short). */
export function sanitizeStatusLine(text: string, fallback = "…"): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || isLeakyStatus(t)) return fallback;
  // Strip leading internal tags the model sometimes prefixes.
  const cleaned = t
    .replace(/^(invalid-arguments|error|tool error)\s*[:\-–]?\s*/i, "")
    .trim();
  if (!cleaned || isLeakyStatus(cleaned)) return fallback;
  return cleaned.length > 72 ? `${cleaned.slice(0, 71)}…` : cleaned;
}

/** Full transcript for the dropdown — strip only the worst leaks. */
export function sanitizeTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (isLeakyStatus(t) && !/[.!?]\s+[A-Z]/.test(t)) {
    // Entire line is leaky garbage.
    return "";
  }
  return t
    .replace(/\binvalid-arguments\b[:\s]*/gi, "")
    .replace(/\bfilesystem__[a-z0-9_]+\b/gi, "")
    .trim();
}

/** Human label for a tool id — never show raw capability paths in the UI. */
export function humanToolLabel(capabilityId: string): string {
  const id = capabilityId.replace(/__/g, ".");
  const map: Record<string, string> = {
    "applications.open": "Opening…",
    "applications.focus": "Focusing…",
    "screen.capture": "Screenshot…",
    "screen.understand": "Looking…",
    "screen.click_target": "Clicking…",
    "filesystem.create_directory": "Creating folder…",
    "filesystem.resolve_known_folder": "Finding folder…",
    "filesystem.list_directory": "Listing…",
    "filesystem.list_known_folder": "Listing…",
    "system.get_local_datetime": "Checking time…",
    "input.click_at": "Clicking…",
    "email.list_messages": "Reading Gmail…",
    "email.read_message": "Opening email…",
    "email.get_connection_status": "Checking Gmail…",
    "calendar.list_events": "Reading calendar…",
    "calendar.create_event": "Adding event…",
    "calendar.get_connection_status": "Checking calendar…",
    "drive.list_files": "Reading Drive…",
    "drive.get_connection_status": "Checking Drive…",
  };
  if (map[id]) return map[id];
  if (id.startsWith("applications.")) return "Working with apps…";
  // Never surface raw filesystem dumps as the capsule status during voice.
  if (id.startsWith("filesystem.")) return "Working…";
  if (id.startsWith("email.")) return "Reading Gmail…";
  if (id.startsWith("calendar.")) return "Checking calendar…";
  if (id.startsWith("drive.")) return "Reading Drive…";
  if (id.startsWith("screen.")) return "Looking…";
  return "Working…";
}
