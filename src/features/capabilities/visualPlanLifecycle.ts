/**
 * One visual action, from plan to verified result.
 *
 * Visual capabilities used to run straight off the model's tool call: capture,
 * look, click, done — with no plan behind them. That is not wrong in itself, but
 * it means the thing that decided a click was appropriate never hears how it
 * went. The risk level it assigned, the identifiers it stamped, and the rule
 * that a possible side effect forbids a retry all evaporate at the moment the
 * click happens.
 *
 * So a visual action now starts as a plan, is fulfilled by the existing vision
 * pipeline, and is closed against the plan that asked for it — carrying the same
 * four identifiers the whole way.
 */
import type { ToolResult } from "./capabilityTypes";
import type { VisualExecutionRequest } from "./plannerBridge";
import { completeVisualAction } from "./plannerBridge";

/** Where a visual action has got to. */
export type VisualPlanState =
  | "awaiting-capture"
  | "awaiting-model"
  | "target-resolved"
  | "executing"
  | "verifying"
  | "completed"
  | "partial"
  | "failed";

export interface PendingVisualPlan {
  requestId: string;
  planId: string;
  runId: string;
  correlationId: string;
  intent: string;
  targetDescription: string;
  requestedAction: "preview" | "move" | "click";
  riskLevel: string;
  state: VisualPlanState;
  startedAt: number;
}

const pending = new Map<string, PendingVisualPlan>();

/**
 * A plan is identified by plan id *and* correlation id together.
 *
 * Either alone would be enough in the happy path. Together they mean a result
 * carrying a mismatched pair cannot close a plan it does not belong to — which
 * is the failure that would otherwise be silent.
 */
export function planKey(planId: string, correlationId: string): string {
  return `${planId}::${correlationId}`;
}

export function beginVisualPlan(
  request: VisualExecutionRequest,
  runId: string,
): PendingVisualPlan {
  const plan: PendingVisualPlan = {
    requestId: request.requestId,
    planId: request.planId,
    runId,
    correlationId: request.correlationId,
    intent: String(request.intent),
    targetDescription: request.targetDescription,
    requestedAction: request.requiresClick ? "click" : "preview",
    riskLevel: request.riskLevel,
    state: "awaiting-capture",
    startedAt: Date.now(),
  };
  pending.set(planKey(plan.planId, plan.correlationId), plan);
  return plan;
}

export function advanceVisualPlan(
  plan: PendingVisualPlan,
  state: VisualPlanState,
): void {
  const key = planKey(plan.planId, plan.correlationId);
  const live = pending.get(key);
  if (!live) return;
  live.state = state;
  plan.state = state;
}

export function getVisualPlan(
  planId: string,
  correlationId: string,
): PendingVisualPlan | undefined {
  return pending.get(planKey(planId, correlationId));
}

export function activeVisualPlans(): PendingVisualPlan[] {
  return [...pending.values()];
}

/** Test seam. Production never needs to forget a plan wholesale. */
export function resetVisualPlans(): void {
  pending.clear();
}

export interface VisualCompletion {
  status: string;
  sideEffectPossible: boolean;
  summary: string;
  displayId?: number;
  verification?: { verified: boolean; detail: string } | null;
}

export type CompletionOutcome =
  | { ok: true; result: ReturnType<typeof completeVisualAction> }
  | { ok: false; reason: "unknown-plan" | "already-completed" | "identity-mismatch" };

/**
 * Close a visual plan with its final result. Exactly once.
 *
 * The second completion is the dangerous one. A retry handler, a duplicated
 * event, or a model that calls the tool twice would otherwise append a second
 * activity entry and — worse — could promote a partial into a success without
 * any new evidence. So a plan is removed from the map as it completes, and a
 * later attempt is refused rather than absorbed.
 */
export function finishVisualPlan(
  request: VisualExecutionRequest,
  visual: VisualCompletion,
): CompletionOutcome {
  const key = planKey(request.planId, request.correlationId);
  const plan = pending.get(key);
  if (!plan) {
    // Either it never started, or it already finished. Both mean this result
    // has nothing to close, and inventing a plan to match it would defeat the
    // identity check entirely.
    return { ok: false, reason: "already-completed" };
  }
  if (plan.requestId !== request.requestId) {
    return { ok: false, reason: "identity-mismatch" };
  }
  pending.delete(key);
  const result = completeVisualAction(request, visual);
  plan.state =
    result.status === "succeeded"
      ? "completed"
      : result.status === "partially-completed"
        ? "partial"
        : "failed";
  return { ok: true, result };
}

/**
 * Read a visual outcome out of the tool result the vision pipeline produced.
 *
 * The executor already reports honestly — `partial` for a click that was sent
 * but not verified — so this reads what it said rather than re-deciding.
 */
export function completionFromToolResult(result: ToolResult): VisualCompletion {
  const data = (result.data ?? {}) as {
    status?: string;
    side_effect_possible?: boolean;
    display_id?: number;
    verification?: { verified: boolean; detail: string } | null;
  };
  return {
    status: data.status ?? (result.status === "success" ? "verified-succeeded" : "failed"),
    // Absent means the click never happened; a missing flag must not be read as
    // "safe to retry" when the underlying result says otherwise.
    sideEffectPossible: data.side_effect_possible ?? false,
    summary: result.summary,
    displayId: data.display_id,
    verification: data.verification ?? null,
  };
}
