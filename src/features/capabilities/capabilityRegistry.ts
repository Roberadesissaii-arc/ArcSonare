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
      "Search this computer's own folders (or given roots) for local files and folders by name. Bounded, case-insensitive, exact-then-fuzzy ranking, max 50 results. Never reads file bodies. LOCAL DISK ONLY — “find X on YouTube / on the web / online” is never this tool.",
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
      "Create a NEW text or SOURCE CODE file. Supported: .py .js .ts .jsx .tsx .rs .go .java .c .h .cpp .cs .rb .php .sh .sql .html .css .scss and .txt .md .json .csv .log .yaml .yml .toml .ini .xml. Use this to write real programs — e.g. a Python script that finds prime numbers. Put the full file contents in `content`. ONLY for files that do not exist yet: if the user is asking you to change, fix or update a file that already exists, use filesystem.modify_file instead. Verifies bytes written.",
    category: "filesystem",
    riskLevel: "reversible",
    confirmation: "when-ambiguous",
    aliases: ["create file", "new file", "write a script", "create a program"],
    intentExamples: [
      "create a notes.txt on my desktop",
      "create a python file on my desktop that finds prime numbers",
      "write a script that renames my photos",
      "make an index.html in my documents",
    ],
    keywords: [
      "create", "file", "text", "notes", "write", "new",
      "python", "script", "program", "code", "py", "js", "html",
    ],
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
    id: "desktop.find_item",
    displayName: "Find a Desktop icon",
    description:
      "Find a file or folder icon ON THE WINDOWS DESKTOP and get its exact on-screen rectangle, straight from the shell — no screenshot and no guessing. ALWAYS use this before screen.highlight_target when the user names something on their Desktop (\"show me the books folder\", \"where is my Trip folder\", \"point to that file on my desktop\"). It returns the precise icon bounds; a vision model looking at a screenshot regularly picks the wrong icon or boxes several at once.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["find desktop icon", "locate desktop item", "where is on desktop"],
    intentExamples: [
      "show me the books folder on my desktop",
      "where is the Trip folder",
      "point to the notes file on my desktop",
    ],
    keywords: ["desktop", "icon", "folder", "file", "where", "show", "locate", "point"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        kind: { type: ["string", "null"], enum: ["folder", "file", "any", null] },
      },
      required: ["name"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.read_for_edit",
    displayName: "Read a file before editing it",
    description:
      "Read a file AND get the content hash you must pass back when you edit it. Always call this before filesystem.modify_file: you need the exact current text to write a patch against, and the hash proves the file did not change underneath you.",
    category: "filesystem",
    riskLevel: "read-only",
    aliases: ["read before edit", "open for editing"],
    intentExamples: ["read prime.py so I can fix it", "show me the current code"],
    keywords: ["read", "edit", "fix", "before", "hash", "code"],
    inputSchema: {
      type: "object",
      properties: { path: pathProp },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.modify_file",
    displayName: "Modify an existing file",
    description:
      "CHANGE A FILE THAT ALREADY EXISTS — the correct tool for \"fix the bug\", \"update the function\", \"change that value\", \"add error handling\". The file existing is expected, so this NEVER asks permission to overwrite. Call filesystem.read_for_edit first, then send the smallest patch that does the job: patch={kind:\"replace-text\", oldText, newText} swaps an exact snippet and leaves the rest of the file untouched. Use kind:\"append\" to add to the end, and kind:\"full-content\" ONLY when the user asked to rewrite the whole file. Pass based_on_hash from read_for_edit. Writes atomically and checks the result still parses. Do NOT use filesystem.create_file to change a file that already exists.",
    category: "filesystem",
    riskLevel: "reversible",
    confirmation: "never",
    aliases: ["modify file", "edit file", "update file", "fix the code", "patch file"],
    intentExamples: [
      "fix the bug in prime_finder.py",
      "update the script on my desktop",
      "change the API url in config.json",
      "add error handling to that file",
      "correct the syntax error in the file you just created",
    ],
    keywords: [
      "modify", "edit", "update", "fix", "change", "patch", "correct",
      "bug", "code", "existing", "add", "function",
    ],
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        patch: {
          type: "object",
          description:
            "One of: {kind:\"replace-text\", oldText, newText, expectedOccurrences?} | {kind:\"append\", text} | {kind:\"full-content\", content}",
          properties: {
            kind: {
              type: "string",
              enum: ["replace-text", "append", "full-content"],
            },
            oldText: { type: "string" },
            newText: { type: "string" },
            expectedOccurrences: { type: ["integer", "null"] },
            text: { type: "string" },
            content: { type: "string" },
          },
          required: ["kind"],
        },
        based_on_hash: { type: ["string", "null"] },
      },
      required: ["path", "patch"],
      additionalProperties: false,
    },
  }),
  def({
    id: "filesystem.write_text_file",
    displayName: "Replace a file's whole contents",
    description:
      "Replace EVERYTHING in a file, or append to it. Only for \"rewrite this file from scratch\" / \"overwrite it with this version\". To fix a bug or change part of a file, use filesystem.modify_file instead — this one discards anything you did not include.",
    category: "filesystem",
    riskLevel: "sensitive",
    confirmation: "when-ambiguous",
    aliases: ["rewrite file", "overwrite file", "replace contents"],
    intentExamples: [
      "rewrite prime.py completely",
      "overwrite that file with this version",
      "replace the whole contents of notes.txt",
    ],
    keywords: [
      "write", "save", "append", "text", "file",
      "rewrite", "overwrite", "replace", "whole", "entire",
    ],
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
    id: "system.set_volume",
    displayName: "Volume",
    description:
      "Turn the computer's volume up or down, or mute/unmute it. Each step is 2%, so steps:5 is about 10%.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["volume", "louder", "quieter", "mute"],
    intentExamples: [
      "turn the volume up",
      "make it quieter",
      "mute the sound",
      "turn it down a bit",
    ],
    keywords: ["volume", "sound", "loud", "quiet", "mute", "audio"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "mute", "unmute"] },
        steps: { type: ["integer", "null"], description: "2% steps. Default 5." },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  }),
  def({
    id: "system.set_brightness",
    displayName: "Screen brightness",
    description:
      "Set the screen brightness to a percentage, or move it up/down. Laptop screens only — most desktop monitors cannot be controlled this way and will report that honestly.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["brightness", "dim", "brighter"],
    intentExamples: [
      "make the screen brighter",
      "dim the screen",
      "set brightness to 40%",
    ],
    keywords: ["brightness", "screen", "dim", "bright", "display"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        level: { type: ["integer", "null"], description: "0-100." },
        direction: { type: ["string", "null"], enum: ["up", "down", null] },
      },
      required: [],
      additionalProperties: false,
    },
  }),
  def({
    id: "system.open_settings",
    displayName: "Open Windows settings",
    description:
      "Open a Windows Settings page directly by name — Wi-Fi, Bluetooth, display, sound, notifications, apps, Windows Update, battery, storage, privacy. This opens the real Settings page; it never clicks the taskbar or hunts for an icon.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["settings", "windows settings", "control panel"],
    intentExamples: [
      "open wifi settings",
      "open bluetooth settings",
      "show me display settings",
      "open windows update",
    ],
    keywords: [
      "settings",
      "wifi",
      "wi-fi",
      "bluetooth",
      "display",
      "sound",
      "notifications",
      "update",
      "battery",
      "privacy",
    ],
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          description:
            "The settings page in plain words, e.g. \"wi-fi\", \"bluetooth\", \"display\", \"windows update\".",
          minLength: 2,
          maxLength: 60,
        },
      },
      required: ["page"],
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.record",
    displayName: "Screen recording",
    description:
      "Start or stop recording the screen. Uses the recorder built into Windows; clips land in Videos\Captures. Requires Xbox Game Bar to be enabled.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["record", "screen record", "capture video"],
    intentExamples: ["start recording my screen", "stop the recording"],
    keywords: ["record", "recording", "video", "capture", "screen"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["start", "stop"] } },
      required: ["action"],
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.open_with",
    displayName: "Open with",
    description:
      "Open a specific file or folder WITH a specific application, the way right-click → 'Open with' does. Use this whenever the request names both a thing and an app: \"open script.py with VS Code\", \"open this folder in the terminal\", \"open that image in Photoshop\". Do NOT use applications.open for these — that launches the app on its own and ignores the file, which is the wrong result. For a terminal, pass application:\"terminal\"; a file opens a terminal in its containing folder.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["open with", "open in", "edit with", "launch with"],
    intentExamples: [
      "open my python file with vs code",
      "open this folder in the terminal",
      "open the report with word",
      "go to that folder and open it in terminal",
      "open notes.txt in notepad",
    ],
    keywords: ["open with", "open in", "edit in", "terminal", "vs code", "editor"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path of the file or folder to open.",
        },
        application: {
          type: "string",
          description:
            'What to open it with, e.g. "vs code", "terminal", "notepad", "photoshop".',
        },
      },
      required: ["path", "application"],
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.list",
    displayName: "List apps",
    description:
      "List applications with a `running` flag on each. Set running_only to answer 'what do I have open right now?'. Use this BEFORE opening or closing something, to check whether it is already running.",
    category: "applications",
    riskLevel: "read-only",
    aliases: ["installed apps", "my apps", "what's open", "running apps"],
    intentExamples: [
      "what apps do I have installed",
      "what do I have open right now",
      "which applications are running",
      "is spotify open",
    ],
    keywords: [
      "installed", "applications", "apps", "list", "programs",
      "running", "open", "active",
    ],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        running_only: {
          type: ["boolean", "null"],
          description: "true → only applications running right now.",
        },
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
          enum: [
            "active-display",
            "display",
            "window",
            "application",
            "region",
            "portion",
          ],
        },
        display_id: {
          type: ["string", "null"],
          description:
            "1-based monitor ordinal as a person would say it — \"2\" for \"my second monitor\". Ordered left-to-right physically.",
        },
        portion: {
          type: ["string", "null"],
          enum: [
            "left-half", "right-half", "top-half", "bottom-half",
            "left-third", "center-third", "right-third", null,
          ],
          description:
            "With target=portion, captures part of a display. Useful on an ultrawide, where a full capture is mostly empty desktop.",
        },
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
  def({
    id: "screen.understand",
    displayName: "Understand screen",
    description:
      "Capture the active display (or use a prior capture) and describe it with Gemini vision. Use for “what’s on my screen”, “what do you see”, visual Q&A.",
    category: "screen",
    riskLevel: "read-only",
    aliases: ["vision", "describe screen", "see screen", "look at screen"],
    intentExamples: [
      "what's on my screen",
      "what do you see on my screen",
      "describe this screenshot",
      "look at my screen and tell me what app is open",
    ],
    keywords: ["screen", "see", "vision", "describe", "looking", "visible"],
    supportsDeterministicRouting: true,
    timeoutMs: 60_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: ["string", "null"],
          description: "Optional visual question; default is a concise description.",
        },
        capture_id: {
          type: ["string", "null"],
          description: "Reuse an existing capture instead of taking a new screenshot.",
        },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.click_target",
    displayName: "Click on screen (vision)",
    description:
      "Find a UI control on screen by description, move a purple pointer to it, and optionally click. Use for “click the play button”, “press it”, “point to the video”, “show me where Save is”. Prefer the last opened/watched app’s window. Set click=false to only point without clicking.",
    category: "screen",
    riskLevel: "reversible",
    aliases: [
      "vision click",
      "click button",
      "click the",
      "press it",
      "click play",
      "point to",
      "point at",
    ],
    intentExamples: [
      "click the play button",
      "press it",
      "click play",
      "point to the video",
      "point at the play button",
      "click save",
      "click the blue Submit button",
    ],
    keywords: ["click", "press", "tap", "button", "play", "point", "show"],
    supportsDeterministicRouting: true,
    timeoutMs: 60_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "Human description of the control, e.g. play button, video player, Save.",
        },
        capture_id: { type: ["string", "null"] },
        application: {
          type: ["string", "null"],
          description: "Optional app window to capture first (e.g. Spotify).",
        },
        click: {
          type: ["boolean", "null"],
          description:
            "If false, only move the purple pointer (point). Default true (click).",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
  }),
  def({
    id: "input.click_at",
    displayName: "Click at coordinates",
    description:
      "Move the mouse and click at final physical virtual-desktop pixels — the same space Windows reports, where the primary monitor's top-left is 0,0 and a monitor to its left has negative x. Not screenshot pixels, not display-local pixels, not normalised model coordinates: those must be resolved through screen.click_target instead. The display containing the point must have a verified display profile.",
    category: "system",
    riskLevel: "reversible",
    keywords: ["click", "mouse"],
    supportsDeterministicRouting: false,
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        button: { type: ["string", "null"], enum: ["left", "right", "double", null] },
        // Required, and single-valued, so a caller has to state which space it
        // is in rather than have one assumed for it. "x and y" have meant five
        // different things in this codebase and every confusion between them
        // produced a click nobody asked for.
        coordinate_space: { type: "string", enum: ["physical-virtual-desktop"] },
      },
      required: ["x", "y", "coordinate_space"],
      additionalProperties: false,
    },
  }),
  def({
    id: "input.type_text",
    displayName: "Type text",
    description:
      "Type text into whatever currently has keyboard focus \u2014 a document, a search box, a form field, a chat message. Click the field first (screen.click_target) so focus is where you expect. Use this to write into Google Docs, fill forms, or compose messages.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["type", "write", "enter text", "fill in"],
    intentExamples: [
      "type hello world",
      "write a paragraph about wolves in this document",
      "fill in my email address",
      "put that in the search box",
    ],
    keywords: ["type", "write", "text", "fill", "form", "compose"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to type." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  }),
  def({
    id: "input.press_keys",
    displayName: "Press keys",
    description:
      "Send a keyboard shortcut to the focused window. Use for copy (ctrl+c), paste (ctrl+v), cut (ctrl+x), select all (ctrl+a), save (ctrl+s), undo (ctrl+z), find (ctrl+f), new tab (ctrl+t), close tab (ctrl+w), switch field (tab), submit (enter), refresh (f5). Copying puts the selection on the clipboard, which clipboard.read_text can then read.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["shortcut", "hotkey", "copy", "paste", "select all"],
    intentExamples: [
      "copy that",
      "paste it here",
      "select all",
      "save the document",
      "press enter",
      "undo that",
    ],
    keywords: ["copy", "paste", "cut", "shortcut", "hotkey", "key", "press", "enter", "tab"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        keys: {
          type: "string",
          description:
            "A chord such as ctrl+c, ctrl+v, ctrl+shift+n, alt+tab, enter, tab, escape, f5, or a single letter.",
        },
        repeat: { type: ["integer", "null"], description: "Times to send it. Default 1." },
      },
      required: ["keys"],
      additionalProperties: false,
    },
  }),
  def({
    id: "input.scroll",
    displayName: "Scroll",
    description:
      "Scroll the window under the mouse. Use to reach content that is off-screen before reading or clicking it \u2014 for example scrolling a web page down to find a button.",
    category: "system",
    riskLevel: "reversible",
    aliases: ["scroll down", "scroll up", "page down"],
    intentExamples: [
      "scroll down",
      "scroll to the bottom",
      "scroll up a bit",
    ],
    keywords: ["scroll", "down", "up", "page"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: ["integer", "null"], description: "Wheel notches. Default 3." },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  }),
  // `input.mouse_monitor_bounds` was here. It reported the monitor under the
  // cursor so the vision path could use it as a coordinate origin — for a
  // screenshot that may have come from a different monitor entirely. Where a
  // screenshot came from is now recorded at capture time and read from the
  // frame registry, so there is nothing left for this to answer.

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
    description:
      "Open a validated http(s) URL or a website by domain in the default browser — “open youtube.com”, “go to github.com”, “take me to that site”. This navigates the user away, which is what they asked for. Never use it to answer whether a service is connected to ArcSonare (use connections.get_status).",
    category: "web",
    riskLevel: "reversible",
    aliases: ["go to", "take me to", "open the site"],
    intentExamples: [
      "open youtube com for me",
      "go to github com",
      "take me to the site",
      "open that website in my browser",
    ],
    keywords: ["url", "website", "site", "browser", "link", "com", "go", "take"],
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
      "Open a web search in the BROWSER for the user to look at. Use this WHENEVER the user asks to go to the browser — “search YouTube in my browser”, “open a browser and search…”, “take me to YouTube results”, “in a tab”. For a plain YouTube question with no browser wording, prefer youtube.search instead, which shows results inside the app. This does NOT read the results — it returns nothing to answer with. If the user asked a question, use web.answer_question instead. Never use this to find out whether a service is connected to ArcSonare — that is connections.get_status.",
    category: "web",
    riskLevel: "reversible",
    aliases: ["search the web", "google it", "google that", "look up", "search in my browser", "take me to"],
    intentExamples: [
      "search the web for tauri screenshot api",
      "search youtube in my browser for arcsonare",
      "open a browser and search youtube for mrbeast",
      "take me to youtube results for mrbeast",
      "open a browser search for rust tutorials",
      "google that for me",
    ],
    keywords: ["search", "web", "look", "browser", "online", "tab", "take"],
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
  def({
    id: "screen.highlight_target",
    displayName: "Draw a border",
    description:
      "Draw a visible purple border on the user's screen around something — a folder, a button, a window, a region. YOU CAN DO THIS: it draws directly on the screen, it is not a file edit. If the user drew around something with Ctrl+Shift+D, this borders exactly that area; otherwise give the target and it will be found on screen first. Use it whenever the user asks to show, mark, outline, circle or point out where something is.",
    category: "screen",
    riskLevel: "reversible",
    aliases: ["border", "outline", "highlight", "show me where", "mark it"],
    intentExamples: [
      "put a border around that folder",
      "show me where the settings button is",
      "outline what I just drew",
      "highlight that window",
      "mark where it is on screen",
    ],
    keywords: ["border", "outline", "highlight", "circle", "mark", "show", "where"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: ["string", "null"],
          description:
            "What to outline. Omit if the user drew a region — that area is used instead.",
        },
        seconds: { type: ["integer", "null"], description: "How long to hold it. Default 6." },
      },
      required: [],
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.annotate",
    displayName: "Draw a shape on screen",
    description:
      "Draw a border, circle, rectangle, arrow or label on the user's screen around something you can see — a person in a photo, their face, an object, a control. YOU CAN DO THIS: it draws a temporary overlay on top of the screen and never edits the underlying image or file. Returns an annotation id. Use `parent` when the thing is inside something already annotated, e.g. a face inside a person, so it is searched for only within that area. Several annotations can be on screen at once.",
    category: "screen",
    riskLevel: "reversible",
    aliases: ["draw a border", "circle", "draw around", "annotate", "mark"],
    intentExamples: [
      "draw a border around the person on the left",
      "circle their face",
      "put a rectangle around that button",
      "draw a circle on the dog",
      "mark the person in the middle",
    ],
    keywords: ["draw", "border", "circle", "rectangle", "annotate", "around", "person", "face"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "What to draw around, in the user's words: \"the person on the left\", \"their face\".",
        },
        shape: {
          type: ["string", "null"],
          enum: ["highlight", "rectangle", "circle", "arrow", "label", null],
          description: "Default rectangle. Use circle when the user says circle or ring.",
        },
        parent: {
          type: ["string", "null"],
          description:
            "An annotation id this sits inside. Pass the person's annotation id when circling their face, so the face is only looked for within that person.",
        },
        colour: {
          type: ["string", "null"],
          description: "A colour name or #rrggbb. Omit for the default purple.",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.update_annotation",
    displayName: "Change a drawn shape",
    description:
      "Change something already drawn on screen — usually its colour. Takes the annotation id returned when it was drawn. Use this for \"make the circle red\"; it never redraws or duplicates the shape, and never touches the other annotations.",
    category: "screen",
    riskLevel: "reversible",
    aliases: ["make it red", "change the colour", "recolour"],
    intentExamples: [
      "make the circle red",
      "change the border to green",
      "make that outline thicker",
    ],
    keywords: ["colour", "color", "red", "green", "blue", "change", "make"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        annotation_id: { type: "string", description: "The id returned by screen.annotate." },
        colour: { type: ["string", "null"], description: "A colour name or #rrggbb." },
        thickness: { type: ["number", "null"] },
      },
      required: ["annotation_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.remove_annotation",
    displayName: "Remove a drawn shape",
    description:
      "Remove one shape from the screen by its annotation id, leaving every other annotation in place. Use this for \"remove the circle but keep the border\". To remove everything, use screen.clear_annotations instead.",
    category: "screen",
    riskLevel: "reversible",
    aliases: ["remove the circle", "take that off", "undo the border"],
    intentExamples: [
      "remove the circle but keep the border",
      "take the circle off",
      "get rid of that outline",
    ],
    keywords: ["remove", "delete", "take off", "clear", "circle", "border"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        annotation_id: { type: "string", description: "The id returned by screen.annotate." },
      },
      required: ["annotation_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "screen.clear_annotations",
    displayName: "Clear everything drawn",
    description:
      "Remove every shape currently drawn on screen for this conversation. Use for \"clear everything\" or \"remove all of that\". Nothing on the user's actual screen or files is affected — only ArcSonare's own overlays.",
    category: "screen",
    riskLevel: "reversible",
    aliases: ["clear everything", "remove all", "clear the screen"],
    intentExamples: ["clear everything", "remove all the annotations", "take all that off"],
    keywords: ["clear", "everything", "all", "remove", "annotations"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  }),
  def({
    id: "web.answer_question",
    displayName: "Look it up",
    description:
      "Answer a question using live web results — news, prices, scores, weather elsewhere, who won, what happened, anything that changed recently or that you are not certain about. Returns the answer plus its sources. ALWAYS use this instead of answering from memory when the question is about current events or today; your training data is old and stating it as current is wrong. Do NOT use web.search for questions — that only opens a browser tab and tells the user nothing.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["look up", "search", "news", "what happened"],
    intentExamples: [
      "what's the news today",
      "what happened in the world this week",
      "who won the game last night",
      "how much is bitcoin right now",
      "what's the latest on that story",
    ],
    keywords: ["news", "today", "latest", "current", "look up", "search", "happening", "now"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question, in full. Include any context the user gave.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  }),
  def({
    id: "web.fetch_page",
    displayName: "Read web page",
    description:
      "Fetch a public http(s) URL and extract readable text so the assistant can explain what the page is about. Use when the user pastes a link and asks about it (Browser mode / web scrape).",
    category: "web",
    riskLevel: "read-only",
    aliases: ["read page", "scrape", "what is this link", "summarize url", "browse link"],
    intentExamples: [
      "what is this link about https://example.com",
      "summarize https://example.com/article",
      "read this page and tell me what it says",
    ],
    keywords: ["link", "url", "page", "website", "article", "scrape", "read"],
    supportsDeterministicRouting: true,
    timeoutMs: 25_000,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 10, maxLength: 2048 },
        max_chars: { type: ["integer", "null"], minimum: 500, maximum: 40_000 },
      },
      required: ["url"],
      additionalProperties: false,
    },
  }),
  def({
    id: "web.activate_listed_item",
    displayName: "Open listed video",
    description:
      "Open the Nth result on a YouTube search/list (e.g. “open the second video”). Requires an ordinal (first/second/3). When the user already has a video open under Watch and says “play the video” / pause / resume with no number, use screen.click_target on the play or pause button instead — never ask for a video index.",
    category: "web",
    riskLevel: "reversible",
    aliases: ["second video", "first video", "nth video", "third video"],
    intentExamples: [
      "open the second video",
      "play the first video",
      "open video 3",
      "click the second video",
    ],
    keywords: ["video", "youtube", "second", "first", "third", "nth", "result"],
    supportsDeterministicRouting: true,
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "integer", minimum: 1, maximum: 30 },
        site: { type: ["string", "null"], enum: ["youtube", null] },
        query: { type: ["string", "null"], maxLength: 500 },
      },
      required: ["index"],
      additionalProperties: false,
    },
  }),

  // ------------------------------------------- Google Workspace (Connect)
  def({
    id: "email.send_message",
    displayName: "Send email",
    description:
      "Send an email from the user's connected Gmail. This actually delivers it — use email.create_draft instead if they only want it written.",
    category: "web",
    riskLevel: "sensitive",
    intentExamples: ["send an email to sam saying I'll be late", "email my manager the report"],
    keywords: ["send", "email", "mail", "write"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: ["string", "null"] },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  }),
  def({
    id: "email.create_draft",
    displayName: "Draft email",
    description:
      "Write an email and save it to Gmail as a draft without sending it.",
    category: "web",
    riskLevel: "reversible",
    intentExamples: ["draft an email to hr about my leave", "write it as a draft"],
    keywords: ["draft", "compose", "write", "email"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: ["string", "null"] },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  }),
  def({
    id: "email.update_draft",
    displayName: "Edit draft",
    description:
      "Rewrite an existing Gmail draft. Get its draft_id from email.list_drafts first.",
    category: "web",
    riskLevel: "reversible",
    intentExamples: ["change that draft", "make the draft shorter"],
    keywords: ["edit", "draft", "change", "rewrite"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: ["string", "null"] },
      },
      required: ["draft_id", "to", "subject", "body"],
      additionalProperties: false,
    },
  }),
  def({
    id: "email.list_drafts",
    displayName: "List drafts",
    description:
      "List the drafts waiting in Gmail, with their draft_id.",
    category: "web",
    riskLevel: "read-only",
    intentExamples: ["what drafts do I have", "show my unsent emails"],
    keywords: ["drafts", "unsent", "list"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        max_results: { type: ["integer", "null"] },
      },
      required: [],
      additionalProperties: false,
    },
  }),
  def({
    id: "email.reply",
    displayName: "Reply to email",
    description:
      "Reply to a message in the same conversation. Set reply_all true to include everyone. Get message_id from email.list_messages.",
    category: "web",
    riskLevel: "sensitive",
    intentExamples: ["reply to that email", "reply all and say yes"],
    keywords: ["reply", "respond", "answer", "reply all"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string" },
        body: { type: "string" },
        reply_all: { type: ["boolean", "null"] },
      },
      required: ["message_id", "body"],
      additionalProperties: false,
    },
  }),
  def({
    id: "calendar.update_event",
    displayName: "Change event",
    description:
      "Change an existing calendar event's title, time or description. Get event_id from calendar.list_events.",
    category: "web",
    riskLevel: "reversible",
    intentExamples: ["move my 3pm to 4pm", "rename that meeting"],
    keywords: ["move", "reschedule", "change", "event"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        summary: { type: ["string", "null"] },
        start: { type: ["string", "null"] },
        end: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "calendar.delete_event",
    displayName: "Delete event",
    description:
      "Remove an event from the calendar. Get event_id from calendar.list_events.",
    category: "web",
    riskLevel: "sensitive",
    intentExamples: ["cancel my 2pm", "delete that meeting"],
    keywords: ["cancel", "delete", "remove", "event"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "docs.create",
    displayName: "Create Google Doc",
    description:
      "Create a formatted Google Doc. Write the content as Markdown — use # / ## for headings, - for bullets, 1. for numbered steps and **bold** for emphasis, and it becomes real Docs formatting with proper heading styles, lists and spacing. Use this for essays, stories, reports, forms and letters.",
    category: "web",
    riskLevel: "reversible",
    intentExamples: ["write me an essay about climate change in google docs", "create a doc with a form for new starters", "write a short story and put it in a document"],
    keywords: ["google doc", "document", "essay", "story", "write", "report", "form"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        markdown: { type: "string" },
      },
      required: ["title", "markdown"],
      additionalProperties: false,
    },
  }),
  def({
    id: "docs.append",
    displayName: "Add to Google Doc",
    description:
      "Append more formatted Markdown to the end of an existing Google Doc.",
    category: "web",
    riskLevel: "reversible",
    intentExamples: ["add another section to that doc", "continue the story"],
    keywords: ["append", "add", "continue", "document"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        markdown: { type: "string" },
      },
      required: ["document_id", "markdown"],
      additionalProperties: false,
    },
  }),
  def({
    id: "docs.list",
    displayName: "List Google Docs",
    description:
      "List the user's most recently edited Google Docs, with their document_id.",
    category: "web",
    riskLevel: "read-only",
    intentExamples: ["what documents do I have", "list my google docs"],
    keywords: ["documents", "docs", "list"],
    supportsDeterministicRouting: false,
    supportsVoice: true,
    inputSchema: {
      type: "object",
      properties: {
        max_results: { type: ["integer", "null"] },
      },
      required: [],
      additionalProperties: false,
    },
  }),
  def({
    id: "email.list_messages",
    displayName: "Read Gmail inbox",
    description:
      "Read recent Gmail messages from the user's connected Google account. Use for “read my email”, “what’s in my Gmail”, “latest emails”, “unread mail”. Does NOT open the Gmail website.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["gmail", "inbox", "my email", "latest email", "unread"],
    intentExamples: [
      "read my gmail",
      "what's in my inbox",
      "show my latest emails",
      "any unread mail",
    ],
    keywords: ["gmail", "email", "inbox", "mail", "unread", "message"],
    supportsDeterministicRouting: true,
    timeoutMs: 35_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        max_results: { type: ["integer", "null"], minimum: 1, maximum: 20 },
        query: {
          type: ["string", "null"],
          description: "Gmail search query, e.g. is:unread or from:alice",
          maxLength: 300,
        },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "email.read_message",
    displayName: "Read one email",
    description:
      "Read the full body of one Gmail message by id (from email.list_messages). Use after listing when the user wants details on a specific mail.",
    category: "web",
    riskLevel: "read-only",
    keywords: ["email", "message", "read", "open mail"],
    timeoutMs: 35_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["message_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "email.get_connection_status",
    displayName: "Gmail connected?",
    description:
      "Check whether Gmail/Google email is connected in ArcSonare Connect. Use for “is my Gmail connected?”.",
    category: "web",
    riskLevel: "read-only",
    keywords: ["gmail", "connected", "email"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  }),
  def({
    id: "calendar.list_events",
    displayName: "Read calendar",
    description:
      "List upcoming Google Calendar events from the connected account. Use for “what’s on my calendar”, “meetings today”, “schedule this week”.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["calendar", "meetings", "schedule", "events"],
    intentExamples: [
      "what's on my calendar today",
      "do I have any meetings",
      "show my schedule",
    ],
    keywords: ["calendar", "meeting", "event", "schedule", "appointment"],
    supportsDeterministicRouting: true,
    timeoutMs: 35_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        max_results: { type: ["integer", "null"], minimum: 1, maximum: 20 },
        time_min: {
          type: ["string", "null"],
          description: "RFC3339 start (optional)",
        },
        time_max: {
          type: ["string", "null"],
          description: "RFC3339 end (optional)",
        },
        range_label: {
          type: ["string", "null"],
          description: "Human range label for empty copy, e.g. today",
        },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "calendar.create_event",
    displayName: "Create calendar event",
    description:
      "Create an event on the connected Google Calendar. Use for schedule/add/book a meeting. Requires summary, start, and end (RFC3339 or ISO).",
    category: "web",
    riskLevel: "reversible",
    aliases: ["schedule", "book meeting", "add event"],
    intentExamples: [
      "schedule a meeting tomorrow at 3pm called design review",
      "add lunch with Sam Friday noon",
    ],
    keywords: ["calendar", "schedule", "meeting", "event", "book"],
    timeoutMs: 35_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 300 },
        start: { type: "string", minLength: 8, maxLength: 80 },
        end: { type: "string", minLength: 8, maxLength: 80 },
        description: { type: ["string", "null"], maxLength: 2000 },
      },
      required: ["summary", "start", "end"],
      additionalProperties: false,
    },
  }),
  def({
    id: "calendar.get_connection_status",
    displayName: "Calendar connected?",
    description:
      "Check whether Google Calendar is connected in ArcSonare Connect. Use for “is my calendar connected?”.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["calendar connected", "is calendar connected"],
    intentExamples: ["is google calendar connected", "is my calendar connected"],
    keywords: ["calendar", "google", "connected", "connection"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  }),
  def({
    id: "drive.list_files",
    displayName: "List Google Drive files",
    description:
      "List or search files in the connected Google Drive. Use for “what’s in my Drive”, “find X on Drive”.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["drive", "google drive", "my files on drive"],
    intentExamples: ["list my drive files", "search drive for budget"],
    keywords: ["drive", "google drive", "files", "documents"],
    supportsDeterministicRouting: true,
    timeoutMs: 35_000,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        max_results: { type: ["integer", "null"], minimum: 1, maximum: 20 },
        query: { type: ["string", "null"], maxLength: 300 },
      },
      additionalProperties: false,
    },
  }),
  def({
    id: "drive.get_connection_status",
    displayName: "Drive connected?",
    description:
      "Check whether Google Drive is connected in ArcSonare Connect. Use for “is Google Drive connected?”.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["google drive connected", "is drive connected"],
    intentExamples: ["is google drive connected", "is my drive connected"],
    keywords: ["drive", "google", "connected", "connection"],
    supportsDeterministicRouting: true,
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  }),

  // ------------------------------------------------------------- youtube
  def({
    id: "youtube.search",
    displayName: "Search YouTube",
    description:
      "Search the user's CONNECTED YouTube account and return real results (titles, channels, thumbnails) INSIDE ArcSonare chat. This does NOT open a browser and CANNOT open one. Use it for “find X on YouTube”, “show me videos about X”, “find the X channel”, “what did X upload recently”. DO NOT use it when the user asks to go somewhere — “in my browser”, “open a browser”, “take me to”, “open youtube.com”, “in a tab” all mean they want to LEAVE the app, and that is web.search or web.open_url. If you pick this tool for one of those, the user does not get the browser they asked for.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["on youtube", "youtube videos", "find on youtube"],
    intentExamples: [
      "find cleo abram on youtube",
      "find a mrbeast video on youtube",
      "show me videos about rust",
      "find the mrbeast channel",
      "show me the newest mrbeast videos",
      "find that channel on youtube",
    ],
    keywords: ["youtube", "video", "videos", "channel", "find", "search", "watch"],
    executor: "frontend",
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        type: { type: ["string", "null"], enum: ["video", "channel", "playlist", null] },
        limit: { type: ["integer", "null"], minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }),
  def({
    id: "youtube.list_channel_videos",
    displayName: "Newest videos from a channel",
    description:
      "List a connected-YouTube channel's newest uploads, newest first, shown inside chat. Needs the channel_id from a previous youtube.search of type channel. Does not open a browser.",
    category: "web",
    riskLevel: "read-only",
    intentExamples: [
      "what are the newest videos from this channel",
      "show me their latest uploads",
    ],
    keywords: ["newest", "latest", "uploads", "channel", "videos", "youtube"],
    executor: "frontend",
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", minLength: 3, maxLength: 64 },
        limit: { type: ["integer", "null"], minimum: 1, maximum: 10 },
      },
      required: ["channel_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "youtube.open_result",
    displayName: "Open a YouTube result",
    description:
      "Open one result the user was already shown, by its result id. This DOES open the browser, so only use it when the user asked to open something or agreed to an offer to open it. Never guess an id — it must come from a result set already displayed.",
    category: "web",
    riskLevel: "reversible",
    intentExamples: ["open the first video", "open that one", "play the second result"],
    keywords: ["open", "play", "watch", "result", "video"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        result_item_id: { type: "string", minLength: 1, maxLength: 80 },
        result_set_id: { type: ["string", "null"], maxLength: 80 },
      },
      required: ["result_item_id"],
      additionalProperties: false,
    },
  }),

  // -------------------------------------------------------- connections
  def({
    id: "connections.list",
    displayName: "Connected apps",
    description:
      "List which apps and services are actually connected to ArcSonare right now, and what each one can currently do. Reads ArcSonare's own connection registry — NOT the Discover catalogue, which shows everything on offer whether connected or not. Use for “list my connected apps”, “what's connected?”, “which integrations can I use?”. Does not open anything.",
    category: "arcsonare",
    riskLevel: "read-only",
    aliases: ["connected apps", "what is connected", "my integrations", "connected services"],
    intentExamples: [
      "list all the connected apps",
      "what is connected",
      "list my connected services",
      "which integrations can i use",
      "what apps do i have connected",
    ],
    keywords: [
      "connected", "apps", "integrations", "services", "list", "available", "connections",
    ],
    supportsDeterministicRouting: true,
    executor: "frontend",
    timeoutMs: 10_000,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }),

  def({
    id: "connections.get_status",
    displayName: "Service connection status",
    description:
      "Check whether a service (YouTube, Spotify, Discord, Notion, GitHub, Slack, Gmail, …) is CONNECTED to ArcSonare in the Connect page, and what it can do once connected. This reads ArcSonare's own connection registry — it does NOT open the service, does NOT search it, and does NOT open a browser. Use it for any question about connection, linking, sign-in or setup state, e.g. “is YouTube connected?”, “did my Spotify link work?”, “can you use my Notion yet?”. To OPEN a service use applications.open or web.open_url; to SEARCH one use web.search; to let the user connect one, use arcsonare.navigate with page \"connect\".",
    category: "arcsonare",
    riskLevel: "read-only",
    aliases: [
      "is connected",
      "connection status",
      "are we connected",
      "is it linked",
      "check connection",
    ],
    intentExamples: [
      "is youtube connected",
      "can you check if youtube is connected",
      "is my spotify connected to arcsonare",
      "did discord connect properly",
      "is notion linked yet",
      "is my github account set up",
      // "What can YouTube do?" is the same question — it asks the connection
      // registry what a service offers. Without these it retrieved
      // `youtube.search` instead, and answered a capability question by
      // running a search with no query.
      "what can youtube do",
      "what can i do with spotify",
      "what tools does discord have",
      "what gmail tools are available",
      "which youtube features can you use",
    ],
    keywords: [
      "connected",
      "connection",
      "connect",
      "linked",
      "link",
      "integration",
      "account",
      "signed",
      "setup",
      "status",
      "tools",
      "features",
    ],
    supportsDeterministicRouting: true,
    executor: "frontend",
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description:
            "The service the user asked about, in their own words: youtube, spotify, discord, gmail, notion…",
        },
      },
      required: ["service"],
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
    id: "watch.activate_application",
    displayName: "Activate focused Watch access",
    description:
      "Turn on focused Watch access for one running application in this conversation, so ArcSonare may read and control it. Offer this — as an action the user clicks — when the user asks something that needs to read an application that is running but not active. Never call it to answer the request yourself: it grants access and stops, and the user asks again if they still want the answer.",
    category: "arcsonare",
    riskLevel: "reversible",
    aliases: ["activate watch", "focus on this app", "let me watch this app"],
    intentExamples: [
      "activate Chrome for this conversation",
      "turn on watch for VS Code",
    ],
    keywords: ["activate", "watch", "focus", "application"],
    executor: "frontend",
    inputSchema: {
      type: "object",
      properties: {
        app_catalog_id: { type: "string", minLength: 1, maxLength: 64 },
      },
      required: ["app_catalog_id"],
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

  // --------------------------------------------------- watched applications
  //
  // Every capability below is gated on the user watching that application AND
  // that application running. `capabilitiesForWatchContext` enforces it; the
  // `watchedApplicationId` field is what it enforces against.
  //
  // `instance_key` is required rather than optional on purpose. An optional
  // instance means "act on whichever one I find", which is exactly how a
  // command reaches the wrong VS Code workspace.

  def({
    id: "spotify.get_playback",
    displayName: "What's playing",
    description:
      "Read the current track, artist and playback state from the watched Spotify instance's Windows media session. Use for 'what's playing', 'what song is this', 'is it paused'. instance_key is optional — omit it and Spotify is resolved automatically. Never ask the user which window.",
    category: "watched-app",
    riskLevel: "read-only",
    watchedApplicationId: "spotify",
    aliases: ["what's playing", "current track", "now playing"],
    intentExamples: ["what is playing", "what song is this", "who sings this"],
    keywords: ["playing", "track", "song", "artist", "album", "music"],
    supportsDeterministicRouting: true,
    timeoutMs: 5_000,
    // `instance_key` is optional here and on the transport capabilities below.
    //
    // Requiring it made the model stop and ask "which Spotify window should I
    // play it in?" — a question with no useful answer for a player that has one
    // window, and an obstacle in front of the simplest command in the product.
    // It is safe to omit because the adapter resolves the target from the
    // capability's own application: `spotify.*` addresses Spotify and cannot
    // reach another player, whatever key does or does not arrive.
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: ["string", "null"], minLength: 1 } },
      additionalProperties: false,
    },
  }),
  ...(
    [
      ["spotify.play", "Play", "Resume playback", ["play", "resume", "start the music"]],
      ["spotify.pause", "Pause", "Pause playback", ["pause", "stop the music", "hold on"]],
      ["spotify.next", "Next track", "Skip to the next track", ["next", "skip", "next song"]],
      [
        "spotify.previous",
        "Previous track",
        "Go back to the previous track",
        ["previous", "go back", "last song"],
      ],
    ] as const
  ).map(([id, displayName, description, intents]) =>
    def({
      id,
      displayName,
      description: `${description} on the watched Spotify instance, through the Windows media session. One command per call. instance_key is optional — omit it and Spotify is resolved automatically. Never ask which window, and never take a screenshot or click for this.`,
      category: "watched-app",
      riskLevel: "reversible",
      watchedApplicationId: "spotify",
      aliases: [...intents],
      intentExamples: [...intents],
      keywords: [...intents],
      supportsDeterministicRouting: true,
      timeoutMs: 8_000,
      inputSchema: {
        type: "object",
        properties: { instance_key: { type: ["string", "null"], minLength: 1 } },
        additionalProperties: false,
      },
    }),
  ),

  def({
    id: "vscode.get_context",
    displayName: "Editor context",
    description:
      "Read the watched VS Code workspace: active file, language, diagnostics, configured tasks, terminals and Git branch. Requires the ArcSonare VS Code extension.",
    category: "watched-app",
    riskLevel: "read-only",
    watchedApplicationId: "vscode",
    aliases: ["what am I editing", "active file", "current file"],
    intentExamples: [
      "what file am I editing",
      "what am I working on",
      "what's open in the editor",
    ],
    keywords: ["editing", "file", "editor", "workspace", "project"],
    supportsDeterministicRouting: true,
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "vscode.get_diagnostics",
    displayName: "Editor problems",
    description:
      "Read the real errors and warnings the watched VS Code workspace's language servers are reporting. Use for 'what's wrong with this code' and 'what errors are here'.",
    category: "watched-app",
    riskLevel: "read-only",
    watchedApplicationId: "vscode",
    aliases: ["errors", "problems", "diagnostics"],
    intentExamples: [
      "what is wrong with this code",
      "what errors are here",
      "any problems in this file",
    ],
    keywords: ["error", "errors", "warning", "problem", "wrong", "broken"],
    supportsDeterministicRouting: true,
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "vscode.list_tasks",
    displayName: "Configured tasks",
    description:
      "List the tasks the watched VS Code workspace has configured. Call this before run_task when the user did not name one.",
    category: "watched-app",
    riskLevel: "read-only",
    watchedApplicationId: "vscode",
    aliases: ["tasks", "what can I run"],
    intentExamples: ["what tasks are there", "how do I run this"],
    keywords: ["task", "tasks", "run", "build", "script"],
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "vscode.run_task",
    displayName: "Run a configured task",
    description:
      "Run a task already declared in the watched workspace's tasks.json, by name. Only names returned by vscode.list_tasks are valid — this cannot run an arbitrary command. Use for 'run this code' and 'build it'.",
    category: "watched-app",
    riskLevel: "reversible",
    watchedApplicationId: "vscode",
    aliases: ["run", "build", "run this code"],
    intentExamples: ["run this code", "build the project", "run the dev task"],
    keywords: ["run", "build", "execute", "start", "task"],
    timeoutMs: 15_000,
    inputSchema: {
      type: "object",
      properties: {
        instance_key: { type: "string", minLength: 1 },
        task_name: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["instance_key", "task_name"],
      additionalProperties: false,
    },
  }),
  def({
    id: "vscode.start_debug",
    displayName: "Start debugging",
    description:
      "Start a debug configuration already declared in the watched workspace's launch.json.",
    category: "watched-app",
    riskLevel: "reversible",
    watchedApplicationId: "vscode",
    aliases: ["debug", "start debugging"],
    intentExamples: ["debug this", "start the debugger"],
    keywords: ["debug", "debugger", "breakpoint"],
    timeoutMs: 15_000,
    inputSchema: {
      type: "object",
      properties: {
        instance_key: { type: "string", minLength: 1 },
        configuration: { type: ["string", "null"], maxLength: 120 },
      },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "vscode.stop_task",
    displayName: "Stop running tasks",
    description: "Terminate the tasks currently running in the watched VS Code workspace.",
    category: "watched-app",
    riskLevel: "reversible",
    watchedApplicationId: "vscode",
    aliases: ["stop", "cancel the build"],
    intentExamples: ["stop the task", "cancel that build"],
    keywords: ["stop", "cancel", "terminate", "kill"],
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),

  def({
    id: "discord_desktop.get_current_location",
    displayName: "Current Discord channel",
    description:
      "Read which server and channel the watched Discord window is showing, from its window title. Reports honestly when the title does not say.",
    category: "watched-app",
    riskLevel: "read-only",
    watchedApplicationId: "discord",
    aliases: ["what channel", "where am I in discord"],
    intentExamples: ["what channel am I in", "which server is this"],
    keywords: ["channel", "server", "discord"],
    supportsDeterministicRouting: true,
    timeoutMs: 5_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "discord_desktop.get_visible_controls",
    displayName: "Discord controls",
    description:
      "List the interactive controls the watched Discord window exposes through Windows UI Automation. Returns nothing readable when the window has no accessibility tree.",
    category: "watched-app",
    riskLevel: "read-only",
    watchedApplicationId: "discord",
    aliases: ["what can I click in discord"],
    intentExamples: ["what controls are available", "what can you see in discord"],
    keywords: ["controls", "buttons", "discord"],
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "discord_desktop.get_visible_messages",
    displayName: "Visible Discord messages",
    description:
      "Read the message text visible in the watched Discord window. Requires explicit message-content permission for Discord and an accessibility tree; says so when either is missing.",
    category: "watched-app",
    riskLevel: "sensitive",
    watchedApplicationId: "discord",
    aliases: ["what did they say", "read the messages"],
    intentExamples: ["what does the last message say", "read the chat"],
    keywords: ["message", "messages", "chat", "said"],
    requiredPermissions: ["watch.messageContent"],
    timeoutMs: 12_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "discord_desktop.prepare_message",
    displayName: "Prepare a Discord message",
    description:
      "Prepare — never send — a message for the channel the watched Discord window is showing. Returns the exact destination and text for one confirmation.",
    category: "watched-app",
    riskLevel: "sensitive",
    watchedApplicationId: "discord",
    confirmation: "before-execution",
    aliases: ["send a message", "message the channel"],
    intentExamples: ["send hello here", "reply in this channel"],
    keywords: ["send", "message", "reply", "post"],
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: {
        instance_key: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["instance_key", "message"],
      additionalProperties: false,
    },
  }),
  def({
    id: "discord_desktop.send_message",
    displayName: "Send the prepared Discord message",
    description:
      "Send the message the user already approved. Refuses if Discord has moved to a different channel since the confirmation. Never call this without a prior prepare_message the user approved.",
    category: "watched-app",
    riskLevel: "sensitive",
    watchedApplicationId: "discord",
    confirmation: "always",
    // Voice cannot show the exact recipient and text before it happens, and
    // this reaches another person. Text chat only.
    supportsVoice: false,
    aliases: [],
    intentExamples: [],
    keywords: [],
    timeoutMs: 15_000,
    inputSchema: {
      type: "object",
      properties: {
        instance_key: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1, maxLength: 2000 },
        confirmed_destination: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["instance_key", "message", "confirmed_destination"],
      additionalProperties: false,
    },
  }),

  def({
    id: "browser.get_page_context",
    displayName: "Watched browser page",
    description:
      "Read what the watched browser window is showing, from its window title. This is the page identity, not the address — say so rather than claiming to read the URL.",
    category: "watched-app",
    riskLevel: "read-only",
    aliases: ["what page", "what site"],
    intentExamples: ["what page am I on", "what is open in the browser"],
    keywords: ["page", "tab", "site", "browser"],
    supportsDeterministicRouting: true,
    timeoutMs: 5_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "browser.navigate",
    displayName: "Navigate the watched browser",
    description:
      "Go back, forward or reload in the watched browser window. Focuses that specific window first — it never navigates whatever happens to be in front.",
    category: "watched-app",
    riskLevel: "reversible",
    aliases: ["go back", "go forward", "reload"],
    intentExamples: ["go back", "go forward", "refresh the page"],
    keywords: ["back", "forward", "reload", "refresh", "navigate"],
    timeoutMs: 12_000,
    inputSchema: {
      type: "object",
      properties: {
        instance_key: { type: "string", minLength: 1 },
        direction: { type: "string", enum: ["back", "forward", "reload"] },
      },
      required: ["instance_key", "direction"],
      additionalProperties: false,
    },
  }),

  // -------------------------------------------------------------------------
  // Download → installer.
  //
  // The workflow that used to stop at "I found the Download button". Each step
  // returns evidence the next one needs, and the only question in the whole
  // chain is the one at the elevation boundary — see `installer.inspect`.
  // -------------------------------------------------------------------------

  def({
    id: "browser.find_link",
    displayName: "Find a download link on a page",
    description:
      "FIND THE RIGHT DOWNLOAD on a web page, by reading the page's own structure. Use this before downloading anything — it is how two products on one page with identically-labelled \"Download\" buttons are told apart, which a screenshot cannot do. Give the product name exactly as the user said it (\"LightBurn\") and the platform (\"windows\"). Returns the chosen link with the reason it was chosen; if two links are equally plausible it asks rather than guessing, and if the page has no download it says so. Never click a download button visually when this can answer.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["find the download", "which download"],
    intentExamples: [
      "find the LightBurn download for Windows",
      "which download on this page is the Windows one",
    ],
    keywords: ["download", "link", "installer", "version", "platform"],
    timeoutMs: 25_000,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 1 },
        product: { type: "string", minLength: 1 },
        platform: { type: "string", enum: ["windows", "mac", "linux"] },
      },
      required: ["url", "product"],
      additionalProperties: false,
    },
  }),
  def({
    id: "browser.download",
    displayName: "Download a file",
    description:
      "DOWNLOAD A FILE to the user's Downloads folder and verify it arrived. Takes the href from browser.find_link. This does NOT install anything and does NOT need permission for a normal user-requested download — downloading and installing are separate steps with separate risks. Pass origin_url (the page the link came from) so a download served by an unrelated host can be flagged. Returns the real path and byte size; a download that stopped early is reported as failed, never as done.",
    category: "web",
    riskLevel: "reversible",
    aliases: ["download it", "get the file"],
    intentExamples: ["download LightBurn for Windows", "download that file"],
    keywords: ["download", "save", "get", "file", "installer"],
    timeoutMs: 900_000,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 1 },
        origin_url: { type: "string" },
        approved: { type: "boolean" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  }),
  def({
    id: "browser.wait_for_download",
    displayName: "Check a download",
    description:
      "Check the progress of a download by its download_id. Reports bytes received, the total when the server gave one, and whether the file is verifiably complete. A download is only complete when the bytes on disk match what was promised.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["is it downloaded yet", "download progress"],
    intentExamples: ["is that download finished", "how far along is the download"],
    keywords: ["download", "progress", "finished", "complete"],
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: { download_id: { type: "string", minLength: 1 } },
      required: ["download_id"],
      additionalProperties: false,
    },
  }),
  def({
    id: "browser.get_downloads",
    displayName: "List this session's downloads",
    description:
      "List the downloads ArcSonare has performed this session, with their state and final paths.",
    category: "web",
    riskLevel: "read-only",
    aliases: ["what did you download", "my downloads"],
    intentExamples: ["what have you downloaded", "where did that file go"],
    keywords: ["downloads", "files", "session"],
    timeoutMs: 5_000,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }),
  def({
    id: "installer.inspect",
    displayName: "Inspect a downloaded installer",
    description:
      "Read what a downloaded file actually is BEFORE offering to run it: installer type, publisher, whether the digital signature verifies, and whether running it will raise a Windows administrator prompt. Call this after a download completes and before asking the user anything — the returned approvalPrompt is the ONE question to ask, and it is asked once, at the install boundary. Never claim a publisher this did not report.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["is it safe", "who signed it"],
    intentExamples: ["is that installer signed", "what did I just download"],
    keywords: ["installer", "signature", "publisher", "signed", "safe"],
    timeoutMs: 30_000,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        product: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  }),
  def({
    id: "installer.list_installed",
    displayName: "List installed applications",
    description:
      "List the applications registered as installed on this machine, from the Windows uninstall registry. Call this BEFORE running an installer so afterwards it is possible to tell \"this installed it\" from \"it was already there\".",
    category: "system",
    riskLevel: "read-only",
    aliases: ["what is installed", "do I have"],
    intentExamples: ["is LightBurn installed", "what programs are installed"],
    keywords: ["installed", "programs", "applications", "registry"],
    timeoutMs: 20_000,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }),
  def({
    id: "installer.verify",
    displayName: "Verify an installation",
    description:
      "Check whether an application is now actually installed, by comparing the installed-applications registry against the list from before the installer ran. An installer exiting is NOT an installation — a user pressing Cancel exits too. Only report something as installed when this says so.",
    category: "system",
    riskLevel: "read-only",
    aliases: ["did it install", "is it installed now"],
    intentExamples: ["did LightBurn install", "did that work"],
    keywords: ["installed", "verify", "confirm", "worked"],
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", minLength: 1 },
        before: { type: "array", items: { type: "object" } },
        exit_code: { type: "number" },
        still_running: { type: "boolean" },
      },
      required: ["product"],
      additionalProperties: false,
    },
  }),

  def({
    id: "applications.focus_watched",
    displayName: "Bring a watched app to the front",
    description:
      "Focus one specific watched application instance by its instance key. Unlike applications.focus, this targets the exact window — not the first one matching a product name.",
    category: "watched-app",
    riskLevel: "reversible",
    aliases: ["bring it to the front", "focus", "show it"],
    intentExamples: ["bring it to the front", "switch to it", "show me that window"],
    keywords: ["focus", "front", "switch", "show"],
    timeoutMs: 8_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
      additionalProperties: false,
    },
  }),
  def({
    id: "applications.get_window_context",
    displayName: "Watched window metadata",
    description:
      "Everything ArcSonare can honestly say about one watched instance from window metadata alone: executable, title, workspace, monitor and bounds. Not an understanding of the application's contents.",
    category: "watched-app",
    riskLevel: "read-only",
    aliases: [],
    intentExamples: [],
    keywords: ["window", "instance", "metadata"],
    timeoutMs: 5_000,
    inputSchema: {
      type: "object",
      properties: { instance_key: { type: "string", minLength: 1 } },
      required: ["instance_key"],
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
