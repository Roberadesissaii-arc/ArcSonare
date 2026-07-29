/**
 * Central provider-independent capability registry. One definition per
 * capability — provider adapters convert these into each model's tool format.
 * Never send the whole registry to a model; the router selects a small set.
 */
import type {
  CapabilityDefinition,
  JSONSchema,
} from "./capabilityTypes";

function def(
  base: Pick<
    CapabilityDefinition,
    "id" | "displayName" | "description" | "category" | "riskLevel"
  > &
    Partial<CapabilityDefinition>,
): CapabilityDefinition {
  return {
    version: 1,
    aliases: [],
    intentExamples: [],
    keywords: [],
    confirmation: "never",
    availability: "available",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    resultSchema: { type: "object" },
    supportsVoice: true,
    supportsChat: true,
    supportsDeterministicRouting: false,
    canChain: true,
    timeoutMs: 15_000,
    requiredPermissions: [],
    executor: "native",
    ...base,
  };
}

const pathProp: JSONSchema = { type: "string", description: "Absolute Windows path" };

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  // ------------------------------------------------------------- system
  def({
    id: "system.get_local_datetime",
    displayName: "Current date & time",
    description:
      "Read the real local system date, time and timezone. Use for any question about the current time, date, day or timezone.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["time", "date", "clock", "today", "datetime", "timezone"],
    intentExamples: [
      "what time is it",
      "what day is it",
      "what is today's date",
      "what timezone am I in",
    ],
    keywords: ["time", "date", "day", "today", "clock", "timezone", "now"],
    supportsDeterministicRouting: true,
    timeoutMs: 3_000,
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["spoken", "full", "iso"] },
        include_timezone: { type: "boolean" },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "system.get_environment_summary",
    displayName: "System info",
    description:
      "Safe summary of this computer: Windows version, architecture, ArcSonare version, device name, locale, timezone.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["system info", "about this pc", "windows version"],
    intentExamples: ["what windows version am I on", "system information"],
    keywords: ["windows", "version", "system", "computer", "pc", "architecture"],
    supportsDeterministicRouting: true,
  }),
  def({
    id: "system.get_running_processes",
    displayName: "Running applications",
    description: "List user-facing application processes that have windows.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["running apps", "open apps", "processes"],
    intentExamples: ["what apps are running", "what's open right now"],
    keywords: ["running", "processes", "apps", "open", "programs"],
    supportsDeterministicRouting: true,
  }),
  def({
    id: "system.get_active_window",
    displayName: "Active window",
    description: "Describe the currently focused window (title, app, bounds).",
    category: "system",
    riskLevel: "read-only",
    aliases: ["active window", "current window", "focused window"],
    intentExamples: ["what window is active", "what am I looking at"],
    keywords: ["active", "window", "focused", "foreground"],
    supportsDeterministicRouting: true,
  }),
  def({
    id: "system.list_displays",
    displayName: "Displays",
    description: "List connected displays with bounds, scale and primary flag.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["monitors", "screens", "displays"],
    intentExamples: ["list my displays", "how many monitors do I have"],
    keywords: ["display", "monitor", "screen", "resolution"],
    supportsDeterministicRouting: true,
  }),
  def({
    id: "system.get_battery_status",
    displayName: "Battery",
    description: "Battery percentage and charging state, when the device has one.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["battery", "charge"],
    intentExamples: ["what's my battery at", "am I charging"],
    keywords: ["battery", "charge", "charging", "power", "percent"],
    supportsDeterministicRouting: true,
  }),
  def({
    id: "system.get_audio_status",
    displayName: "Audio status",
    description: "Output device, volume and mute state (not yet implemented).",
    category: "system",
    riskLevel: "read-only",
    availability: "unsupported",
    aliases: ["volume", "audio"],
    keywords: ["volume", "audio", "mute", "sound"],
  }),

  // --------------------------------------------------------- filesystem
  def({
    id: "filesystem.resolve_known_folder",
    displayName: "Resolve known folder",
    description:
      "Resolve a Windows known folder (desktop, documents, downloads, pictures, videos, music, home) to its real, possibly redirected path.",
    category: "filesystem",
    riskLevel: "read-only",
    keywords: ["desktop", "documents", "downloads", "folder", "path", "where"],
    intentExamples: ["where is my desktop folder"],
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          enum: [
            "desktop",
            "documents",
            "downloads",
            "pictures",
            "videos",
            "music",
            "home",
            "app-data",
            "local-app-data",
          ],
        },
      },
      required: ["folder"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.list_known_folder",
    displayName: "List a known folder",
    description:
      "List the direct contents of a Windows known folder such as the Desktop, Documents or Downloads. Folders first, paginated, no file contents.",
    category: "filesystem",
    riskLevel: "read-only",
    aliases: ["what's on my desktop", "list desktop", "show downloads"],
    intentExamples: [
      "what is on my desktop",
      "list my documents",
      "show me my downloads folder",
    ],
    keywords: ["desktop", "documents", "downloads", "list", "show", "contents", "files"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          enum: [
            "desktop",
            "documents",
            "downloads",
            "pictures",
            "videos",
            "music",
            "home",
          ],
        },
        include_hidden: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        cursor: { type: ["string", "null"] },
      },
      required: ["folder"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.list_directory",
    displayName: "List a folder",
    description:
      "List the direct children of any folder by absolute path. Paginated (default 50), folders before files, never reads file contents.",
    category: "filesystem",
    riskLevel: "read-only",
    keywords: ["list", "folder", "directory", "contents", "inside"],
    intentExamples: ["what's inside C:\\Projects", "list that folder"],
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        include_hidden: { type: "boolean" },
        sort_by: { type: "string", enum: ["name", "type", "modified", "size"] },
        sort_direction: { type: "string", enum: ["ascending", "descending"] },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        cursor: { type: ["string", "null"] },
      },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.get_metadata",
    displayName: "File / folder info",
    description: "Size, type, modified time and attributes of one path.",
    category: "filesystem",
    riskLevel: "read-only",
    keywords: ["size", "info", "metadata", "modified", "when"],
    inputSchema: {
      type: "object",
      properties: { path: pathProp },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.get_directory_summary",
    displayName: "Folder summary",
    description: "Recursive file/folder count and total size of a folder.",
    category: "filesystem",
    riskLevel: "read-only",
    keywords: ["how big", "size", "folder", "summary", "count"],
    inputSchema: {
      type: "object",
      properties: { path: pathProp },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.get_disk_space",
    displayName: "Disk space",
    description: "Free and total disk space for the drive containing a path.",
    category: "filesystem",
    riskLevel: "read-only",
    aliases: ["disk space", "free space", "storage"],
    intentExamples: ["how much disk space do I have"],
    keywords: ["disk", "space", "free", "storage", "drive"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: { path: pathProp },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.find",
    displayName: "Find files & folders",
    description:
      "Search user folders (or given roots) for files/folders by name. Bounded, case-insensitive, exact-then-fuzzy ranking, max 50 results. Never reads file bodies.",
    category: "filesystem",
    riskLevel: "read-only",
    aliases: ["find", "search files", "locate", "where is"],
    intentExamples: [
      "find my Client Videos folder",
      "where is resume.pdf",
      "find every folder named ArcSonare in Documents",
    ],
    keywords: ["find", "search", "locate", "where", "file", "folder"],
    supportsDeterministicRouting: true,
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        roots: { type: "array", items: pathProp },
        item_type: { type: "string", enum: ["any", "file", "directory"] },
        extension: { type: ["string", "null"] },
        recursive: { type: "boolean" },
        max_depth: { type: "integer", minimum: 1, maximum: 12 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.create_directory",
    displayName: "Create folder",
    description:
      "Create a folder inside an existing parent. Name is validated; existence is verified after creation.",
    category: "filesystem",
    riskLevel: "reversible",
    aliases: ["create folder", "make folder", "new folder", "mkdir"],
    intentExamples: [
      "create a folder called Client Videos on my desktop",
      "make a folder named Reports inside Documents",
    ],
    keywords: ["create", "make", "new", "folder", "directory"],
    supportsDeterministicRouting: false,
    inputSchema: {
      type: "object",
      properties: {
        parent_path: pathProp,
        name: { type: "string", minLength: 1, maxLength: 200 },
        recursive: { type: "boolean" },
        if_exists: {
          type: "string",
          enum: ["return-existing", "ask", "create-numbered-copy"],
        },
      },
      required: ["parent_path", "name"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.create_file",
    displayName: "Create file",
    description:
      "Create a plain-text file (.txt/.md/.json/.csv). Asks before overwrite; verifies bytes written.",
    category: "filesystem",
    riskLevel: "reversible",
    confirmation: "when-ambiguous",
    aliases: ["create file", "new file"],
    intentExamples: ["create a notes.txt on my desktop"],
    keywords: ["create", "file", "text", "notes", "write", "new"],
    inputSchema: {
      type: "object",
      properties: {
        parent_path: pathProp,
        name: { type: "string", minLength: 1, maxLength: 200 },
        content: { type: "string" },
        if_exists: {
          type: "string",
          enum: ["overwrite", "append", "numbered-copy", "fail"],
        },
      },
      required: ["parent_path", "name"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.write_text_file",
    displayName: "Write text file",
    description:
      "Write or append text to a plain-text file. Asks before overwrite; verifies bytes written.",
    category: "filesystem",
    riskLevel: "sensitive",
    confirmation: "when-ambiguous",
    keywords: ["write", "save", "append", "text", "file"],
    inputSchema: {
      type: "object",
      properties: {
        parent_path: pathProp,
        name: { type: "string", minLength: 1, maxLength: 200 },
        content: { type: "string" },
        if_exists: {
          type: "string",
          enum: ["overwrite", "append", "numbered-copy", "fail"],
        },
      },
      required: ["parent_path", "name"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.read_text_file",
    displayName: "Read text file",
    description: "Read a UTF-8 text file (up to 512 KB).",
    category: "filesystem",
    riskLevel: "sensitive",
    keywords: ["read", "open", "contents", "text", "file"],
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        max_bytes: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.rename",
    displayName: "Rename",
    description: "Rename a file or folder in place. Verifies old gone / new present.",
    category: "filesystem",
    riskLevel: "sensitive",
    aliases: ["rename"],
    intentExamples: ["rename Client Videos to Client Delivery"],
    keywords: ["rename", "change name"],
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        new_name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["path", "new_name"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.move",
    displayName: "Move",
    description: "Move a file or folder into another folder. Verifies both sides.",
    category: "filesystem",
    riskLevel: "sensitive",
    keywords: ["move", "relocate", "put"],
    inputSchema: {
      type: "object",
      properties: {
        source_path: pathProp,
        destination_folder: pathProp,
        new_name: { type: ["string", "null"] },
      },
      required: ["source_path", "destination_folder"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.copy",
    displayName: "Copy",
    description: "Copy a file or folder into another folder. Size-verified for files.",
    category: "filesystem",
    riskLevel: "reversible",
    keywords: ["copy", "duplicate"],
    inputSchema: {
      type: "object",
      properties: {
        source_path: pathProp,
        destination_folder: pathProp,
        new_name: { type: ["string", "null"] },
      },
      required: ["source_path", "destination_folder"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.delete",
    displayName: "Delete",
    description:
      "Delete files/folders. Defaults to the Recycle Bin and ALWAYS requires user confirmation. Permanent deletion is a separate explicit mode.",
    category: "filesystem",
    riskLevel: "destructive",
    confirmation: "always",
    aliases: ["delete", "remove", "trash"],
    intentExamples: ["delete the Client Videos folder"],
    keywords: ["delete", "remove", "trash", "recycle"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: pathProp, minItems: 1, maxItems: 50 },
        mode: { type: "string", enum: ["recycle-bin", "permanent"] },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.reveal_in_explorer",
    displayName: "Show in Explorer",
    description: "Reveal a file or folder in Windows File Explorer.",
    category: "filesystem",
    riskLevel: "reversible",
    keywords: ["explorer", "show", "reveal", "open folder"],
    inputSchema: {
      type: "object",
      properties: { path: pathProp },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.open_item",
    displayName: "Open file",
    description:
      "Open a document/image/etc. with its default app. Executables are blocked here.",
    category: "filesystem",
    riskLevel: "reversible",
    keywords: ["open", "file", "document"],
    inputSchema: {
      type: "object",
      properties: { path: pathProp },
      required: ["path"],
      additionalProperties: false,
    },
  }),

  // ------------------------------------------------------- applications
  def({
    id: "applications.resolve",
    displayName: "Resolve application",
    description:
      "Resolve an app name to an installed application, protocol target or known web service on THIS computer (checks the real index).",
    category: "applications",
    riskLevel: "read-only",
    keywords: ["app", "application", "installed", "resolve", "which"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        intent: { type: "string", enum: ["open", "focus", "close", "inspect"] },
        preference: {
          type: "string",
          enum: ["native-first", "web-first", "user-default"],
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.open",
    displayName: "Open application",
    description:
      "Open an application or service: installed app first (verified by process/window), official web version as fallback. Focuses an already-running instance instead of duplicating.",
    category: "applications",
    riskLevel: "reversible",
    aliases: ["open", "launch", "start", "run"],
    intentExamples: ["open spotify", "launch netflix", "start vs code"],
    keywords: ["open", "launch", "start", "run", "app"],
    supportsDeterministicRouting: true,
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        target_id: { type: ["string", "null"] },
        preference: {
          type: "string",
          enum: ["native-first", "web-first", "user-default"],
        },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.list",
    displayName: "List installed apps",
    description: "List indexed installed applications, optionally filtered.",
    category: "applications",
    riskLevel: "read-only",
    aliases: ["installed apps", "my apps"],
    intentExamples: ["what apps do I have installed"],
    keywords: ["installed", "applications", "apps", "list", "programs"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.refresh_index",
    displayName: "Refresh app index",
    description: "Rebuild the installed-application index (Start Menu, App Paths, protocols).",
    category: "applications",
    riskLevel: "read-only",
    aliases: ["refresh apps"],
    keywords: ["refresh", "rescan", "index", "apps"],
    timeoutMs: 30_000,
  }),
  def({
    id: "applications.focus",
    displayName: "Focus application",
    description: "Bring a running application's window to the foreground.",
    category: "applications",
    riskLevel: "reversible",
    aliases: ["switch to", "focus", "bring up"],
    intentExamples: ["switch to chrome", "focus spotify"],
    keywords: ["focus", "switch", "foreground", "bring"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.close",
    displayName: "Close application",
    description:
      "Politely ask an application to close (never force-kills). Verified by the window disappearing; unsaved-work prompts are respected.",
    category: "applications",
    riskLevel: "sensitive",
    confirmation: "before-execution",
    aliases: ["close", "quit", "exit"],
    intentExamples: ["close spotify", "quit chrome"],
    keywords: ["close", "quit", "exit", "stop"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
  }),

  // ------------------------------------------------------------ windows
  def({
    id: "windows.list",
    displayName: "List windows",
    description: "List open windows with opaque ids, titles and bounds.",
    category: "windows",
    riskLevel: "read-only",
    keywords: ["windows", "open", "list"],
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
      additionalProperties: false,
    },
  }),
  def({
    id: "windows.focus",
    displayName: "Focus window",
    description: "Focus a window by its opaque id (from windows.list).",
    category: "windows",
    riskLevel: "reversible",
    keywords: ["focus", "window"],
    inputSchema: {
      type: "object",
      properties: { window_id: { type: "string" } },
      required: ["window_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "windows.minimize",
    displayName: "Minimize window",
    description: "Minimize a window by id.",
    category: "windows",
    riskLevel: "reversible",
    keywords: ["minimize", "window"],
    inputSchema: {
      type: "object",
      properties: { window_id: { type: "string" } },
      required: ["window_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "windows.maximize",
    displayName: "Maximize window",
    description: "Maximize a window by id.",
    category: "windows",
    riskLevel: "reversible",
    keywords: ["maximize", "window"],
    inputSchema: {
      type: "object",
      properties: { window_id: { type: "string" } },
      required: ["window_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "windows.restore",
    displayName: "Restore window",
    description: "Restore a minimized/maximized window by id.",
    category: "windows",
    riskLevel: "reversible",
    keywords: ["restore", "window"],
    inputSchema: {
      type: "object",
      properties: { window_id: { type: "string" } },
      required: ["window_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "windows.move_resize",
    displayName: "Move / resize window",
    description: "Move and/or resize a window by id.",
    category: "windows",
    riskLevel: "reversible",
    keywords: ["move", "resize", "window", "position"],
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "string" },
        x: { type: "integer" },
        y: { type: "integer" },
        width: { type: "integer", minimum: 100, maximum: 20000 },
        height: { type: "integer", minimum: 100, maximum: 20000 },
      },
      required: ["window_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "windows.close",
    displayName: "Close window",
    description: "Politely close a window by id (no force-kill).",
    category: "windows",
    riskLevel: "sensitive",
    confirmation: "before-execution",
    keywords: ["close", "window"],
    inputSchema: {
      type: "object",
      properties: { window_id: { type: "string" } },
      required: ["window_id"],
      additionalProperties: false,
    },
  }),

  // ------------------------------------------------------------- screen
  def({
    id: "screen.capture",
    displayName: "Take screenshot",
    description:
      "Capture the active display, a specific display, a window, one application's window, or a region. The image is validated and shown in ArcSonare.",
    category: "screen",
    riskLevel: "read-only",
    confirmation: "when-ambiguous",
    aliases: ["screenshot", "capture", "screen shot", "snap"],
    intentExamples: [
      "take a screenshot",
      "screenshot chrome",
      "take a screenshot of visual studio code and show me",
    ],
    keywords: ["screenshot", "capture", "screen", "grab", "snap"],
    supportsDeterministicRouting: true,
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["active-display", "display", "window", "application", "region"],
        },
        display_id: { type: ["string", "null"] },
        window_id: { type: ["string", "null"] },
        application_query: { type: ["string", "null"] },
        region: {
          type: ["object", "null"],
          properties: {
            x: { type: "integer" },
            y: { type: "integer" },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false,
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.list_capture_targets",
    displayName: "List capture targets",
    description: "List displays and visible windows available for capture.",
    category: "screen",
    riskLevel: "read-only",
    keywords: ["capture", "targets", "windows", "displays"],
  }),

  // ---------------------------------------------------------- clipboard
  def({
    id: "clipboard.read_text",
    displayName: "Read clipboard",
    description:
      "Read the current clipboard text (size-capped). Only runs when the user explicitly asks.",
    category: "clipboard",
    riskLevel: "read-only",
    aliases: ["clipboard", "what did I copy"],
    intentExamples: ["what's on my clipboard", "read my clipboard"],
    keywords: ["clipboard", "copied", "paste", "copy"],
    supportsDeterministicRouting: true,
  }),
  def({
    id: "clipboard.write_text",
    displayName: "Copy to clipboard",
    description: "Put text on the clipboard, verified by readback.",
    category: "clipboard",
    riskLevel: "reversible",
    aliases: ["copy to clipboard"],
    intentExamples: ["copy that to my clipboard"],
    keywords: ["clipboard", "copy", "put"],
    inputSchema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
      additionalProperties: false,
    },
  }),

  // ---------------------------------------------------------------- web
  def({
    id: "web.open_url",
    displayName: "Open URL",
    description: "Open a validated http(s) URL in the default browser.",
    category: "web",
    riskLevel: "reversible",
    keywords: ["url", "website", "browser", "link", "go to"],
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", minLength: 10, maxLength: 2048 } },
      required: ["url"],
      additionalProperties: false,
    },
  }),
  def({
    id: "web.search",
    displayName: "Web search",
    description:
      "Open a web search (or a YouTube/GitHub-scoped search) in the default browser. Does not read results.",
    category: "web",
    riskLevel: "reversible",
    aliases: ["search", "google", "look up"],
    intentExamples: ["search the web for tauri screenshot api", "search youtube for arcsonare"],
    keywords: ["search", "google", "web", "look", "youtube"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        site: { type: ["string", "null"], enum: ["youtube", "google", "bing", "github", null] },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }),

  // ---------------------------------------------------------- arcsonare
  def({
    id: "arcsonare.navigate",
    displayName: "Navigate ArcSonare",
    description:
      "Navigate the ArcSonare window to dashboard, tasks, agent, connect or settings. Deterministic — no model involved.",
    category: "arcsonare",
    riskLevel: "reversible",
    aliases: ["go to", "open page", "navigate"],
    intentExamples: ["go to tasks", "open settings", "show the dashboard"],
    keywords: ["go", "navigate", "page", "tasks", "dashboard", "settings", "agent", "connect"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          enum: ["dashboard", "tasks", "agent", "connect", "settings"],
        },
        task_filter: { type: ["string", "null"] },
      },
      required: ["page"],
      additionalProperties: false,
    },
  }),
  def({
    id: "arcsonare.show_notification",
    displayName: "Show notification",
    description: "Show a local ArcSonare notification.",
    category: "arcsonare",
    riskLevel: "reversible",
    keywords: ["notify", "notification", "remind"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 100 },
        body: { type: "string", maxLength: 500 },
      },
      required: ["title"],
      additionalProperties: false,
    },
  }),

  // -------------------------------------------------------------- tasks
  def({
    id: "tasks.list",
    displayName: "List tasks",
    description: "List ArcSonare tasks, optionally filtered (open, urgent, today, completed).",
    category: "tasks",
    riskLevel: "read-only",
    aliases: ["my tasks", "show tasks", "urgent tasks"],
    intentExamples: ["show my urgent tasks", "what tasks do I have today"],
    keywords: ["tasks", "todo", "list", "urgent", "today"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "open", "today", "upcoming", "urgent", "completed"],
        },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.create",
    displayName: "Create task",
    description:
      "Create a task in ArcSonare's real task store. Persistence is verified before success.",
    category: "tasks",
    riskLevel: "reversible",
    aliases: ["create task", "add task", "new task", "remind me"],
    intentExamples: [
      "create a task to call Tamiru tomorrow at 3 pm",
      "add a task to upload the files",
    ],
    keywords: ["task", "create", "add", "todo", "remind"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 300 },
        description: { type: ["string", "null"] },
        due_at: { type: ["string", "null"], description: "ISO date/time when known" },
        priority: { type: "string", enum: ["high", "medium", "low", "none"] },
        agent_id: { type: ["string", "null"] },
        subtasks: { type: "array", items: { type: "string" }, maxItems: 20 },
      },
      required: ["title"],
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.complete",
    displayName: "Complete task",
    description: "Mark a task complete by id or fuzzy title match.",
    category: "tasks",
    riskLevel: "reversible",
    aliases: ["complete task", "mark done", "finish task"],
    intentExamples: ["mark the client email task done"],
    keywords: ["complete", "done", "finish", "task", "mark"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: ["string", "null"] },
        title_query: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.reopen",
    displayName: "Reopen task",
    description: "Reopen a completed task by id or fuzzy title match.",
    category: "tasks",
    riskLevel: "reversible",
    keywords: ["reopen", "task", "undo"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: ["string", "null"] },
        title_query: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.update",
    displayName: "Update task",
    description: "Update a task's title, priority or due date.",
    category: "tasks",
    riskLevel: "sensitive",
    keywords: ["update", "task", "priority", "rename", "due"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: ["string", "null"] },
        title_query: { type: ["string", "null"] },
        new_title: { type: ["string", "null"] },
        priority: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
        due_at: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.add_subtask",
    displayName: "Add subtask",
    description: "Add a subtask to an existing task.",
    category: "tasks",
    riskLevel: "reversible",
    keywords: ["subtask", "task", "add", "step"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: ["string", "null"] },
        title_query: { type: ["string", "null"] },
        subtask_title: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["subtask_title"],
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.assign_agent",
    displayName: "Assign agent",
    description: "Assign an ArcSonare agent to a task.",
    category: "tasks",
    riskLevel: "reversible",
    keywords: ["assign", "agent", "task"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: ["string", "null"] },
        title_query: { type: ["string", "null"] },
        agent: { type: "string", minLength: 1 },
      },
      required: ["agent"],
      additionalProperties: false,
    },
  }),
  def({
    id: "tasks.delete",
    displayName: "Delete task",
    description: "Delete a task. Always requires confirmation; verified against the store.",
    category: "tasks",
    riskLevel: "destructive",
    confirmation: "always",
    keywords: ["delete", "remove", "task"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: ["string", "null"] },
        title_query: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  }),

  // ---------------------------------------------------------- location
  def({
    id: "location.get_weather",
    displayName: "Local weather",
    description:
      "Get current weather for the user's device location. Use when they ask about weather, temperature, or conditions outside without naming another city.",
    category: "location",
    riskLevel: "read-only",
    aliases: ["weather", "temperature", "forecast"],
    intentExamples: [
      "what's the weather",
      "how's the weather outside",
      "what's the temperature",
    ],
    keywords: ["weather", "temperature", "forecast", "outside", "rain", "humid"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    timeoutMs: 20_000,
    requiredPermissions: ["location"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  }),
  def({
    id: "location.get_nearby",
    displayName: "Nearby places",
    description:
      "Find places near the user's current location (cafes, restaurants, pharmacies, etc.).",
    category: "location",
    riskLevel: "read-only",
    aliases: ["nearby", "near me", "around me"],
    intentExamples: [
      "what's near me",
      "nearby restaurants",
      "cafes near me",
    ],
    keywords: ["nearby", "near", "around", "places", "restaurant", "cafe"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    timeoutMs: 20_000,
    requiredPermissions: ["location"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: ["string", "null"], maxLength: 80 },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "location.get_travel_time",
    displayName: "Travel time",
    description:
      "Estimate driving time and distance from the user's current location to a named destination.",
    category: "location",
    riskLevel: "read-only",
    aliases: ["how long", "travel time", "how far", "eta"],
    intentExamples: [
      "how long to get to the airport",
      "how far is Target",
      "travel time to downtown",
    ],
    keywords: ["how long", "how far", "travel", "drive", "eta", "minutes"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    timeoutMs: 25_000,
    requiredPermissions: ["location"],
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["destination"],
      additionalProperties: false,
    },
  }),
];

const byId = new Map(CAPABILITY_REGISTRY.map((c) => [c.id, c]));

export function getCapability(id: string): CapabilityDefinition | undefined {
  return byId.get(id);
}

export function availableCapabilities(): CapabilityDefinition[] {
  return CAPABILITY_REGISTRY.filter((c) => c.availability === "available");
}
