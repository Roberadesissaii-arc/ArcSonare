/**
 * Human labels for the provenance footer under an assistant reply.
 *
 * Internal ids (`tasks.create`, `filesystem.list_known_folder`) must never
 * reach the user, but knowing WHICH tool ran is genuinely useful — it is the
 * difference between "it says it created a task" and "it created a task".
 */

const TOOL_LABELS: Record<string, string> = {
  "tasks.create": "Created task",
  "tasks.complete": "Completed task",
  "tasks.reopen": "Reopened task",
  "tasks.update": "Updated task",
  "tasks.list": "Read tasks",
  "filesystem.list_known_folder": "Read folder",
  "filesystem.list_directory": "Read folder",
  "filesystem.create_directory": "Created folder",
  "filesystem.create_file": "Created file",
  "filesystem.find": "Searched files",
  "filesystem.delete": "Moved to Recycle Bin",
  "applications.open": "Opened app",
  "web.activate_listed_item": "Opened YouTube video",
  "web.search": "Web search",
  "web.fetch_page": "Read web page",
  "applications.focus": "Focused window",
  "applications.close": "Closed app",
  "system.get_local_datetime": "System clock",
  "screen.capture": "Screenshot",
  "clipboard.read_text": "Read clipboard",
  "arcsonare.navigate": "Navigated",
  "location.get_weather": "Weather",
  "location.get_nearby": "Nearby places",
  "location.get_travel_time": "Travel time",
  "email.get_inbox_summary": "Read Gmail",
  "email.get_latest_message": "Read Gmail",
  "email.list_unread": "Read Gmail",
  "email.open_inbox_ui": "Opened Gmail",
  "email.get_connection_status": "Checked connection",
  "email.create_draft": "Drafted email",
  "email.reply_draft": "Drafted reply",
  "calendar.list_events": "Read calendar",
  "calendar.get_next_event": "Read calendar",
  "calendar.create_event": "Added event",
  "calendar.open_ui": "Opened calendar",
  "calendar.get_connection_status": "Checked connection",
  "drive.list": "Read Drive",
  "drive.open_ui": "Opened Drive",
  "drive.get_connection_status": "Checked connection",
  "connections.get_status": "Checked connection",
};

/** Which part of ArcSonare handled the request — the "agent" in the footer. */
export function agentForTool(toolId?: string): string {
  if (!toolId) return "Assistant";
  const domain = toolId.split(".")[0];
  switch (domain) {
    case "tasks":
      return "Tasks";
    case "filesystem":
      return "Files";
    case "applications":
      return "Apps";
    case "email":
    case "calendar":
    case "drive":
      return "Connections";
    case "screen":
    case "system":
    case "clipboard":
      return "System";
    case "web":
      return "Web";
    case "location":
      return "Location";
    case "arcsonare":
      return "Navigation";
    default:
      return "Assistant";
  }
}

/** Readable name for a tool id, falling back to a de-slugged form. */
export function labelForTool(toolId?: string): string | undefined {
  if (!toolId) return undefined;
  return (
    TOOL_LABELS[toolId] ??
    toolId
      .split(".")
      .slice(1)
      .join(" ")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}
