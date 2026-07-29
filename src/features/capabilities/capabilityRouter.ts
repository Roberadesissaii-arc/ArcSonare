/**
 * Two-stage capability routing.
 * Stage 1: deterministic local patterns — obvious requests never touch a model.
 * Stage 2: lightweight retrieval — only the top-scoring capability schemas are
 * sent to the model (never the whole registry).
 */
import { availableCapabilities, getCapability } from "./capabilityRegistry";
import type { CapabilityDefinition } from "./capabilityTypes";
import { recentSuccessBoost } from "./capabilityMemory";

export interface DeterministicRoute {
  capabilityId: string;
  arguments: Record<string, unknown>;
  /** Compose the response locally without any model call. */
  localResponse: boolean;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[""''`]/g, "'")
    .replace(/[?!.,;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_FOLDERS =
  "(desktop|documents?|downloads?|pictures?|videos?|music)";

function folderKey(word: string): string {
  const w = word.toLowerCase();
  if (w.startsWith("desktop")) return "desktop";
  if (w.startsWith("document")) return "documents";
  if (w.startsWith("download")) return "downloads";
  if (w.startsWith("picture")) return "pictures";
  if (w.startsWith("video")) return "videos";
  return "music";
}

/**
 * Remove conversational wrapper words from an application name while keeping
 * the actual product name intact. Voice transcripts commonly contain phrases
 * such as "my Discord" or "an application called Arduino".
 */
export function normalizeApplicationTarget(raw: string): string {
  let target = normalize(raw);
  target = target.replace(/\s+(?:please|for me)$/g, "").trim();
  target = target
    .replace(/^(?:(?:my|the|a|an)\s+)+/g, "")
    .replace(
      /^(?:(?:desktop|windows)\s+)?(?:app|application|program)\s+(?:called|named)\s+/,
      "",
    )
    .replace(/^(?:called|named)\s+/, "")
    .replace(/^(?:(?:my|the|a|an)\s+)+/g, "")
    .replace(/\s+(?:desktop\s+)?(?:app|application|program)$/g, "")
    .trim();
  return target;
}

/**
 * Stage 1 — deterministic routes. Returns null when no obvious match; the
 * request then goes through retrieval + model tool selection.
 */
export function routeDeterministic(input: string): DeterministicRoute | null {
  const q = normalize(input);
  if (!q || q.length > 300) return null;

  // ---- time & date -------------------------------------------------------
  if (
    /^(what(?:'s| is) the (?:current )?time|what time is it(?: now)?|tell me the time|current time)$/.test(
      q,
    ) ||
    /^time(?: please)?$/.test(q)
  ) {
    return {
      capabilityId: "system.get_local_datetime",
      arguments: { format: "spoken", include_timezone: false },
      localResponse: true,
    };
  }
  if (
    /^(what(?:'s| is) (?:the )?(?:current )?date|what(?:'s| is) today(?:'s date)?|tell me the date|current date)$/.test(
      q,
    ) ||
    /^(what day is it(?: today)?)$/.test(q)
  ) {
    return {
      capabilityId: "system.get_local_datetime",
      arguments: { format: "spoken", include_timezone: false },
      localResponse: true,
    };
  }
  if (/^(what timezone am i in|what(?:'s| is) my timezone)$/.test(q)) {
    return {
      capabilityId: "system.get_local_datetime",
      arguments: { format: "spoken", include_timezone: true },
      localResponse: true,
    };
  }

  // ---- ArcSonare navigation ----------------------------------------------
  const nav = q.match(
    /^(?:go to|open|show|navigate to|take me to)(?: the)? (dashboard|tasks?|agent|connect|settings)(?: page| tab)?$/,
  );
  if (nav) {
    const page = nav[1].startsWith("task") ? "tasks" : nav[1];
    return {
      capabilityId: "arcsonare.navigate",
      arguments: { page },
      localResponse: true,
    };
  }
  if (/^(go to tasks and show|show)( me)? urgent tasks$/.test(q)) {
    return {
      capabilityId: "arcsonare.navigate",
      arguments: { page: "tasks", task_filter: "urgent" },
      localResponse: true,
    };
  }

  // ---- known-folder listing ----------------------------------------------
  const listFolder = q.match(
    new RegExp(
      `^(?:what(?:'s| is) (?:on|in)|what do i have (?:on|in)|list|show(?: me)?)(?: my| the)? ${KNOWN_FOLDERS}(?: folder)?$`,
    ),
  );
  if (listFolder) {
    return {
      capabilityId: "filesystem.list_known_folder",
      arguments: { folder: folderKey(listFolder[1]) },
      localResponse: true,
    };
  }

  // ---- screenshots ---------------------------------------------------------
  if (/^(?:take|capture|grab)(?: a)? screenshot(?: of (?:my|the) screen)?(?: and show(?: it to)? me)?$/.test(q) || q === "screenshot") {
    return {
      capabilityId: "screen.capture",
      arguments: { target: "active-display" },
      localResponse: true,
    };
  }
  const shotApp = q.match(
    /^(?:take|capture|grab)(?: a)? screenshot of (.+?)(?: and show(?: it to)? me)?$|^screenshot (.+)$/,
  );
  if (shotApp) {
    const target = (shotApp[1] ?? shotApp[2] ?? "").trim();
    if (target && !/^(my|the) (screen|display|desktop|monitor)$/.test(target)) {
      return {
        capabilityId: "screen.capture",
        arguments: { target: "application", application_query: target },
        localResponse: true,
      };
    }
    return {
      capabilityId: "screen.capture",
      arguments: { target: "active-display" },
      localResponse: true,
    };
  }

  // ---- create folder / file ------------------------------------------------
  // Intentionally NOT deterministic. Folder/file creation goes through the
  // model tool loop so the AI selects the tool, sees the verified result, and
  // can answer follow-ups (“where did you create it?”).

  // ---- delete --------------------------------------------------------------
  // Destructive deletes also go through the model (confirmation + memory).

  // ---- find ------------------------------------------------------------------
  const find = q.match(
    /^(?:find|locate|where is|search for)(?: my| the)? ['"]?(.+?)['"]?(?: (folder|file))?$/,
  );
  if (find && !/^(the web|web|online)/.test(find[1])) {
    const itemType = find[2] === "folder" ? "directory" : find[2] === "file" ? "file" : "any";
    return {
      capabilityId: "filesystem.find",
      arguments: { query: find[1].trim(), item_type: itemType },
      localResponse: true,
    };
  }

  // ---- web search -----------------------------------------------------------
  const ytSearch = q.match(/^search youtube for (.+)$/);
  if (ytSearch) {
    return {
      capabilityId: "web.search",
      arguments: { query: ytSearch[1].trim(), site: "youtube" },
      localResponse: true,
    };
  }
  const webSearch = q.match(/^(?:search(?: the web)?(?: for)?|google|look up) (.+)$/);
  if (webSearch) {
    return {
      capabilityId: "web.search",
      arguments: { query: webSearch[1].trim() },
      localResponse: true,
    };
  }

  // ---- clipboard ------------------------------------------------------------
  if (/^(?:what(?:'s| is) (?:on|in) my clipboard|read my clipboard|show(?: me)? my clipboard)$/.test(q)) {
    return {
      capabilityId: "clipboard.read_text",
      arguments: {},
      localResponse: true,
    };
  }

  // ---- tasks ------------------------------------------------------------------
  const task = q.match(/^(?:create|add|make)(?: a)? task(?: to| called| titled|:)? (.+)$/);
  if (task) {
    return {
      capabilityId: "tasks.create",
      arguments: { title: task[1].trim() },
      localResponse: true,
    };
  }

  // ---- location / weather / nearby / travel ---------------------------------
  if (
    /^(?:what(?:'s| is)|how(?:'s| is))(?: the)? weather(?: like)?(?: (?:outside|today|right now|now))?(?: (?:here|near me))?$/.test(
      q,
    ) ||
    /^(?:weather(?: (?:outside|today|here|near me))?|temperature(?: outside)?|is it (?:raining|snowing|cold|hot|warm)(?: outside)?)$/.test(
      q,
    ) ||
    /^what(?:'s| is) the temperature(?: outside| today| right now| now)?$/.test(q)
  ) {
    return {
      capabilityId: "location.get_weather",
      arguments: {},
      localResponse: true,
    };
  }

  const nearby =
    q.match(/^(?:what(?:'s| is)|show(?: me)?|find)(?: (?:places?|spots?))? near(?:by)?(?: me)?$/) ||
    q.match(/^(?:nearby|near me)(?: (.+))?$/) ||
    q.match(/^(?:find|show(?: me)?|any) (.+?) near(?:by)?(?: me)?$/);
  if (nearby) {
    const query =
      typeof nearby[1] === "string" && nearby[1].trim()
        ? nearby[1].trim()
        : "cafe";
    return {
      capabilityId: "location.get_nearby",
      arguments: { query },
      localResponse: true,
    };
  }

  const travel =
    q.match(/^(?:how long(?: (?:will it take|does it take))? to (?:get to|reach|drive to) (.+)$)/) ||
    q.match(/^(?:how far is (.+?)(?: from (?:here|me))?$)/) ||
    q.match(/^(?:travel time to|eta to|drive time to) (.+)$/);
  if (travel) {
    return {
      capabilityId: "location.get_travel_time",
      arguments: { destination: travel[1].trim() },
      localResponse: true,
    };
  }
  if (/^(?:show|list)(?: me)?(?: my)? tasks$/.test(q)) {
    return {
      capabilityId: "tasks.list",
      arguments: { filter: "open" },
      localResponse: true,
    };
  }
  if (/^(?:show|list)(?: me)?(?: my)? urgent tasks$/.test(q)) {
    return {
      capabilityId: "tasks.list",
      arguments: { filter: "urgent" },
      localResponse: true,
    };
  }
  const complete = q.match(/^(?:mark|set)(?: the)? (.+?)(?: task)? (?:as )?(?:done|complete|completed|finished)$/);
  if (complete) {
    return {
      capabilityId: "tasks.complete",
      arguments: { title_query: complete[1].trim() },
      localResponse: true,
    };
  }

  // ---- battery / displays / apps ---------------------------------------------
  if (/^(?:what(?:'s| is) my battery(?: at| level)?|battery status|am i charging)$/.test(q)) {
    return { capabilityId: "system.get_battery_status", arguments: {}, localResponse: true };
  }
  if (/^(?:list(?: my)? displays|how many (?:monitors|displays|screens) do i have)$/.test(q)) {
    return { capabilityId: "system.list_displays", arguments: {}, localResponse: true };
  }
  if (/^(?:what apps are running|what(?:'s| is) (?:open|running)(?: right now)?)$/.test(q)) {
    return { capabilityId: "system.get_running_processes", arguments: {}, localResponse: true };
  }
  if (/^(?:refresh|rescan)(?: the)? app(?:lication)?s?(?: index)?$/.test(q)) {
    return { capabilityId: "applications.refresh_index", arguments: {}, localResponse: true };
  }

  // ---- app focus / close -------------------------------------------------------
  const focus = q.match(/^(?:switch to|focus|bring up) (.+)$/);
  if (focus) {
    const target = normalizeApplicationTarget(focus[1]);
    return {
      capabilityId: "applications.focus",
      arguments: { query: target },
      localResponse: true,
    };
  }
  const close = q.match(/^(?:close|quit|exit) (.+)$/);
  if (close) {
    const target = normalizeApplicationTarget(close[1]);
    if (!/^(this|the app|arcsonare)$/.test(target)) {
      return {
        capabilityId: "applications.close",
        arguments: { query: target },
        localResponse: true,
      };
    }
  }

  // ---- open (apps / services / urls) — LAST so specific routes win -------------
  const open = q.match(
    /^(?:(?:(?:can|could|would) you|please|i want you to)\s+)?(?:open|launch|start|run)(?:\s+up)?\s+(.+)$/,
  );
  if (open) {
    const target = normalizeApplicationTarget(open[1]);
    // In-app pages already matched above; URLs go to web.open_url.
    if (/^https?:\/\//.test(target)) {
      return {
        capabilityId: "web.open_url",
        arguments: { url: target },
        localResponse: true,
      };
    }
    if (target && target.length <= 80) {
      return {
        capabilityId: "applications.open",
        arguments: { query: target },
        localResponse: true,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stage 2 — retrieval
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "my", "me", "i", "you", "please", "can", "could", "would",
  "to", "of", "on", "in", "for", "and", "is", "it", "that", "this", "with",
  "do", "does", "what", "whats", "how", "at",
]);

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface RetrievalResult {
  capability: CapabilityDefinition;
  score: number;
}

/**
 * Score capabilities against the request. Keyword/alias/example overlap plus
 * a recent-success boost from memory. Returns at most `limit` schemas.
 */
export function retrieveCapabilities(
  input: string,
  limit = 6,
): RetrievalResult[] {
  const requestTokens = tokens(input);
  if (requestTokens.length === 0) return [];
  const results: RetrievalResult[] = [];
  for (const cap of availableCapabilities()) {
    let score = 0;
    const keywordSet = new Set(cap.keywords.map((k) => k.toLowerCase()));
    for (const t of requestTokens) {
      if (keywordSet.has(t)) score += 3;
    }
    for (const alias of cap.aliases) {
      if (normalize(input).includes(normalize(alias))) score += 4;
    }
    for (const example of cap.intentExamples) {
      const exampleTokens = new Set(tokens(example));
      const overlap = requestTokens.filter((t) => exampleTokens.has(t)).length;
      if (overlap >= 2) score += overlap * 2;
    }
    if (score > 0) {
      score += recentSuccessBoost(cap.id);
      results.push({ capability: cap, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  // Dependency-aware expansion: filesystem mutations often need the resolver.
  const top = results.slice(0, limit);
  const hasFsMutation = top.some(
    (r) =>
      r.capability.category === "filesystem" &&
      r.capability.riskLevel !== "read-only",
  );
  if (
    hasFsMutation &&
    !top.some((r) => r.capability.id === "filesystem.resolve_known_folder")
  ) {
    const resolver = getCapability("filesystem.resolve_known_folder");
    if (resolver) top.push({ capability: resolver, score: 1 });
  }
  return top.slice(0, Math.max(limit, 1));
}
