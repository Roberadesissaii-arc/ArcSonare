/**
 * What the conversation is currently about, as structure rather than prose.
 *
 * "Highlight it" is unanswerable from a transcript. The assistant's own sentence
 * — "I found the books folder on your Desktop" — is not a reference to anything;
 * re-parsing it to recover "books" is guesswork, and guessing wrong means
 * highlighting the wrong thing on someone's screen. So every successful tool
 * result deposits a typed entity here, and follow-ups resolve against those.
 *
 * Deliberately dependency-free. `capabilityRouter` imports the resolver, and the
 * routing suites run under plain Node where the app's asset imports cannot load
 * — the same constraint `clickTargetMemory` documents. Nothing here may import
 * a store, a component, or anything that reaches Vite.
 *
 * Scope: one ledger per (account, conversation). Switching either one starts a
 * fresh ledger, so a reference can never resolve to another user's file.
 */

/** What kind of thing an entity is, for compatibility with a requested action. */
export type EntityType =
  | "file"
  | "folder"
  | "desktop-item"
  | "task"
  | "application"
  | "window"
  | "document"
  | "search-result"
  | "visual-target"
  | "control";

/**
 * A thing the conversation can refer back to.
 *
 * `ref` is the identity an action should be re-issued against — a task id, a
 * Desktop item name, a path. It is deliberately *not* a coordinate: a visual
 * target's position is re-resolved at action time, because a remembered
 * rectangle is stale the moment anything moves. See `stale` handling in
 * `referenceResolver`.
 */
export interface ConversationEntity {
  /** Stable within this ledger. */
  id: string;
  type: EntityType;
  /** What a person would call it: "books", "Apply to Y Combinator". */
  label: string;
  /** The capability that produced it, e.g. "desktop.find_item". */
  sourceTool: string;
  /**
   * Index of the turn that FIRST produced it.
   *
   * Deliberately not refreshed when the same thing is acted on again: it is the
   * answer to "has the user been told about this?", and acting on the books
   * folder a second time does not un-tell them about it.
   */
  sourceTurn: number;
  timestamp: number;
  /** 0..1. Deterministic lookups are 1; a vision match is lower. */
  confidence: number;
  /**
   * How to act on it again. For a task this is the task id; for a Desktop item
   * the item name the structured lookup takes.
   */
  ref: string;
  /** Extra identity that does not belong in `ref` (path, pid, bounds source). */
  meta?: Record<string, string | number | boolean | null>;
}

export interface RecentTurn {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface ToolResultRecord {
  capabilityId: string;
  success: boolean;
  summary: string;
  entityIds: string[];
  timestamp: number;
}

/** An unanswered "which one did you mean?". */
export interface PendingClarification {
  /** The action the user asked for, so the answer can be applied to it. */
  requestedAction: string;
  candidates: ConversationEntity[];
  askedAt: number;
  question: string;
}

/**
 * Where the conversation currently "is".
 *
 * "Show me here" is not answerable from entities alone — "here" is a surface,
 * not a thing. Without this, a follow-up after a YouTube search fell back to
 * the Desktop reader and listed files, because the only context that existed
 * was Desktop-shaped.
 */
export interface InteractionSurface {
  /** "youtube", "browser", "desktop", "tasks" — where the last action landed. */
  kind: string;
  /** Human label: "YouTube". */
  label: string;
  /** The search that produced it, when there was one. */
  query?: string;
  /** Application or browser that hosts it. */
  application?: string;
  timestamp: number;
}


/**
 * An ordered set of results the assistant showed the user.
 *
 * Stored so "open the second one" resolves against what was actually shown,
 * without searching again and hoping the ordering repeats. The items carry
 * enough to act on — an id and a url — so a follow-up never has to match on a
 * title the user might have paraphrased.
 */
export interface ResultItem {
  id: string;
  ordinal: number;
  type: "video" | "channel" | "playlist" | "web-result" | "file";
  title: string;
  subtitle?: string;
  url?: string;
  thumbnail?: string;
  sourceId?: string;
}

export interface ResultSet {
  id: string;
  conversationId: string;
  source: "youtube" | "web" | "filesystem" | "application";
  query: string;
  createdAt: number;
  expiresAt: number;
  items: ResultItem[];
}

/**
 * An action the assistant offered and is waiting on an answer for.
 *
 * This is the thing whose absence broke multi-turn: the assistant asked "want
 * me to open the first video?", the recommendation existed only as rendered
 * chip data and as a sentence in the reply, and the next turn had no idea what
 * "yes" referred to. A question the assistant asked is state, not decoration.
 *
 * It stores the resolved capability and arguments, so "yes" continues *this*
 * action rather than re-deriving one from words.
 */
export interface PendingAction {
  id: string;
  conversationId: string;
  accountId: string;
  /** Turn index on which the assistant asked. */
  sourceTurn: number;
  actionType: string;
  capabilityId: string;
  args: Record<string, unknown>;
  entityRefs: string[];
  resultSetId?: string;
  resultItemId?: string;
  recommendationId?: string;
  /** The exact wording the user saw, so the follow-up can refer back to it. */
  promptShownToUser: string;
  createdAt: number;
  expiresAt: number;
  status:
    | "awaiting-confirmation"
    | "accepted"
    | "declined"
    | "expired"
    | "executed"
    | "cancelled";
}

/** What was offered, and how the user reacted — so it is not offered forever. */
export interface RecommendationHistoryEntry {
  recommendationId: string;
  actionType: string;
  capabilityId: string;
  entityRef?: string;
  turn: number;
  offeredCount: number;
  outcome: "offered" | "accepted" | "declined" | "ignored";
}

export interface ConversationContext {
  conversationId: string;
  accountId: string;
  recentTurns: RecentTurn[];
  recentEntities: ConversationEntity[];
  recentToolResults: ToolResultRecord[];
  lastSuccessfulAction: ToolResultRecord | null;
  pendingClarification: PendingClarification | null;
  /** Where the conversation currently is, for "here" / "there". */
  surface: InteractionSurface | null;
  /** Ordered result sets the user has been shown, newest last. */
  resultSets: ResultSet[];
  /** The single action awaiting a yes/no. Never more than one. */
  pendingAction: PendingAction | null;
  /** What has been recommended already, so it is not repeated endlessly. */
  recommendationHistory: RecommendationHistoryEntry[];
  /**
   * Turn on which the user's name was last used.
   *
   * -1 means never. Greeting someone by name every single turn reads like a
   * form letter — the prompt used to instruct the model to open with
   * "Hey <name>," on every styled reply, so two consecutive tool confirmations
   * both began that way.
   */
  lastUserNameMentionTurn: number;
}

/** How many of each kind to keep. Enough for follow-ups, not a transcript. */
const MAX_TURNS = 12;
const MAX_ENTITIES = 24;
const MAX_TOOL_RESULTS = 12;
const MAX_RESULT_SETS = 4;
const MAX_RECOMMENDATION_HISTORY = 20;

/**
 * How long an offered action stays answerable.
 *
 * Long enough to read a reply and think about it; short enough that "yes" ten
 * minutes later does not open a video from a search you have forgotten making.
 */
export const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

/** Results go stale — a list from an hour ago is not what "the second one" means. */
export const RESULT_SET_TTL_MS = 30 * 60 * 1000;

/**
 * How long an entity stays referable.
 *
 * Long enough to survive reading a reply and typing a follow-up; short enough
 * that "open it" an hour later does not act on something forgotten. Matches the
 * existing click-memory window so the two do not disagree.
 */
export const ENTITY_TTL_MS = 45 * 60 * 1000;

function emptyContext(conversationId: string, accountId: string): ConversationContext {
  return {
    conversationId,
    accountId,
    recentTurns: [],
    recentEntities: [],
    recentToolResults: [],
    lastSuccessfulAction: null,
    pendingClarification: null,
    surface: null,
    resultSets: [],
    pendingAction: null,
    recommendationHistory: [],
    lastUserNameMentionTurn: -1,
  };
}

let current: ConversationContext = emptyContext("default", "anonymous");
let turnCounter = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeConversationContext(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getConversationContext(): ConversationContext {
  return current;
}

/**
 * Point the ledger at a conversation and account.
 *
 * Changing either starts a fresh ledger. That is the isolation guarantee: an
 * entity recorded for one user can never be resolved by another, because the
 * list it lived in is gone rather than filtered.
 */
export function setConversationScope(conversationId: string, accountId: string): void {
  if (current.conversationId === conversationId && current.accountId === accountId) return;
  current = emptyContext(conversationId, accountId);
  turnCounter = 0;
  // Point the watch scope at the same conversation. Watch context is
  // conversation-scoped, and a composer showing the previous chat's watched
  // application would attach it to the next message.
  void import("../watch/watchScopeStore").then(({ setCurrentConversation }) => {
    setCurrentConversation(conversationId);
  });
  emit();
}

/** The conversation the ledger — and the watch scope — is pointed at. */
export function currentConversationId(): string {
  return current.conversationId;
}

/** Discard everything. Used on sign-out. */
export function clearConversationContext(): void {
  current = emptyContext(current.conversationId, current.accountId);
  turnCounter = 0;
  emit();
}

export function recordTurn(role: "user" | "assistant", text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return turnCounter;
  turnCounter += 1;
  current = {
    ...current,
    recentTurns: [
      ...current.recentTurns,
      { role, text: trimmed, timestamp: Date.now() },
    ].slice(-MAX_TURNS),
  };
  emit();
  return turnCounter;
}

export function currentTurn(): number {
  return turnCounter;
}

/**
 * Remember something a tool actually found or created.
 *
 * Only ever called from a *successful* result — a folder that was not found is
 * not something "it" can mean. Re-recording the same `ref` and `type` refreshes
 * the existing entity rather than stacking duplicates, so asking twice about the
 * same folder does not make it ambiguous with itself.
 */
export function rememberEntity(
  entity: Omit<ConversationEntity, "id" | "timestamp" | "sourceTurn"> &
    Partial<Pick<ConversationEntity, "id" | "timestamp" | "sourceTurn">>,
): ConversationEntity {
  const now = entity.timestamp ?? Date.now();
  const existing = current.recentEntities.find(
    (e) => e.type === entity.type && e.ref === entity.ref,
  );
  const record: ConversationEntity = {
    id: existing?.id ?? `ent-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type: entity.type,
    label: entity.label,
    sourceTool: entity.sourceTool,
    // First sighting wins. Refreshing this on every re-record was why
    // "highlight it" still opened with "I found the books folder" — the entity
    // looked brand new again on the very turn that was following up on it.
    sourceTurn: entity.sourceTurn ?? existing?.sourceTurn ?? turnCounter,
    timestamp: now,
    confidence: entity.confidence,
    ref: entity.ref,
    meta: entity.meta,
  };
  const others = current.recentEntities.filter((e) => e.id !== record.id);
  current = {
    ...current,
    // Newest last, so recency is the tail.
    recentEntities: [...others, record].slice(-MAX_ENTITIES),
  };
  emit();
  return record;
}

export function rememberToolResult(record: Omit<ToolResultRecord, "timestamp">): void {
  const full: ToolResultRecord = { ...record, timestamp: Date.now() };
  current = {
    ...current,
    recentToolResults: [...current.recentToolResults, full].slice(-MAX_TOOL_RESULTS),
    lastSuccessfulAction: record.success ? full : current.lastSuccessfulAction,
  };
  emit();
}

/** Entities still young enough to be referred to, newest first. */
export function referableEntities(now = Date.now()): ConversationEntity[] {
  return current.recentEntities
    .filter((e) => now - e.timestamp <= ENTITY_TTL_MS)
    .slice()
    .reverse();
}

/** How many turns must pass before the user's name may be used again. */
const NAME_COOLDOWN_TURNS = 6;

/**
 * May this reply address the user by name?
 *
 * True on the first assistant turn of a conversation, and then only after a
 * cooldown. Never on consecutive replies, which is the specific complaint:
 * "Hey Robera, found it…" immediately followed by "Hey Robera, I found the
 * books folder, but…".
 */
export function shouldUseUserName(): boolean {
  const last = current.lastUserNameMentionTurn;
  if (last < 0) return true;
  return turnCounter - last >= NAME_COOLDOWN_TURNS;
}

/** Record that a reply used the name, starting the cooldown. */
export function noteUserNameUsed(): void {
  current = { ...current, lastUserNameMentionTurn: turnCounter };
  emit();
}

export function setInteractionSurface(surface: Omit<InteractionSurface, "timestamp">): void {
  current = { ...current, surface: { ...surface, timestamp: Date.now() } };
  emit();
}

export function getInteractionSurface(): InteractionSurface | null {
  return current.surface;
}

/**
 * Has this entity already been announced to the user?
 *
 * Lets a follow-up say "It's highlighted now" instead of "I found the books
 * folder and highlighted it" — the finding happened a turn ago and the user
 * was already told.
 */
export function wasEntityAlreadyDiscussed(ref: string): boolean {
  const entity = current.recentEntities.find((e) => e.ref === ref);
  if (!entity) return false;
  return entity.sourceTurn < turnCounter;
}

export function setPendingClarification(pending: PendingClarification | null): void {
  current = { ...current, pendingClarification: pending };
  emit();
}

export function getPendingClarification(): PendingClarification | null {
  return current.pendingClarification;
}

/** Test-only: reset module state so cases cannot leak into each other. */
export function resetConversationContextForTest(): void {
  current = emptyContext("test-conversation", "test-account");
  turnCounter = 0;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Result sets
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Remove repeats by provider id, first occurrence wins.
 *
 * Deterministic on purpose: "keep the first" is a rule the user can predict
 * from what they were shown. Items with no source id are all kept — there is
 * nothing to compare them on, and dropping them would silently shorten a list.
 */
function dedupeBySourceId<T extends { sourceId?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.sourceId) return true;
    if (seen.has(item.sourceId)) return false;
    seen.add(item.sourceId);
    return true;
  });
}

/**
 * Record what the user was shown, in the order they saw it.
 *
 * Returned rather than voided so the caller can bind a pending action to a
 * specific item without a second lookup.
 */
export function rememberResultSet(input: {
  source: ResultSet["source"];
  query: string;
  items: Array<Omit<ResultItem, "id" | "ordinal"> & { id?: string }>;
  ttlMs?: number;
}): ResultSet {
  const now = Date.now();
  const set: ResultSet = {
    id: nextId("rs"),
    conversationId: current.conversationId,
    source: input.source,
    query: input.query,
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? RESULT_SET_TTL_MS),
    // Deduplicate on the provider's own id, keeping the first occurrence, then
    // number what survives. A search can legitimately return the same video
    // twice; showing it twice makes "open the second one" mean two different
    // things depending on whether the user counted the duplicate.
    items: dedupeBySourceId(input.items).map((item, index) => ({
      ...item,
      id: item.id ?? nextId("ri"),
      ordinal: index + 1,
    })),
  };
  current = {
    ...current,
    resultSets: [...current.resultSets, set].slice(-MAX_RESULT_SETS),
  };
  emit();
  return set;
}

/** The newest result set that has not expired, or null. */
export function latestResultSet(now = Date.now()): ResultSet | null {
  for (let i = current.resultSets.length - 1; i >= 0; i -= 1) {
    const set = current.resultSets[i];
    if (set.expiresAt > now) return set;
  }
  return null;
}

export function getResultSet(id: string): ResultSet | null {
  return current.resultSets.find((s) => s.id === id) ?? null;
}

/** Resolve "the second one" against what was actually shown. */
export function resultByOrdinal(ordinal: number, now = Date.now()): {
  set: ResultSet;
  item: ResultItem;
} | null {
  const set = latestResultSet(now);
  const item = set?.items.find((i) => i.ordinal === ordinal);
  return set && item ? { set, item } : null;
}

// ---------------------------------------------------------------------------
// Pending actions
// ---------------------------------------------------------------------------

/**
 * Record that the assistant asked, and is waiting.
 *
 * Only one may be outstanding: two live questions make "yes" ambiguous, and an
 * ambiguous "yes" is exactly the case that must ask rather than guess.
 */
export function setPendingAction(
  input: Omit<
    PendingAction,
    "id" | "conversationId" | "accountId" | "createdAt" | "expiresAt" | "status" | "sourceTurn"
  > & { ttlMs?: number },
): PendingAction {
  const now = Date.now();
  const action: PendingAction = {
    ...input,
    id: nextId("pa"),
    conversationId: current.conversationId,
    accountId: current.accountId,
    sourceTurn: turnCounter,
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? PENDING_ACTION_TTL_MS),
    status: "awaiting-confirmation",
  };
  current = { ...current, pendingAction: action };
  emit();
  return action;
}

/**
 * The outstanding action, if there is one that is still answerable.
 *
 * Expiry and account scope are enforced on read, not on a timer: a timer that
 * has not fired yet would let a stale action through, and this is the gate that
 * decides whether something opens on the user's screen.
 */
export function getPendingAction(now = Date.now()): PendingAction | null {
  const action = current.pendingAction;
  if (!action) return null;
  if (action.status !== "awaiting-confirmation") return null;
  if (action.accountId !== current.accountId) return null;
  if (action.conversationId !== current.conversationId) return null;
  if (action.expiresAt <= now) return null;
  return action;
}

/** Present but no longer usable — the caller offers to refresh rather than act. */
export function getExpiredPendingAction(now = Date.now()): PendingAction | null {
  const action = current.pendingAction;
  if (!action || action.status !== "awaiting-confirmation") return null;
  if (action.accountId !== current.accountId) return null;
  return action.expiresAt <= now ? action : null;
}

/**
 * Move a pending action to a terminal state.
 *
 * Returns false when the transition is not allowed — which is how exactly-once
 * is enforced: a replayed confirmation finds the action already `executed` and
 * is refused rather than running a second time.
 */
export function resolvePendingAction(
  id: string,
  status: Extract<
    PendingAction["status"],
    "accepted" | "declined" | "executed" | "cancelled" | "expired"
  >,
): boolean {
  const action = current.pendingAction;
  if (!action || action.id !== id) return false;
  // Only a live action can transition. Anything already executed, declined or
  // expired refuses — which is exactly how a replayed confirmation is stopped
  // from running the action a second time.
  if (action.status !== "awaiting-confirmation" && action.status !== "accepted") {
    return false;
  }
  current = { ...current, pendingAction: { ...action, status } };
  emit();
  return true;
}

export function clearPendingAction(): void {
  if (!current.pendingAction) return;
  current = { ...current, pendingAction: null };
  emit();
}

// ---------------------------------------------------------------------------
// Recommendation history
// ---------------------------------------------------------------------------

/** How many times this recommendation has already been put in front of the user. */
export function recommendationOfferCount(actionType: string, entityRef?: string): number {
  return current.recommendationHistory
    .filter((r) => r.actionType === actionType && r.entityRef === entityRef)
    .reduce((sum, r) => sum + r.offeredCount, 0);
}

export function noteRecommendationOffered(input: {
  recommendationId: string;
  actionType: string;
  capabilityId: string;
  entityRef?: string;
}): void {
  const existing = current.recommendationHistory.find(
    (r) => r.actionType === input.actionType && r.entityRef === input.entityRef,
  );
  const history = existing
    ? current.recommendationHistory.map((r) =>
        r === existing ? { ...r, offeredCount: r.offeredCount + 1, turn: turnCounter } : r,
      )
    : [
        ...current.recommendationHistory,
        { ...input, turn: turnCounter, offeredCount: 1, outcome: "offered" as const },
      ];
  current = {
    ...current,
    recommendationHistory: history.slice(-MAX_RECOMMENDATION_HISTORY),
  };
  emit();
}

export function noteRecommendationOutcome(
  recommendationId: string,
  outcome: RecommendationHistoryEntry["outcome"],
): void {
  current = {
    ...current,
    recommendationHistory: current.recommendationHistory.map((r) =>
      r.recommendationId === recommendationId ? { ...r, outcome } : r,
    ),
  };
  emit();
}

export function getRecommendationHistory(): RecommendationHistoryEntry[] {
  return current.recommendationHistory;
}
