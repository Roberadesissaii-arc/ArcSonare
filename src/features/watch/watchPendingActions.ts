/**
 * Pending watched-application actions.
 *
 * Two problems this solves, and they pull in opposite directions:
 *
 *  1. "yes", "do it", "send it", "the second one" must resolve to the exact
 *     action that was proposed — not be re-derived from the words, which is how
 *     an approval for one thing authorises another.
 *  2. The same approval must not execute twice. Voice transports retry, the
 *     Realtime bridge treats an identical repeated call as the approval, and a
 *     user can say "yes" twice. A duplicate Discord message is not recoverable.
 *
 * So an action is *claimed* before it runs and its outcome is remembered. A
 * second approval for the same action resolves to the recorded outcome and
 * returns it again — the user hears the same confirmation, and nothing is sent
 * a second time.
 */

export type PendingActionStatus =
  | "awaiting-approval"
  | "executing"
  | "executed"
  | "declined"
  | "expired"
  | "invalidated";

export interface PendingWatchAction {
  id: string;
  capabilityId: string;
  /** Exactly the arguments that will be sent. Never re-derived at approval. */
  arguments: Record<string, unknown>;
  appCatalogId: string;
  instanceKey: string;
  /** One sentence naming what will happen, shown in the confirmation. */
  description: string;
  /** For "the second one" — the ordered options this action came from. */
  optionIndex?: number;
  conversationId?: string;
  external: boolean;
  status: PendingActionStatus;
  createdAt: number;
  /** Result summary once executed, replayed on a repeated approval. */
  outcomeSummary?: string;
}

/** How long an unapproved action stays offerable. */
const TTL_MS = 5 * 60 * 1000;
/** How long an executed action is remembered, to absorb replayed approvals. */
const MEMORY_MS = 30 * 60 * 1000;

const actions = new Map<string, PendingWatchAction>();
let counter = 0;

function prune(): void {
  const now = Date.now();
  for (const [id, action] of actions) {
    const age = now - action.createdAt;
    if (action.status === "executed" || action.status === "declined") {
      if (age > MEMORY_MS) actions.delete(id);
    } else if (age > TTL_MS) {
      action.status = "expired";
      if (age > MEMORY_MS) actions.delete(id);
    }
  }
}

export function proposeWatchAction(input: {
  capabilityId: string;
  arguments: Record<string, unknown>;
  appCatalogId: string;
  instanceKey: string;
  description: string;
  optionIndex?: number;
  conversationId?: string;
  external?: boolean;
}): PendingWatchAction {
  prune();
  const action: PendingWatchAction = {
    id: `wpa-${Date.now().toString(36)}-${(counter += 1).toString(36)}`,
    status: "awaiting-approval",
    createdAt: Date.now(),
    external: Boolean(input.external),
    ...input,
  };
  actions.set(action.id, action);
  return action;
}

/** Actions still awaiting approval, newest first. */
export function openWatchActions(
  conversationId?: string,
): PendingWatchAction[] {
  prune();
  return [...actions.values()]
    .filter((a) => a.status === "awaiting-approval")
    .filter((a) => !conversationId || a.conversationId === conversationId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Which action a follow-up refers to.
 *
 * Ordinals ("the second one") select among the options *of the newest
 * proposal*, not among unrelated pending actions — "the second one" after a
 * list of YouTube results means the second result, never the second thing
 * ArcSonare happens to be waiting on.
 */
export function resolveWatchFollowUp(
  text: string,
  conversationId?: string,
): PendingWatchAction | null {
  const open = openWatchActions(conversationId);
  if (open.length === 0) return null;

  const ordinal = parseOrdinal(text);
  if (ordinal !== null) {
    const byIndex = open.find((a) => a.optionIndex === ordinal);
    if (byIndex) return byIndex;
  }
  return isAffirmative(text) ? open[0] : null;
}

const AFFIRMATIVE =
  /^(?:\s*(?:yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|go for it|send it|run it|open (?:it|that)|confirm(?:ed)?|that one|approved?)\s*[.!]?\s*)+$/i;

const NEGATIVE =
  /^(?:\s*(?:no|nope|nah|not now|cancel|stop|never ?mind|don'?t|forget it)\s*[.!]?\s*)+$/i;

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(text.trim());
}

export function isNegative(text: string): boolean {
  return NEGATIVE.test(text.trim());
}

const ORDINALS: Record<string, number> = {
  first: 0,
  "1st": 0,
  one: 0,
  second: 1,
  "2nd": 1,
  two: 1,
  third: 2,
  "3rd": 2,
  three: 2,
  fourth: 3,
  "4th": 3,
  fifth: 4,
  "5th": 4,
  last: -1,
};

export function parseOrdinal(text: string): number | null {
  const lower = text.trim().toLowerCase();
  for (const [word, index] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return index;
  }
  const digits = lower.match(/\b(?:number\s*)?(\d{1,2})\b/);
  if (digits) {
    const n = Number(digits[1]);
    if (n >= 1 && n <= 20) return n - 1;
  }
  return null;
}

/**
 * Claim an action for execution.
 *
 * `{ replay: true }` means this approval was already honoured. The caller must
 * return `action.outcomeSummary` rather than executing — that is the guarantee
 * against a second Discord message from a repeated "yes".
 */
export function claimWatchAction(
  id: string,
):
  | { ok: true; action: PendingWatchAction }
  | { ok: false; reason: "unknown" | "expired" | "declined"; action?: PendingWatchAction }
  | { ok: false; reason: "replay"; action: PendingWatchAction } {
  prune();
  const action = actions.get(id);
  if (!action) return { ok: false, reason: "unknown" };
  if (action.status === "executed" || action.status === "executing") {
    return { ok: false, reason: "replay", action };
  }
  if (action.status === "declined") return { ok: false, reason: "declined", action };
  if (action.status === "expired" || action.status === "invalidated") {
    return { ok: false, reason: "expired", action };
  }
  action.status = "executing";
  return { ok: true, action };
}

export function settleWatchAction(id: string, outcomeSummary: string): void {
  const action = actions.get(id);
  if (!action) return;
  action.status = "executed";
  action.outcomeSummary = outcomeSummary;
}

/** Release a claim whose execution never happened, so it can be retried. */
export function releaseWatchAction(id: string): void {
  const action = actions.get(id);
  if (action?.status === "executing") action.status = "awaiting-approval";
}

export function declineWatchAction(id: string): void {
  const action = actions.get(id);
  if (action) action.status = "declined";
}

/**
 * Invalidate every action targeting an instance that changed.
 *
 * Called when a watched instance stops or rebinds. An approval given for
 * "#general in Testing" must not survive Discord moving to another channel —
 * the send capability re-checks too, but an invalidated action never gets that
 * far and the user is told why.
 */
export function invalidateActionsForInstance(instanceKey: string): number {
  let count = 0;
  for (const action of actions.values()) {
    if (
      action.instanceKey === instanceKey &&
      action.status === "awaiting-approval"
    ) {
      action.status = "invalidated";
      count += 1;
    }
  }
  return count;
}

export function getWatchAction(id: string): PendingWatchAction | null {
  return actions.get(id) ?? null;
}

/** Test seam. Never called in production. */
export function __resetWatchActions(): void {
  actions.clear();
  counter = 0;
}
