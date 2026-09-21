/**
 * Reading a follow-up that answers a question the assistant asked.
 *
 * The deliberate split, and the reason this file executes nothing:
 *
 *   deterministic — "is this an answer, and to what?"
 *   model         — "then which tool, with which arguments?"
 *
 * A regex that opened a browser on "yes" would be hidden keyword execution: the
 * user could not see why it happened and no validation stood between the word
 * and the side effect. So this only *classifies*, and hands the resolved
 * pending action to the model as context. The model still has to ask for the
 * tool, and the executor still checks that what it asked for is what was
 * authorised.
 */

import {
  getPendingAction,
  getExpiredPendingAction,
  latestResultSet,
  resultByOrdinal,
  type PendingAction,
  type ResultItem,
  type ResultSet,
} from "./conversationContext";

export type ConfirmationKind =
  | "affirm"
  | "decline"
  | "ordinal"
  | "more"
  | "none";

const AFFIRM =
  /^(?:yes|yep|yeah|yup|sure|ok(?:ay)?|please(?: do)?|go ahead|do it|go for it|sounds good|alright|absolutely|of course|open it|open that|play it|let'?s do it|why not|confirm(?:ed)?|proceed|delete them|delete it|all of them|both)\b[.!]?$/i;

const DECLINE =
  /^(?:no|nope|nah|not now|later|don'?t(?: open(?: anything)?| bother| do it)?|do not(?: open(?: anything)?)?|no thanks|no thank you|cancel|cancel it|cancel that|stop|stop it|abort|never ?mind|skip it|leave it|leave them|leave that|forget it|maybe later|i'?m good)\b[.!]?$/i;

/**
 * People answer in more than one word: "Yes, go ahead." "Yes please."
 *
 * The patterns above are anchored to a single phrase, so anything after the
 * first one failed. "Yes, go ahead" typed at a confirmation classified as
 * `none`, fell through to fresh routing, and got "go ahead with what?" while
 * the deletion sat there unanswered. That was the whole of the reported bug.
 *
 * A chain is a sequence of these phrases and nothing else. That is what keeps
 * it safe: "yes, go ahead" is a chain of two affirmations, and "yes, delete the
 * other one instead" is not a chain at all — the second clause is an
 * instruction, so the message falls through to routing rather than approving
 * something the user has just changed their mind about.
 */
const SEPARATOR = String.raw`(?:[\s,;]+(?:and\s+|then\s+|please\s*)?)`;

function chainOf(phrase: string): RegExp {
  const body = phrase.replace(/^\^|\\b\[\.!\]\?\$$/g, "");
  return new RegExp(`^${body}(?:${SEPARATOR}${body})*[\\s.!]*$`, "i");
}

/** The phrase bodies, without their anchors, so they can be chained. */
const AFFIRM_BODY = AFFIRM.source.replace(/^\^/, "").replace(/\\b\[\.!\]\?\$$/, "");
const DECLINE_BODY = DECLINE.source.replace(/^\^/, "").replace(/\\b\[\.!\]\?\$$/, "");
const AFFIRM_CHAIN = chainOf(AFFIRM_BODY);
const DECLINE_CHAIN = chainOf(DECLINE_BODY);

/**
 * Does any clause decline?
 *
 * "No, go ahead" is contradictory, and the safe reading of a contradiction is
 * the one that does nothing. Checked before affirmation for that reason.
 */
function anyClauseDeclines(text: string): boolean {
  return text
    .split(/[,;]|\band\b|\bthen\b/i)
    .map((p) => p.trim().replace(/[.!]+$/, ""))
    .filter(Boolean)
    .some((part) => DECLINE.test(part) || DECLINE_CHAIN.test(part));
}

const MORE = /^(?:show me more|more results|more|another one|next one|others|what else)\b[.!?]?$/i;

/**
 * Both the ordinal and the cardinal forms.
 *
 * People say "number three" as readily as "the third one", and the cardinal
 * half was missing — so "show me number three" resolved to nothing at all.
 */
const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  last: -1,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "open the second one", "the 3rd", "play the first video" → 2, 3, 1. */
export function parseOrdinalReference(text: string): number | null {
  const n = normalize(text);
  if (!n) return null;
  // Guard against sentences that merely contain a number ("open 5 tabs").
  if (!/\b(?:one|video|result|item|link|channel|option)\b/.test(n) && !/^(?:open|play|show)\b/.test(n)) {
    return null;
  }
  // A bare cardinal is not a position — "another one" means one more, not
  // result #1. Cardinals only count when the user numbered something.
  const CARDINALS = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  ]);
  for (const [word, value] of Object.entries(ORDINAL_WORDS)) {
    if (!new RegExp(`\\b${word}\\b`).test(n)) continue;
    if (CARDINALS.has(word) && !new RegExp(`\\bnumber\\s+${word}\\b`).test(n)) continue;
    return value;
  }
  const digits = n.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (digits) {
    const value = Number(digits[1]);
    if (value >= 1 && value <= 30) return value;
  }
  return null;
}

export function classifyConfirmation(text: string): ConfirmationKind {
  const raw = text.trim();
  if (!raw) return "none";
  // Decline wins over affirm at every stage: a message containing a refusal is
  // a refusal, however much else it contains.
  if (anyClauseDeclines(raw)) return "decline";
  if (AFFIRM.test(raw) || AFFIRM_CHAIN.test(raw)) return "affirm";
  if (MORE.test(normalize(raw))) return "more";
  if (parseOrdinalReference(raw) !== null) return "ordinal";
  return "none";
}

export type FollowUpResolution =
  | { kind: "none" }
  /** A live pending action the model should be told about. */
  | { kind: "confirm"; action: PendingAction }
  | { kind: "decline"; action: PendingAction }
  /** The user named a position in the last result set. */
  | { kind: "ordinal"; set: ResultSet; item: ResultItem }
  /** They answered, but there is nothing to answer. */
  | { kind: "nothing-pending"; question: string }
  /** They answered, but the offer has gone stale. */
  | { kind: "expired"; action: PendingAction; question: string }
  | { kind: "more"; set: ResultSet | null };

/**
 * What the user's follow-up means, given what is actually on record.
 *
 * Never guesses: an affirmation with nothing pending returns a question, not a
 * best-effort action. That case is the one where a wrong guess opens something
 * the user never asked for.
 */
export function resolveFollowUp(text: string, now = Date.now()): FollowUpResolution {
  const kind = classifyConfirmation(text);
  if (kind === "none") return { kind: "none" };

  if (kind === "ordinal") {
    const ordinal = parseOrdinalReference(text);
    const set = latestResultSet(now);
    if (ordinal === null || !set) {
      return {
        kind: "nothing-pending",
        question: "I don't have a list open to pick from. What would you like me to find?",
      };
    }
    const index = ordinal === -1 ? set.items.length : ordinal;
    const hit = resultByOrdinal(index, now);
    if (!hit) {
      return {
        kind: "nothing-pending",
        question: `That list only has ${set.items.length} result${
          set.items.length === 1 ? "" : "s"
        }. Which one did you mean?`,
      };
    }
    return { kind: "ordinal", set: hit.set, item: hit.item };
  }

  if (kind === "more") {
    return { kind: "more", set: latestResultSet(now) };
  }

  const pending = getPendingAction(now);
  if (!pending) {
    const stale = getExpiredPendingAction(now);
    if (stale) {
      return {
        kind: "expired",
        action: stale,
        question:
          "That result isn't current any more. Want me to look it up again first?",
      };
    }
    return {
      kind: "nothing-pending",
      question: "What would you like me to continue with?",
    };
  }

  return kind === "affirm"
    ? { kind: "confirm", action: pending }
    : { kind: "decline", action: pending };
}
