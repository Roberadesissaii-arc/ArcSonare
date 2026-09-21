/**
 * Developer-only provenance for every chat tool execution.
 *
 * The claim "the model chose this tool" is not verifiable by reading the reply —
 * a deterministic router and a model tool call produce the same sentence. This
 * records the chain so the claim can be checked: what the user asked, which
 * schemas retrieval offered, which one the model called and with what id,
 * whether validation passed, which executor ran it, and what came back.
 *
 * Nothing here is user-facing. It is read from the developer console via
 * `window.__arcsonareTrace`, never rendered in chat.
 */

export interface ExecutionTraceEntry {
  /** Correlates every step of one user request. */
  runId: string;
  /** Verbatim user request that started the run. */
  userRequest: string;
  /** Provider request/response identity, when the adapter exposes one. */
  modelRequestId?: string;
  modelResponseId?: string;
  /** Tool call id the model emitted. Absent for non-model paths. */
  toolCallId?: string;
  /** How this capability came to be selected. */
  selectedBy: "model-tool-call" | "resumed-confirmation" | "direct-invocation";
  capabilityId: string;
  /** Structured arguments the model supplied. */
  arguments: Record<string, unknown>;
  /** Capability ids retrieval offered the model for this run. */
  retrievalCandidates: string[];
  validation: "passed" | "failed" | "skipped";
  validationErrors?: string[];
  executor: "native" | "frontend" | "planner" | "unknown";
  resultStatus?: string;
  resultSummary?: string;
  durationMs?: number;
  startedAt: string;
}

const MAX_ENTRIES = 100;
let entries: ExecutionTraceEntry[] = [];
const listeners = new Set<() => void>();

export function recordExecutionTrace(entry: ExecutionTraceEntry): void {
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  listeners.forEach((l) => l());
}

/** Fill in the outcome of an already-recorded call, matched on tool call id. */
export function completeExecutionTrace(
  key: { runId: string; toolCallId?: string; capabilityId: string },
  outcome: Partial<
    Pick<
      ExecutionTraceEntry,
      | "resultStatus"
      | "resultSummary"
      | "durationMs"
      | "executor"
      | "validation"
      | "validationErrors"
    >
  >,
): void {
  let patched = false;
  entries = entries.map((e) => {
    if (patched) return e;
    if (
      e.runId === key.runId &&
      e.capabilityId === key.capabilityId &&
      e.toolCallId === key.toolCallId &&
      e.resultStatus === undefined
    ) {
      patched = true;
      return { ...e, ...outcome };
    }
    return e;
  });
  if (patched) listeners.forEach((l) => l());
}

/**
 * Where an assistant answer's wording came from.
 *
 * Separate from the tool trace because the question it answers is different:
 * not "did the model pick the tool?" but "did the model write the sentence, or
 * did a template?". Both used to be invisible, and the second is what made
 * successful actions read as canned.
 */
export interface ResponseProvenance {
  runId: string;
  capabilityId: string;
  source: "MODEL_GENERATED" | "DETERMINISTIC_FALLBACK";
  /** Set only when a template was used, so "why canned?" has an answer. */
  fallbackReason?: string;
  providerCalls: number;
  toolExecutions: number;
  at: string;
}

const MAX_PROVENANCE = 50;
let provenance: ResponseProvenance[] = [];

export function recordResponseProvenance(
  entry: Omit<ResponseProvenance, "at">,
): void {
  provenance = [...provenance, { ...entry, at: new Date().toISOString() }].slice(
    -MAX_PROVENANCE,
  );
  listeners.forEach((l) => l());
}

export function getResponseProvenance(): ResponseProvenance[] {
  return provenance;
}

/** The most recent answer's provenance — what the developer panel shows. */
export function latestResponseProvenance(): ResponseProvenance | undefined {
  return provenance[provenance.length - 1];
}

export function getExecutionTrace(): ExecutionTraceEntry[] {
  return entries;
}

/** Everything recorded for one run, oldest first. */
export function getRunTrace(runId: string): ExecutionTraceEntry[] {
  return entries.filter((e) => e.runId === runId);
}

export function subscribeExecutionTrace(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function clearExecutionTrace(): void {
  entries = [];
  provenance = [];
  listeners.forEach((l) => l());
}

/**
 * Expose the trace on `window` for developer inspection.
 *
 * Deliberately not a React view: putting it on screen is how internal ids end
 * up in front of normal users, which is the defect this work is fixing.
 */
export function installTraceConsoleHook(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>).__arcsonareTrace = {
    all: getExecutionTrace,
    run: getRunTrace,
    responses: getResponseProvenance,
    lastResponse: latestResponseProvenance,
    clear: clearExecutionTrace,
  };
}
