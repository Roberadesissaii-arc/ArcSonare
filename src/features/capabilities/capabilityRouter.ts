/**
 * Two-stage capability routing.
 * Stage 1: deterministic local patterns — obvious requests never touch a model.
 * Stage 2: lightweight retrieval — only the top-scoring capability schemas are
 * sent to the model (never the whole registry).
 */
import { resolveClickTarget } from "./clickTargetMemory";
import { availableCapabilities, getCapability } from "./capabilityRegistry";
import { capabilitiesForOrigin } from "./connectorRegistry";
import type { IntegrationId } from "../../config/iconRegistry";
import type { CapabilityDefinition } from "./capabilityTypes";
import type { WatchedApplication } from "../watch/watchTypes";
import {
  capabilityForIntent,
  isMediaApplication,
  parseMediaIntent,
} from "../watch/mediaIntent";
import { getWatchScope } from "../watch/watchScopeStore";
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

/**
 * Recovers the capitalisation the user typed for a value that was captured
 * from the lowercased query. Falls back to the lowercase form when the phrase
 * cannot be located (e.g. the user typed it in a different form).
 */
function originalCasing(original: string, lowercased: string): string {
  const index = original.toLowerCase().indexOf(lowercased);
  return index >= 0 ? original.slice(index, index + lowercased.length) : lowercased;
}

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
/**
 * Resolve a media transport command against the conversation's Watch scope.
 *
 * Returns null unless *both* halves hold: the text is a transport command, and
 * a media application is active in this conversation. Either alone is not
 * enough — "play" with nothing watched is genuinely ambiguous, and Spotify
 * being watched does not make "play chess" a transport command.
 */
function routeWatchedMedia(q: string): DeterministicRoute | null {
  const intent = parseMediaIntent(q);
  if (!intent) return null;

  const { scope } = getWatchScope();
  const mediaApps = scope.entries.filter((entry) =>
    isMediaApplication(entry.appCatalogId),
  );
  if (mediaApps.length === 0) return null;

  // Two watched players and a bare "play" is genuinely ambiguous. Returning
  // null lets the conversation ask which one rather than guessing — and, more
  // importantly, still never reaches the visual locator, because the media
  // capabilities are the only ones the scope offers.
  if (mediaApps.length > 1) return null;

  const target = mediaApps[0];
  const capabilityId = capabilityForIntent(intent, target.appCatalogId);
  if (!capabilityId) return null;

  // A closed application cannot be commanded. The engine's own handling for
  // that is honest ("Spotify is watched but isn't running"); what matters here
  // is that it is not handed to vision instead.
  if (!target.running) {
    return {
      capabilityId,
      arguments: target.boundInstanceKey
        ? { instance_key: target.boundInstanceKey }
        : {},
      localResponse: true,
    };
  }

  return {
    capabilityId,
    arguments: target.boundInstanceKey
      ? { instance_key: target.boundInstanceKey }
      : {},
    localResponse: true,
  };
}

/**
 * A watched application the phrase names, if any.
 *
 * Matched against the conversation's Watch scope rather than the whole catalog:
 * "show me Spotify" should focus the Spotify this conversation is about, and if
 * no Spotify is watched there is nothing to focus and the ordinary routing
 * should have its turn.
 */
function watchedAppNamed(spoken: string) {
  const phrase = spoken.trim().toLowerCase();
  if (!phrase || phrase.length > 40) return null;
  const { scope } = getWatchScope();
  return (
    scope.entries.find(
      (entry) =>
        entry.displayName.toLowerCase() === phrase ||
        entry.appCatalogId.replace(/-/g, " ") === phrase,
    ) ?? null
  );
}

export function routeDeterministic(input: string): DeterministicRoute | null {
  const q = normalize(input);
  if (!q || q.length > 300) return null;

  // ---- watched media transport — before ANY vision rule ------------------
  //
  // "Play the current song" with Spotify watched used to fall through every
  // rule here, reach model tool-selection, and come back as
  // `screen.click_target` with the target "that" — a screen capture, a hunt for
  // a control named by a pronoun, and "I couldn't find 'that' on the screen."
  //
  // Transport is a media-session operation. It needs no pixels, so it is
  // resolved first and never reaches the visual rules further down.
  const mediaRoute = routeWatchedMedia(q);
  if (mediaRoute) return mediaRoute;

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

  // A NAMED subfolder of a known folder. Without this, "what's inside Fantastic
  // on my desktop" reached model tool-selection, which built the relative path
  // "desktop/Fantastic", failed argument validation, and then asked the user
  // what was inside the folder it was supposed to be reading.
  const listNamed = q.match(
    new RegExp(
      `^(?:(?:hey|ok|please|can you|could you)\\s+)*` +
        `(?:go\\s+to\\s+(?:my\\s+|the\\s+)?${KNOWN_FOLDERS}\\s+and\\s+)?` +
        // Optional lead-in ("show me", "tell me"), then the query verb. Kept
        // separate so "show me what's in X" works as well as bare "show me X".
        `(?:(?:show|tell|give)\\s+me\\s+)?` +
        `(?:what(?:'s| is| are)?\\s+(?:in|inside|on)|list|inside|in)\\s+` +
        `(?:the\\s+contents\\s+of\\s+)?(?:the\\s+)?` +
        `["']?([\\w .\\-]+?)["']?\\s*(?:folder)?` +
        `(?:\\s+(?:on|in|under)\\s+(?:my\\s+|the\\s+)?${KNOWN_FOLDERS}(?:\\s+folder)?)?$`,
    ),
  );
  if (listNamed) {
    // Group 1 = leading "go to my <folder>", group 2 = name, group 3 = trailing folder.
    const parent = listNamed[3] ?? listNamed[1];
    // Strip the wrapper words around the name. Without the trailing pass,
    // "fantastic folder which is on my desktop" captured the name as
    // "fantastic folder which is" and looked for a folder literally called
    // that — which does not exist, so the answer silently became the desktop.
    const rawName = (listNamed[2] ?? "")
      .replace(/^(?:folder|directory)\s+(?:called|named|titled)\s+/i, "")
      .replace(/^(?:called|named|titled)\s+/i, "")
      // trailing: "… folder which is" / "… that is" / "… folder"
      .replace(/\s+(?:folder|directory)?\s*(?:which|that)\s+(?:is|are|s)$/i, "")
      .replace(/\s+(?:folder|directory)$/i, "")
      .trim();
    const known = new Set([
      "desktop", "document", "documents", "download", "downloads",
      "picture", "pictures", "video", "videos", "music",
    ]);
    // "what's in my desktop" is the known-folder case, already handled above.
    if (parent && rawName && !known.has(rawName)) {
      return {
        capabilityId: "filesystem.list_directory",
        arguments: {
          // Resolved to an absolute path by resolveSpecialArgs.
          __known_subpath: { folder: folderKey(parent), name: originalCasing(input, rawName) },
        },
        localResponse: true,
      };
    }
  }

  // ---- vision: describe / understand screen --------------------------------
  // Must run before generic screenshot routes so "what's on my screen" is not
  // treated as a dumb capture-only request.
  if (
    /^(?:what(?:'s| is) on my screen|what do you see(?: on (?:my|the) screen)?|describe (?:my|the|this) screen|look at (?:my|the) screen(?: and (?:tell me|describe).*)?|what(?:'s| is) (?:visible|showing) on (?:my|the) screen)$/.test(
      q,
    )
  ) {
    return {
      capabilityId: "screen.understand",
      arguments: { question: "Describe what is on this screen. Be concise." },
      localResponse: true,
    };
  }
  const visionQ = q.match(
    /^(?:look at (?:my|the) screen and |using (?:vision|the screenshot),?\s*)?(.+\?)$/,
  );
  if (
    visionQ &&
    /\b(screen|screenshot|this image|what (?:app|window|page)|can you see)\b/i.test(q) &&
    !/^(?:take|capture|grab|screenshot|snapshot)\b/.test(q)
  ) {
    return {
      capabilityId: "screen.understand",
      arguments: { question: visionQ[1].trim() },
      localResponse: true,
    };
  }
  // Explicit “describe this screenshot”
  if (
    /^(?:describe (?:this|the) (?:screenshot|image|capture)|what(?:'s| is) in (?:this|the) (?:screenshot|image))$/.test(
      q,
    )
  ) {
    return {
      capabilityId: "screen.understand",
      arguments: { question: "Describe this screenshot clearly." },
      localResponse: true,
    };
  }

  // ---- vision point: "point to the video" / "show me where X is" -------------
  const pointAt = q.match(
    /^(?:(?:can|could|would) you\s+|please\s+)?(?:point(?:\s+to|\s+at)?|show me where|show me|highlight)\s+(?:the\s+)?(.+?)(?:\s+please)?$/,
  );
  if (pointAt) {
    const spoken = pointAt[1].trim().replace(/[.!?]+$/, "");
    // "Show me Spotify" means bring Spotify forward, not draw a box around its
    // icon. When the phrase names a watched application, that application is
    // the answer — pointing at it on screen would require finding it on screen,
    // which is both unnecessary and frequently wrong.
    const namedApp = watchedAppNamed(spoken);
    if (namedApp) {
      return {
        capabilityId: "applications.focus_watched",
        arguments: namedApp.boundInstanceKey
          ? { instance_key: namedApp.boundInstanceKey }
          : {},
        localResponse: true,
      };
    }
    const target = resolveClickTarget(spoken) ?? spoken;
    if (target && target.length <= 80 && !/^https?:\/\//i.test(target)) {
      return {
        capabilityId: "screen.click_target",
        arguments: { target, click: false },
        localResponse: true,
      };
    }
  }

  // ---- vision click: "click the play button" / "press it" --------------------
  // Do not steal YouTube “click the second video” — those use ordinal media.
  // Bare “press it” / “click it” / “click play” after opening Spotify/YouTube.
  // "press play" names its target; "press it" does not. They are split because
  // only the second one may be refused.
  const namesPlay =
    /^(?:(?:can|could|would) you\s+|please\s+)?(?:click|press|tap)\s+(?:on\s+)?(?:play|the play(?: button)?)(?:\s+please)?$/.test(
      q,
    ) || /^(?:play it|hit play|press play)(?:\s+please)?$/.test(q);
  const pronounClick =
    /^(?:(?:can|could|would) you\s+|please\s+)?(?:click|press|tap)\s+(?:on\s+)?(?:it|that|this)(?:\s+please)?$/.test(
      q,
    );
  if (namesPlay || pronounClick) {
    // Previously this ended in `?? "play button"`. With nothing to refer back
    // to, that invented a target and clicked it — the worst possible answer to
    // "press it", because the click lands somewhere. A pronoun with no
    // referent is now refused so the conversation can ask which control.
    const target = namesPlay
      ? (resolveClickTarget("play") ?? "play button")
      : resolveClickTarget("it");
    if (!target) return null;
    return {
      capabilityId: "screen.click_target",
      arguments: { target, click: true },
      localResponse: true,
    };
  }
  const clickTarget = q.match(
    /^(?:(?:can|could|would) you\s+|please\s+)?(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+please)?$/,
  );
  if (clickTarget) {
    const spoken = clickTarget[1].trim().replace(/[.!?]+$/, "");
    // "press it" refers to the control from the previous turn — searching the
    // screen for the literal word "it" finds nothing.
    const target = resolveClickTarget(spoken) ?? "";
    // Nothing to refer back to — let conversation ask which control, rather
    // than sending a pronoun to the vision model.
    if (!target && spoken) return null;
    // Ordinal media picks are handled later / separately — skip if looks like “Nth video”.
    if (
      target &&
      target.length <= 80 &&
      !/\b(?:first|second|third|theird|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:video|one|result)\b/i.test(
        target,
      ) &&
      !/^https?:\/\//i.test(target)
    ) {
      return {
        capabilityId: "screen.click_target",
        arguments: { target },
        localResponse: true,
      };
    }
  }

  // ---- screenshots ---------------------------------------------------------
  // Deictic / watched-app captures first — “screenshot that app” is not the whole screen.
  const shotThat = q.match(
    /^(?:(?:can|could|would) you\s+|please\s+)?(?:take|capture|grab)?\s*(?:a\s+)?(?:screenshot|snapshot|screen\s*shot)\s+(?:of\s+)?(that|this|it|the app|that app|this app|the application|that application|this application|the window|that window|the browser|that browser)(?:\s+please)?$/,
  );
  if (shotThat || /^(?:screenshot|snapshot)\s+(?:that|this|it)(?:\s+(?:app|application|window|one))?$/.test(q)) {
    return {
      capabilityId: "screen.capture",
      arguments: {
        target: "application",
        // Engine resolves “that” → last opened / watched app.
        application_query: "that",
      },
      localResponse: true,
    };
  }

  if (/^(?:take|capture|grab)(?: a)? screenshot(?: of (?:my|the) screen)?(?: and show(?: it to)? me)?$/.test(q) || q === "screenshot" || q === "snapshot") {
    return {
      capabilityId: "screen.capture",
      arguments: { target: "active-display" },
      localResponse: true,
    };
  }
  // A specific monitor. Without this, "screenshot my second monitor" was sent
  // as application_query:"second monitor" and looked for an app by that name.
  const shotDisplay = q.match(
    /^(?:take|capture|grab)?\s*(?:a\s+)?screenshot\s+(?:of\s+)?(?:my\s+|the\s+)?(?:(first|second|third|1st|2nd|3rd|primary|main|left|right)\s+)?(?:monitor|display|screen)\s*(\d)?$/,
  );
  if (shotDisplay) {
    const word = shotDisplay[1] ?? "";
    const digit = shotDisplay[2] ?? "";
    const index =
      digit ||
      (/^(first|1st|primary|main|left)$/.test(word)
        ? "1"
        : /^(second|2nd|right)$/.test(word)
          ? "2"
          : /^(third|3rd)$/.test(word)
            ? "3"
            : "");
    // No ordinal at all → whichever display is active.
    if (!index) {
      return {
        capabilityId: "screen.capture",
        arguments: { target: "active-display" },
        localResponse: true,
      };
    }
    return {
      capabilityId: "screen.capture",
      // display_id is resolved against the live display list by the executor.
      arguments: { target: "display", display_id: index },
      localResponse: true,
    };
  }

  // Part of a screen — the useful case on an ultrawide, where a full capture is
  // 3840px of mostly empty desktop.
  const shotPortion = q.match(
    /^(?:take|capture|grab)?\s*(?:a\s+)?screenshot\s+(?:of\s+)?(?:the\s+)?(left|right|top|bottom|center|middle)\s*(half|third|side)?\s*(?:of\s+(?:my\s+|the\s+)?(?:monitor|display|screen)\s*(\d)?)?$/,
  );
  if (shotPortion) {
    const side = shotPortion[1];
    const unit = shotPortion[2] ?? "half";
    return {
      capabilityId: "screen.capture",
      arguments: {
        target: "portion",
        portion: `${side}-${unit === "side" ? "half" : unit}`,
        display_id: shotPortion[3] ?? null,
      },
      localResponse: true,
    };
  }

  const shotApp = q.match(
    /^(?:(?:can|could|would) you\s+|please\s+)?(?:take|capture|grab)?\s*(?:a\s+)?(?:screenshot|snapshot)\s+(?:of\s+)?(.+?)(?: and show(?: it to)? me)?$|^(?:screenshot|snapshot)\s+(.+)$/,
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

  // ---- create folder -------------------------------------------------------
  // Previously left to the model tool loop so it could answer follow-ups. In
  // practice a small local model often failed to pick the tool at all and just
  // described creating a folder. Session memory records the verified result
  // either way, so follow-ups still work — and now the folder is actually made.
  const mkdir = q.match(
    new RegExp(
      `^(?:(?:hey|ok|please|can you|could you|would you)\\s+)*(?:create|make|add)\\s+(?:a\\s+|an\\s+|new\\s+)*folder\\s+` +
        `(?:(?:called|named|titled)\\s+)?["']?(.+?)["']?\\s+` +
        `(?:on|in|to|under)\\s+(?:my\\s+|the\\s+)?${KNOWN_FOLDERS}(?:\\s+folder)?$`,
    ),
  );
  if (mkdir) {
    return {
      capabilityId: "filesystem.create_directory",
      arguments: {
        __known_parent: folderKey(mkdir[2]),
        // Matching happens on the lowercased query; the folder must keep the
        // capitalisation the user typed ("Reports", not "reports").
        name: originalCasing(input, mkdir[1].trim()),
      },
      localResponse: true,
    };
  }
  // Reverse order: "create a folder on my desktop called Reports".
  const mkdirAlt = q.match(
    new RegExp(
      `^(?:(?:hey|ok|please|can you|could you|would you)\\s+)*(?:create|make|add)\\s+(?:a\\s+|an\\s+|new\\s+)*folder\\s+` +
        `(?:on|in|to|under)\\s+(?:my\\s+|the\\s+)?${KNOWN_FOLDERS}(?:\\s+folder)?\\s+` +
        `(?:called|named|titled)\\s+["']?(.+?)["']?$`,
    ),
  );
  if (mkdirAlt) {
    return {
      capabilityId: "filesystem.create_directory",
      arguments: {
        __known_parent: folderKey(mkdirAlt[1]),
        name: originalCasing(input, mkdirAlt[2].trim()),
      },
      localResponse: true,
    };
  }

  // ---- create file ---------------------------------------------------------
  // Still routed through the model: file creation usually carries content that
  // the model has to compose, so there is no purely deterministic form.

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

  // ---- read / scrape a link (Browser) ---------------------------------------
  // Must run BEFORE open/search so “show me the thumbnail https://youtube…” is
  // never treated as applications.open("youtube").
  // ANY pasted http(s) link is fetched locally (web.fetch_page) before open/search.
  const urlInText =
    input.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0]?.replace(/[.,;:!?)]+$/, "") ??
    null;
  if (urlInText) {
    // Explicit "open this in browser" still opens — everything else scrapes.
    const wantsOpenOnly =
      /^(?:open|launch|go to|visit|browse)\b/.test(q) &&
      !/\b(image|images|thumbnail|thumb|picture|pic|preview|read|summarize|about|what|show|display|extract|get)\b/.test(
        q,
      );
    if (!wantsOpenOnly) {
      return {
        capabilityId: "web.fetch_page",
        arguments: { url: urlInText },
        localResponse: true,
      };
    }
  }

  // ---- web search -----------------------------------------------------------
  // Site-scoped search. Accepts "search youtube for X", "search on youtube for X".
  const ytSearch = q.match(
    /^search\s+(?:on\s+|in\s+)?(youtube|github)\s+for\s+(.+)$/,
  );
  if (ytSearch) {
    return {
      capabilityId: "web.search",
      arguments: {
        query: ytSearch[2].trim(),
        site: ytSearch[1] as "youtube" | "github",
      },
      localResponse: true,
    };
  }
  const webSearch = q.match(
    /^(?:search(?: the web)?(?: for)?|google|look up)\s+(.+)$/,
  );
  if (webSearch) {
    // Strip a leading preposition/site that isn't a real query — "search on
    // youtube" was producing the literal query "on youtube".
    const raw = webSearch[1]
      .trim()
      .replace(/^(?:on|in|at|for)\s+/, "")
      .replace(/^(?:youtube|github|google|bing)$/, "")
      .trim();
    // Nothing left to search for → let the engine ask instead of searching junk.
    if (raw.length > 1) {
      return {
        capabilityId: "web.search",
        arguments: { query: raw },
        localResponse: true,
      };
    }
    return null;
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
  // Tolerates natural framing ("can you create a task to ...", "remind me to
  // ...") so real requests reach tasks.create instead of falling through to
  // plain chat, where the model would only describe creating a task.
  const task = q.match(
    /^(?:(?:hey|ok|please|can you|could you|would you|will you|i want you to|i need you to|i'?d like you to)\s+)*(?:create|add|make)(?: a| an| another| new)*\s+task(?:\s+(?:to|called|titled|named|for|about|that says))?\s*:?\s*(.+)$/,
  );
  if (task) {
    const title = task[1].trim().replace(/^(?:for|to)\s+me\b\s*/, "").trim();
    if (title.length > 2) {
      return {
        capabilityId: "tasks.create",
        arguments: { title },
        localResponse: true,
      };
    }
  }
  // Title BEFORE the noun: "make a chicken task", "add a dentist task".
  // Without this these matched nothing, fell through to model tool-selection,
  // and were answered by tasks.complete → "I'm unable to find a task…".
  const taskSuffix = q.match(
    /^(?:(?:hey|ok|please|can you|could you|would you|will you|i want you to|i need you to)\s+)*(?:create|add|make)\s+(?:a|an|another|new)?\s*(.+?)\s+task(?:\s+for\s+me)?$/,
  );
  if (taskSuffix) {
    const title = taskSuffix[1].trim();
    if (title.length > 2) {
      return {
        capabilityId: "tasks.create",
        arguments: { title },
        localResponse: true,
      };
    }
  }

  const remind = q.match(/^(?:please\s+)?remind me to\s+(.+)$/);
  if (remind && remind[1].trim().length > 2) {
    return {
      capabilityId: "tasks.create",
      arguments: { title: remind[1].trim() },
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
  // Task queries, with the filter pulled out of the phrasing. Previously only
  // the two exact forms "show my tasks" / "show me urgent tasks" matched, so
  // "what are my urgent tasks" fell through to chat — where the model has no
  // task data and can only guess.
  const taskQuery = q.match(
    /^(?:(?:what(?:'s| is| are)?|which|how many|do i have any)\s+)?(?:are\s+)?(?:show|list|tell me)?\s*(?:me\s+)?(?:my\s+|the\s+)?(urgent|today(?:'s)?|upcoming|completed|done|open|all)?\s*tasks?(?:\s+(?:do i have|are (?:there|due)|due))?(?:\s+(?:today|now))?$/,
  );
  if (taskQuery) {
    const word = taskQuery[1] ?? "";
    const filter = /^urgent$/.test(word)
      ? "urgent"
      : /^today/.test(word)
        ? "today"
        : /^upcoming$/.test(word)
          ? "upcoming"
          : /^(completed|done)$/.test(word)
            ? "completed"
            : /^all$/.test(word)
              ? "all"
              : "open";
    return {
      capabilityId: "tasks.list",
      arguments: { filter },
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
  // Running-apps questions are handled by answerRunningAppsQuestion in
  // AssistantService (uses Dashboard watching + window titles). Do not route
  // them to a raw process dump — that loses watched context.
  if (
    /^(?:what apps are running|what(?:'s| is) (?:open|running)(?: right now)?|what am i (?:running|watching))$/.test(
      q,
    )
  ) {
    return null;
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

  // ---- play / pause the CURRENT video (Watch context) — NOT a list pick ----
  // “play the video” while YouTube is already watched means click Play on that
  // player. Only ordinal requests (“second video”) go to web.activate_listed_item.
  const transportVerb = q.match(
    /^(?:(?:can|could|would) you\s+|please\s+|i(?:'d| would)? like(?: you)? to\s+|i want(?: you)? to\s+)?(play|resume|unpause|pause|stop)\b/,
  );
  if (transportVerb) {
    const verb = transportVerb[1];
    const hasOrdinal =
      extractOrdinalFromPhrase(q) != null ||
      parseOrdinalMediaRequest(q) != null;
    // Bare transport or “play the video / it / that” — never ask for an index.
    const isCurrentPlayer =
      !hasOrdinal &&
      (/^(?:play|resume|unpause|pause|stop)(?:\s+(?:please|now))?$/.test(q) ||
        /^(?:play|resume|unpause|pause|stop)\s+(?:the\s+)?(?:video|clip|movie|media|player|it|that)(?:\s+(?:please|now))?$/.test(
          q,
        ) ||
        /^(?:play|resume|unpause|pause|stop)\s+(?:the\s+)?(?:watched|current)\s+(?:video|clip|media)(?:\s+(?:please|now))?$/.test(
          q,
        ));
    if (isCurrentPlayer) {
      const target =
        verb === "pause" || verb === "stop"
          ? "pause button"
          : "play button";
      return {
        capabilityId: "screen.click_target",
        arguments: { target },
        localResponse: true,
      };
    }
  }

  // ---- in-page media (“open the second video”) — BEFORE applications.open ----
  // Speech often mangles “third” → “theird”. Never treat these as app names.
  const ordinalVideo = parseOrdinalMediaRequest(q);
  if (ordinalVideo) {
    return {
      capabilityId: "web.activate_listed_item",
      arguments: {
        index: ordinalVideo.index,
        site: "youtube",
      },
      localResponse: true,
    };
  }

  // ---- open a folder on Desktop/Documents/… — NEVER applications.open --------
  // e.g. "open the avatar folder on my desktop"
  //      "open folder called avatar on my desktop"
  //      "open folder call avater it is in my desktop" (STT / broken English)
  const openFolder = q.match(
    new RegExp(
      `^(?:(?:can|could|would) you\\s+|please\\s+|i(?:'d| would)? like(?: you)? to\\s+|i want(?: you)? to\\s+)?` +
        `(?:open|show|reveal|launch)\\s+` +
        `(?:(?:the\\s+|a\\s+)?folder\\s+(?:called|named|titled|call)\\s+)?` +
        `(?:the\\s+)?` +
        `["']?([\\w .\\-]+?)["']?\\s*` +
        `(?:folder\\s+)?` +
        `(?:(?:which|that|it)\\s+(?:is\\s+)?)?(?:on|in|under)\\s+(?:my\\s+|the\\s+)?${KNOWN_FOLDERS}` +
        `(?:\\s+folder)?(?:\\s+please)?$`,
    ),
  );
  if (openFolder) {
    const rawName = (openFolder[1] ?? "")
      .replace(/^(?:folder|directory)\s+(?:called|named|titled|call)\s+/i, "")
      .replace(/^(?:called|named|titled|call)\s+/i, "")
      .replace(/\s+(?:folder|directory)$/i, "")
      .trim();
    const parent = openFolder[2];
    if (rawName && parent && rawName.length < 80) {
      return {
        capabilityId: "filesystem.open_item",
        arguments: {
          __known_subpath: {
            folder: folderKey(parent),
            name: originalCasing(input, rawName),
          },
        },
        localResponse: true,
      };
    }
  }

  // ---- open (apps / services / urls) — LAST so specific routes win -------------
  const open = q.match(
    /^(?:(?:(?:can|could|would) you|please|i(?:'d| would)? like(?: you)? to|i want(?: you)? to)\s+)?(?:open|launch|start|run)(?:\s+up)?\s+(.+)$/,
  );
  if (open) {
    const rawTarget = open[1].trim();
    // "folder called avatar on my desktop" without leading open-verb already stripped
    const folderInTarget = rawTarget.match(
      new RegExp(
        `^(?:(?:the\\s+|a\\s+)?folder\\s+(?:called|named|titled|call)\\s+)?(?:the\\s+)?` +
          `["']?([\\w .\\-]+?)["']?\\s*(?:folder\\s+)?` +
          `(?:(?:which|that|it)\\s+(?:is\\s+)?)?(?:on|in|under)\\s+(?:my\\s+|the\\s+)?${KNOWN_FOLDERS}` +
          `(?:\\s+folder)?$`,
      ),
    );
    if (folderInTarget) {
      const rawName = (folderInTarget[1] ?? "")
        .replace(/\s+(?:folder|directory)$/i, "")
        .trim();
      const parent = folderInTarget[2];
      if (rawName && parent) {
        return {
          capabilityId: "filesystem.open_item",
          arguments: {
            __known_subpath: {
              folder: folderKey(parent),
              name: originalCasing(input, rawName),
            },
          },
          localResponse: true,
        };
      }
    }
    const target = normalizeApplicationTarget(rawTarget);
    // “theird video”, “3rd video”, “the second one” → YouTube list pick.
    if (looksLikeMediaListPick(target) || looksLikeMediaListPick(rawTarget)) {
      const parsed =
        parseOrdinalMediaRequest(`open ${rawTarget}`) ??
        parseOrdinalMediaRequest(`open ${target}`) ??
        extractOrdinalFromPhrase(rawTarget) ??
        extractOrdinalFromPhrase(target);
      if (parsed) {
        return {
          capabilityId: "web.activate_listed_item",
          arguments: { index: parsed.index, site: "youtube" },
          localResponse: true,
        };
      }
    }
    // Any "* video" that isn't a known app name is almost never a desktop app.
    if (/\bvideos?\b/i.test(target) && !isKnownAppName(target)) {
      const parsed =
        extractOrdinalFromPhrase(target) ??
        extractOrdinalFromPhrase(rawTarget) ??
        parseOrdinalMediaRequest(`open ${target}`);
      if (parsed) {
        return {
          capabilityId: "web.activate_listed_item",
          arguments: { index: parsed.index, site: "youtube" },
          localResponse: true,
        };
      }
    }
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

/** Common STT mangling of ordinals (voice: “theird” ≈ third). */
const STT_ORDINAL_MAP: Record<string, number> = {
  first: 1,
  fist: 1,
  furst: 1,
  "1st": 1,
  "1": 1,
  second: 2,
  secund: 2,
  seccond: 2,
  "2nd": 2,
  "2": 2,
  third: 3,
  theird: 3,
  thrid: 3,
  thrird: 3,
  therd: 3,
  "3rd": 3,
  "3": 3,
  fourth: 4,
  forth: 4,
  "4th": 4,
  "4": 4,
  fifth: 5,
  fith: 5,
  "5th": 5,
  "5": 5,
  sixth: 6,
  "6th": 6,
  "6": 6,
  seventh: 7,
  "7th": 7,
  "7": 7,
  eighth: 8,
  eigth: 8,
  "8th": 8,
  "8": 8,
  ninth: 9,
  "9th": 9,
  "9": 9,
  tenth: 10,
  "10th": 10,
  "10": 10,
};

function softCorrectStt(text: string): string {
  return text.replace(
    /\b(theird|thrid|thrird|therd|seccond|secund|furst|fist|forth|fith|eigth)\b/g,
    (w) => {
      const n = STT_ORDINAL_MAP[w];
      if (n === 1) return "first";
      if (n === 2) return "second";
      if (n === 3) return "third";
      if (n === 4) return "fourth";
      if (n === 5) return "fifth";
      if (n === 8) return "eighth";
      return w;
    },
  );
}

/**
 * Token-based parser — avoids brittle regex that ate "rd" out of "third".
 * Handles STT: “theird video”, “i like to open the 3rd video”, “play video 3”.
 */
export function parseOrdinalMediaRequest(
  input: string,
): { index: number } | null {
  const q = softCorrectStt(normalize(input));

  // Must look like an open/play/watch request (or a bare “Nth video” fragment).
  const isAction =
    /^(?:(?:can|could|would) you\s+|please\s+|i(?:'d| would)? like(?: you)? to\s+|i want(?: you)? to\s+)?(?:open|play|click|select|watch|launch)\b/.test(
      q,
    ) ||
    /^(?:the\s+)?(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth)\s+(?:video|clip|one)\b/.test(
      q,
    );

  if (!isAction && !/\bvideo\b/.test(q)) return null;

  // “video 3” / “video number 3”
  const videoNum = q.match(/\bvideos?\s+(?:number\s+|#\s*)?(\d+)\b/);
  if (videoNum) {
    const index = ordinalToIndex(videoNum[1]);
    if (index) return { index };
  }

  // “the third video”, “3rd video”, “third one”
  const tokens = q.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^#/, "");
    const index = ordinalToIndex(tok);
    if (!index) continue;
    const next = tokens[i + 1] ?? "";
    const next2 = tokens[i + 2] ?? "";
    // third video | 3rd video | third one | 3 video
    if (/^(video|videos|clip|result|results|one)$/.test(next)) {
      return { index };
    }
    // the third video — already handled when tok is third and next is video
    // open the third — next is video after "the" skip
    if (tok === "the" || next === "the") continue;
    // “open 3 on youtube” rare; require media word nearby
    if (
      /^(video|videos|clip|one)$/.test(next2) &&
      /^(the|a|#)$/.test(next)
    ) {
      return { index };
    }
  }

  return extractOrdinalFromPhrase(q);
}

export function extractOrdinalFromPhrase(
  phrase: string,
): { index: number } | null {
  const p = softCorrectStt(normalize(phrase));
  const tokens = p.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^#/, "");
    const index = ordinalToIndex(tok);
    if (!index) continue;
    const next = tokens[i + 1] ?? "";
    if (/^(video|videos|clip|result|results|one)$/.test(next)) {
      return { index };
    }
  }
  const b = p.match(/\bvideos?\s+(?:number\s+|#\s*)?(\d+)\b/);
  if (b) {
    const index = ordinalToIndex(b[1]);
    if (index) return { index };
  }
  return null;
}

function ordinalToIndex(raw: string): number | null {
  const lower = raw.toLowerCase().trim();
  // Whole-token map first (never strip "rd" from "third").
  if (STT_ORDINAL_MAP[lower] != null) return STT_ORDINAL_MAP[lower];
  // Fuzzy STT for third/second/first before any suffix stripping.
  if (/^th[ei]?r?d$|^t[h]?ird$|^therd$|^theird$|^thrid$|^third$/.test(lower)) {
    return 3;
  }
  if (/^sec+o?n?d$|^s[ei]cond$|^second$/.test(lower)) return 2;
  if (/^f[iu]rst$|^first$/.test(lower)) return 1;
  // Numeric ordinals only: 1st, 2nd, 3rd, 4th, 12th…
  const numOrd = lower.match(/^(\d+)(?:st|nd|rd|th)?$/);
  if (numOrd) {
    const n = Number(numOrd[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 30) return n;
  }
  return null;
}

export function looksLikeMediaListPick(target: string): boolean {
  const t = softCorrectStt(normalize(target));
  if (extractOrdinalFromPhrase(t) != null && /\b(video|videos|clip|result|one)\b/.test(t)) {
    return true;
  }
  // Bare “video 3”
  if (/\bvideos?\s+(?:number\s+|#\s*)?\d+\b/.test(t)) return true;
  return false;
}

function isKnownAppName(target: string): boolean {
  const t = normalize(target);
  // Never treat “… video” as a desktop app name.
  if (/\bvideos?\b/.test(t)) return false;
  return /^(youtube|chrome|edge|firefox|spotify|discord|slack|zoom|teams|notepad|calculator|vscode|code)$/.test(
    t,
  );
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
  const out: string[] = [];
  for (const raw of normalize(text).split(" ")) {
    if (raw.length > 1 && !STOPWORDS.has(raw)) out.push(raw);
    // A dotted token is also its parts.
    //
    // `normalize` only strips trailing punctuation, so "youtube.com" stayed a
    // single token and matched neither the "youtube" keyword nor the "com"
    // one — "open youtube.com" retrieved no web tool at all, and the model was
    // left choosing between application and filesystem capabilities. The same
    // applies to "report.pdf" and any other dotted term.
    if (raw.includes(".")) {
      for (const part of raw.split(".")) {
        if (part.length > 1 && !STOPWORDS.has(part)) out.push(part);
      }
    }
  }
  return out;
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
  /**
   * Origin and live connector state, so chat and voice narrow the same way.
   * Omitted by tests and by callers that only want scoring; the default keeps
   * the previous behaviour of scoring everything available.
   */
  scope?: {
    origin: "chat" | "voice";
    connectedConnectors: ReadonlySet<IntegrationId>;
    /** Live watched applications, so retrieval narrows the same way voice does. */
    watchedApplications?: readonly WatchedApplication[];
  },
): RetrievalResult[] {
  const requestTokens = tokens(input);
  if (requestTokens.length === 0) return [];
  const pool = scope
    ? capabilitiesForOrigin(
        scope.origin,
        scope.connectedConnectors,
        scope.watchedApplications ?? [],
      )
    : // No scope means "score everything available" — used by tests and by
      // callers that only want ranking. Watched-application capabilities are
      // excluded, because offering one without a watched instance would hand
      // the model a tool with no instance_key to fill in.
      availableCapabilities().filter((c) => c.category !== "watched-app");
  const results: RetrievalResult[] = [];
  for (const cap of pool) {
    let score = 0;
    const keywordSet = new Set(cap.keywords.map((k) => k.toLowerCase()));
    for (const t of requestTokens) {
      if (keywordSet.has(t)) score += 3;
    }
    for (const alias of cap.aliases) {
      if (normalize(input).includes(normalize(alias))) score += 4;
    }
    // Two overlapping tokens keeps a single incidental word from matching every
    // example that mentions it. But a request whose content is one word can
    // never reach two — "What can YouTube do?" reduces to ["youtube"], so its
    // examples scored nothing and the capability-inventory tool never entered
    // the candidate list at all. The model was left choosing between searching
    // YouTube and listing a channel, for a question that asked neither.
    const minOverlap = requestTokens.length < 2 ? 1 : 2;
    for (const example of cap.intentExamples) {
      const exampleTokens = new Set(tokens(example));
      const overlap = requestTokens.filter((t) => exampleTokens.has(t)).length;
      if (overlap >= minOverlap) score += overlap * 2;
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
