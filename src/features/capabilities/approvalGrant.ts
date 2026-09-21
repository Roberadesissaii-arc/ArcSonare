/**
 * The approval side of the permission split, and the file `permissionPolicy.ts`
 * has referred to since it was written.
 *
 * `permissionPolicy.ts` answers "does this need asking?". This answers "has it
 * already been asked, and what did the user say?" — and it answers it by asking
 * Rust, never by consulting a module-level `Map`.
 *
 * That distinction is the whole fix for the repeated-permission problem. The
 * capability engine kept its pending questions in `pendingByRun`, a `Map` in
 * the module scope. The main window and `sonare-overlay` are separate WebView2
 * heaps, so there were always two of those maps, they never agreed, and a
 * question answered in one window stayed open in the other. Rust is the only
 * place both windows can see, so Rust owns:
 *
 *   - whether a question is currently open        (`pending_awaiting`)
 *   - whether an identical one is already open    (`pending_open` → created)
 *   - what the user answered                      (`pending_approve` / cancel)
 *   - that the answer is spent exactly once       (`pending_claim`)
 *
 * What stays in TypeScript is the part that cannot cross a heap: the paused
 * model loop and the closure that resumes it. The decision crosses; the
 * continuation does not.
 */

import { invoke } from "@tauri-apps/api/core";
import { actionRisk, type ActionRisk } from "./permissionPolicy";

export type ApprovalScope = "exact-action" | "action-plan" | "current-task";

export type PendingActionState =
  | "awaiting-approval"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface PendingAction {
  actionId: string;
  runId: string;
  conversationId: string;
  planFingerprint: string;
  risk: ActionRisk;
  scope: ApprovalScope;
  state: PendingActionState;
  createdAtMs: number;
  expiresAtMs: number;
  title: string;
  description: string;
  sideEffectPossible: boolean;
}

export interface OpenOutcome {
  action: PendingAction;
  /** `false` when an identical question was already open — do not ask again. */
  created: boolean;
  /** Already answered yes; proceed straight to `claimPendingAction`. */
  alreadyApproved: boolean;
}

export interface PendingDecision {
  allowed: boolean;
  action?: PendingAction;
  error?: string;
  reason?: string;
}

/**
 * Whether the Rust side is reachable.
 *
 * The engine runs under `tsx` in the check scripts, where there is no Tauri
 * host unless a stub registered one. A missing backend must not be read as "no
 * approval needed" — every caller below fails closed, which for an approval
 * question means "ask", not "proceed".
 */
function backendAvailable(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";
}

/**
 * Open a question, or find the one already open for this exact action.
 *
 * Callers must branch on `created`: a `false` means some other window (or an
 * earlier turn of this one) already asked, and asking again is the bug.
 */
export async function openPendingAction(input: {
  runId: string;
  conversationId: string;
  capabilityId: string;
  args: Record<string, unknown>;
  risk?: ActionRisk;
  scope?: ApprovalScope;
  title: string;
  description?: string;
}): Promise<OpenOutcome | null> {
  if (!backendAvailable()) return null;
  try {
    return await invoke<OpenOutcome>("pending_open", {
      request: {
        runId: input.runId,
        conversationId: input.conversationId,
        capabilityId: input.capabilityId,
        arguments: input.args,
        risk: input.risk ?? actionRisk(input.capabilityId),
        scope: input.scope ?? "exact-action",
        title: input.title,
        description: input.description ?? "",
      },
    });
  } catch {
    return null;
  }
}

/**
 * Record the user's yes.
 *
 * Idempotent in Rust, so a "yes" spoken to the overlay while chat also sends
 * one produces one approval and therefore one execution.
 */
export async function approvePendingAction(actionId: string): Promise<PendingDecision> {
  if (!backendAvailable()) return { allowed: false, reason: "backend-unavailable" };
  try {
    return await invoke<PendingDecision>("pending_approve", { actionId });
  } catch (e) {
    return { allowed: false, reason: String(e) };
  }
}

export async function cancelPendingAction(actionId: string): Promise<PendingDecision> {
  if (!backendAvailable()) return { allowed: false, reason: "backend-unavailable" };
  try {
    return await invoke<PendingDecision>("pending_cancel", { actionId });
  } catch (e) {
    return { allowed: false, reason: String(e) };
  }
}

/**
 * Spend the approval, exactly once.
 *
 * The arguments are re-sent so Rust can re-fingerprint them: an approval is for
 * what the user saw, and a resumed call that quietly gained a field is not that.
 */
export async function claimPendingAction(input: {
  actionId: string;
  runId: string;
  capabilityId: string;
  args: Record<string, unknown>;
}): Promise<PendingDecision> {
  if (!backendAvailable()) return { allowed: false, reason: "backend-unavailable" };
  try {
    return await invoke<PendingDecision>("pending_claim", {
      claim: {
        actionId: input.actionId,
        runId: input.runId,
        capabilityId: input.capabilityId,
        arguments: input.args,
      },
    });
  } catch (e) {
    return { allowed: false, reason: String(e) };
  }
}

/**
 * Mark the point past which retrying is no longer safe.
 *
 * Called by an executor immediately before the irreversible part — the click is
 * sent, the request leaves, the write begins. After this, a failure is an
 * unknown rather than a no, and Rust refuses to re-run it on its own.
 */
export async function markSideEffectPossible(actionId: string): Promise<void> {
  if (!backendAvailable()) return;
  try {
    await invoke("pending_mark_side_effect", { actionId });
  } catch {
    /* best effort: a missed mark makes retry *more* cautious, never less */
  }
}

export async function settlePendingAction(
  actionId: string,
  succeeded: boolean,
): Promise<void> {
  if (!backendAvailable()) return;
  try {
    await invoke("pending_settle", { actionId, succeeded });
  } catch {
    /* the TTL sweeps it either way */
  }
}

/** The question currently on screen for a conversation, in either window. */
export async function awaitingPendingAction(
  conversationId: string,
): Promise<PendingAction | null> {
  if (!backendAvailable()) return null;
  try {
    return (await invoke<PendingAction | null>("pending_awaiting", { conversationId })) ?? null;
  } catch {
    return null;
  }
}

/** Drop every open question for a conversation — it closed, or voice ended. */
export async function revokePendingForConversation(conversationId: string): Promise<void> {
  if (!backendAvailable()) return;
  try {
    await invoke("pending_revoke_conversation", { conversationId });
  } catch {
    /* nothing to clean up if the backend is gone */
  }
}

// ---------------------------------------------------------------------------
// Request-scoped grants
//
// The other half: `pending_*` is one question about one action, and this is one
// answer covering a described plan. Both live in Rust for the same reason.
// ---------------------------------------------------------------------------

/** The vocabulary `approval.rs` speaks — narrower than `ActionRisk` by design. */
export type GrantRisk = "read-only" | "reversible" | "moderate" | "destructive";

/**
 * Record that the user approved a described plan.
 *
 * Returns the grant id, or `null` when Rust refused to issue one — which it
 * does for destructive plans and for anything above read-only that did not name
 * its capabilities. A `null` here means "keep asking per action", never "assume
 * approved".
 */
export async function grantRequestApproval(input: {
  requestId: string;
  accountId: string;
  conversationId?: string;
  origin: string;
  approvedRisk: GrantRisk;
  approvedCapabilities: string[];
  approvedResourceScope?: string[];
  planId?: string;
}): Promise<string | null> {
  if (!backendAvailable()) return null;
  try {
    return (
      (await invoke<string | null>("approval_grant", {
        request: {
          requestId: input.requestId,
          planId: input.planId ?? null,
          accountId: input.accountId,
          conversationId: input.conversationId ?? null,
          origin: input.origin,
          approvedRisk: input.approvedRisk,
          approvedCapabilities: input.approvedCapabilities,
          approvedResourceScope: input.approvedResourceScope ?? [],
        },
      })) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Whether an already-approved plan covers this step.
 *
 * Fails closed: an unreachable backend returns `false`, so the caller asks.
 */
export async function stepIsCovered(input: {
  requestId: string;
  accountId: string;
  conversationId?: string;
  origin: string;
  capabilityId: string;
  risk: GrantRisk;
  resource?: string;
  externalRecipient?: boolean;
}): Promise<boolean> {
  if (!backendAvailable()) return false;
  try {
    const decision = await invoke<{ allowed: boolean }>("approval_covers", {
      step: {
        requestId: input.requestId,
        accountId: input.accountId,
        conversationId: input.conversationId ?? null,
        origin: input.origin,
        capabilityId: input.capabilityId,
        risk: input.risk,
        resource: input.resource ?? null,
        externalRecipient: input.externalRecipient ?? false,
      },
    });
    return decision?.allowed === true;
  } catch {
    return false;
  }
}

export async function revokeGrantForConversation(conversationId: string): Promise<void> {
  if (!backendAvailable()) return;
  try {
    await invoke("approval_revoke_conversation", { conversationId });
  } catch {
    /* best effort */
  }
}

/** How many steps a grant covered. For the permission-count tests. */
export async function grantUses(requestId: string): Promise<number> {
  if (!backendAvailable()) return 0;
  try {
    return (await invoke<number>("approval_uses", { requestId })) ?? 0;
  } catch {
    return 0;
  }
}
