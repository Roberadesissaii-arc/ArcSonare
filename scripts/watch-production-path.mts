/**
 * Send a request the way the Send button does, and report what actually ran.
 *
 * This replaces driving the composer through the system clipboard. Pasting a
 * sentence into an input proved only that a paste happened: it destroyed the
 * user's clipboard, it was unreliable — it twice pasted the wrong text into a
 * live test — and it said nothing about whether the planner chose the right
 * capability or whether the adapter was read fresh.
 *
 * So the harness enters where `CommandComposer` enters: `askAssistant`. Nothing
 * is stubbed past that point. The conversation id, the active scope, the scope
 * version, the relevance gate, prompt construction, tool execution, the response
 * guard and the per-turn provenance ledger all run exactly as they do for a
 * typed message, and what comes back is the evidence.
 *
 * Not a suite — a tool the suites and I use:
 *
 *     tsx --import ./scripts/register-watch-backend-stub.mjs \
 *         scripts/watch-production-path.mts "what's playing"
 */

import { askAssistant } from "../src/services/AssistantService";
import { setCurrentConversation } from "../src/features/watch/watchScopeStore";
import { setConversationScope } from "../src/features/conversation/conversationContext";
import {
  beginWatchTurn,
  endWatchTurn,
  resetWatchProvenance,
  type TurnProvenance,
} from "../src/features/watch/watchProvenance";
import { lastWatchPromptTrace } from "../src/features/watch/watchPromptContext";

export interface ProductionTurn {
  /** What the user would have seen in the bubble. */
  text: string;
  /** Applications credited for this turn, from the ledger. */
  contributors: string[];
  /** The full ledger, including which adapters ran. */
  provenance: TurnProvenance | null;
  /** Which applications reached the prompt, and why. */
  promptTrace: ReturnType<typeof lastWatchPromptTrace>;
  /** Action chips attached to the reply — the activation affordance. */
  actions: Array<{ label: string; capabilityId: string }>;
}

/**
 * Run one turn through the production path.
 *
 * `conversationId` is set on both stores because that is what the composer's
 * environment provides; a turn without one silently skips the whole scope
 * mechanism, which would make every assertion below vacuous.
 */
export async function sendThroughProductionPath(
  requestText: string,
  conversationId: string,
): Promise<ProductionTurn> {
  // Both, exactly as the app does it: `setConversationScope` points the ledger
  // and the watch scope at the same conversation, and the second call is the
  // belt-and-braces for a harness that may reuse the same id across runs.
  setConversationScope(conversationId, "test-account");
  setCurrentConversation(conversationId);

  resetWatchProvenance();
  // `askAssistant` opens and closes its own turn; this outer pair keeps the
  // ledger readable afterwards, since the inner close is re-entrant.
  beginWatchTurn();
  const reply = await askAssistant(requestText);
  const { currentTurnProvenance, turnContributors } = await import(
    "../src/features/watch/watchProvenance"
  );
  const provenance = currentTurnProvenance();
  const contributors = turnContributors();
  endWatchTurn();

  return {
    text: reply.text,
    contributors,
    provenance,
    promptTrace: lastWatchPromptTrace(),
    actions: (reply.actions ?? []).map((a) => ({
      label: a.label,
      capabilityId: a.capabilityId,
    })),
  };
}

/** Tokens that must never appear in anything a user reads. */
export const FORBIDDEN_IN_REPLY = [
  "DSML",
  "toolcalls",
  "tool_calls",
  "invoke name",
  "<|",
  "|>",
];

/** Which forbidden tokens a reply leaked, if any. */
export function protocolLeaks(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_IN_REPLY.filter((token) => lower.includes(token.toLowerCase()));
}

// Run directly for a one-off check against the stub backend.
if (process.argv[2]) {
  const turn = await sendThroughProductionPath(process.argv[2], "conv-manual");
  console.log("\ntext        :", turn.text);
  console.log("contributors:", turn.contributors);
  console.log("adapters    :", turn.provenance?.adaptersQueried);
  console.log("contextMode :", turn.promptTrace?.contextMode);
  console.log("actions     :", turn.actions.map((a) => a.label));
  console.log("leaks       :", protocolLeaks(turn.text));
}
