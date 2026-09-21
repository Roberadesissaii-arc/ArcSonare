/**
 * Bridges ArcSonare capabilities to OpenAI Realtime tools.
 *
 * With Realtime, the model chooses the tool — that is the point of moving off
 * the deterministic router. This module only translates: capability → tool
 * schema on the way out, tool call → capability execution on the way back.
 */

import { getCapability } from "../../features/capabilities/capabilityRegistry";
import {
  executeCapabilityById,
  type EngineOptions,
} from "../../features/capabilities/capabilityEngine";
import { fromToolName } from "../../features/capabilities/providerToolAdapter";
import { composeResponse } from "../../features/capabilities/capabilityResponseComposer";

export { buildRealtimeTools, type RealtimeTool } from "./realtimeToolSchemas";

/**
 * The last call that came back needing confirmation.
 *
 * The bridge used to tell the model "call again once they agree" — but calling
 * again produced the identical prompt, because nothing carried the approval.
 * That looped forever, asking permission over and over for one file write.
 *
 * An identical repeat of a call we just asked about IS the approval.
 */
let awaitingConfirm: { key: string; at: number } | null = null;
const CONFIRM_WINDOW_MS = 2 * 60 * 1000;

/**
 * Identity of a call for confirmation purposes: which capability, acting on
 * which thing. Deliberately ignores volatile payload like `content`.
 *
 * Hashing every argument meant approving "overwrite prime_finder.py" did not
 * match the retry, because the model sent corrected content the second time.
 * The user approved the file, not the bytes.
 */
const IDENTITY_KEYS = [
  "path",
  "parent_path",
  "name",
  "source_path",
  "target_path",
  "destination",
  "query",
  "folder",
];

function callKey(capabilityId: string, args: Record<string, unknown>): string {
  const identity: Record<string, unknown> = {};
  for (const k of IDENTITY_KEYS) {
    if (args[k] !== undefined) identity[k] = args[k];
  }
  return `${capabilityId}:${JSON.stringify(identity)}`;
}

export interface ToolCallOutcome {
  /** JSON string returned to the model as the tool output. */
  output: string;
  /** Human-readable text, for the transcript panel. */
  display: string;
}

/** Avoid flooding the model / UI with giant directory listings mid-voice. */
function compactToolData(
  capabilityId: string | undefined,
  data: unknown,
): unknown {
  if (!data || typeof data !== "object") return data ?? null;
  const d = data as Record<string, unknown>;
  if (
    capabilityId?.startsWith("filesystem.") &&
    (Array.isArray(d.entries) || Array.isArray(d.items) || Array.isArray(d.files))
  ) {
    const list = (d.entries ?? d.items ?? d.files) as unknown[];
    return {
      ...d,
      entries: undefined,
      items: undefined,
      files: undefined,
      count: list.length,
      sample: list.slice(0, 5),
    };
  }
  return data;
}

/** Capsule-safe one-liner; never “11 folders” while opening Spotify. */
function shortOverlayDisplay(capabilityId: string | undefined, display: string): string {
  const t = display.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (capabilityId === "applications.open") {
    return t.length > 48 ? t.slice(0, 47) + "…" : t;
  }
  if (capabilityId?.startsWith("filesystem.")) {
    // Don't put folder dumps in the voice capsule at all.
    return "";
  }
  if (capabilityId === "screen.click_target" || capabilityId === "input.click_at") {
    return t.length > 48 ? t.slice(0, 47) + "…" : t;
  }
  // Any long multi-sentence tool result stays off the capsule.
  if (t.length > 56 || /\bfolders?\b/i.test(t) && !/open/i.test(t)) {
    return "";
  }
  return t;
}

/**
 * Run one Realtime tool call and produce the output the model gets back.
 *
 * The model is told the *result*, not a pre-written sentence — it phrases the
 * spoken reply itself. Errors are returned as data too, so the model can
 * correct its arguments rather than announcing a failure to the user.
 */
export async function dispatchRealtimeToolCall(
  toolName: string,
  rawArguments: string,
  options: EngineOptions,
  /**
   * The Realtime API's own `call_id`.
   *
   * Used as the idempotency key: the session redelivers a tool call if the
   * output is not acknowledged, and a redelivery must not create a second task.
   */
  callId?: string,
): Promise<ToolCallOutcome> {
  const capabilityId = fromToolName(toolName);

  let args: Record<string, unknown> = {};
  if (rawArguments.trim()) {
    try {
      args = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      return {
        output: JSON.stringify({ error: "arguments were not valid JSON" }),
        display: "",
      };
    }
  }

  if (!getCapability(capabilityId)) {
    return {
      output: JSON.stringify({ error: `unknown tool "${toolName}"` }),
      display: "",
    };
  }

  try {
    const key = callKey(capabilityId, args);
    const fresh =
      awaitingConfirm &&
      awaitingConfirm.key === key &&
      Date.now() - awaitingConfirm.at < CONFIRM_WINDOW_MS;
    if (fresh) awaitingConfirm = null;

    const outcome = await executeCapabilityById(
      capabilityId,
      args,
      `voice: ${capabilityId}`,
      options,
      Boolean(fresh),
      callId,
    );

    if (outcome.pendingConfirmation) {
      return {
        output: JSON.stringify({
          status: "needs-confirmation",
          message: outcome.pendingConfirmation.title,
          instruction:
            "Ask the user to confirm in one short spoken question. When they say yes, call the SAME tool again with the SAME corrected arguments. Never read tool names, JSON, or error codes aloud.",
        }),
        display: outcome.pendingConfirmation.title,
      };
    }

    const result = outcome.result;
    if (!result) {
      const msg = outcome.responseText ?? "no result";
      // Schema feedback is for the model only — do not put it on the overlay.
      const isArgFix = /invalid-arguments/i.test(msg);
      return {
        output: JSON.stringify({
          status: "error",
          message: msg,
          instruction: isArgFix
            ? "Correct the arguments and call the tool again. Do not speak the error or JSON to the user."
            : undefined,
        }),
        display: isArgFix ? "" : msg,
      };
    }
    if (result.error?.code === "invalid-arguments") {
      return {
        output: JSON.stringify({
          status: "error",
          message: result.error.message,
          instruction:
            "Correct the arguments and call the tool again. Do not speak the error or JSON to the user.",
        }),
        display: "",
      };
    }

    // Overlay must never show an unrelated compose (e.g. folder counts while
    // opening Spotify). Prefer the verified tool summary only.
    const display =
      (result.summary && result.summary.trim()) ||
      composeResponse(result, "") ||
      "";
    return {
      output: JSON.stringify({
        status: result.status,
        summary: result.summary,
        // Keep data for the model; strip huge listing arrays so the spoken
        // reply stays on-topic for the current request.
        data: compactToolData(result.capabilityId, result.data),
      }),
      // Never put long listing dumps on the capsule — short action labels only.
      display: shortOverlayDisplay(result.capabilityId, display),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: JSON.stringify({ status: "error", message }),
      display: "",
    };
  }
}
