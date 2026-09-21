/**
 * A visual action must belong to the plan that asked for it.
 *
 * Visual capabilities used to run straight off the model's tool call. The click
 * happened, the pipeline verified it, and then the result went nowhere: the
 * plan that decided a click was appropriate never heard how it went, so its
 * risk level, its identifiers and its "a possible side effect forbids a retry"
 * rule all stopped mattering at the moment they mattered most.
 *
 * These checks cover the bookkeeping that fixes that — one switch, one plan,
 * one completion, identifiers intact — and the honesty of the mapping from a
 * low-level visual outcome to a planner result.
 *
 * Run: npx tsx scripts/check-visual-dispatch.mts
 */

import { readFileSync } from "node:fs";
import {
  completeVisualAction,
  isVisualCapability,
  toActionRequest,
  type VisualExecutionRequest,
} from "../src/features/capabilities/plannerBridge";
import {
  beginVisualPlan,
  completionFromToolResult,
  finishVisualPlan,
  getVisualPlan,
  resetVisualPlans,
} from "../src/features/capabilities/visualPlanLifecycle";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const visualRequest = (over: Partial<VisualExecutionRequest> = {}): VisualExecutionRequest => ({
  correlationId: "corr-1",
  requestId: "req-1",
  planId: "plan-1",
  intent: "click-target",
  targetDescription: "the blue test button",
  requiresClick: true,
  requiresOverlay: false,
  expectedOutcome: { kind: "region-changed" },
  riskLevel: "moderate",
  ...over,
});

// ------------------------------------------------- visual intents are planned
{
  check(
    "clicking and highlighting are planner-routed",
    isVisualCapability("screen.click_target") &&
      isVisualCapability("screen.highlight_target"),
    "both go through the switch",
  );
  check(
    "describing the screen is not wrapped in a plan",
    // It changes nothing, needs no cursor and has no outcome to verify.
    !isVisualCapability("screen.understand"),
    "screen.understand stays direct",
  );

  const click = toActionRequest("screen.click_target", { target: "the blue button" }, "chat");
  check(
    "a click request becomes a click intent with a description, not a coordinate",
    click?.intent === "click-target" &&
      click.target.kind === "visual-description" &&
      click.target.description === "the blue button",
    `${click?.intent} / ${String(click?.target.description)}`,
  );
  const point = toActionRequest(
    "screen.click_target",
    { target: "the blue button", click: false },
    "chat",
  );
  check(
    "point-only is a highlight, so it never asks for the cursor",
    point?.intent === "highlight-target",
    `click:false -> ${point?.intent}`,
  );
  const highlight = toActionRequest("screen.highlight_target", { target: "x" }, "chat");
  check(
    "highlighting is a highlight intent",
    highlight?.intent === "highlight-target",
    String(highlight?.intent),
  );
  check(
    "no visual request ever carries a display id from this side",
    // The planner does not know which screen the thing is on, and neither does
    // TypeScript — the frame decides that, later.
    [click, point, highlight].every((r) => r?.target.displayId === null),
    "displayId is always null at plan time",
  );
}

// --------------------------------------------------------- identity survives
{
  resetVisualPlans();
  const req = visualRequest();
  const plan = beginVisualPlan(req, "run-9");
  check(
    "a plan records all four identifiers",
    plan.requestId === "req-1" &&
      plan.planId === "plan-1" &&
      plan.runId === "run-9" &&
      plan.correlationId === "corr-1",
    `${plan.requestId}/${plan.planId}/${plan.runId}/${plan.correlationId}`,
  );

  const closed = finishVisualPlan(req, {
    status: "verified-succeeded",
    sideEffectPossible: true,
    summary: "Clicked the blue test button.",
    verification: { verified: true, detail: "the test target received exactly 1 click(s)" },
  });
  check(
    "the verified result closes the original plan, unchanged",
    closed.ok &&
      closed.result.requestId === "req-1" &&
      closed.result.planId === "plan-1" &&
      closed.result.status === "succeeded",
    closed.ok ? `${closed.result.planId} -> ${closed.result.status}` : "not closed",
  );
  check(
    "a closed plan is no longer pending",
    getVisualPlan("plan-1", "corr-1") === undefined,
    "removed on completion",
  );
}

// ---------------------------------------------------------- exactly once
{
  resetVisualPlans();
  const req = visualRequest();
  beginVisualPlan(req, "run-9");
  const first = finishVisualPlan(req, {
    status: "verified-succeeded",
    sideEffectPossible: true,
    summary: "Clicked.",
    verification: { verified: true, detail: "one click" },
  });
  const second = finishVisualPlan(req, {
    status: "verified-succeeded",
    sideEffectPossible: true,
    summary: "Clicked.",
    verification: { verified: true, detail: "one click" },
  });
  check(
    "a second completion is refused, not absorbed",
    first.ok && !second.ok && second.reason === "already-completed",
    // Absorbing it would append a second activity entry and could promote a
    // partial to a success with no new evidence.
    second.ok ? "accepted twice" : String(second.reason),
  );
}
{
  resetVisualPlans();
  const req = visualRequest();
  beginVisualPlan(req, "run-9");
  const wrong = finishVisualPlan(visualRequest({ requestId: "req-OTHER" }), {
    status: "verified-succeeded",
    sideEffectPossible: true,
    summary: "Clicked.",
  });
  check(
    "a result from a different request cannot close this plan",
    !wrong.ok && wrong.reason === "identity-mismatch",
    wrong.ok ? "accepted a foreign result" : String(wrong.reason),
  );
  check(
    "and the real plan is still open afterwards",
    getVisualPlan("plan-1", "corr-1") !== undefined,
    "not consumed by the mismatch",
  );
}

// ------------------------------------------------- honest result mapping
{
  const cases: Array<[string, boolean, string]> = [
    ["preview-succeeded", false, "succeeded"],
    ["verified-succeeded", true, "succeeded"],
    // Sent but unproven. The click may well have registered, so this is neither
    // a success to report nor a failure to retry.
    ["verification-failed", true, "partially-completed"],
    ["no-verifier-available", true, "partially-completed"],
    // Nothing happened, so a fresh capture and another go is legitimate.
    ["screen-changed-before-action", false, "not-found"],
    ["cursor-position-mismatch", false, "failed"],
    ["target-window-changed", false, "failed"],
  ];
  const wrong = cases.filter(([status, side, expected]) => {
    const r = completeVisualAction(visualRequest(), {
      status,
      sideEffectPossible: side,
      summary: status,
    });
    return r.status !== expected;
  });
  check(
    "every visual outcome maps to the planner status it deserves",
    wrong.length === 0,
    wrong.length ? `wrong: ${wrong.map(([s]) => s).join(", ")}` : `${cases.length} mappings`,
  );

  const partial = completeVisualAction(visualRequest(), {
    status: "verification-failed",
    sideEffectPossible: true,
    summary: "The click was sent but nothing visibly changed.",
  });
  check(
    "a sent-but-unverified click is never reported as completed",
    partial.status === "partially-completed",
    partial.status,
  );
}

// ------------------------------------ the tool result carries the truth through
{
  const sentNotVerified: ToolResult = {
    callId: "c",
    capabilityId: "screen.click_target",
    status: "partial",
    summary: "The click was sent but nothing visibly changed.",
    data: {
      status: "verification-failed",
      side_effect_possible: true,
      verification: { verified: false, detail: "nothing changed" },
    },
    evidence: { verified: false, method: "return-code" },
    startedAt: "",
    completedAt: "",
    durationMs: 1,
  };
  const completion = completionFromToolResult(sentNotVerified);
  check(
    "the side-effect flag survives the trip back from the executor",
    completion.sideEffectPossible && completion.status === "verification-failed",
    `${completion.status} sideEffect=${completion.sideEffectPossible}`,
  );

  const refused: ToolResult = {
    ...sentNotVerified,
    status: "not-found",
    data: { status: "screen-changed-before-action", side_effect_possible: false },
  };
  check(
    "a pre-click refusal is not marked as having had a side effect",
    completionFromToolResult(refused).sideEffectPossible === false,
    "retry is allowed only when nothing happened",
  );
}

// ------------------------------------------------- the switch is actually wired
{
  const engine = readFileSync("src/features/capabilities/capabilityEngine.ts", "utf8");
  const fn = engine.slice(
    engine.indexOf("async function executeCapability("),
    engine.indexOf("/** Resolve router placeholders"),
  );
  check(
    "the engine dispatches on the planner disposition",
    fn.includes("planAndDispatchAction") && fn.includes("switch (disposition.disposition)"),
    "one central switch",
  );
  check(
    "every disposition variant is handled",
    ["executed", "requires-vision", "unsupported"].every((c) => fn.includes(`case "${c}"`)) &&
      fn.includes("const unreachable: never"),
    // The never-assignment is what makes a new variant a compile error rather
    // than a silent fall through into the direct path.
    "exhaustive, with a compile-time guard",
  );
  check(
    "visual capabilities enter the switch before the frontend executor",
    fn.indexOf("isVisualCapability") < fn.indexOf('definition?.executor === "frontend"'),
    // They are frontend-executed, so the old order meant they never reached the
    // planner at all.
    "planner first",
  );
  check(
    "a visual plan is fulfilled, not executed inline",
    fn.includes("fulfillVisualPlan(disposition"),
    "delegated with the plan context",
  );

  const fulfil = engine.slice(
    engine.indexOf("async function fulfillVisualPlan("),
    engine.indexOf("async function executeCapability("),
  );
  check(
    "fulfilment reuses the existing vision pipeline",
    fulfil.includes("executeFrontendCapability"),
    // Rebuilding it here would mean two pipelines, and the second would be the
    // one without freshness, ownership and verification.
    "no second vision pipeline",
  );
  check(
    "fulfilment passes the plan's correlation id down, and does not mint one",
    fulfil.includes("correlation_id: visualRequest.correlationId") &&
      !fulfil.includes("newCorrelationId"),
    "id flows down from the plan",
  );
  check(
    "fulfilment closes the plan",
    fulfil.includes("finishVisualPlan"),
    "completion is not optional",
  );
  check(
    "there is no direct planner-bypassing visual call left in the engine",
    !engine.includes('executeFrontendCapability("screen.'),
    "visual work only via fulfillVisualPlan",
  );
}

console.log(failed === 0 ? "\nAll visual dispatch checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
