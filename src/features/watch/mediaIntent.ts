/**
 * Media transport intent, resolved against the active Watch context.
 *
 * The defect this fixes: "play the current song" with Spotify watched and
 * active answered *"I couldn't find 'that' on the screen."* — because nothing
 * routed it to a media control, so the model reached for `screen.click_target`,
 * captured the screen, hunted for a UI element named by a pronoun, and failed.
 *
 * Playing, pausing, skipping and reading the current track are **media session
 * operations**. They do not require seeing anything. Routing them through
 * vision is wrong even when it happens to work: it captures the screen for a
 * command that needs no pixels, moves the cursor, and clicks whatever the model
 * believed was a play button.
 *
 * So transport verbs resolve here — deterministically, before any vision rule —
 * and the vision path is explicitly forbidden for them.
 */

/** What the user asked the player to do. */
export type MediaIntent =
  | "play"
  | "pause"
  | "resume"
  | "next"
  | "previous"
  | "stop"
  | "read-current";

/** Applications that own a media session and can answer a transport intent. */
export const MEDIA_APPLICATIONS = ["spotify", "youtube", "netflix"] as const;

export function isMediaApplication(appCatalogId: string): boolean {
  return (MEDIA_APPLICATIONS as readonly string[]).includes(appCatalogId);
}

/**
 * Words that mean "the thing we are already talking about".
 *
 * Listed rather than inferred because the failure was precisely that one of
 * these reached a visual locator as if it were the *name of a control*. A
 * pronoun has no appearance; it has a referent, and the referent lives in the
 * conversation's Watch scope.
 */
const DEICTIC =
  /^(?:it|that|this|the current one|current one|the song|this song|that song|the current song|the current track|the track|this track|that track|the music|the video|this video|that video|the media|the player)$/i;

export function isDeictic(phrase: string): boolean {
  return DEICTIC.test(phrase.trim().replace(/[.!?]+$/, ""));
}

const LEAD_IN =
  "(?:(?:hey|ok|okay)\\s+)?(?:(?:can|could|would|will)\\s+you\\s+)?(?:please\\s+)?(?:i(?:'d| would)?\\s+like(?:\\s+you)?\\s+to\\s+|i\\s+want(?:\\s+you)?\\s+to\\s+|go\\s+ahead\\s+and\\s+)?";
const TRAILER = "(?:\\s+(?:please|now|again|for\\s+me))*\\s*[.!?]*";

/** The object a transport verb may take, all of which mean "what's loaded". */
const OBJECT =
  "(?:\\s+(?:the|this|that|my)?\\s*(?:current|currently\\s+playing|playing|watched|active)?\\s*(?:song|track|music|video|clip|movie|media|player|playback|tune|it|that|this|one)?)?";

interface Pattern {
  intent: MediaIntent;
  regex: RegExp;
}

/**
 * Transport phrasings.
 *
 * Deliberately generous about the object and strict about the verb. "Play the
 * current song", "play it", "play", "resume the music", "hit play" all mean the
 * same operation on the same session; what must never be loose is the verb,
 * because "play chess" is not a transport command.
 */
const PATTERNS: Pattern[] = [
  {
    intent: "read-current",
    regex: new RegExp(
      `^${LEAD_IN}(?:what(?:'s| is)\\s+(?:this\\s+song|the\\s+song|playing|this|it)|what\\s+song\\s+is\\s+(?:this|playing|on)|what\\s+(?:track|music)\\s+is\\s+(?:this|playing)|who\\s+(?:sings|is\\s+singing)\\s+this|name\\s+(?:this|the)\\s+(?:song|track))${TRAILER}$`,
      "i",
    ),
  },
  {
    intent: "next",
    regex: new RegExp(
      `^${LEAD_IN}(?:next(?:\\s+(?:song|track|one|video))?|skip(?:\\s+(?:this|it|the)?\\s*(?:song|track|one|video)?)?|go\\s+to\\s+the\\s+next(?:\\s+(?:song|track|one|video))?|play\\s+the\\s+next(?:\\s+(?:song|track|one|video))?|forward)${TRAILER}$`,
      "i",
    ),
  },
  {
    intent: "previous",
    regex: new RegExp(
      `^${LEAD_IN}(?:previous(?:\\s+(?:song|track|one|video))?|prev|go\\s+back(?:\\s+(?:a|one)\\s+(?:song|track))?|go\\s+to\\s+the\\s+previous(?:\\s+(?:song|track|one|video))?|play\\s+the\\s+(?:previous|last)(?:\\s+(?:song|track|one|video))?|back\\s+(?:a|one)\\s+(?:song|track))${TRAILER}$`,
      "i",
    ),
  },
  {
    intent: "pause",
    regex: new RegExp(`^${LEAD_IN}(?:pause|hold\\s+on)${OBJECT}${TRAILER}$`, "i"),
  },
  {
    intent: "stop",
    regex: new RegExp(`^${LEAD_IN}(?:stop)${OBJECT}${TRAILER}$`, "i"),
  },
  {
    intent: "resume",
    regex: new RegExp(
      `^${LEAD_IN}(?:resume|unpause|un-pause|keep\\s+playing|continue)${OBJECT}${TRAILER}$`,
      "i",
    ),
  },
  {
    intent: "play",
    regex: new RegExp(
      `^${LEAD_IN}(?:play|start(?:\\s+playing)?|hit\\s+play|press\\s+play|put\\s+(?:it|this|that)\\s+on)${OBJECT}${TRAILER}$`,
      "i",
    ),
  },
];

/**
 * Phrases that look like transport verbs but name something to *find*.
 *
 * "Play the second video" is a list pick, not a transport command — it needs
 * the results list, not the media session. "Play some jazz" names content the
 * media session cannot search for.
 */
const NOT_TRANSPORT =
  /\b(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\b|\bsome\b|\bplaylist\b|\bby\s+\w+|\bsearch\b|\bfind\b/i;

/**
 * Parse a transport intent, or null when the text is not one.
 *
 * Returning null is the important half: everything that is *not* a transport
 * command must keep its existing routing, including "play the second video",
 * which is a list pick and genuinely needs the page.
 */
export function parseMediaIntent(text: string): MediaIntent | null {
  const q = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return null;
  if (NOT_TRANSPORT.test(q)) return null;
  for (const { intent, regex } of PATTERNS) {
    if (regex.test(q)) return intent;
  }
  return null;
}

/** The capability that performs one intent for a media application. */
export function capabilityForIntent(
  intent: MediaIntent,
  appCatalogId: string,
): string | null {
  // Only Spotify has a real transport adapter today. A browser-hosted player
  // has no media capability of its own, and saying so is better than routing
  // its transport request into a screen click.
  if (appCatalogId !== "spotify") return null;
  switch (intent) {
    case "play":
    case "resume":
      return "spotify.play";
    case "pause":
    case "stop":
      return "spotify.pause";
    case "next":
      return "spotify.next";
    case "previous":
      return "spotify.previous";
    case "read-current":
      return "spotify.get_playback";
  }
}

/**
 * Capabilities a transport intent must never reach.
 *
 * Enforced rather than discouraged. The model was offered `screen.click_target`
 * and used it, so removing the tool for these turns is the only reliable fix —
 * an instruction not to use a tool it can see is a suggestion.
 */
export const VISION_AND_CURSOR_CAPABILITIES: ReadonlySet<string> = new Set([
  "screen.click_target",
  "screen.capture",
  "screen.understand",
  "screen.record",
  "screen.list_capture_targets",
  "input.click_at",
  "input.type_text",
  "input.press_keys",
  "input.scroll",
  "annotations.point_at",
  "annotations.highlight",
]);

/** Human sentence for an intent that has no mechanism behind it. */
export function unsupportedMessage(displayName: string): string {
  return (
    `${displayName} is watched, but media control is not currently available. ` +
    `Open ${displayName} or enable Windows media controls, then try again.`
  );
}
