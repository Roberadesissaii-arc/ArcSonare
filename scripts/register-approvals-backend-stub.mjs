/**
 * A working fake of the approval half of the Rust backend.
 *
 * Same reasoning as `register-watch-backend-stub.mjs`: the defects here live in
 * the *round trip*, not in any one function. "The overlay asked, chat answered,
 * and it ran twice" cannot be expressed by a rejecting `invoke` — it needs a
 * store that behaves like the real one, so a test can drive both windows
 * against it and watch them agree or fail to.
 *
 * The semantics below mirror `src-tauri/src/capabilities/pending.rs` exactly:
 *
 *  - an identical still-live action is returned rather than duplicated;
 *  - `approve` is idempotent, `claim` is not;
 *  - a claim re-fingerprints the arguments, so a substituted one is refused;
 *  - a failure past `mark_side_effect` cannot retry, a clean one can;
 *  - `awaiting` is per conversation, which is what makes both windows agree.
 *
 * `executionCount` is the assertion that matters most: it counts what actually
 * ran, so "asked once" and "ran once" are separately checkable.
 */
import { register } from "node:module";

register("./asset-stub-loader.mjs", import.meta.url);

/** action_id → action */
const actions = new Map();
/** request_id → grant */
const grants = new Map();
let nextId = 1;

export const approvalCalls = {
  open: 0,
  approve: 0,
  cancel: 0,
  claim: 0,
  settle: 0,
  awaiting: 0,
  /** Claims that were allowed — i.e. things that actually got to run. */
  executionCount: 0,
  /** Actions newly created, i.e. questions the user would actually see. */
  questionsAsked: 0,
};

export function resetApprovals() {
  actions.clear();
  grants.clear();
  nextId = 1;
  for (const k of Object.keys(approvalCalls)) approvalCalls[k] = 0;
}

/** Canonical JSON — the same rule `pending.rs::canonical` applies. */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${k}:${canonical(value[k])}`).join(",")}}`;
}

function fingerprint(capabilityId, args) {
  return `${capabilityId}::${canonical(args ?? {})}`;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function decide(actionOrError) {
  if (typeof actionOrError === "string") {
    return { allowed: false, error: actionOrError, reason: MESSAGES[actionOrError] };
  }
  return { allowed: true, action: actionOrError };
}

const MESSAGES = {
  unknown: "That request is not on record.",
  expired: "That request expired before it was answered.",
  "not-approved": "That has not been approved yet.",
  "already-resolved": "That was already answered.",
  "already-executing": "That is already running.",
  "already-executed": "That has already been done.",
  "action-changed": "That changed after you approved it.",
  "different-run": "That approval belongs to a different request.",
  "side-effect-possible": "That may already have taken effect, so I won't run it again.",
};

const handlers = {
  pending_open({ request }) {
    approvalCalls.open += 1;
    const fp = fingerprint(request.capabilityId, request.arguments);
    for (const action of actions.values()) {
      if (
        action.planFingerprint === fp &&
        action.runId === request.runId &&
        action.conversationId === request.conversationId &&
        !TERMINAL.has(action.state)
      ) {
        return {
          action,
          created: false,
          alreadyApproved: action.state === "approved" || action.state === "executing",
        };
      }
    }
    const now = Date.now();
    const action = {
      actionId: `pending-${nextId++}`,
      runId: request.runId,
      conversationId: request.conversationId,
      planFingerprint: fp,
      risk: request.risk,
      scope: request.scope,
      state: "awaiting-approval",
      createdAtMs: now,
      expiresAtMs: now + 180_000,
      title: request.title ?? "",
      description: request.description ?? "",
      sideEffectPossible: false,
    };
    actions.set(action.actionId, action);
    approvalCalls.questionsAsked += 1;
    return { action, created: true, alreadyApproved: false };
  },

  pending_approve({ actionId }) {
    approvalCalls.approve += 1;
    const action = actions.get(actionId);
    if (!action) return decide("unknown");
    if (Date.now() >= action.expiresAtMs) return decide("expired");
    switch (action.state) {
      case "awaiting-approval":
        action.state = "approved";
        return decide(action);
      // Saying yes twice is one yes.
      case "approved":
        return decide(action);
      case "executing":
        return decide("already-executing");
      case "completed":
      case "failed":
        return decide("already-executed");
      default:
        return decide("already-resolved");
    }
  },

  pending_cancel({ actionId }) {
    approvalCalls.cancel += 1;
    const action = actions.get(actionId);
    if (!action) return decide("unknown");
    if (TERMINAL.has(action.state)) return decide("already-resolved");
    action.state = "cancelled";
    return decide(action);
  },

  pending_claim({ claim }) {
    approvalCalls.claim += 1;
    const action = actions.get(claim.actionId);
    if (!action) return decide("unknown");
    if (Date.now() >= action.expiresAtMs) return decide("expired");
    if (action.runId !== claim.runId) return decide("different-run");
    if (action.planFingerprint !== fingerprint(claim.capabilityId, claim.arguments)) {
      return decide("action-changed");
    }
    switch (action.state) {
      case "awaiting-approval":
        return decide("not-approved");
      case "approved":
        action.state = "executing";
        approvalCalls.executionCount += 1;
        return decide(action);
      case "executing":
        return decide("already-executing");
      case "completed":
        return decide("already-executed");
      case "failed":
        if (action.sideEffectPossible) return decide("side-effect-possible");
        action.state = "executing";
        approvalCalls.executionCount += 1;
        return decide(action);
      default:
        return decide("already-resolved");
    }
  },

  pending_mark_side_effect({ actionId }) {
    const action = actions.get(actionId);
    if (action) action.sideEffectPossible = true;
    return null;
  },

  pending_settle({ actionId, succeeded }) {
    approvalCalls.settle += 1;
    const action = actions.get(actionId);
    if (!action) return null;
    action.state = succeeded ? "completed" : "failed";
    return action;
  },

  pending_awaiting({ conversationId }) {
    approvalCalls.awaiting += 1;
    const open = [...actions.values()]
      .filter(
        (a) => a.conversationId === conversationId && a.state === "awaiting-approval",
      )
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
    return open[0] ?? null;
  },

  pending_get({ actionId }) {
    return actions.get(actionId) ?? null;
  },

  pending_revoke_conversation({ conversationId }) {
    for (const [id, a] of actions) {
      if (a.conversationId === conversationId) actions.delete(id);
    }
    return null;
  },

  // --- request-scoped grants (approval.rs) -------------------------------

  approval_grant({ request }) {
    // Rust refuses a destructive grant, and refuses a blanket grant above
    // read-only. Mirrored so a test cannot pass here and fail in production.
    if (request.approvedRisk === "destructive") return null;
    if (
      (request.approvedCapabilities ?? []).length === 0 &&
      request.approvedRisk !== "read-only"
    ) {
      return null;
    }
    grants.set(request.requestId, { request, uses: 0, issued: Date.now() });
    return request.requestId;
  },

  approval_covers({ step }) {
    if (step.externalRecipient) {
      return { allowed: false, miss: "external-recipient" };
    }
    if (step.risk === "destructive") return { allowed: false, miss: "risk-increased" };
    const grant = grants.get(step.requestId);
    if (!grant) return { allowed: false, miss: "no-grant" };
    const order = ["read-only", "reversible", "moderate", "destructive"];
    const approved = grant.request;
    if (approved.accountId !== step.accountId) {
      return { allowed: false, miss: "different-account" };
    }
    if (approved.origin !== step.origin) return { allowed: false, miss: "different-origin" };
    if (order.indexOf(step.risk) > order.indexOf(approved.approvedRisk)) {
      return { allowed: false, miss: "risk-increased" };
    }
    const caps = approved.approvedCapabilities ?? [];
    if (caps.length > 0 && !caps.includes(step.capabilityId)) {
      return { allowed: false, miss: "capability-outside-plan" };
    }
    grant.uses += 1;
    return { allowed: true };
  },

  approval_uses({ requestId }) {
    return grants.get(requestId)?.uses ?? 0;
  },

  approval_revoke_conversation({ conversationId }) {
    for (const [id, g] of grants) {
      if (g.request.conversationId === conversationId) grants.delete(id);
    }
    return null;
  },
};

/** Commands this stub deliberately does not model, answered as unavailable. */
function unhandled(command) {
  throw new Error(`approvals stub: no handler for "${command}"`);
}

globalThis.__TAURI_INTERNALS__ = {
  transformCallback: (cb) => cb,
  invoke: async (command, payload = {}) => {
    const handler = handlers[command];
    if (!handler) return unhandled(command);
    return handler(payload);
  },
};

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.__TAURI_INTERNALS__ = globalThis.__TAURI_INTERNALS__;
