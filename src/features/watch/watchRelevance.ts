/**
 * Whether a request should carry watched-application context at all.
 *
 * An active application is *available*, not *implied*. Before this gate,
 * activating Spotify put Spotify into every turn — "what's the weather?",
 * "create a task for tomorrow", "what time is it?" — because the scope existed,
 * so the block was injected. That is both noise and a disclosure: the watched
 * application's state travelled with questions that had nothing to do with it.
 *
 * The rule is the product rule, stated as five ways a turn can earn the
 * context. Anything else runs as an ordinary request.
 */
import { isDeictic, parseMediaIntent } from "./mediaIntent";
import type { ActiveWatchEntry } from "./watchScopeStore";

export type RelevanceReason =
  | "named-application"
  | "application-action"
  | "pronoun-continuation"
  | "current-activity"
  | "capability-question"
  | "topic-continuation";

export interface RelevanceVerdict {
  relevant: boolean;
  reason: RelevanceReason | null;
  /** Applications the turn is about. Empty when the turn is not about any. */
  applicationIds: string[];
}

/**
 * Questions about what an application is currently doing.
 *
 * Deliberately requires an application-ish object or an active scope to be
 * meaningful — "what's going on" is about the active application, "what's going
 * on in the world" is not, and the difference is the trailing phrase.
 */
const CURRENT_ACTIVITY =
  /^(?:so\s+)?(?:tell me\s+)?(?:what(?:'s| is)\s+(?:going on|happening|new|playing|up)|what\s+(?:am i|are we)\s+(?:doing|looking at)|catch me up|any(?:thing)?\s+new|what\s+do\s+you\s+see)\b/i;

/**
 * Phrases that take "what's going on" *out* of the application and into the
 * world. Without these, "what's going on in the world" would be answered from
 * Discord.
 */
const OUTWARD_SCOPE =
  /\b(?:in the world|in the news|with (?:the )?(?:weather|market|stock|economy)|globally|worldwide|today in|around the world|out there)\b/i;

/** Application-specific verbs that only make sense against a running app. */
const APPLICATION_ACTIONS = [
  /\b(?:focus|bring (?:it |them )?(?:to the )?front|switch to|show me)\b/i,
  // The nouns each adapted application answers about. Missing "video" meant
  // "what video is open" reached YouTube's adapter through no path at all,
  // which the application matrix caught on its first run.
  /\b(?:what (?:channel|server|workspace|file|page|tab|track|song|video|project|repo|branch|document|site))\b/i,
  /\b(?:run (?:the |this |it )?(?:task|build|code|project|app|application|server|tests?)|start (?:the )?deb(?:ug|ugger))\b/i,
  // The coordinated editor-and-browser case, which is the reason more than one
  // application can be active at all: "run this project, check the browser
  // output, fix the error" has to reach both.
  /\b(?:browser|editor|terminal|workspace|page)\s+(?:output|result|console|state|window|tab)\b/i,
  /\bfix (?:this|the|that) (?:error|bug|failure|crash|test|problem|issue)\b/i,
  // "errors here", "errors are here", "any errors in this workspace" — the
  // filler between the noun and the deictic varies, and requiring them adjacent
  // silently dropped the most natural phrasing.
  /\b(?:diagnostics|errors?(?:\s+\w+){0,2}\s+(?:here|in this)|what(?:'s| is) wrong (?:here|with this))\b/i,
];

/**
 * "What can you do?" asked while an application is active.
 *
 * This is a question about the current scope, not about ArcSonare in general:
 * having deliberately activated Spotify, the honest answer is Spotify's
 * abilities, not the global feature list. Requires an active application, like
 * every other rule here — with none active it never fires.
 */
const SCOPE_CAPABILITY =
  /\b(?:what can you (?:do|see|read|control)|what are you able to do|help me with (?:this|it)|what can i ask you)\b/i;

/** Requests that belong to ArcSonare itself and must never be intercepted. */
const NATIVE_INTENT =
  /\b(?:weather|forecast|temperature|what time|what(?:'s| is) the (?:date|time)|create (?:a )?task|add (?:a )?task|remind me|my (?:calendar|schedule|email|inbox|tasks?)|open (?:my |the )?(?:downloads?|documents?|desktop|pictures?|folder)|write (?:me )?an? (?:email|essay|poem)|explain|translate|summar(?:ise|ize) this (?:paragraph|text|article))\b/i;

/**
 * Decide whether this turn is about a watched application.
 *
 * `previousTurnApplicationIds` carries the applications the *last* turn used,
 * which is what makes "pause it" work after "play the current song" without
 * making it work after "what's the weather?".
 */
export function watchRelevance(input: {
  requestText: string;
  active: readonly ActiveWatchEntry[];
  /**
   * Applications that are only addressable when the user names them.
   *
   * These are in `active` so a named request can reach them and be told they
   * need activating, but they are not part of the conversation's scope. A
   * pronoun, a soft "what's going on", or an app-shaped verb must never pull
   * one in — that would make activation meaningless.
   */
  namedOnly?: ReadonlySet<string>;
  previousTurnApplicationIds?: readonly string[];
}): RelevanceVerdict {
  const text = input.requestText.trim();
  const none: RelevanceVerdict = {
    relevant: false,
    reason: null,
    applicationIds: [],
  };
  if (!text || input.active.length === 0) return none;

  const namedOnly = input.namedOnly ?? new Set<string>();
  // Everything the soft signals below may resolve to: the real active set.
  const allIds = input.active
    .map((e) => e.appCatalogId)
    .filter((id) => !namedOnly.has(id));

  // 1. The user named an application. Strongest signal, and it wins even over a
  //    native-intent phrase — "open Spotify" is about Spotify.
  const named = input.active.filter(
    (entry) =>
      new RegExp(`\\b${escapeRegex(entry.displayName)}\\b`, "i").test(text) ||
      new RegExp(`\\b${escapeRegex(entry.appCatalogId.replace(/-/g, " "))}\\b`, "i").test(
        text,
      ),
  );
  if (named.length > 0) {
    return {
      relevant: true,
      reason: "named-application",
      applicationIds: named.map((e) => e.appCatalogId),
    };
  }

  // 2. A request that belongs to ArcSonare itself. Checked before the softer
  //    signals so "create a task for tomorrow" cannot be captured by an active
  //    application that happens to be watched.
  if (NATIVE_INTENT.test(text)) return none;

  // Every signal below is a *soft* one, resolving to "whatever is active". With
  // nothing active there is nothing for them to mean, and letting them through
  // would have the effect the named-only rule exists to prevent.
  if (allIds.length === 0) return none;

  // 3. An application-specific action or a transport command.
  if (parseMediaIntent(text) !== null) {
    return { relevant: true, reason: "application-action", applicationIds: allIds };
  }
  if (APPLICATION_ACTIONS.some((pattern) => pattern.test(text))) {
    return { relevant: true, reason: "application-action", applicationIds: allIds };
  }

  // 4. "What's going on" — but only about the machine, not about the world.
  if (CURRENT_ACTIVITY.test(text) && !OUTWARD_SCOPE.test(text)) {
    return { relevant: true, reason: "current-activity", applicationIds: allIds };
  }

  // 5. "What can you do?" — answered from the active application's abilities.
  if (SCOPE_CAPABILITY.test(text)) {
    return { relevant: true, reason: "capability-question", applicationIds: allIds };
  }

  // 6. A bare pronoun continuing an application turn. Requires the previous
  //    turn to have used one — otherwise "pause it" after a weather question
  //    has nothing to refer to and should ask, not guess.
  const previous = input.previousTurnApplicationIds ?? [];
  if (previous.length > 0 && isDeicticContinuation(text)) {
    const stillActive = previous.filter((id) => allIds.includes(id));
    if (stillActive.length > 0) {
      return {
        relevant: true,
        reason: "pronoun-continuation",
        applicationIds: stillActive,
      };
    }
  }

  return none;
}

/** A short phrase that is mostly a pronoun — "it", "pause it", "that one". */
function isDeicticContinuation(text: string): boolean {
  const stripped = text
    .trim()
    .toLowerCase()
    .replace(/^(?:can you|could you|please|now)\s+/g, "")
    .replace(/[.!?]+$/, "");
  if (isDeictic(stripped)) return true;
  // A verb plus a pronoun: "pause it", "close that", "read this".
  return /^\w+\s+(?:it|that|this|them)$/.test(stripped);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
