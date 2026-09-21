/**
 * Capability engine orchestrator.
 *
 *   user request → deterministic router → capability retrieval → model tool
 *   selection (only when necessary) → validation → risk/confirmation policy →
 *   native execution → verification → structured ToolResult → audit → reply.
 *
 * Voice and chat share this single engine; a model sentence is never treated
 * as an executed action.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCapability } from "./capabilityRegistry";
import {
  capabilitiesForWatchContext,
  narrowForWatchScope,
} from "../watch/watchCapabilityGate";
import type { WatchedApplication } from "../watch/watchTypes";
import { recordCapabilityCall } from "../watch/watchProvenance";
import type { CapabilityDefinition } from "./capabilityTypes";
import {
  retrieveCapabilities,
} from "./capabilityRouter";
import { validateArguments } from "./capabilitySchemas";
import { describeBatch, findDeletionBatch, type DeletionBatch } from "./deletionBatch";
import { requiresApproval } from "./permissionPolicy";
import { modifyRedirectMessage, shouldRedirectToModify } from "./modifyIntent";
import {
  approvePendingAction,
  cancelPendingAction,
  claimPendingAction,
  openPendingAction,
  settlePendingAction,
} from "./approvalGrant";
import {
  composeResponse,
  composeSpokenResponse,
} from "./capabilityResponseComposer";
import { needsSearchQuery, needsTaskTitle } from "./clarifyGuards";
import {
  deepSeekAdapter,
  compactToolResult,
  toToolName,
  type ChatTurn,
  type ProviderToolAdapter,
} from "./providerToolAdapter";
import {
  executeFrontendCapability,
  describeTaskDelete,
} from "./frontendExecutors";
import {
  toToolResult as actionResultToToolResult,
  isPlannedCapability,
  isVisualCapability,
  planAndDispatchAction,
  type VisualExecutionRequest,
} from "./plannerBridge";
import {
  advanceVisualPlan,
  beginVisualPlan,
  completionFromToolResult,
  finishVisualPlan,
} from "./visualPlanLifecycle";
import {
  finishRun,
  getRun,
  patchRun,
  startRun,
} from "./capabilityRunStore";
import { judgeFinalText } from "./finalTextJudge";
import {
  claimFactsFor,
  enforceConnectorClaims,
  type ConnectorClaimFacts,
} from "./connectorClaims";
import { repairTurns, ToolTurn, validateTurns } from "./toolTurn";
import {
  completeExecutionTrace,
  recordExecutionTrace,
  recordResponseProvenance,
  type ExecutionTraceEntry,
} from "./executionTrace";
import {
  getAliasPreference,
  recordAliasFailure,
  recordAliasSuccess,
  recordCapabilitySuccess,
  forgetAlias,
} from "./capabilityMemory";
import {
  formatSessionActionContext,
  getRecentSessionActions,
  recordSessionAction,
} from "./actionSessionMemory";
import type {
  CapabilityConfirmation,
  CapabilityRun,
  ParsedToolCall,
  ToolResult,
} from "./capabilityTypes";
import { addActivity } from "../../stores/appStore";
import { getPrefs } from "../../stores/settingsStore";
import { getAssistantRoute } from "../../services/AssistantService";
import { describeProviderError } from "../../services/providerErrors";

/** Strip internal tool ids so users never see system.get_local_datetime etc. */
function sanitizeUserFacingText(text: string): string {
  return text
    // Providers sometimes emit a tool call as *text* instead of in the
    // tool_calls field — DeepSeek does it with `<｜｜DSML｜｜tool_calls>` markup.
    // Observed in evaluation: the model chose the right tool and the app would
    // have shown the user its raw control tokens. No tool ran, so there is
    // nothing here worth keeping.
    .replace(/<[｜|]{1,2}[^>]*?[｜|]{1,2}[^>]*>/g, " ")
    // The tag name varies by provider and build — DSML one run,
    // `<user_tool_call>` the next — so match the concept, not a fixed string.
    .replace(/<\/?[^>]*tool[_-]?calls?[^>]*>/gi, " ")
    .replace(/<\/?(?:invoke|parameter|function_calls?)\b[^>]*>/gi, " ")
    .replace(/\b[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*\b/gi, "the system")
    .replace(/\b(I will call|calling|call(?:ed)?)\s+the system\b/gi, "I'll check")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isTimeOrDateQuestion(text: string): boolean {
  const q = text.trim().toLowerCase();
  return (
    /\b(what(?:'s| is) the (?:current )?time|what time is it|current time)\b/.test(q) ||
    /\b(what(?:'s| is) (?:the )?(?:current )?date|what day is it|today(?:'s date)?)\b/.test(q) ||
    /\b(timezone)\b/.test(q)
  );
}

/**
 * The scope constraint for a result that talks about a connector.
 *
 * Returns null for everything else, so the guard costs nothing on the ordinary
 * path and cannot mangle a reply that is not about access levels.
 */
async function connectorClaimsFor(
  result: ToolResult,
): Promise<ConnectorClaimFacts | null> {
  const id = result.capabilityId;
  if (id !== "connections.get_status" && id !== "connections.list") return null;
  const data = (result.data ?? {}) as {
    service?: string | null;
    connected?: Array<{ accessLevel?: string; unavailable?: string[] }>;
  };
  try {
    if (id === "connections.list" && Array.isArray(data.connected)) {
      // A listing describes several connectors; the strictest one binds, since
      // one over-claim in a sentence is still an over-claim.
      const publicOnly = data.connected.some((c) => /public/i.test(c.accessLevel ?? ""));
      const limited = data.connected.some(
        (c) => (c.unavailable?.length ?? 0) > 0 || /read-only|public|limited/i.test(c.accessLevel ?? ""),
      );
      return { accessLevel: "mixed", publicOnly, limited };
    }
    if (data.service) {
      const { connectorProfile } = await import("./connectorRegistry");
      const profile = connectorProfile(data.service as never);
      return claimFactsFor(profile);
    }
  } catch {
    // A missing profile must not block the reply; the fact check still applies.
  }
  return null;
}

const MAX_TOOL_STEPS = 5;
const MAX_TOOL_STEPS_COMPLEX = 8;

export interface EngineOutcome {
  /** False → the request is conversation, not an action; caller uses chat. */
  handled: boolean;
  run?: CapabilityRun;
  responseText?: string;
  spokenText?: string;
  result?: ToolResult;
  /** Present when the run paused for user approval / disambiguation. */
  pendingConfirmation?: CapabilityConfirmation;
  /**
   * Where `responseText` came from. Absent means the caller still owns
   * presentation; MODEL_GENERATED means the sentence is already the answer and
   * must not be re-templated downstream.
   */
  responseSource?: "MODEL_GENERATED" | "DETERMINISTIC_FALLBACK";
}

export interface EngineOptions {
  origin: "chat" | "voice";
  conversationId?: string;
  voiceSessionId?: string;
  /** Progress callback for UI status lines ("Opening Spotify..."). */
  onProgress?: (message: string, capabilityId?: string) => void;
}

// Pending continuations for confirmation round-trips, keyed by run id.
//
// This map holds the part of a paused action that *cannot* cross a window: the
// provider turns, the adapter, the closure that resumes them. The decision —
// whether a question is open, what the user answered, and that the answer is
// spent once — lives in Rust (`approvalGrant.ts`), because `main` and
// `sonare-overlay` are separate WebView2 heaps and each would otherwise keep
// its own copy of this map and disagree with the other.
interface PendingExecution {
  capabilityId: string;
  args: Record<string, unknown>;
  token?: string;
  /** The Rust-owned pending action this continuation belongs to. */
  actionId?: string;
  request: string;
  options: EngineOptions;
  /** Resume data for a paused model loop. */
  modelLoop?: {
    adapter: ProviderToolAdapter | null;
    model: string;
    turns: ChatTurn[];
    toolNames: string[];
    stepsUsed: number;
    /** Provider completion id of the response that produced the pending call. */
    lastResponseId?: string;
    /** Counted for the developer provenance trace. */
    providerCalls: number;
    toolExecutions: number;
  };
  /** Ambiguity candidates (choose-one) instead of an approve/deny. */
  candidates?: Array<{ id?: string; label: string }>;
  /**
   * Several enumerated items approved by one answer.
   *
   * Present only when the assistant turn asked for the same always-confirm
   * capability on two or more distinct targets. The user saw every row, so
   * approving runs every row — and only those rows.
   */
  batch?: DeletionBatch;
}

const pendingByRun = new Map<string, PendingExecution>();

/**
 * Runs whose enumerated batch the user has already approved.
 *
 * Without this the model's next turn — which re-issues the same calls after
 * being told they were approved — would be detected as a fresh batch and ask
 * again, which is the bug in a different costume.
 */
const batchApproved = new Set<string>();

/**
 * The run currently waiting on a yes or no, per conversation.
 *
 * Confirmations and offers were two unrelated mechanisms. `PendingAction` is
 * something the assistant *suggested* and "yes" resolves; a pending
 * confirmation is something it is *blocked on* and had no conversational
 * resolver at all — `resolvePendingConfirmation` was reachable only from the
 * voice overlay's buttons. So chat could display "Want me to go ahead?", the
 * user could answer "Yes, go ahead", and the reply was "go ahead with what? I
 * don't have a pending request on my end", with the run left hanging.
 *
 * Keyed by conversation so an answer cannot resolve a confirmation raised in a
 * different one, and timestamped so a stale question is re-asked rather than
 * silently acted on.
 */
const AWAITING_TTL_MS = 5 * 60 * 1000;
const awaitingConfirmation = new Map<
  string,
  { runId: string; origin: EngineOptions["origin"]; at: number; title: string }
>();

function conversationKey(options: EngineOptions): string {
  return options.conversationId ?? options.voiceSessionId ?? `origin:${options.origin}`;
}

/** Remember that this run is blocked on the user, so a "yes" can find it. */
function markAwaitingConfirmation(
  runId: string,
  options: EngineOptions,
  title: string,
): void {
  awaitingConfirmation.set(conversationKey(options), {
    runId,
    origin: options.origin,
    at: Date.now(),
    title,
  });
}

function takeAwaitingConfirmation(
  options: EngineOptions,
): { runId: string; title: string } | null {
  const key = conversationKey(options);
  const entry = awaitingConfirmation.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > AWAITING_TTL_MS || !pendingByRun.has(entry.runId)) {
    awaitingConfirmation.delete(key);
    return null;
  }
  // An answer given in one origin must not resolve a question asked in
  // another: the voice overlay and the chat window are different rooms.
  if (entry.origin !== options.origin) return null;
  awaitingConfirmation.delete(key);
  return { runId: entry.runId, title: entry.title };
}

/** Whatever happens to a run, it is no longer waiting on an answer. */
function clearAwaitingConfirmation(runId: string): void {
  for (const [key, entry] of awaitingConfirmation) {
    if (entry.runId === runId) awaitingConfirmation.delete(key);
  }
}

function progress(options: EngineOptions, message: string, capabilityId?: string) {
  options.onProgress?.(message, capabilityId);
}

function statusLineFor(capabilityId: string, args: Record<string, unknown>): string {
  switch (capabilityId) {
    case "applications.open":
      return `Opening ${String(args.query ?? args.target_id ?? "application")}...`;
    case "applications.focus":
      return `Focusing ${String(args.query ?? "window")}...`;
    case "applications.close":
      return `Closing ${String(args.query ?? "application")}...`;
    case "filesystem.list_known_folder":
      return `Checking your ${String(args.folder ?? "folder")}...`;
    case "filesystem.create_directory":
      return "Creating folder...";
    case "filesystem.find":
      return `Searching for ${String(args.query ?? "")}...`;
    case "filesystem.delete":
      return "Preparing delete...";
    case "screen.capture":
      return "Taking screenshot...";
    case "screen.understand":
      return "Looking at your screen...";
    case "screen.click_target":
      return `Finding “${String(args.target ?? "that")}” to click...`;
    case "input.click_at":
      return "Clicking...";
    case "tasks.create":
      return "Creating task...";
    case "arcsonare.navigate":
      return `Opening ${String(args.page ?? "page")}...`;
    case "web.search":
      return args.site === "youtube"
        ? `Searching YouTube for ${String(args.query ?? "that")}…`
        : "Searching the web...";
    case "connections.get_status":
      return `Checking your ${String(args.service ?? "service")} connection…`;
    case "web.fetch_page":
      return "Fetching link…";
    case "web.activate_listed_item":
      return `Opening video #${String(args.index ?? "")} on YouTube...`;
    case "filesystem.open_item":
      return "Opening that folder...";
    case "system.open_settings":
      return `Opening ${String(args.page ?? "Windows")} settings...`;
    case "filesystem.reveal_in_explorer":
      return "Opening File Explorer...";
    default:
      return "Working...";
  }
}

// ---------------------------------------------------------------------------
// Native / frontend execution
// ---------------------------------------------------------------------------

/**
 * Carry out a visual plan, then close it against the plan that asked.
 *
 * The vision pipeline itself is untouched — it captures, asks the model, binds
 * the answer to the frame it came from, checks freshness and verifies the
 * result. What this adds is the bookkeeping around it: the plan's identifiers
 * travel in, the verified outcome travels back, and the plan is closed exactly
 * once. Rebuilding the pipeline here would mean two of them, and the second
 * would be the one without the protections.
 */
async function fulfillVisualPlan(
  visualRequest: VisualExecutionRequest,
  capabilityId: string,
  args: Record<string, unknown>,
  runId: string,
): Promise<ToolResult> {
  const plan = beginVisualPlan(visualRequest, runId);
  advanceVisualPlan(plan, "awaiting-capture");

  // The correlation id comes from the plan, never from a fresh one here: a
  // result under a new id is a result nobody can join to the request.
  const executed = await executeFrontendCapability(capabilityId, {
    ...args,
    correlation_id: visualRequest.correlationId,
  });
  advanceVisualPlan(plan, "verifying");

  const completion = completionFromToolResult(executed);
  const closed = finishVisualPlan(visualRequest, completion);
  if (!closed.ok) {
    // Refusing is the point: absorbing a duplicate would let a second report
    // append another activity entry, or quietly upgrade a partial.
    return {
      ...executed,
      warnings: [
        ...(executed.warnings ?? []),
        `This visual action was already closed (${closed.reason}).`,
      ],
    };
  }
  return {
    ...executed,
    data: {
      ...((executed.data as Record<string, unknown> | undefined) ?? {}),
      plan: {
        requestId: closed.result.requestId,
        planId: closed.result.planId,
        correlationId: visualRequest.correlationId,
        runId,
        intent: closed.result.intent,
        strategyUsed: closed.result.strategyUsed,
        actionStatus: closed.result.status,
        reasonCode: closed.result.reasonCode,
        sideEffectPossible: completion.sideEffectPossible,
      },
    },
  };
}

async function executeCapability(
  capabilityId: string,
  args: Record<string, unknown>,
  runId: string,
  request: string,
  token?: string,
  source: "chat" | "voice" = "chat",
  /** Passed through to frontend executors that must be exactly-once. */
  idempotencyKey?: string,
): Promise<ToolResult> {
  const definition = getCapability(capabilityId);

  // This turn's provenance. Recorded at the point of execution, so a watched-app
  // tool the model was merely *offered* credits nothing — only one it actually
  // called does. The instance key is passed because capabilities that serve a
  // class of application (any watched browser) cannot be attributed without it.
  recordCapabilityCall(capabilityId, args.instance_key);
  import("../overlay-log/overlayLogService").then((m) => {
    m.logCapabilityStarted(capabilityId);
  });

  // "Highlight it" arrives here with target "it", because the model passes the
  // user's pronoun straight through. Swapping it for the structured reference
  // must happen before dispatch — after it, the pronoun has already been sent
  // to vision or to a search.
  //
  // A pronoun with nothing to refer to becomes a question, never a guess.
  {
    const { resolvePronounArguments, recordEntitiesFromResult } = await import(
      "../conversation/productionBridge"
    );
    const pronoun = resolvePronounArguments(capabilityId, args, request);
    if (pronoun.kind === "clarify") {
      // No capability runs: no search, no vision, no cursor, no click.
      const asked: ToolResult = {
        callId: runId,
        capabilityId,
        status: "needs-confirmation",
        summary: pronoun.question,
        evidence: { verified: false, method: "not-verifiable" },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        data: { clarification: true, question: pronoun.question },
      };
      recordEntitiesFromResult(capabilityId, asked);
      return asked;
    }
    if (pronoun.kind === "resolved") args = pronoun.args;
  }

  // One switch for everything the planner routes — native and visual alike.
  // Visual capabilities used to reach their executor straight from the model's
  // tool call, so nothing recorded that a plan had chosen them, what risk it
  // assigned, or how the attempt ended.
  if (isPlannedCapability(capabilityId) || isVisualCapability(capabilityId)) {
    const disposition = await planAndDispatchAction(capabilityId, args, source);
    if (disposition) {
      switch (disposition.disposition) {
        case "executed":
          return actionResultToToolResult(capabilityId, disposition);
        case "requires-vision":
          return fulfillVisualPlan(disposition, capabilityId, args, runId);
        case "unsupported":
          // Not a crash — a plan that nothing here can carry out. Say which.
          return actionResultToToolResult(capabilityId, disposition);
        default: {
          // Exhaustiveness: a new disposition variant must not fall through
          // into the direct path, which would skip the lifecycle entirely.
          const unreachable: never = disposition;
          throw new Error(
            `Unhandled plan disposition: ${JSON.stringify(unreachable)}`,
          );
        }
      }
    }
  }

  if (definition?.executor === "frontend") {
    return executeFrontendCapability(capabilityId, args, idempotencyKey);
  }
  return invoke<ToolResult>("capability_execute", {
    capabilityId,
    args,
    runId,
    userRequestSummary: request.slice(0, 200),
    confirmationToken: token ?? null,
  });
}

/** Resolve router placeholders (__known_parent / __find_target). */
async function resolveSpecialArgs(
  capabilityId: string,
  args: Record<string, unknown>,
  runId: string,
  request: string,
): Promise<
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; result: ToolResult }
> {
  const out = { ...args };

  if (typeof out.__known_parent === "string") {
    const folder = out.__known_parent;
    delete out.__known_parent;
    const resolved = await executeCapability(
      "filesystem.resolve_known_folder",
      { folder },
      runId,
      request,
    );
    const path = (resolved.data as { path?: string } | undefined)?.path;
    if (resolved.status !== "success" || !path) {
      return { ok: false, result: resolved };
    }
    out.parent_path = path;
  }

  // `{ folder, name }` → an absolute `path`, so listing a named subfolder never
  // depends on the model constructing a valid path itself.
  if (out.__known_subpath && typeof out.__known_subpath === "object") {
    const { folder, name } = out.__known_subpath as { folder: string; name: string };
    delete out.__known_subpath;
    const resolved = await executeCapability(
      "filesystem.resolve_known_folder",
      { folder },
      runId,
      request,
    );
    const base = (resolved.data as { path?: string } | undefined)?.path;
    if (resolved.status !== "success" || !base) {
      return { ok: false, result: resolved };
    }
    const separator = base.endsWith("\\") || base.endsWith("/") ? "" : "\\";
    out.path = `${base}${separator}${name}`;
  }

  if (typeof out.__find_target === "string") {
    const query = out.__find_target;
    delete out.__find_target;
    const found = await executeCapability(
      "filesystem.find",
      { query, limit: 5 },
      runId,
      request,
    );
    const results =
      ((found.data as { results?: Array<{ path?: string; name?: string }> } | undefined)
        ?.results ?? []);
    if (found.status === "not-found" || results.length === 0) {
      return { ok: false, result: found };
    }
    // Prefer exact name matches; require a single unambiguous target.
    const exact = results.filter(
      (r) => (r.name ?? "").toLowerCase() === query.toLowerCase(),
    );
    const pool = exact.length > 0 ? exact : results;
    if (pool.length > 1 && capabilityId === "filesystem.delete") {
      return {
        ok: false,
        result: {
          ...found,
          status: "needs-confirmation",
          summary: `I found ${pool.length} items named like "${query}". Which one?`,
          data: {
            confirmation: {
              reason: "ambiguous",
              candidates: pool.slice(0, 4).map((r) => ({ id: r.path, label: r.path })),
            },
          },
        },
      };
    }
    out.paths = [pool[0].path];
  }

  return { ok: true, args: out };
}

function extractConfirmation(
  runId: string,
  capabilityId: string,
  result: ToolResult,
): CapabilityConfirmation | null {
  const data = result.data as
    | {
        confirmation?: {
          token?: string;
          title?: string;
          description?: string;
          riskLevel?: string;
          affectedItems?: Array<{ name: string; path?: string; itemType?: string }>;
          reversible?: boolean;
          consequence?: string;
          expiresAt?: string;
          reason?: string;
          candidates?: Array<{ id?: string; label?: string; displayName?: string; title?: string; window_id?: string }>;
        };
        reason?: string;
        candidates?: Array<{ id?: string; label?: string; displayName?: string; title?: string; window_id?: string; targetType?: string }>;
      }
    | undefined;
  const conf = data?.confirmation;
  const rawCandidates = conf?.candidates ?? data?.candidates;
  const candidates = rawCandidates?.map((c) => ({
    id: c.id ?? (c as { window_id?: string }).window_id,
    label:
      (c as { displayName?: string }).displayName ??
      (c as { title?: string }).title ??
      c.label ??
      String(c.id ?? ""),
  }));
  return {
    token: conf?.token,
    runId,
    capabilityId,
    title: conf?.title ?? result.summary,
    description: conf?.description ?? "",
    riskLevel: (conf?.riskLevel as CapabilityConfirmation["riskLevel"]) ?? "sensitive",
    affectedItems: conf?.affectedItems ?? [],
    reversible: conf?.reversible ?? true,
    consequence: conf?.consequence ?? "",
    expiresAt: conf?.expiresAt,
    candidates,
  };
}

/**
 * Frontend confirmation policy for sensitive ops without a native gate.
 *
 * The five-level risk model is consulted first and can only ever *remove* a
 * question. That ordering is deliberate: the registry's `confirmation` field
 * marks capabilities like `applications.close` as `before-execution`, and it
 * has no way to express "the user just asked for exactly this". Routine and
 * reversible work — opening, reading, searching, navigating, downloading,
 * editing a file the user named — is authorised by the request that produced
 * it, so it never reaches a prompt regardless of what the registry says.
 */
function needsFrontendConfirmation(capabilityId: string): boolean {
  if (!requiresApproval(capabilityId)) return false;
  const def = getCapability(capabilityId);
  if (!def) return false;
  if (def.id === "tasks.delete") return true;
  return def.confirmation === "before-execution" || def.confirmation === "always"
    ? def.executor === "frontend" || def.riskLevel === "sensitive"
    : false;
}

/**
 * Open the question in Rust, or discover that it is already open.
 *
 * Returns the action id to attach to the continuation, and whether the caller
 * should proceed without asking at all — which happens when this exact action
 * was already approved, in this window or the other one.
 */
async function openApprovalQuestion(
  runId: string,
  options: EngineOptions,
  capabilityId: string,
  args: Record<string, unknown>,
  title: string,
  description = "",
): Promise<{ actionId?: string; proceedApproved: boolean }> {
  const outcome = await openPendingAction({
    runId,
    conversationId: conversationKey(options),
    capabilityId,
    args,
    title,
    description,
  });
  // No backend (or it refused): fall back to asking, which is the safe
  // direction. It costs a prompt; assuming approval would cost correctness.
  if (!outcome) return { proceedApproved: false };
  return {
    actionId: outcome.action.actionId,
    proceedApproved: outcome.alreadyApproved,
  };
}

function buildFrontendConfirmation(
  runId: string,
  capabilityId: string,
  args: Record<string, unknown>,
): CapabilityConfirmation {
  if (capabilityId === "tasks.delete") {
    const described = describeTaskDelete(args);
    return {
      runId,
      capabilityId,
      title: described ? `Delete task "${described.title}"?` : "Delete this task?",
      description: "The task will be removed from ArcSonare.",
      riskLevel: "destructive",
      affectedItems: described ? [{ name: described.title }] : [],
      reversible: false,
      consequence: "This only deletes the ArcSonare task, not any external content.",
    };
  }
  const label = String(args.query ?? args.window_id ?? "");
  return {
    runId,
    capabilityId,
    title:
      capabilityId === "applications.close" || capabilityId === "windows.close"
        ? `Close ${label}?`
        : `Run ${capabilityId}?`,
    description:
      capabilityId === "applications.close"
        ? "Unsaved work in that app may prompt before closing."
        : "",
    riskLevel: "sensitive",
    affectedItems: label ? [{ name: label }] : [],
    reversible: true,
    consequence: "",
  };
}

// ---------------------------------------------------------------------------
// Single-capability run (deterministic path)
// ---------------------------------------------------------------------------

async function runSingleCapability(
  run: CapabilityRun,
  capabilityId: string,
  rawArgs: Record<string, unknown>,
  request: string,
  options: EngineOptions,
  token?: string,
  idempotencyKey?: string,
): Promise<EngineOutcome> {
  let definition = getCapability(capabilityId);
  patchRun(run.id, {
    state: "routing",
    selectedCapabilityIds: [capabilityId],
    riskLevel: definition?.riskLevel ?? "read-only",
  });

  // Application alias memory: reuse the user's confirmed preference.
  let args = { ...rawArgs };
  let aliasUsed: ReturnType<typeof getAliasPreference> = null;
  if (capabilityId === "applications.open" && typeof args.query === "string") {
    aliasUsed = getAliasPreference(args.query);
    if (aliasUsed) {
      args.target_id = aliasUsed.targetId;
      if (aliasUsed.targetType === "web") args.preference = "web-first";
    }
  }

  // Resolve router placeholders (known folders, delete targets).
  const resolved = await resolveSpecialArgs(capabilityId, args, run.id, request);
  if (!resolved.ok) {
    const text = composeResponse(resolved.result, request);
    if (resolved.result.status === "needs-confirmation") {
      const confirmation = extractConfirmation(run.id, capabilityId, resolved.result);
      if (confirmation) {
        pendingByRun.set(run.id, {
          capabilityId,
          args,
          request,
          options,
          candidates: confirmation.candidates,
        });
        patchRun(run.id, {
          state: "awaiting-confirmation",
          confirmationRequired: true,
          confirmationStatus: "pending",
          pendingConfirmation: confirmation,
        });
        markAwaitingConfirmation(run.id, options, confirmation.title);
        return {
          handled: true,
          run: getRun(run.id),
          responseText: text,
          spokenText: text,
          result: resolved.result,
          pendingConfirmation: confirmation,
        };
      }
    }
    finishRun(run.id, resolved.result, text);
    return {
      handled: true,
      run: getRun(run.id),
      responseText: text,
      spokenText: composeSpokenResponse(resolved.result, request),
      result: resolved.result,
    };
  }
  args = resolved.args;

  // Repair the argument mistake models make most often here: passing a PATH to
  // list_known_folder, whose `folder` is a fixed enum. "desktop/Fantastic" was
  // rejected as invalid-arguments, and the model then asked the user to explain
  // its own failure instead of retrying. Splitting it into the known root plus a
  // subpath turns a dead end into the correct list_directory call.
  if (
    capabilityId === "filesystem.list_known_folder" &&
    typeof args.folder === "string" &&
    /[\\/]/.test(args.folder)
  ) {
    const [root, ...rest] = args.folder.split(/[\\/]+/).filter(Boolean);
    const sub = rest.join("\\");
    if (root && sub) {
      capabilityId = "filesystem.list_directory";
      definition = getCapability(capabilityId);
      args = { __known_subpath: { folder: root.toLowerCase(), name: sub } };
    }
  }

  // Local validation before anything native runs.
  if (definition) {
    const validation = validateArguments(definition.inputSchema, args);
    if (!validation.valid) {
      const errResult: ToolResult = {
        callId: "invalid",
        capabilityId,
        status: "error",
        summary: `Arguments were rejected: ${validation.errors.join("; ")}`,
        evidence: { verified: false, method: "not-verifiable" },
        error: {
          code: "invalid-arguments",
          message: validation.errors.join("; "),
          recoverable: true,
        },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
      const text = composeResponse(errResult, request);
      finishRun(run.id, errResult, text);
      return { handled: true, run: getRun(run.id), responseText: text, result: errResult };
    }
  }

  // Frontend confirmation policy (task deletion, app close).
  if (!token && needsFrontendConfirmation(capabilityId)) {
    const confirmation = buildFrontendConfirmation(run.id, capabilityId, args);
    pendingByRun.set(run.id, { capabilityId, args, request, options });
    patchRun(run.id, {
      state: "awaiting-confirmation",
      confirmationRequired: true,
      confirmationStatus: "pending",
      pendingConfirmation: confirmation,
    });
    markAwaitingConfirmation(run.id, options, confirmation.title);
    return {
      handled: true,
      run: getRun(run.id),
      responseText: confirmation.title,
      spokenText: confirmation.title,
      pendingConfirmation: confirmation,
    };
  }

  // Rescue: model/router sent applications.open("theird video") → YouTube pick.
  if (capabilityId === "applications.open" && typeof args.query === "string") {
    const {
      parseOrdinalMediaRequest,
      extractOrdinalFromPhrase,
      looksLikeMediaListPick,
    } = await import("./capabilityRouter");
    const q = String(args.query);
    if (looksLikeMediaListPick(q) || /\bvideos?\b/i.test(q)) {
      const parsed =
        parseOrdinalMediaRequest(`open ${q}`) ?? extractOrdinalFromPhrase(q);
      if (parsed) {
        capabilityId = "web.activate_listed_item";
        definition = getCapability(capabilityId);
        args = { index: parsed.index, site: "youtube" };
      }
    }
  }

  // YouTube ordinal follow-ups: attach last search query when the user says
  // “open the second video” after opening/searching YouTube.
  if (capabilityId === "web.activate_listed_item") {
    const { getMediaContext } = await import("./mediaContext");
    const media = getMediaContext();
    if (media?.site === "youtube" && media.searchQuery && !args.query) {
      args = { ...args, query: media.searchQuery, site: "youtube" };
    } else if (!args.site) {
      args = { ...args, site: "youtube" };
    }
  }

  // “Screenshot that app” / “snapshot of that” → last opened or watched app.
  if (capabilityId === "screen.capture") {
    const { resolveDeicticApp } = await import("./focusContext");
    const rawQuery =
      typeof args.application_query === "string" ? args.application_query : "";
    const resolved = resolveDeicticApp(rawQuery || null);
    if (
      args.target === "application" ||
      /^(that|this|it)$/i.test(rawQuery.trim())
    ) {
      if (resolved) {
        args = {
          ...args,
          target: "application",
          application_query: resolved,
        };
      } else if (!rawQuery || /^(that|this|it)$/i.test(rawQuery.trim())) {
        // No context — capture the active display rather than fail opaquely.
        args = { target: "active-display" };
      }
    }
  }

  patchRun(run.id, { state: "executing" }, statusLineFor(capabilityId, args), iconKeyFor(args));
  progress(options, statusLineFor(capabilityId, args), capabilityId);

  const result = await executeCapability(
    capabilityId,
    args,
    run.id,
    request,
    token,
    options.origin,
    idempotencyKey,
  );
  // Deposit whatever this found or created, so the next "highlight it" has a
  // structured thing to resolve against instead of the assistant's own prose.
  await import("../conversation/productionBridge").then(({ recordEntitiesFromResult }) =>
    recordEntitiesFromResult(capabilityId, result),
  );

  // Native confirmation round-trip (destructive delete, overwrite, ambiguity).
  if (result.status === "needs-confirmation") {
    const confirmation = extractConfirmation(run.id, capabilityId, result);
    if (confirmation) {
      pendingByRun.set(run.id, {
        capabilityId,
        args,
        token: confirmation.token,
        request,
        options,
        candidates: confirmation.candidates,
      });
      patchRun(run.id, {
        state: "awaiting-confirmation",
        confirmationRequired: true,
        confirmationStatus: "pending",
        pendingConfirmation: confirmation,
      });
      markAwaitingConfirmation(run.id, options, confirmation.title);
      const text = result.summary;
      return {
        handled: true,
        run: getRun(run.id),
        responseText: text,
        spokenText: text,
        result,
        pendingConfirmation: confirmation,
      };
    }
  }

  patchRun(run.id, { state: "verifying" });

  // Application alias learning — only after a VERIFIED success.
  if (capabilityId === "applications.open" && typeof rawArgs.query === "string") {
    const data = result.data as { target_id?: string; method?: string } | undefined;
    if (result.status === "success" && data?.target_id) {
      recordAliasSuccess(
        rawArgs.query,
        data.target_id,
        data.method === "web-fallback" ? "web" : "native",
        Boolean(aliasUsed?.confirmedByUser),
      );
    } else if (result.status === "error") {
      recordAliasFailure(rawArgs.query);
    }
  }
  // Remember YouTube for follow-ups like “open the second video”.
  if (result.status === "success") {
    try {
      const { rememberYoutubeOpen, rememberYoutubeSearch } = await import(
        "./mediaContext"
      );
      if (capabilityId === "applications.open") {
        const appName = String(
          (result.data as { application?: string } | undefined)?.application ??
            rawArgs.query ??
            "",
        );
        const { rememberFocusedApp } = await import("./focusContext");
        rememberFocusedApp(appName);
        // “press it” after open Spotify / YouTube → play button.
        void import("./clickTargetMemory").then(({ rememberAppDefaultClick }) => {
          rememberAppDefaultClick(appName);
        });
        const q = appName.toLowerCase();
        if (/\byoutube\b/.test(q)) {
          rememberYoutubeOpen();
        }
      }
      if (capabilityId === "applications.focus") {
        const appName = String(
          (result.data as { application?: string } | undefined)?.application ??
            rawArgs.query ??
            "",
        );
        const { rememberFocusedApp } = await import("./focusContext");
        rememberFocusedApp(appName);
      }
      if (capabilityId === "web.search" && args.site === "youtube") {
        rememberYoutubeSearch(String(args.query ?? ""));
      }
      if (capabilityId === "web.open_url") {
        const url = String(args.url ?? "").toLowerCase();
        if (url.includes("youtube.com")) rememberYoutubeOpen();
      }
      if (capabilityId === "web.fetch_page") {
        const { rememberBrowserPage } = await import("./browserContext");
        const data = result.data as { url?: string; title?: string } | undefined;
        if (data?.url) rememberBrowserPage(data.url, data.title);
      }
      if (capabilityId === "web.activate_listed_item") {
        rememberYoutubeOpen(
          typeof args.query === "string" ? args.query : undefined,
        );
      }
    } catch {
      // non-fatal
    }
  }
  if (result.status === "success") {
    recordCapabilitySuccess(capabilityId);
  }
  recordSessionAction(request, capabilityId, result);

  // Verified facts only. Chat runs styleAssistantOutput in AssistantService
  // (single gate — list/table + AI voice). Voice keeps a short spoken line.
  const verified = composeResponse(result, request);
  finishRun(run.id, result, verified);
  logActivity(capabilityId, result, options);
  return {
    handled: true,
    run: getRun(run.id),
    responseText: verified,
    spokenText: composeSpokenResponse(result, request),
    result,
  };
}

function iconKeyFor(args: Record<string, unknown>): string | undefined {
  const q = args.query ?? args.target_id;
  return typeof q === "string" ? q : undefined;
}

function logActivity(_capabilityId: string, result: ToolResult, options: EngineOptions) {
  // Operational summary only — no reasoning, no file contents.
  void _capabilityId;
  if (result.status === "success" || result.status === "partial") {
    try {
      addActivity(result.summary.slice(0, 140), options.origin === "voice" ? "voice" : "command");
    } catch {
      // Activity log is best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Preference commands ("always open X in the browser", "forget ...")
// ---------------------------------------------------------------------------

async function handlePreferenceCommand(
  text: string,
  options: EngineOptions,
): Promise<EngineOutcome | null> {
  const q = text.toLowerCase().replace(/[?.!]+$/g, "").trim();

  const forget = q.match(/^forget (?:my )?(.+?)(?: preference)?$/);
  if (forget && /preference|alias|choice/.test(q + " preference")) {
    const target = forget[1].replace(/\s*(preference|alias|choice)\s*$/, "").trim();
    const removed = forgetAlias(target);
    const message = removed
      ? `Forgot your preference for "${target}".`
      : `You don't have a saved preference for "${target}".`;
    const run = startRun(text, "deterministic", { voiceSessionId: options.voiceSessionId });
    const result: ToolResult = {
      callId: "pref",
      capabilityId: "arcsonare.preferences",
      status: removed ? "success" : "not-found",
      summary: message,
      evidence: { verified: true, method: "state-readback" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }

  const always = q.match(
    /^always (?:open|use) (?:the )?(.+?) (?:in (?:the )?(browser|web)|(?:as |in )?(?:the )?(desktop app|app|native))$/,
  );
  if (always) {
    const query = always[1].trim();
    const wantWeb = Boolean(always[2]);
    const run = startRun(text, "deterministic", { voiceSessionId: options.voiceSessionId });
    const resolved = await executeCapability(
      "applications.resolve",
      { query, preference: wantWeb ? "web-first" : "native-first" },
      run.id,
      text,
    );
    const data = resolved.data as
      | { resolved?: { id?: string; displayName?: string } | null; candidates?: Array<{ id: string; displayName: string }> }
      | undefined;
    const target = data?.resolved ?? data?.candidates?.[0];
    if (!target?.id) {
      const message = `I couldn't find "${query}" to save a preference for.`;
      finishRun(run.id, resolved, message);
      return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result: resolved };
    }
    recordAliasSuccess(query, target.id, wantWeb ? "web" : "native", true);
    const message = `Got it — I'll ${wantWeb ? "use the web version of" : "use the desktop app for"} ${
      (target as { displayName?: string }).displayName ?? query
    } from now on.`;
    const result: ToolResult = {
      ...resolved,
      summary: message,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Compound deterministic requests ("create a folder ... and take a screenshot")
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Model tool loop (Stage 2)
// ---------------------------------------------------------------------------

const TOOL_SYSTEM_PROMPT = [
  "You are ArcSonare — a warm, capable co-pilot with real local Windows tools.",
  "When a user request matches an available tool, YOU must call the tool — never pretend you did something, and never ask the user to do it manually.",
  "Never claim inability before checking the available tools. Never claim completion before a successful tool result.",
  "Never guess current system state (time, files, apps, windows); read it through tools.",
  "Never invent files, folders, applications, windows, screenshots, or tasks. Never generate shell commands.",
  "Follow-ups: “that / it / that app / that window” refers to the last app you opened or a WATCHED app. “Screenshot that” → screen.capture with target application. After YouTube is open, “second video” / “third video” is a YouTube list pick (web.activate_listed_item with index), never applications.open.",
  "Media on a WATCHED app: if the user says “play the video”, “pause”, “resume”, or “play it” with NO ordinal (no first/second/3rd), they mean the current player under Watch — call screen.click_target with target “play button” or “pause button”. Never ask which video from a list. Never call web.activate_listed_item without a clear ordinal.",
  "Connection questions are about ArcSonare's own state, not the internet: “is YouTube connected?”, “did Spotify link?”, “can you use my Notion?” are connections.get_status. Never answer one by opening the service, searching it, or opening a browser.",
  "To create a folder: first call filesystem.resolve_known_folder (desktop/documents/downloads/…) if needed, then filesystem.create_directory with parent_path + name.",
  "Use the smallest relevant set of tools. Ask a concise clarifying question only when a required argument is genuinely ambiguous.",
  "After tool results arrive, confirm warmly in one short sentence — including the full path when a folder or file was created.",
  "If the user asks what you did or where something is, use the recent-actions context and/or tools — do not guess.",
  "Keep replies to one or two friendly sentences.",
].join(" ");

function toolSystemPromptWithMemory(): string {
  const memory = formatSessionActionContext();
  return memory ? `${TOOL_SYSTEM_PROMPT}\n\n${memory}` : TOOL_SYSTEM_PROMPT;
}

interface ModelRoute {
  adapter: ProviderToolAdapter | null;
  model: string;
  cloudBlocked?: boolean;
  unavailable?: string;
}

async function resolveModelRoute(): Promise<ModelRoute> {
  const route = getAssistantRoute();
  const allowCloud = getPrefs().dataPrivacy.allowCloud;

  if (route.provider === "deepseek") {
    if (!allowCloud) return { adapter: null, model: "", cloudBlocked: true };
    return { adapter: deepSeekAdapter, model: route.modelName ?? "deepseek-v4-flash" };
  }
  if (route.provider === "google") {
    // Gemini is wired for chat replies; tool-calling uses the chat path instead.
    if (!allowCloud) return { adapter: null, model: "", cloudBlocked: true };
    return { adapter: null, model: "" };
  }
  if (route.provider === "none") {
    return {
      adapter: null,
      model: "",
      unavailable: "No DeepSeek key saved. Add it in Settings → Voice & AI keys.",
    };
  }
  return {
    adapter: null,
    model: "",
    unavailable:
      "Chat tools need DeepSeek. Save a DeepSeek API key in Settings → Voice & AI keys.",
  };
}

/**
 * The watch scope for this turn.
 *
 * Read lazily and defensively: the engine runs in both windows, and a failure
 * to read the scope must degrade to "no watched applications" rather than
 * throwing in the middle of a user's request.
 */
async function watchContextForTurn(requestText: string): Promise<{
  watchedApplications: WatchedApplication[];
  watchScoped: boolean;
  conversationId: string;
}> {
  try {
    const [{ getWatchSnapshot }, { currentConversationId }] = await Promise.all([
      import("../watch/watchStore"),
      import("../conversation/conversationContext"),
    ]);
    const conversationId = currentConversationId();
    // Fresh, not cached: the user may have switched the active application a
    // moment ago, and the previous scope must not survive into this turn.
    const { refreshWatchScope } = await import("../watch/watchScopeStore");
    const scope = await refreshWatchScope(conversationId);

    // The same relevance gate the prompt uses. Without it, an active
    // application contributed its capabilities to every request — including
    // "create a task for tomorrow", which has nothing to do with it.
    const { watchRelevance } = await import("../watch/watchRelevance");
    const verdict = watchRelevance({
      requestText,
      active: scope.scope.entries,
    });
    if (!verdict.relevant) {
      return { watchedApplications: [], watchScoped: false, conversationId };
    }
    const activeIds = new Set(verdict.applicationIds);
    // Only the applications this conversation is actually about. A watched but
    // inactive application must not contribute tools to this turn.
    const watchedApplications = getWatchSnapshot().watched.filter((w) =>
      activeIds.has(w.appCatalogId),
    );
    return {
      watchedApplications,
      watchScoped: watchedApplications.length > 0,
      conversationId,
    };
  } catch {
    return { watchedApplications: [], watchScoped: false, conversationId: "" };
  }
}

/** Capabilities the watch scope guarantees, regardless of retrieval scoring. */
function watchScopeCapabilities(
  watched: WatchedApplication[],
): CapabilityDefinition[] {
  return capabilitiesForWatchContext(watched);
}

async function runModelToolLoop(
  run: CapabilityRun,
  request: string,
  options: EngineOptions,
): Promise<EngineOutcome> {
  const complex = /\b(and|then)\b/i.test(request);
  const limit = complex ? 8 : 6;
  // Narrow by origin and live connector state through the shared gate, so chat
  // and voice cannot be offered different tools for the same request — and a
  // disconnected connector's tools are never advertised at all.
  let connectedConnectors = new Set<never>();
  try {
    const { getConnectedIntegrationIds } = await import(
      "../../services/integrationStatusService"
    );
    connectedConnectors = (await getConnectedIntegrationIds()) as unknown as Set<never>;
  } catch {
    // Offering no connector tools beats offering ones that cannot run.
  }
  // The conversation's watched applications, so scope-only capabilities are
  // offered and unwatched ones are not. `capabilityEngine` deliberately has no
  // pattern-matching stage in front of the model — the model chooses every
  // tool — which means the *tool list* is the only place scope can be enforced.
  const { watchedApplications, watchScoped, conversationId } =
    await watchContextForTurn(request);

  let retrieved = retrieveCapabilities(request, limit, {
    origin: options.origin,
    connectedConnectors,
    watchedApplications,
  });

  // A media transport request is a media-session operation. Withholding the
  // vision and cursor tools is what stops the model reaching for
  // `screen.click_target` — which is exactly what "play the current song"
  // did, answering "I couldn't find 'that' on the screen" for a command that
  // needs no pixels. An instruction not to use a visible tool is a
  // suggestion; not offering it is a guarantee.
  const narrowed = narrowForWatchScope(
    retrieved.map((r) => r.capability),
    { watchScoped, requestText: request, scopeCapabilityIds: [] },
  );
  if (narrowed.withheld.length > 0) {
    const kept = new Set(narrowed.capabilities.map((c) => c.id));
    retrieved = retrieved.filter((r) => kept.has(r.capability.id));
  }

  // The scope's own capabilities are added unconditionally, not only when
  // something was withheld. Retrieval scores on word overlap, and "play the
  // current song" overlaps several capabilities as readily as `spotify.play` —
  // leaving the media tool to ranking is how the model ended up without it and
  // answered from the window instead of the media session.
  if (watchScoped) {
    for (const capability of watchScopeCapabilities(watchedApplications)) {
      if (!retrieved.some((r) => r.capability.id === capability.id)) {
        retrieved.push({ capability, score: 900 });
      }
    }
  }

  if (retrieved.length === 0) {
    // Nothing action-like — conversation.
    patchRun(run.id, { state: "cancelled" });
    return { handled: false };
  }
  const tools = retrieved.map((r) => r.capability);
  void conversationId;
  patchRun(run.id, {
    state: "planning",
    selectedCapabilityIds: tools.map((t) => t.id),
  });

  const routeInfo = await resolveModelRoute();
  if (routeInfo.cloudBlocked) {
    const message = `${getAssistantRoute().displayName} needs cloud processing, which is turned off in Settings → Data & Privacy. Turn it on to use chat tools.`;
    const result: ToolResult = {
      callId: "blocked",
      capabilityId: "capability-engine",
      status: "denied",
      summary: message,
      evidence: { verified: false, method: "not-verifiable" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }
  if (!routeInfo.adapter && !routeInfo.model) {
    // Google Gemini: no tool adapter yet — fall through to plain askAssistant chat.
    if (getAssistantRoute().provider === "google") {
      patchRun(run.id, { state: "cancelled" });
      return { handled: false };
    }
    const message = routeInfo.unavailable ?? "No model is available for tool selection.";
    const result: ToolResult = {
      callId: "unavailable",
      capabilityId: "capability-engine",
      status: "error",
      summary: message,
      evidence: { verified: false, method: "not-verifiable" },
      error: { code: "provider-unavailable", message, recoverable: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    finishRun(run.id, result, message);
    return { handled: true, run: getRun(run.id), responseText: message, spokenText: message, result };
  }

  const turns: ChatTurn[] = [
    { role: "system", content: toolSystemPromptWithMemory() },
    { role: "user", content: request },
  ];
  return continueModelLoop(run, request, options, {
    adapter: routeInfo.adapter,
    model: routeInfo.model,
    turns,
    toolNames: tools.map((t) => t.id),
    stepsUsed: 0,
    providerCalls: 0,
    toolExecutions: 0,
  });
}

async function continueModelLoop(
  run: CapabilityRun,
  request: string,
  options: EngineOptions,
  loop: NonNullable<PendingExecution["modelLoop"]>,
): Promise<EngineOutcome> {
  const tools = loop.toolNames
    .map((id) => getCapability(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const maxSteps = /\b(and|then)\b/i.test(request) ? MAX_TOOL_STEPS_COMPLEX : MAX_TOOL_STEPS;
  let lastResult: ToolResult | undefined;
  let invalidRetries = 0;

  while (loop.stepsUsed < maxSteps) {
    progress(options, "Thinking...");
    let reply;
    try {
      if (!loop.adapter) {
        const message =
          "No model adapter available for tool selection. Save a DeepSeek key in Settings → Voice & AI keys.";
        const result: ToolResult = {
          callId: "unavailable",
          capabilityId: "capability-engine",
          status: "error",
          summary: message,
          evidence: { verified: false, method: "not-verifiable" },
          error: { code: "provider-unavailable", message, recoverable: true },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
        };
        finishRun(run.id, result, message);
        return { handled: true, run: getRun(run.id), responseText: message, result };
      }
      // Never hand a provider a history it will reject. A malformed one is
      // repaired if that can be done honestly, and the fact is recorded — the
      // alternative is an opaque mid-conversation failure the user reads as
      // the app being broken.
      const validation = validateTurns(loop.turns);
      if (!validation.valid) {
        const repair = repairTurns(loop.turns);
        console.error(
          "[ArcSonare] malformed tool history repaired before sending:",
          validation.problems.join("; "),
          `(dropped ${repair.dropped})`,
        );
        loop.turns = repair.turns;
      }
      loop.providerCalls += 1;
      reply = await loop.adapter.chat(loop.turns, tools, loop.model);
      loop.lastResponseId = reply.responseId;
    } catch (err) {
      // invoke() rejects with a string, so `instanceof Error` discarded the
      // real reason — including "No API key saved…" on a fresh install.
      const message = describeProviderError(err, getAssistantRoute().displayName);
      const result: ToolResult = {
        callId: "model-error",
        capabilityId: "capability-engine",
        status: "error",
        summary: message,
        evidence: { verified: false, method: "not-verifiable" },
        error: { code: "model-request-failed", message, recoverable: true },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
      finishRun(run.id, result, message);
      return { handled: true, run: getRun(run.id), responseText: message, result };
    }

    if (reply.toolCalls.length === 0) {
      // Nudge once when the request looks actionable but the model only talked.
      const actionable =
        !lastResult &&
        invalidRetries < 1 &&
        /\b(create|make|add|delete|remove|trash|open|launch|find|locate|list|show|take|capture|write|save)\b/i.test(
          request,
        ) &&
        tools.some(
          (t) =>
            t.category === "filesystem" ||
            t.category === "applications" ||
            t.riskLevel !== "read-only",
        );
      if (actionable) {
        loop.turns.push({
          role: "assistant",
          content: reply.text?.trim() || "",
        });
        loop.turns.push({
          role: "user",
          content:
            "You must call one of the available tools to complete this. Do not only describe the steps.",
        });
        invalidRetries += 1;
        continue;
      }

      // The model has now seen the verified tool result and written the reply.
      //
      // This used to throw that sentence away and substitute a template, which
      // is why every successful action produced the same handful of shapes
      // ("Opened X.", "Clicked “Y”.") no matter what was asked. The second
      // provider call was already being made — its answer was simply discarded.
      //
      // Keep it, but only if it survives the fact check: the model owns the
      // phrasing, never the facts.
      if (lastResult?.status === "success") {
        const facts = composeResponse(lastResult, request);
        let candidate = sanitizeUserFacingText(reply.text?.trim() ?? "");
        let verdict = judgeFinalText(candidate, facts);
        // Scope claims get their own guard: "public read-only" becoming "full
        // read-only" is not a success/failure contradiction, so the fact check
        // waves it through while the meaning inverts.
        if (verdict.ok) {
          const claims = await connectorClaimsFor(lastResult);
          if (claims) {
            const enforced = enforceConnectorClaims(candidate, claims);
            if (enforced.ok) candidate = enforced.text;
            else verdict = { ok: false, reason: enforced.reason };
          }
        }
        const text = verdict.ok ? candidate : facts;
        recordResponseProvenance({
          runId: run.id,
          capabilityId: lastResult.capabilityId,
          source: verdict.ok ? "MODEL_GENERATED" : "DETERMINISTIC_FALLBACK",
          fallbackReason: verdict.ok ? undefined : verdict.reason,
          providerCalls: loop.providerCalls,
          toolExecutions: loop.toolExecutions,
        });
        finishRun(run.id, lastResult, text);
        return {
          handled: true,
          run: getRun(run.id),
          responseText: text,
          spokenText: composeSpokenResponse(lastResult, request),
          result: lastResult,
          responseSource: verdict.ok ? "MODEL_GENERATED" : "DETERMINISTIC_FALLBACK",
        };
      }

      const text = sanitizeUserFacingText(
        reply.text?.trim() || (lastResult ? composeResponse(lastResult, request) : ""),
      );
      if (!text && !lastResult) {
        // Pure miss — let the caller fall through to conversational chat.
        patchRun(run.id, { state: "cancelled" });
        return { handled: false };
      }

      // Time/date must never surface a failed tool narrative — read the clock.
      if (
        lastResult?.status === "error" &&
        isTimeOrDateQuestion(request)
      ) {
        return runSingleCapability(
          run,
          "system.get_local_datetime",
          { format: "spoken", include_timezone: /\btimezone\b/i.test(request) },
          request,
          options,
        );
      }

      if (lastResult) {
        finishRun(run.id, lastResult, text || composeResponse(lastResult, request));
      } else {
        patchRun(run.id, { state: "completed", responseText: text });
      }
      return {
        handled: true,
        run: getRun(run.id),
        responseText: text || lastResult?.summary || "",
        spokenText: lastResult
          ? composeSpokenResponse(lastResult, request)
          : text,
        result: lastResult,
      };
    }

    // Execute tool calls (sequential; parallel calls run in order).
    const turn = ToolTurn.begin(loop.turns, reply.text ?? "", reply.toolCalls);
    const pendingContracts: string[] = [];

    // Several deletions in one turn are one question, not one each.
    //
    // Asked per call, "delete these three test tasks" produced three identical
    // prompts for a list the user had already enumerated. One confirmation
    // naming every row is both fewer interruptions and more information —
    // the previous prompts named one task at a time, so nobody could see the
    // whole set they were agreeing to.
    const batch = batchApproved.has(run.id) ? null : findDeletionBatch(reply.toolCalls);
    if (batch) {
      const described = describeBatch(batch);
      const confirmation: CapabilityConfirmation = {
        runId: run.id,
        capabilityId: batch.capabilityId,
        title: described.title,
        description: described.description,
        riskLevel: "destructive",
        affectedItems: described.affectedItems,
        reversible: false,
        consequence: "Only the items listed will be affected.",
      };
      pendingByRun.set(run.id, {
        capabilityId: batch.capabilityId,
        args: {},
        request,
        options,
        modelLoop: loop,
        batch,
      });
      // The turn still owes a result for every declared call.
      for (const id of turn.unansweredIds()) {
        turn.leaveUnsettled(id, "awaiting-confirmation");
      }
      turn.close();
      patchRun(run.id, {
        state: "awaiting-confirmation",
        confirmationRequired: true,
        confirmationStatus: "pending",
        pendingConfirmation: confirmation,
      });
      markAwaitingConfirmation(run.id, options, confirmation.title);
      return {
        handled: true,
        run: getRun(run.id),
        responseText: confirmation.title,
        spokenText: confirmation.title,
        pendingConfirmation: confirmation,
      };
    }

    for (const call of reply.toolCalls) {
      const outcome = await executeModelToolCall(
        run,
        call,
        request,
        options,
        loop,
        turn,
        pendingContracts,
      );
      if (outcome.pause) {
        // The turn still owes a result for every declared call. Close it out
        // before returning, or the history is malformed for good and every
        // later request in this conversation is rejected by the provider.
        turn.leaveUnsettled(call.id, "awaiting-confirmation");
        for (const id of turn.unansweredIds()) {
          turn.leaveUnsettled(id, "not-executed");
        }
        turn.close();
        return outcome.engineOutcome;
      }
      lastResult = outcome.result;
      if (outcome.invalid) {
        invalidRetries += 1;
        if (invalidRetries > 1) {
          const message =
            "The model kept selecting invalid tool arguments, so nothing was executed.";
          const result = outcome.result;
          turn.close();
          finishRun(run.id, result, message);
          return { handled: true, run: getRun(run.id), responseText: message, result };
        }
      }
    }

    // Every declared call is answered; only now may other roles be appended.
    turn.close();
    for (const contract of pendingContracts) {
      loop.turns.push({ role: "user", content: contract });
    }
    loop.stepsUsed += 1;
  }

  const message = lastResult
    ? `${composeResponse(lastResult, request)} (Stopped after ${maxSteps} tool steps — say "continue" to keep going.)`
    : "I stopped before executing anything — the request needed too many steps.";
  if (lastResult) finishRun(run.id, lastResult, message);
  return { handled: true, run: getRun(run.id), responseText: message, result: lastResult };
}

async function executeModelToolCall(
  run: CapabilityRun,
  call: ParsedToolCall,
  request: string,
  options: EngineOptions,
  loop: NonNullable<PendingExecution["modelLoop"]>,
  turn: ToolTurn,
  pendingContracts: string[],
): Promise<{
  result: ToolResult;
  invalid?: boolean;
  pause?: boolean;
  engineOutcome: EngineOutcome;
}> {
  const definition = getCapability(call.capabilityId);
  // Results are handed to the turn assembler, never appended here. Appending
  // inline is what let a `user` contract turn land between two tool results.
  const feedback = (result: ToolResult): void => {
    turn.settle(call.id, result);
  };

  // Provenance first, outcome later. Recorded before validation so a rejected
  // call is still visible — "the model asked for this and it did not run" is
  // exactly as important as a successful one.
  const traceKey = {
    runId: run.id,
    toolCallId: call.id,
    capabilityId: call.capabilityId,
  };
  recordExecutionTrace({
    ...traceKey,
    userRequest: request,
    modelRequestId: `${loop.adapter?.id ?? "none"}:${loop.model}:step-${loop.stepsUsed}`,
    modelResponseId: loop.lastResponseId,
    selectedBy: "model-tool-call",
    arguments: call.arguments,
    retrievalCandidates: [...loop.toolNames],
    validation: "skipped",
    executor:
      (definition?.executor as ExecutionTraceEntry["executor"]) ?? "unknown",
    startedAt: new Date().toISOString(),
  });

  // Unknown or invalid → validation error back to the model (retry once).
  if (!definition || !loop.toolNames.includes(call.capabilityId)) {
    const result: ToolResult = {
      callId: call.id,
      capabilityId: call.capabilityId,
      status: "error",
      summary: `"${call.capabilityId}" is not one of the provided tools.`,
      evidence: { verified: false, method: "not-verifiable" },
      error: { code: "unknown-tool", message: "Tool not in the provided set.", recoverable: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    completeExecutionTrace(traceKey, {
      validation: "failed",
      validationErrors: ["Tool not in the provided set."],
      resultStatus: result.status,
      resultSummary: result.summary,
      durationMs: 0,
    });
    feedback(result);
    return { result, invalid: true, engineOutcome: { handled: true } };
  }
  const validation = validateArguments(definition.inputSchema, call.arguments);
  if (!validation.valid) {
    const result: ToolResult = {
      callId: call.id,
      capabilityId: call.capabilityId,
      status: "error",
      summary: `Invalid arguments: ${validation.errors.join("; ")}`,
      evidence: { verified: false, method: "not-verifiable" },
      error: {
        code: "invalid-arguments",
        message: validation.errors.join("; "),
        recoverable: true,
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    completeExecutionTrace(traceKey, {
      validation: "failed",
      validationErrors: validation.errors,
      resultStatus: result.status,
      resultSummary: result.summary,
      durationMs: 0,
    });
    feedback(result);
    return { result, invalid: true, engineOutcome: { handled: true } };
  }

  // The confirmation gate, on the path the model actually uses.
  //
  // It existed only in `runSingleCapability`, which is the deterministic
  // router. Every model-selected call — which is almost all of them — reached
  // `executeCapability` directly, so "delete this task" from chat deleted it
  // without asking anything. Found by running three deletions physically and
  // watching all three go through in silence.
  if (!batchApproved.has(run.id) && needsFrontendConfirmation(call.capabilityId)) {
    const confirmation = buildFrontendConfirmation(run.id, call.capabilityId, call.arguments);
    // Rust decides whether this is a new question. A model that re-issues the
    // same call after being told it needs approval, or an overlay asking about
    // something chat already asked about, finds the existing action instead of
    // opening a rival one — and if the user has already said yes to it, the
    // call runs now rather than asking a second time.
    const gate = await openApprovalQuestion(
      run.id,
      options,
      call.capabilityId,
      call.arguments,
      confirmation.title,
      confirmation.description,
    );
    if (gate.proceedApproved) {
      const claimed = await claimPendingAction({
        actionId: gate.actionId!,
        runId: run.id,
        capabilityId: call.capabilityId,
        args: call.arguments,
      });
      // Claim refused means the action already ran, or may have. Reporting that
      // is the whole point of the store; running it again is the bug.
      if (!claimed.allowed) {
        return {
          result: {
            callId: call.id,
            capabilityId: call.capabilityId,
            status: "cancelled",
            summary: claimed.reason ?? "That was already handled.",
            evidence: { verified: false, method: "not-verifiable" },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
          },
          engineOutcome: { handled: true, responseText: claimed.reason },
        };
      }
    } else {
      pendingByRun.set(run.id, {
        capabilityId: call.capabilityId,
        args: call.arguments,
        actionId: gate.actionId,
        request,
        options,
        modelLoop: loop,
      });
      patchRun(run.id, {
        state: "awaiting-confirmation",
        confirmationRequired: true,
        confirmationStatus: "pending",
        pendingConfirmation: { ...confirmation, actionId: gate.actionId },
      });
      markAwaitingConfirmation(run.id, options, confirmation.title);
      return {
        result: {
          callId: call.id,
          capabilityId: call.capabilityId,
          status: "needs-confirmation",
          summary: confirmation.title,
          evidence: { verified: false, method: "not-verifiable" },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
        },
        pause: true,
        engineOutcome: {
          handled: true,
          run: getRun(run.id),
          responseText: confirmation.title,
          spokenText: confirmation.title,
          pendingConfirmation: { ...confirmation, actionId: gate.actionId },
        },
      };
    }
  }

  patchRun(
    run.id,
    { state: "executing", selectedCapabilityIds: [call.capabilityId] },
    statusLineFor(call.capabilityId, call.arguments),
  );
  progress(options, statusLineFor(call.capabilityId, call.arguments), call.capabilityId);

  const dispatchedAt = Date.now();
  const result = await executeCapability(
    call.capabilityId,
    call.arguments,
    run.id,
    request,
    undefined,
    options.origin,
  );
  completeExecutionTrace(traceKey, {
    validation: "passed",
    resultStatus: result.status,
    resultSummary: result.summary,
    durationMs: Date.now() - dispatchedAt,
  });
  // Same deposit on the model-tool path, which is the one production uses.
  await import("../conversation/productionBridge").then(({ recordEntitiesFromResult }) =>
    recordEntitiesFromResult(call.capabilityId, result),
  );

  if (result.status === "needs-confirmation") {
    // "Fix the file you made" that arrived as a create, on a file that exists.
    //
    // The user is asked nothing here. They already said what they wanted; the
    // wrong tool was picked, and correcting the tool is not a decision they
    // should have to make out loud — least of all repeatedly, which is what the
    // overwrite question turned it into.
    const reason = (result.data as { reason?: string; path?: string } | undefined) ?? {};
    if (
      shouldRedirectToModify({
        capabilityId: call.capabilityId,
        request,
        reason: reason.reason,
      })
    ) {
      const path =
        reason.path ??
        `${String(call.arguments.parent_path ?? "")}\\${String(call.arguments.name ?? "")}`;
      const redirect: ToolResult = {
        ...result,
        status: "error",
        summary: modifyRedirectMessage(path),
        error: {
          code: "wrong-tool-for-an-existing-file",
          message: modifyRedirectMessage(path),
          recoverable: true,
        },
        data: { redirectTo: "filesystem.modify_file", path },
      };
      feedback(redirect);
      return { result: redirect, engineOutcome: { handled: true } };
    }

    const confirmation = extractConfirmation(run.id, call.capabilityId, result);
    if (confirmation) {
      pendingByRun.set(run.id, {
        capabilityId: call.capabilityId,
        args: call.arguments,
        token: confirmation.token,
        request,
        options,
        modelLoop: loop,
        candidates: confirmation.candidates,
      });
      patchRun(run.id, {
        state: "awaiting-confirmation",
        confirmationRequired: true,
        confirmationStatus: "pending",
        pendingConfirmation: confirmation,
      });
      markAwaitingConfirmation(run.id, options, confirmation.title);
      return {
        result,
        pause: true,
        engineOutcome: {
          handled: true,
          run: getRun(run.id),
          responseText: result.summary,
          spokenText: result.summary,
          result,
          pendingConfirmation: confirmation,
        },
      };
    }
  }

  if (result.status === "success") recordCapabilitySuccess(call.capabilityId);
  recordSessionAction(request, call.capabilityId, result);
  logActivity(call.capabilityId, result, options);
  loop.toolExecutions += 1;
  feedback(result);

  // Brief the model for the sentence it is about to write. Without this it is
  // left to narrate from raw tool JSON, which is where "I have executed the
  // web.search tool" comes from — and it has no way to know the name policy or
  // that the user already heard about this folder two turns ago.
  if (result.status === "success") {
    try {
      const { buildResponsePlan, buildFinalResponseContract } = await import(
        "../conversation/responsePlan"
      );
      const { userFirstName } = await import("../../services/naturalReply");
      const facts = composeResponse(result, request);
      const plan = buildResponsePlan({
        capabilityId: call.capabilityId,
        result,
        facts,
      });
      // Queued, not appended: this is a `user` turn, and a user turn between
      // two tool results is exactly the protocol violation that broke chat.
      // It goes in after every declared call has been answered.
      pendingContracts.push(
        buildFinalResponseContract({
          originalRequest: request,
          plan,
          action: definition.displayName.toLowerCase(),
          verifiedFacts: facts,
          userFirstName: userFirstName() || undefined,
        }),
      );

      // A question the assistant is about to ask is state, not decoration.
      //
      // This is the fix for the reported break: the assistant said "want me to
      // open the first video?", the recommendation lived only as chip data and
      // as a sentence, and the next turn's "yes" had nothing to continue. Now
      // the offer is recorded with its resolved capability and arguments, so
      // "yes" continues *this* action instead of re-deriving one from words.
      const offer = plan.actions[0];
      if (offer) {
        const {
          setPendingAction,
          noteRecommendationOffered,
          latestResultSet,
        } = await import("../conversation/conversationContext");
        const set = latestResultSet();
        setPendingAction({
          actionType: offer.id,
          capabilityId: offer.capabilityId,
          args: offer.args,
          entityRefs: plan.entityRef ? [plan.entityRef] : [],
          resultSetId: set?.id,
          resultItemId:
            typeof offer.args.result_item_id === "string"
              ? offer.args.result_item_id
              : undefined,
          recommendationId: offer.id,
          promptShownToUser: offer.label,
        });
        noteRecommendationOffered({
          recommendationId: offer.id,
          actionType: offer.id,
          capabilityId: offer.capabilityId,
          entityRef: plan.entityRef,
        });
      }
    } catch {
      // No contract is survivable — the fact check still gates the reply.
    }
  }
  return { result, engineOutcome: { handled: true } };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Follow-ups about actions already taken this session ("where did I create
 * that folder?") must NOT re-enter tool selection — create/folder keywords
 * would retrieve mutation tools and the model might act again. Fall through
 * to conversational chat, which has session-action memory in the system prompt.
 */
function isSessionActionFollowUp(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q || getRecentSessionActions(1).length === 0) return false;
  if (
    /\b(create|make|new|delete|remove|trash|open|launch|start|write|save|rename|move|copy)\b/.test(
      q,
    ) &&
    !/\b(where|what|which|when|did you|have you|you (just )?(create|made|did)|that (folder|file)|the (folder|file) you)\b/.test(
      q,
    )
  ) {
    // Fresh action request, not a follow-up.
    return false;
  }
  return (
    /\bwhere (did|was|is) (that|the|it|you|i)\b/.test(q) ||
    /\bwhere did (you|i) (create|make|put|save)\b/.test(q) ||
    /\bwhat (did you|was that|folder|file|path)\b/.test(q) ||
    /\bwhich (folder|file|path)\b/.test(q) ||
    /\b(that|the) (folder|file) you (just )?(created|made|wrote)\b/.test(q) ||
    /\b(remind me|tell me) where\b/.test(q) ||
    /\b(did you|have you) (create|make|write|save)\b/.test(q)
  );
}

/**
 * Entry point for chat and voice. Returns handled=false when the request is
 * pure conversation (the caller then uses plain chat).
 */
/**
 * Turns a detected "missing detail" into a real model-written question.
 *
 * The guards in clarifyGuards.ts decide WHETHER something is missing (that has
 * to be deterministic — it gates whether an action runs). This decides HOW to
 * ask, and that goes through the model so the wording is natural and varies
 * between attempts instead of being a fixed string.
 *
 * `fallback` is used only when the model is unreachable — never as the norm.
 */
async function askForMissingDetail(
  request: string,
  fallback: string,
): Promise<string> {
  const instruction = [
    "The user asked you to do something but left out a detail you need.",
    `What they said: "${request}"`,
    `What is missing: ${fallback.replace(/^Sure — /, "").replace(/\?$/, "")}`,
    "Ask them for it in one short, friendly question. Do not perform the action.",
    "Do not claim anything was created, added, or searched. Reply with the question only.",
  ].join("\n");

  try {
    const { askAssistant } = await import("../../services/AssistantService");
    const reply = await Promise.race([
      askAssistant(instruction, {
        skipCapabilities: true,
        skipOrchestration: true,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("clarify timeout")), 6000),
      ),
    ]);
    const text = reply.text.trim().replace(/^["']|["']$/g, "");
    // A clarification is a short question; anything else means the model
    // wandered off and the deterministic wording is safer.
    if (!text || text.length > 200 || !text.includes("?")) return fallback;
    return text;
  } catch {
    return fallback;
  }
}

/**
 * Continue an action the assistant already offered.
 *
 * The model still chooses the tool — it is handed the pending action as context
 * and must ask for the capability by name. What the deterministic layer does is
 * decide *which* action is on the table and refuse anything that does not match
 * it. A regex that opened a browser on "yes" would be hidden execution; this is
 * an authorisation check around a model choice.
 */
async function runFollowUpTurn(
  request: string,
  options: EngineOptions,
): Promise<EngineOutcome | null> {
  const { resolveFollowUp } = await import("../conversation/confirmationIntent");
  const {
    resolvePendingAction,
    noteRecommendationOutcome,
    getResultSet,
  } = await import("../conversation/conversationContext");

  const resolution = resolveFollowUp(request);
  if (resolution.kind === "none") return null;

  // Nothing to continue, or the offer went stale. Both ask; neither acts.
  if (resolution.kind === "nothing-pending" || resolution.kind === "expired") {
    if (resolution.kind === "expired") {
      resolvePendingAction(resolution.action.id, "expired");
    }
    return {
      handled: true,
      responseText: resolution.question,
      spokenText: resolution.question,
      responseSource: "DETERMINISTIC_FALLBACK",
    };
  }

  if (resolution.kind === "decline") {
    resolvePendingAction(resolution.action.id, "declined");
    if (resolution.action.recommendationId) {
      noteRecommendationOutcome(resolution.action.recommendationId, "declined");
    }
    const message = "No problem — I'll leave it.";
    return {
      handled: true,
      responseText: message,
      spokenText: message,
      responseSource: "DETERMINISTIC_FALLBACK",
    };
  }

  if (resolution.kind === "more") {
    // Showing more is a fresh request, not a continuation; let normal routing
    // handle it rather than inventing a second page that may not exist.
    return null;
  }

  // Work out exactly what is authorised for this turn.
  const authorised =
    resolution.kind === "confirm"
      ? {
          capabilityId: resolution.action.capabilityId,
          args: resolution.action.args,
          pendingId: resolution.action.id,
          prompt: resolution.action.promptShownToUser,
          recommendationId: resolution.action.recommendationId,
        }
      : {
          capabilityId: "youtube.open_result",
          args: { result_set_id: resolution.set.id, result_item_id: resolution.item.id },
          pendingId: undefined as string | undefined,
          prompt: `Open “${resolution.item.title}”`,
          recommendationId: undefined as string | undefined,
        };

  const definition = getCapability(authorised.capabilityId);
  if (!definition) {
    const message = "I can't do that one from here.";
    return { handled: true, responseText: message, spokenText: message };
  }

  const run = startRun(request, "model-tool-call", {
    conversationId: options.conversationId,
    voiceSessionId: options.voiceSessionId,
  });

  const routeInfo = await resolveModelRoute();
  if (!routeInfo.adapter) {
    // No model to confirm with. Rather than execute unilaterally, say so —
    // the authorisation exists, but the choice was supposed to be the model's.
    const message =
      routeInfo.unavailable ?? "I can't reach the assistant to confirm that right now.";
    patchRun(run.id, { state: "cancelled" });
    return { handled: true, responseText: message, spokenText: message };
  }

  const contextLines = [
    "The user is answering a question you asked a moment ago.",
    `You asked: "${authorised.prompt}"`,
    `They replied: "${request}"`,
    resolution.kind === "ordinal"
      ? `They picked result ${resolution.item.ordinal}: "${resolution.item.title}".`
      : "",
    "",
    `Carry it out by calling ${toToolName(authorised.capabilityId)} with exactly these arguments:`,
    JSON.stringify(authorised.args),
    "Call that tool now. Do not call a different tool and do not change the arguments.",
  ].filter(Boolean);

  const loop = {
    adapter: routeInfo.adapter,
    model: routeInfo.model,
    turns: [
      { role: "system" as const, content: toolSystemPromptWithMemory() },
      { role: "user" as const, content: contextLines.join("\n") },
    ],
    toolNames: [authorised.capabilityId],
    stepsUsed: 0,
    providerCalls: 0,
    toolExecutions: 0,
  };

  patchRun(run.id, { state: "planning", selectedCapabilityIds: [authorised.capabilityId] });

  // Claim the action before anything runs. A replayed confirmation finds it
  // already spoken for and is refused — that is the exactly-once guarantee.
  if (authorised.pendingId) {
    if (!resolvePendingAction(authorised.pendingId, "accepted")) {
      const message = "I've already taken care of that one.";
      patchRun(run.id, { state: "cancelled" });
      return { handled: true, responseText: message, spokenText: message };
    }
    if (authorised.recommendationId) {
      noteRecommendationOutcome(authorised.recommendationId, "accepted");
    }
  }

  const outcome = await continueModelLoop(run, request, options, loop);

  if (authorised.pendingId) {
    const executed = loop.toolExecutions > 0;
    resolvePendingAction(authorised.pendingId, executed ? "executed" : "cancelled");
  }
  // Touch the set so an unused import cannot drift out of sync with the type.
  void getResultSet;
  return outcome;
}

/**
 * Answer a run that is parked on a confirmation, if this message is an answer.
 *
 * Only yes and no. Anything else — including a fresh instruction — leaves the
 * run parked and falls through to normal routing, because "delete the other one
 * instead" is a new request and must not be read as approval of the old one.
 */
async function answerPendingConfirmation(
  text: string,
  options: EngineOptions,
): Promise<EngineOutcome | null> {
  const key = conversationKey(options);
  const waiting = awaitingConfirmation.get(key);
  if (!waiting) return null;

  const { classifyConfirmation } = await import("../conversation/confirmationIntent");
  const kind = classifyConfirmation(text);
  if (kind !== "affirm" && kind !== "decline") return null;

  const claimed = takeAwaitingConfirmation(options);
  if (!claimed) {
    // The question went stale, or it was asked in the other origin. Say so
    // rather than acting on an approval nobody can point at.
    const message =
      "That went stale before you answered — tell me again and I'll redo it.";
    return {
      handled: true,
      responseText: message,
      spokenText: message,
      responseSource: "DETERMINISTIC_FALLBACK",
    };
  }

  return resolvePendingConfirmation(claimed.runId, kind === "affirm");
}

export async function handleCapabilityRequest(
  text: string,
  options: EngineOptions,
): Promise<EngineOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { handled: false };

  // A blocked run is answered before anything else is considered.
  //
  // This comes first because a pending confirmation is stronger than a pending
  // offer: the assistant is not suggesting something, it is stopped and waiting.
  // Routing "yes" anywhere else while a run is parked leaves that run hanging
  // forever, which is exactly what happened — the batch confirmation was shown,
  // "Yes, go ahead" was treated as a brand-new request, and the deletion never
  // ran or got cancelled.
  const answered = await answerPendingConfirmation(trimmed, options);
  if (answered) return answered;

  // Answering an outstanding offer takes precedence over fresh routing: "yes"
  // retrieves no capabilities at all, so without this it fell through to plain
  // chat and the assistant asked what the user meant.
  const followUp = await runFollowUpTurn(trimmed, options);
  if (followUp) return followUp;

  // Preference commands (always/forget) run before everything.
  const preference = await handlePreferenceCommand(trimmed, options);
  if (preference) return preference;

  // Follow-ups about recent verified actions → conversation + memory.
  if (isSessionActionFollowUp(trimmed)) {
    return { handled: false };
  }

  // Connected-service intents (Gmail / Calendar / Drive / …) belong to the
  // IntentOrchestrator — never let applications.open steal “what's on my
  // Gmail?” or “is my Gmail connected?”.
  const { classifyIntent, isOrchestratedDomain } = await import(
    "../orchestration/IntentClassifier"
  );
  if (isOrchestratedDomain(classifyIntent(trimmed))) {
    return { handled: false };
  }

  // Under-specified action requests ("create a task for me", "search
  // youtube"). These must NOT run — a titleless create fabricates a task, a
  // query-less search fails validation. The guards detect the situation; the
  // wording of the question comes from the model so it varies naturally and
  // is never a canned string.
  const missing = needsTaskTitle(trimmed) ?? needsSearchQuery(trimmed);
  if (missing) {
    const asked = await askForMissingDetail(trimmed, missing);
    return {
      handled: true,
      responseText: asked,
      spokenText: asked,
    };
  }

  // The model chooses every tool. There is deliberately no pattern-matching
  // stage in front of it.
  //
  // A deterministic router looks harmless until nothing is connected: it
  // answered "what time is it" from the system clock and opened Spotify
  // with no model configured, so the app appeared to work while the user
  // had connected nothing. Worse, regexes like /open (.+)/ read
  // "open Spotify and take a screenshot" as one app name.
  //
  // If this block reappears, that is the bug, not a feature.
  // Stage 2 — model tool selection only when no obvious local route matched.
  // Multi-step / ambiguous requests use the model; URL extract already handled above.
  const run = startRun(trimmed, "model-tool-call", {
    conversationId: options.conversationId,
    voiceSessionId: options.voiceSessionId,
  });
  const outcome = await runModelToolLoop(run, trimmed, options);
  if (!outcome.handled) {
    // Conversation — drop the placeholder run silently.
    patchRun(run.id, { state: "cancelled" });
  }
  return outcome;
}

/**
 * Resolve a pending confirmation. `approvedId` selects a candidate for
 * ambiguity confirmations; `approved=false` cancels.
 */
export async function resolvePendingConfirmation(
  runId: string,
  approved: boolean,
  approvedId?: string,
): Promise<EngineOutcome> {
  const pending = pendingByRun.get(runId);
  pendingByRun.delete(runId);
  // Answered one way or another, so it is no longer waiting — including when
  // the overlay's buttons resolved it and chat never saw the answer.
  clearAwaitingConfirmation(runId);
  if (!pending) {
    return { handled: true, responseText: "That confirmation has expired." };
  }
  const run = getRun(runId);
  if (!run) {
    return { handled: true, responseText: "That run no longer exists." };
  }
  if (!approved) {
    if (pending.actionId) await cancelPendingAction(pending.actionId);
    const result: ToolResult = {
      callId: "cancelled",
      capabilityId: pending.capabilityId,
      status: "cancelled",
      summary: "Cancelled — nothing was changed.",
      evidence: { verified: true, method: "state-readback" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    patchRun(runId, { state: "cancelled", confirmationStatus: "rejected" });
    finishRun(runId, result, result.summary);
    return {
      handled: true,
      run: getRun(runId),
      responseText: result.summary,
      spokenText: result.summary,
      result,
    };
  }

  patchRun(runId, { confirmationStatus: "approved", pendingConfirmation: undefined });

  // One answer, every enumerated item — and only those items.
  if (pending.batch) {
    return runApprovedBatch(runId, pending, pending.batch);
  }

  // Approving a name clash means "yes, replace it" — so the resumed call has to
  // say so. Without this the resumed call is byte-identical to the one that
  // asked, the file still exists, and the same question comes straight back.
  // That loop is what made "yes" do nothing, forever.
  let args = pending.args;
  if (
    pending.capabilityId === "filesystem.create_file" ||
    pending.capabilityId === "filesystem.write_text_file"
  ) {
    args = { ...args, if_exists: "overwrite" };
  }

  // The answer is recorded and spent in Rust, once.
  //
  // This is what stops a second "yes" — spoken to the overlay while chat also
  // sends one, or re-arriving because the model asked again — from producing a
  // second execution. `approve` is idempotent by design; `claim` is not, and a
  // refused claim means the action has already run or may have.
  //
  // The claim carries `pending.args`, not the overwrite-escalated `args`: the
  // question was opened over what the user was shown, and re-fingerprinting the
  // escalated form would refuse the very approval it belongs to.
  if (pending.actionId) {
    const decision = await approvePendingAction(pending.actionId);
    if (!decision.allowed) {
      const reason = decision.reason ?? "That was already handled.";
      patchRun(runId, { state: "completed", confirmationStatus: "approved" });
      return { handled: true, responseText: reason, spokenText: reason };
    }
    const claimed = await claimPendingAction({
      actionId: pending.actionId,
      runId,
      capabilityId: pending.capabilityId,
      args: pending.args,
    });
    if (!claimed.allowed) {
      const reason = claimed.reason ?? "That was already handled.";
      patchRun(runId, { state: "completed" });
      return { handled: true, responseText: reason, spokenText: reason };
    }
  }

  // Ambiguity selection: re-run with the chosen target.
  if (approvedId && pending.candidates?.length) {
    if (pending.capabilityId === "applications.open") {
      args = { ...args, target_id: approvedId };
      delete (args as Record<string, unknown>).query;
      // The user explicitly picked this target — learn it as confirmed.
      if (typeof pending.args.query === "string") {
        recordAliasSuccess(pending.args.query, approvedId, "native", true);
      }
    } else if (pending.capabilityId === "filesystem.delete") {
      args = { ...args, paths: [approvedId] };
    } else if (pending.capabilityId === "screen.capture") {
      args = { ...args, target: "window", window_id: approvedId, application_query: null };
    } else if (pending.capabilityId.startsWith("tasks.")) {
      args = { ...args, task_id: approvedId, title_query: null };
    }
  }

  if (pending.modelLoop) {
    // Resume the paused model loop with the executed result.
    const result = await executeCapability(
      pending.capabilityId,
      args,
      runId,
      pending.request,
      pending.token,
      pending.options.origin,
    );
    // Terminal either way: the action is done with, so a later redelivery gets
    // "already done" rather than a fresh execution.
    if (pending.actionId) {
      await settlePendingAction(pending.actionId, result.status === "success");
    }
    // NOT a tool message. The paused turn was already closed with a result for
    // every declared call, so appending another `tool` here — under the invented
    // id "confirmed", which matched no declared call — produced a history the
    // provider rejected while the real call still looked unanswered.
    pending.modelLoop.turns.push({
      role: "user",
      content: [
        "The user approved the action, and it has now run.",
        `Result: ${JSON.stringify(compactToolResult(result))}`,
        "Tell them what happened, in one or two natural sentences.",
      ].join("\n"),
    });
    logActivity(pending.capabilityId, result, pending.options);
    return continueModelLoop(run, pending.request, pending.options, pending.modelLoop);
  }

  // "user-approved" is a sentinel for frontend-confirmed capabilities that
  // have no native token; it prevents re-prompting in the confirm gate.
  const outcome = await runSingleCapability(
    run,
    pending.capabilityId,
    args,
    pending.request,
    pending.options,
    pending.token ?? "user-approved",
  );
  if (pending.actionId) {
    await settlePendingAction(pending.actionId, outcome.result?.status === "success");
  }
  return outcome;
}

export function hasPendingConfirmation(runId: string): boolean {
  return pendingByRun.has(runId);
}

/**
 * Run every item the user approved, in the order they were shown, once each.
 *
 * Each item is executed and reported individually. A batch that half-succeeds
 * says so: "two deleted, one could not be saved" is the truth, and rounding it
 * to "done" is exactly the failure the durable-write work exists to prevent.
 *
 * The idempotency key is the tool-call id, so a redelivered call cannot delete
 * a second thing — the same guarantee `approval_plan.rs` enforces on the Rust
 * side for callers that go through the plan store.
 */
async function runApprovedBatch(
  runId: string,
  pending: PendingExecution,
  batch: DeletionBatch,
): Promise<EngineOutcome> {
  batchApproved.add(runId);
  const run = getRun(runId);
  const done: Array<{ label: string; ok: boolean }> = [];
  let lastResult: ToolResult | undefined;

  for (const item of batch.items) {
    const result = await executeCapability(
      item.capabilityId,
      item.arguments,
      runId,
      pending.request,
      // Approved as part of the enumerated list, so the per-item gate must not
      // ask again. The list *is* the confirmation.
      "user-approved",
      pending.options.origin,
      item.toolCallId,
    );
    lastResult = result;
    done.push({ label: item.label, ok: result.status === "success" });
    logActivity(item.capabilityId, result, pending.options);
  }

  const ok = done.filter((d) => d.ok);
  const failed = done.filter((d) => !d.ok);
  const summary =
    failed.length === 0
      ? `Done — ${ok.map((d) => `“${d.label}”`).join(", ")}.`
      : `${ok.length} of ${done.length} done. ${failed
          .map((d) => `“${d.label}” didn't`)
          .join(", ")}.`;

  if (pending.modelLoop) {
    pending.modelLoop.turns.push({
      role: "user",
      content: [
        "The user approved this list, and every item has now run.",
        `Results: ${JSON.stringify(done)}`,
        "Tell them what happened in one or two natural sentences. Do not repeat the list unless something failed.",
      ].join("\n"),
    });
    return continueModelLoop(
      run ?? getRun(runId)!,
      pending.request,
      pending.options,
      pending.modelLoop,
    );
  }

  if (lastResult) finishRun(runId, lastResult, summary);
  return {
    handled: true,
    run: getRun(runId),
    responseText: summary,
    spokenText: summary,
    result: lastResult,
  };
}

/**
 * Execute one capability by id — the entry point for OpenAI Realtime tool
 * calls, where the *model* has already chosen the capability and arguments.
 *
 * This deliberately skips the deterministic router: with Realtime, tool
 * selection is the model's job. Schema validation, the confirmation gate and
 * the audit trail still apply, so a spoken conversation cannot reach a
 * destructive action without passing the same checks as typed chat.
 */
/** Known Windows folders the voice model often passes instead of a full path. */
const KNOWN_FOLDER_ALIASES = new Set([
  "desktop",
  "documents",
  "downloads",
  "pictures",
  "videos",
  "music",
  "home",
  "app-data",
  "local-app-data",
]);

/**
 * Voice models often pass a known-folder name as parent_path, or nest args.
 * Normalize before schema validation so create-folder doesn't bounce as
 * invalid-arguments mid-conversation.
 */
function normalizeVoiceToolArgs(
  capabilityId: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  let args = { ...raw };
  // Some models wrap fields in `parameters`.
  if (
    args.parameters &&
    typeof args.parameters === "object" &&
    !Array.isArray(args.parameters)
  ) {
    args = { ...(args.parameters as Record<string, unknown>) };
  }

  if (capabilityId === "filesystem.create_directory") {
    // `{ folder: "desktop", name: "x" }` → resolve desktop then create.
    if (typeof args.folder === "string" && !args.parent_path) {
      const f = args.folder.trim().toLowerCase();
      if (KNOWN_FOLDER_ALIASES.has(f)) {
        args.__known_parent = f;
        delete args.folder;
      }
    }
    // `parent_path: "desktop"` (no slashes) → known folder.
    if (typeof args.parent_path === "string") {
      const p = args.parent_path.trim();
      const lower = p.toLowerCase();
      if (!/[\\/]/.test(p) && KNOWN_FOLDER_ALIASES.has(lower)) {
        args.__known_parent = lower;
        delete args.parent_path;
      }
    }
    // Drop empty optional flags that sometimes arrive as "".
    if (args.recursive === "" || args.recursive === "false") delete args.recursive;
    if (args.recursive === "true") args.recursive = true;
  }

  if (capabilityId === "filesystem.resolve_known_folder") {
    if (typeof args.folder === "string") {
      args.folder = args.folder.trim().toLowerCase();
    }
  }

  // Datetime tools: models often send junk fields; keep only known ones.
  if (capabilityId === "system.get_local_datetime") {
    const next: Record<string, unknown> = {};
    if (typeof args.format === "string") next.format = args.format;
    if (typeof args.include_timezone === "boolean") {
      next.include_timezone = args.include_timezone;
    }
    return next;
  }

  return args;
}

export async function executeCapabilityById(
  capabilityId: string,
  args: Record<string, unknown>,
  request: string,
  options: EngineOptions,
  /** Set once the user has agreed to a previously-returned confirmation. */
  confirmed = false,
  /** Caller's identity for this request, so a retry cannot create a duplicate. */
  idempotencyKey?: string,
): Promise<EngineOutcome> {
  const definition = getCapability(capabilityId);
  if (!definition) {
    return {
      handled: true,
      responseText: `I don't have a "${capabilityId}" capability on this machine.`,
    };
  }

  const normalized = normalizeVoiceToolArgs(capabilityId, args);
  // __known_parent is resolved inside runSingleCapability; hide it from schema check.
  const forSchema = { ...normalized };
  const hasKnownParent = typeof forSchema.__known_parent === "string";
  if (hasKnownParent) {
    delete forSchema.__known_parent;
    // Satisfy required parent_path for schema only; real path is filled later.
    if (!forSchema.parent_path) forSchema.parent_path = "__pending_known_folder__";
  }
  const validation = validateArguments(definition.inputSchema, forSchema);

  if (!validation.valid) {
    // Hand the reason back to the model so it can fix its own arguments —
    // never surface schema wording to the user as speech.
    return {
      handled: true,
      responseText: `invalid-arguments: ${validation.errors.join(", ")}. Fix the tool call arguments and call the tool again. Do not read this message aloud.`,
      result: {
        callId: "invalid-args",
        capabilityId,
        status: "error",
        summary: `invalid-arguments: ${validation.errors.join(", ")}`,
        evidence: { verified: false, method: "not-verifiable" },
        error: {
          code: "invalid-arguments",
          message: validation.errors.join(", "),
          recoverable: true,
        },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      },
    };
  }

  const run = startRun(request, "model-tool-call", {
    voiceSessionId: options.voiceSessionId,
  });
  // Drop placeholder before execute if we only injected it for schema.
  if (hasKnownParent && forSchema.parent_path === "__pending_known_folder__") {
    delete normalized.parent_path;
  }
  return runSingleCapability(
    run,
    capabilityId,
    normalized,
    request,
    options,
    // "user-approved" is the sentinel for an approval that came from the
    // conversation rather than a native token.
    confirmed ? "user-approved" : undefined,
    idempotencyKey,
  );
}
