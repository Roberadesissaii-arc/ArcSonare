/**
 * The last thing between a model's raw serialisation and the user's screen.
 *
 * DeepSeek intermittently writes a tool call into `content` instead of
 * `tool_calls`, and the tag varies between runs. `recoverTextEmbeddedCall`
 * catches the cases it can name an offered capability for, but it is
 * deliberately conservative: it will not turn arbitrary text into a tool call.
 * Whatever it declines still has to not be rendered — and it was. A Chrome
 * question came back as a chat bubble containing the raw DSML envelope and an
 * invoke tag, which is both meaningless to the user and a disclosure of
 * how the assistant is wired.
 *
 * So this is a guard, not a parser. It strips internal protocol from text about
 * to be shown and reports whether it had to. It deliberately does not execute
 * what it strips: text that reaches here has already failed to be recognised as
 * a call, and running it now would mean acting on a string no validation layer
 * ever approved.
 */

/** Tag names that are protocol, never prose. */
const TAGS = [
  "function_calls",
  "tool_calls",
  "toolcalls",
  "tool_call",
  "user_tool_call",
  "invoke",
  "parameter",
];

const TAG_ALTERNATION = TAGS.join("|");

/**
 * Protocol shapes seen in the wild, most specific first.
 *
 * Applied in sequence so a wrapper is removed after its contents, rather than
 * leaving an orphaned closing tag behind.
 */
const PROTOCOL_PATTERNS: RegExp[] = [
  // A paired block: opening tag, anything, matching close (or end of string,
  // because a truncated stream is exactly when this leaks).
  new RegExp(
    `<\\s*(?:antml:)?(?:${TAG_ALTERNATION})\\b[^>]*>[\\s\\S]*?(?:<\\s*/\\s*(?:antml:)?(?:${TAG_ALTERNATION})\\s*>|$)`,
    "gi",
  ),
  // A lone opening or closing tag with no partner.
  new RegExp(`<\\s*/?\\s*(?:antml:)?(?:${TAG_ALTERNATION})\\b[^>]*>`, "gi"),
  // `<|DSML|>...` in any of its fullwidth-pipe spellings, with or without a
  // closing marker.
  /[<＜]\s*[|｜]{1,2}\s*DSML[\s\S]*?(?:[|｜]{1,2}\s*[>＞]|$)/gi,
  // Any remaining `<| ... |>` control envelope.
  /[<＜]\s*[|｜]+[^>＞]{0,120}?[|｜]+\s*[>＞]/g,
  // A protocol keyword alone on its own line. The reported leak printed a bare
  // `toolcalls` line between the envelope and the tags. Anchored to the whole
  // line on purpose: "I can invoke the build task for you" is a sentence, and a
  // guard that ate it would be worse than the leak it prevents.
  new RegExp(`^[ \\t]*(?:${TAG_ALTERNATION})[ \\t]*$`, "gim"),
];

/** Cheap pre-check, so ordinary prose never touches the expensive patterns. */
const SUSPECT = new RegExp(`(?:${TAG_ALTERNATION})|DSML|[|｜]{2}`, "i");

export interface GuardResult {
  text: string;
  /** True when protocol was found and removed. */
  stripped: boolean;
}

/**
 * Remove internal protocol from user-visible text.
 *
 * Returns the cleaned text and whether anything was removed, so the caller can
 * substitute a real message rather than showing the user an empty bubble.
 */
export function stripToolProtocol(text: string): GuardResult {
  if (!text || !SUSPECT.test(text)) return { text, stripped: false };

  let out = text;
  for (const pattern of PROTOCOL_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, "");
  }
  // Collapse the whitespace the removals left behind.
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, stripped: out !== text };
}

/**
 * The text to show for a reply that was nothing but protocol.
 *
 * A turn whose entire visible output was a malformed call produced something,
 * it just could not be run. Saying so is honest; showing the markup is not, and
 * showing an empty bubble is worse than either.
 */
export const PROTOCOL_ONLY_FALLBACK =
  "I started an action but the response came back malformed, so nothing ran. Ask me again and I will retry it.";

/**
 * Guard a reply that is about to be shown.
 *
 * Logs identity only — the number of characters removed, never the removed
 * text, which can carry the user's own arguments.
 */
export function guardVisibleText(text: string): string {
  const result = stripToolProtocol(text);
  if (!result.stripped) return text;
  console.warn(
    `[ArcSonare] tool protocol suppressed from a visible reply (${text.length - result.text.length} chars)`,
  );
  return result.text.length > 0 ? result.text : PROTOCOL_ONLY_FALLBACK;
}
