/**
 * The one place a provider-visible tool turn is assembled.
 *
 * Providers enforce a protocol that is easy to state and easy to break:
 *
 *   assistant(tool_calls: [A, B])
 *     → tool(tool_call_id: A)
 *     → tool(tool_call_id: B)
 *     → assistant(final answer)
 *
 * Every declared call needs exactly one result, the results must come
 * immediately after the assistant message, and nothing may be interleaved. Break
 * it and the provider rejects the whole request with "An assistant message with
 * tool_calls must be followed by tool messages responding to each tool_call_id"
 * — which the user sees as the app being broken, with no clue why.
 *
 * Three ways the engine broke it, all fixed by routing through here:
 *
 *   1. A `user` turn carrying the final-response contract was appended after the
 *      first tool result, so a second tool result landed after a user message.
 *   2. A call that paused for confirmation returned early, leaving the remaining
 *      declared calls with no results at all — permanently malformed history.
 *   3. The confirmation resume appended `tool_call_id: "confirmed"`, an id that
 *      matched no declared call, while the real one stayed unanswered.
 *
 * A tool that fails, is refused, times out, or is never reached still gets a
 * result message. "Nothing to say" is not an option the protocol allows.
 */

import type { ChatTurn } from "./providerToolAdapter";
import type { ParsedToolCall, ToolResult } from "./capabilityTypes";
import { compactToolResult, toToolName } from "./providerToolAdapter";

/** Why a declared call has no real result of its own. */
export type UnsettledReason =
  | "awaiting-confirmation"
  | "not-executed"
  | "cancelled"
  | "timed-out"
  | "refused";

interface Outstanding {
  call: ParsedToolCall;
  result?: ToolResult;
  unsettled?: UnsettledReason;
}

/** One assistant turn and the calls it declared. */
export class ToolTurn {
  private readonly outstanding: Outstanding[];
  private closed = false;

  private constructor(
    private readonly turns: ChatTurn[],
    calls: ParsedToolCall[],
  ) {
    this.outstanding = calls.map((call) => ({ call }));
  }

  /**
   * Append the assistant message declaring these calls.
   *
   * From here the turn is a debt: every declared id owes a result before
   * anything else may be appended.
   */
  static begin(
    turns: ChatTurn[],
    assistantText: string,
    calls: ParsedToolCall[],
  ): ToolTurn {
    turns.push({
      role: "assistant",
      content: assistantText,
      toolCalls: calls.map((c) => ({
        id: c.id,
        name: toToolName(c.capabilityId),
        arguments: JSON.stringify(c.arguments),
      })),
    });
    return new ToolTurn(turns, calls);
  }

  settle(callId: string, result: ToolResult): void {
    const entry = this.outstanding.find((o) => o.call.id === callId);
    if (entry) entry.result = result;
  }

  /**
   * Mark a call that will not produce a real result, and why.
   *
   * First reason wins. The caller marks the paused call and then sweeps the
   * rest, and a second pass must not relabel the specific reason ("awaiting
   * confirmation") with the generic one it uses for everything else.
   */
  leaveUnsettled(callId: string, reason: UnsettledReason): void {
    const entry = this.outstanding.find((o) => o.call.id === callId);
    if (entry && !entry.result && !entry.unsettled) entry.unsettled = reason;
  }

  /** Declared calls with neither a result nor a recorded reason. */
  unansweredIds(): string[] {
    return this.outstanding
      .filter((o) => !o.result && !o.unsettled)
      .map((o) => o.call.id);
  }

  /**
   * Append exactly one tool message per declared call, in declaration order.
   *
   * Idempotent: closing twice appends nothing the second time, so a resumed or
   * retried path cannot double-write the results.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.outstanding) {
      const payload = entry.result
        ? compactToolResult(entry.result)
        : syntheticResult(entry.call, entry.unsettled ?? "not-executed");
      this.turns.push({
        role: "tool",
        toolCallId: entry.call.id,
        content: JSON.stringify(payload),
      });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * A structured stand-in for a call that produced no result.
 *
 * Deliberately explicit rather than an empty object: the model reads this, and
 * "this did not run, here is why" leads to a better next turn than silence.
 */
function syntheticResult(call: ParsedToolCall, reason: UnsettledReason) {
  return {
    capability: call.capabilityId,
    status: reason === "awaiting-confirmation" ? "awaiting-user-confirmation" : "not-executed",
    reason,
    message:
      reason === "awaiting-confirmation"
        ? "Paused — waiting for the user to confirm this action."
        : `This call did not run (${reason}).`,
    verified: false,
  };
}

// ---------------------------------------------------------------------------
// Validation and repair
// ---------------------------------------------------------------------------

export interface TurnValidation {
  valid: boolean;
  problems: string[];
}

/**
 * Check a history before it is sent to a provider.
 *
 * Cheap, and it turns a provider-side rejection — opaque, mid-conversation —
 * into something diagnosable locally.
 */
export function validateTurns(turns: ChatTurn[]): TurnValidation {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];

    if (turn.role === "assistant" && turn.toolCalls?.length) {
      const declared = turn.toolCalls.map((c) => c.id);
      for (const id of declared) {
        if (seenIds.has(id)) problems.push(`duplicate tool_call_id "${id}"`);
        seenIds.add(id);
      }
      // The next `declared.length` turns must be the matching tool results.
      const answers = turns.slice(i + 1, i + 1 + declared.length);
      if (answers.length < declared.length) {
        problems.push(
          `assistant at ${i} declared ${declared.length} call(s) but only ${answers.length} result(s) follow`,
        );
      }
      answers.forEach((answer, offset) => {
        if (answer.role !== "tool") {
          problems.push(
            `expected a tool result at ${i + 1 + offset}, found role "${answer.role}"`,
          );
        } else if (answer.toolCallId !== declared[offset]) {
          problems.push(
            `tool result at ${i + 1 + offset} answers "${answer.toolCallId}", expected "${declared[offset]}"`,
          );
        }
      });
      i += declared.length;
      continue;
    }

    if (turn.role === "tool") {
      // A tool result reached here without an assistant tool_calls message
      // immediately before it.
      problems.push(`orphan tool result at ${i} (tool_call_id "${turn.toolCallId}")`);
    }
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Make a malformed history safe to send.
 *
 * Repair, not rescue: an assistant turn whose results cannot be reconstructed is
 * dropped along with its orphans rather than guessed at. Losing a turn of model
 * context is recoverable; sending a history the provider rejects is not, and
 * inventing tool results the tools never produced would be worse than both.
 */
export function repairTurns(turns: ChatTurn[]): {
  turns: ChatTurn[];
  repaired: boolean;
  dropped: number;
} {
  if (validateTurns(turns).valid) return { turns, repaired: false, dropped: 0 };

  const out: ChatTurn[] = [];
  let dropped = 0;

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];

    if (turn.role === "tool") {
      // Orphan: its assistant message is gone or out of order.
      dropped += 1;
      continue;
    }

    if (turn.role === "assistant" && turn.toolCalls?.length) {
      const declared = turn.toolCalls.map((c) => c.id);
      const answers = new Map<string, ChatTurn>();
      // Collect any matching results that follow, in any order.
      for (let j = i + 1; j < turns.length && answers.size < declared.length; j += 1) {
        const candidate = turns[j];
        if (candidate.role !== "tool") break;
        if (candidate.toolCallId && declared.includes(candidate.toolCallId)) {
          answers.set(candidate.toolCallId, candidate);
        }
      }
      if (answers.size === 0) {
        // Nothing to pair it with. Keep the model's words, drop the call.
        if (turn.content.trim()) out.push({ role: "assistant", content: turn.content });
        dropped += 1;
        i += 0;
        continue;
      }
      out.push(turn);
      for (const id of declared) {
        const answer = answers.get(id);
        out.push(
          answer ?? {
            role: "tool",
            toolCallId: id,
            content: JSON.stringify({
              status: "not-executed",
              reason: "missing-from-history",
              message: "No result was recorded for this call.",
              verified: false,
            }),
          },
        );
      }
      i += answers.size;
      continue;
    }

    out.push(turn);
  }

  return { turns: out, repaired: true, dropped };
}
