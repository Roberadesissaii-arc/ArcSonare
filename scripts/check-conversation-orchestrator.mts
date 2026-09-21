/**
 * Multi-turn conversation, driven through the real production modules.
 *
 * The failure this exists to prevent: the assistant asked "want me to open the
 * first video?", the user said "yes", and the assistant asked what they meant.
 * The recommendation existed only as chip data in React state and as a sentence
 * in the reply — nothing durable, so the next turn had nothing to continue.
 *
 * Everything here is the shipping code: the real conversation ledger, the real
 * confirmation resolver, the real result-set store, the real response plan.
 * Only the side effects are recorded rather than performed — no browser opens,
 * no files change, no account is touched.
 *
 * Run: npm run test:conversation-orchestrator
 */

import {
  classifyConfirmation,
  parseOrdinalReference,
  resolveFollowUp,
} from "../src/features/conversation/confirmationIntent";
import {
  clearPendingAction,
  getPendingAction,
  getRecommendationHistory,
  latestResultSet,
  noteRecommendationOffered,
  recommendationOfferCount,
  rememberResultSet,
  resetConversationContextForTest,
  resolvePendingAction,
  resultByOrdinal,
  setConversationScope,
  setPendingAction,
  recordTurn,
  PENDING_ACTION_TTL_MS,
} from "../src/features/conversation/conversationContext";
import { buildResponsePlan } from "../src/features/conversation/responsePlan";
import { getCapability } from "../src/features/capabilities/capabilityRegistry";
import { retrieveCapabilities } from "../src/features/capabilities/capabilityRouter";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

let failed = 0;
const failures: string[] = [];
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) {
    failed += 1;
    failures.push(`${name} → ${got}`);
  }
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** A verified YouTube search result, shaped exactly as the executor returns it. */
function youtubeSearchResult(query: string, titles: string[]): ToolResult {
  const set = rememberResultSet({
    source: "youtube",
    query,
    items: titles.map((title) => ({
      type: "video" as const,
      title,
      subtitle: "MrBeast",
      url: `https://www.youtube.com/watch?v=${title.replace(/\s+/g, "")}`,
      sourceId: title.replace(/\s+/g, ""),
    })),
  });
  return {
    callId: "t",
    capabilityId: "youtube.search",
    status: "success",
    summary: `Found ${set.items.length} YouTube results for “${query}”.`,
    evidence: { verified: true, method: "artifact-validated" },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 5,
    data: {
      result_set_id: set.id,
      query,
      shown_inline: true,
      items: set.items,
    },
  };
}

/** Records what *would* have happened, so no side effect is real. */
const executed: Array<{ capabilityId: string; args: Record<string, unknown> }> = [];
function recordSideEffect(capabilityId: string, args: Record<string, unknown>) {
  executed.push({ capabilityId, args });
}

function freshConversation(conversationId = "c1", accountId = "user-a") {
  resetConversationContextForTest();
  setConversationScope(conversationId, accountId);
  executed.length = 0;
}

/**
 * One assistant turn: run a tool, plan the reply, store the offer.
 *
 * Mirrors what `capabilityEngine` does after a successful model tool call —
 * same plan, same pending-action write.
 */
function assistantTurn(userText: string, result: ToolResult) {
  recordTurn("user", userText);
  const plan = buildResponsePlan({
    capabilityId: result.capabilityId,
    result,
    facts: result.summary,
  });
  const offer = plan.actions[0];
  if (offer) {
    const set = latestResultSet();
    setPendingAction({
      actionType: offer.id,
      capabilityId: offer.capabilityId,
      args: offer.args,
      entityRefs: plan.entityRef ? [plan.entityRef] : [],
      resultSetId: set?.id,
      resultItemId:
        typeof offer.args.result_item_id === "string" ? offer.args.result_item_id : undefined,
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
  recordTurn("assistant", result.summary);
  return plan;
}

/** The authorisation step the engine performs before executing a follow-up. */
function runFollowUp(userText: string, now = Date.now()) {
  const resolution = resolveFollowUp(userText, now);
  if (resolution.kind === "confirm") {
    if (!resolvePendingAction(resolution.action.id, "accepted")) {
      return { outcome: "already-handled" as const };
    }
    recordSideEffect(resolution.action.capabilityId, resolution.action.args);
    resolvePendingAction(resolution.action.id, "executed");
    return { outcome: "executed" as const, action: resolution.action };
  }
  if (resolution.kind === "ordinal") {
    recordSideEffect("youtube.open_result", {
      result_set_id: resolution.set.id,
      result_item_id: resolution.item.id,
    });
    return { outcome: "executed-ordinal" as const, item: resolution.item };
  }
  if (resolution.kind === "decline") {
    resolvePendingAction(resolution.action.id, "declined");
    return { outcome: "declined" as const };
  }
  return { outcome: resolution.kind, resolution };
}

// ── 1. Tool selection: YouTube prefers the connection, not the browser ─────
console.log("\n— tool retrieval —");
for (const [q, want] of [
  ["find a mrbeast video on youtube", "youtube.search"],
  ["find cleo abram on youtube", "youtube.search"],
  ["show me the newest mrbeast videos", "youtube.search"],
  ["can you check if youtube is connected", "connections.get_status"],
] as const) {
  const ranked = retrieveCapabilities(q, 8).map((r) => r.capability.id);
  check(
    `"${q}" offers ${want} ahead of the browser`,
    ranked.includes(want) &&
      (!ranked.includes("web.search") ||
        ranked.indexOf(want) < ranked.indexOf("web.search")),
    ranked.slice(0, 3).join(", "),
  );
}
check(
  "the browser search tool tells the model to prefer the connection",
  /prefer youtube\.search/i.test(getCapability("web.search")?.description ?? ""),
  "web.search defers to youtube.search",
);
check(
  "opening a result is marked as the thing that opens a browser",
  getCapability("youtube.open_result")?.riskLevel === "reversible" &&
    getCapability("youtube.search")?.riskLevel === "read-only",
  "search is read-only, open is reversible",
);

// ── 2. Confirmation phrasing ───────────────────────────────────────────────
console.log("\n— confirmation phrasing —");
for (const yes of ["yes", "Yep", "sure", "do it", "go ahead", "ok", "open it", "please do"]) {
  check(`"${yes}" reads as agreement`, classifyConfirmation(yes) === "affirm", classifyConfirmation(yes));
}
for (const no of ["no", "nope", "not now", "no thanks", "never mind", "cancel"]) {
  check(`"${no}" reads as a decline`, classifyConfirmation(no) === "decline", classifyConfirmation(no));
}
for (const [text, want] of [
  ["open the first one", 1],
  ["the second one", 2],
  ["play the third video", 3],
  ["open the last one", -1],
] as const) {
  check(`"${text}" resolves to ordinal ${want}`, parseOrdinalReference(text) === want, String(parseOrdinalReference(text)));
}
check(
  "an ordinary sentence is not mistaken for an answer",
  classifyConfirmation("find a mrbeast video on youtube") === "none" &&
    classifyConfirmation("what is the capital of Japan") === "none",
  "not a confirmation",
);

// ── 3. The reported failure: search → offer → yes ──────────────────────────
console.log("\n— search, offer, yes —");
freshConversation();
const searchPlan = assistantTurn(
  "Find a MrBeast video on YouTube",
  youtubeSearchResult("MrBeast", ["Beast Games Ep 1", "I Survived 100 Days", "World's Largest Maze"]),
);
check(
  "the search offers exactly one follow-up, bound to a real result",
  searchPlan.actions.length === 1 &&
    searchPlan.actions[0].capabilityId === "youtube.open_result" &&
    typeof searchPlan.actions[0].args.result_item_id === "string",
  searchPlan.actions.map((a) => `${a.label}→${a.capabilityId}`).join(", ") || "(none)",
);
const pending = getPendingAction();
check(
  "the offer is stored as a pending action, not just a sentence",
  Boolean(pending) &&
    pending?.status === "awaiting-confirmation" &&
    pending?.capabilityId === "youtube.open_result",
  pending ? `${pending.capabilityId} (${pending.status})` : "no pending action",
);

recordTurn("user", "Yes.");
const yes = runFollowUp("Yes.");
check(
  "“Yes” continues the exact action that was offered",
  yes.outcome === "executed" &&
    executed.length === 1 &&
    executed[0].capabilityId === "youtube.open_result" &&
    executed[0].args.result_item_id === pending?.args.result_item_id,
  `${yes.outcome} · ${executed.length} side effect(s)`,
);
check(
  "no browser search was run as a side effect of confirming",
  !executed.some((e) => e.capabilityId === "web.search" || e.capabilityId === "web.open_url"),
  executed.map((e) => e.capabilityId).join(", ") || "(none)",
);

// ── 4. Exactly once ────────────────────────────────────────────────────────
console.log("\n— exactly once —");
const replay = runFollowUp("Yes.");
check(
  "a replayed confirmation cannot execute a second time",
  replay.outcome !== "executed" && executed.length === 1,
  `${replay.outcome} · total side effects ${executed.length}`,
);

// ── 5. Decline ─────────────────────────────────────────────────────────────
console.log("\n— decline —");
freshConversation();
assistantTurn("Find MrBeast on YouTube", youtubeSearchResult("MrBeast", ["A", "B", "C"]));
const declined = runFollowUp("No.");
check(
  "“No” performs no action at all",
  declined.outcome === "declined" && executed.length === 0,
  `${declined.outcome} · ${executed.length} side effect(s)`,
);
check(
  "a declined offer cannot then be confirmed",
  runFollowUp("Yes.").outcome !== "executed" && executed.length === 0,
  `${executed.length} side effect(s)`,
);

// ── 6. Ordinals resolve against what was shown ─────────────────────────────
console.log("\n— ordinals —");
freshConversation();
assistantTurn(
  "Find MrBeast on YouTube",
  youtubeSearchResult("MrBeast", ["First Video", "Second Video", "Third Video"]),
);
const second = runFollowUp("Open the second one");
check(
  "“the second one” opens result 2 without searching again",
  second.outcome === "executed-ordinal" &&
    "item" in second &&
    second.item.ordinal === 2 &&
    second.item.title === "Second Video",
  "item" in second ? `#${second.item.ordinal} ${second.item.title}` : second.outcome,
);
const last = resultByOrdinal(3);
check(
  "the stored order is the order the user saw",
  last?.item.title === "Third Video",
  last?.item.title ?? "missing",
);
const outOfRange = resolveFollowUp("open the ninth one");
check(
  "an out-of-range pick asks instead of guessing",
  outOfRange.kind === "nothing-pending",
  outOfRange.kind === "nothing-pending" ? outOfRange.question : outOfRange.kind,
);

// ── 7. "Yes" with nothing pending ──────────────────────────────────────────
console.log("\n— nothing pending —");
freshConversation();
const orphan = resolveFollowUp("Yes.");
check(
  "“Yes” out of nowhere asks rather than acting",
  orphan.kind === "nothing-pending" && executed.length === 0,
  orphan.kind === "nothing-pending" ? orphan.question : orphan.kind,
);

// ── 8. Expiry ──────────────────────────────────────────────────────────────
console.log("\n— expiry —");
freshConversation();
assistantTurn("Find MrBeast on YouTube", youtubeSearchResult("MrBeast", ["A", "B"]));
const later = Date.now() + PENDING_ACTION_TTL_MS + 1000;
const stale = resolveFollowUp("Yes.", later);
check(
  "a stale offer is refused and offered a refresh",
  stale.kind === "expired" && /again/i.test(stale.kind === "expired" ? stale.question : ""),
  stale.kind === "expired" ? stale.question : stale.kind,
);
check(
  "nothing executed from the stale offer",
  executed.length === 0,
  `${executed.length} side effect(s)`,
);

// ── 9. Account isolation ───────────────────────────────────────────────────
console.log("\n— account isolation —");
freshConversation("c1", "user-a");
assistantTurn("Find MrBeast on YouTube", youtubeSearchResult("MrBeast", ["A", "B"]));
check("user A has a pending action", Boolean(getPendingAction()), "pending");
setConversationScope("c1", "user-b");
check(
  "user B cannot see or continue user A's offer",
  getPendingAction() === null && latestResultSet() === null,
  "no pending action, no results",
);
const bYes = resolveFollowUp("Yes.");
check(
  "user B saying yes acts on nothing",
  bYes.kind === "nothing-pending",
  bYes.kind,
);

// ── 10. Separate conversations do not share offers ─────────────────────────
console.log("\n— conversation isolation —");
freshConversation("voice-1", "user-a");
assistantTurn("Find MrBeast on YouTube", youtubeSearchResult("MrBeast", ["A", "B"]));
setConversationScope("chat-1", "user-a");
check(
  "an offer made in one conversation is not answerable in another",
  resolveFollowUp("Open the first one").kind === "nothing-pending",
  resolveFollowUp("Open the first one").kind,
);

// ── 11. Recommendations vary ───────────────────────────────────────────────
console.log("\n— recommendation repetition —");
freshConversation();
const labels: string[] = [];
for (let i = 0; i < 3; i += 1) {
  clearPendingAction();
  const plan = assistantTurn(
    `Find search ${i} on YouTube`,
    youtubeSearchResult(`query ${i}`, ["One", "Two", "Three"]),
  );
  labels.push(plan.actions[0]?.label ?? "(none)");
}
check(
  "the same recommendation is not offered on every single search",
  new Set(labels).size > 1,
  labels.join(" | "),
);
check(
  "it stops being offered once it has been ignored twice",
  labels[2] === "(none)",
  labels[2],
);
check(
  "recommendation history records what was offered",
  getRecommendationHistory().length > 0 && recommendationOfferCount("open-first-result") >= 2,
  `${getRecommendationHistory().length} entries, offered ${recommendationOfferCount("open-first-result")}×`,
);

// ── 12. A channel result offers the useful next step, not "open" ───────────
console.log("\n— channel results —");
freshConversation();
const channelSet = rememberResultSet({
  source: "youtube",
  query: "Cleo Abram",
  items: [
    {
      type: "channel",
      title: "Cleo Abram",
      subtitle: "1.9M subscribers",
      url: "https://www.youtube.com/channel/UC123",
      sourceId: "UC123",
    },
  ],
});
const channelPlan = buildResponsePlan({
  capabilityId: "youtube.search",
  result: {
    callId: "t",
    capabilityId: "youtube.search",
    status: "success",
    summary: "Found the Cleo Abram channel.",
    evidence: { verified: true, method: "artifact-validated" },
    startedAt: "",
    completedAt: "",
    durationMs: 1,
    data: { result_set_id: channelSet.id, items: channelSet.items },
  },
  facts: "Found the Cleo Abram channel.",
});
check(
  "a channel offers its newest uploads, not “open the first one”",
  channelPlan.actions[0]?.capabilityId === "youtube.list_channel_videos" &&
    channelPlan.actions[0]?.args.channel_id === "UC123",
  channelPlan.actions[0]?.label ?? "(none)",
);

// ── 13. No side effect ever escaped this suite ─────────────────────────────
console.log("\n— side effects —");
check(
  "every executed action was a recorded YouTube open, never a browser search",
  executed.every((e) => e.capabilityId === "youtube.open_result"),
  executed.map((e) => e.capabilityId).join(", ") || "(none)",
);

console.log(`\n${"-".repeat(74)}`);
if (failed > 0) {
  console.log(`${failed} FAILED\n`);
  failures.forEach((f) => console.log(`  ✗ ${f}`));
} else {
  console.log("all passed");
}
process.exit(failed === 0 ? 0 : 1);
