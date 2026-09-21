/**
 * The ledger has to be wired to something, or it is a library nobody calls.
 *
 * The previous round built `conversationContext` and `referenceResolver`, and
 * both passed their own tests — while nothing in production imported either. So
 * "highlight it" still did not work in the running application.
 *
 * These drive `productionBridge`, which is what `capabilityEngine` actually
 * calls: `resolvePronounArguments` before dispatch, `recordEntitiesFromResult`
 * after a success.
 *
 * Note what is *not* asserted here: that the engine calls the bridge. That is a
 * source check at the end, because a bridge with no caller is exactly the
 * failure this file exists to prevent recurring.
 *
 * Run: npx tsx scripts/check-conversation-wiring.mts
 */

import { readFileSync } from "node:fs";
import {
  resetConversationContextForTest,
  setConversationScope,
  recordTurn,
  shouldUseUserName,
  noteUserNameUsed,
  wasEntityAlreadyDiscussed,
  getInteractionSurface,
} from "../src/features/conversation/conversationContext";
import {
  recordEntitiesFromResult,
  resolvePronounArguments,
  resolveClarificationReply,
  classifyTargetProvenance,
  surfaceForRequest,
} from "../src/features/conversation/productionBridge";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const ok = (capabilityId: string, data: Record<string, unknown>): ToolResult =>
  ({
    callId: "c",
    capabilityId,
    status: "success",
    summary: "done",
    evidence: { verified: true, method: "state-readback" },
    startedAt: "", completedAt: "", durationMs: 0,
    data,
  }) as unknown as ToolResult;

const failure = (capabilityId: string): ToolResult =>
  ({
    callId: "c", capabilityId, status: "error", summary: "not found",
    evidence: { verified: false, method: "not-verifiable" },
    startedAt: "", completedAt: "", durationMs: 0,
    data: { name: "ghost" },
  }) as unknown as ToolResult;

// ── Find books → Highlight it ────────────────────────────────────────────
resetConversationContextForTest();
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", {
  name: "books", path: "C:/Users/x/Desktop/books", source: "shell-list-view",
  bounds: { x: 0, y: 789, width: 74, height: 70 },
}));
{
  const r = resolvePronounArguments("screen.highlight_target", { target: "it" }, "highlight it");
  check(
    "'highlight it' rewrites the target to the structured name",
    r.kind === "resolved" && r.args.target === "books",
    r.kind === "resolved" ? `target="${r.args.target}"` : r.kind,
  );
  check(
    "the pronoun never survives into the dispatched arguments",
    r.kind === "resolved" && r.args.target !== "it",
    r.kind === "resolved" ? String(r.args.target) : r.kind,
  );
}

// The bounds in the result must NOT be remembered — they go stale.
{
  const r = resolvePronounArguments("screen.highlight_target", { target: "it" }, "highlight it");
  const stored = r.kind === "resolved" ? JSON.stringify(r.entity) : "";
  check(
    "no geometry is carried into the remembered entity",
    !/\b(?:"x"|"y"|"width"|"height"|bounds)\b/i.test(stored),
    "bounds discarded — re-resolved at action time",
  );
}

// ── Find books → Open it ─────────────────────────────────────────────────
{
  const r = resolvePronounArguments("filesystem.open_item", { name: "it" }, "open it");
  check(
    "'open it' resolves the same Desktop item",
    r.kind === "resolved" && r.args.name === "books",
    r.kind === "resolved" ? String(r.args.name) : r.kind,
  );
}

// ── Create task → Mark it high priority ──────────────────────────────────
resetConversationContextForTest();
recordEntitiesFromResult("tasks.create", ok("tasks.create", {
  taskId: "task-yc-1", task: { title: "Apply to Y Combinator" }, persisted: true,
}));
{
  const r = resolvePronounArguments(
    "tasks.update",
    { title_query: "it", priority: "high" },
    "mark it high priority",
  );
  check(
    "'mark it high priority' targets the original task id",
    r.kind === "resolved" && r.args.title_query === "task-yc-1",
    r.kind === "resolved" ? String(r.args.title_query) : r.kind,
  );
  check(
    "the update keeps its other arguments",
    r.kind === "resolved" && r.args.priority === "high",
    r.kind === "resolved" ? String(r.args.priority) : "n/a",
  );
  check(
    "it routes to tasks.update, so no second task is created",
    r.kind === "resolved",
    "tasks.update with an existing id",
  );
}

// ── Create task → Make it due tomorrow ───────────────────────────────────
resetConversationContextForTest();
recordEntitiesFromResult("tasks.create", ok("tasks.create", {
  taskId: "task-pitch-9", task: { title: "Finish pitch deck" },
}));
{
  const r = resolvePronounArguments(
    "tasks.update",
    { title_query: "it", due_at: "tomorrow" },
    "make it due tomorrow",
  );
  check(
    "'make it due tomorrow' targets the same task id",
    r.kind === "resolved" && r.args.title_query === "task-pitch-9",
    r.kind === "resolved" ? String(r.args.title_query) : r.kind,
  );
}

// ── Missing context ──────────────────────────────────────────────────────
resetConversationContextForTest();
{
  const press = resolvePronounArguments("screen.click_target", { target: "it" }, "press it");
  check(
    "'press it' with no history asks instead of clicking",
    press.kind === "clarify",
    press.kind === "clarify" ? press.question : press.kind,
  );
  check(
    "the question does not invent a play button",
    press.kind === "clarify" && !/play button/i.test(press.question),
    press.kind === "clarify" ? press.question : "n/a",
  );
  const hl = resolvePronounArguments("screen.highlight_target", { target: "it" }, "highlight it");
  check(
    "'highlight it' with no history asks instead of calling vision",
    hl.kind === "clarify" && /highlight/i.test(hl.question),
    hl.kind === "clarify" ? hl.question : hl.kind,
  );
}

// A failed lookup is not something "it" can mean.
resetConversationContextForTest();
recordEntitiesFromResult("desktop.find_item", failure("desktop.find_item"));
{
  const r = resolvePronounArguments("screen.highlight_target", { target: "it" }, "highlight it");
  check(
    "a failed tool result records no entity",
    r.kind === "clarify",
    r.kind,
  );
}

// ── Ambiguous, then answered ─────────────────────────────────────────────
resetConversationContextForTest();
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", { name: "books" }));
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", { name: "Photos" }));
{
  const r = resolvePronounArguments("filesystem.open_item", { name: "it" }, "open it");
  check(
    "two same-turn items make 'open it' ask which",
    r.kind === "clarify" && r.question.includes("books") && r.question.includes("Photos"),
    r.kind === "clarify" ? r.question : r.kind,
  );
  check("no arguments are dispatched while ambiguous", r.kind === "clarify", r.kind);

  const answered = resolveClarificationReply("the books folder");
  check(
    "answering the clarification picks that candidate",
    answered?.entity.ref === "books",
    answered ? answered.entity.ref : "unresolved",
  );
  check(
    "the pending clarification is cleared once answered",
    resolveClarificationReply("the books folder") === null,
    "cleared",
  );
  const nonsense = resolveClarificationReply("something else entirely");
  check(
    "an unmatched reply does not silently pick a candidate",
    nonsense === null,
    "left unresolved",
  );
}

// ── Named targets pass straight through ──────────────────────────────────
resetConversationContextForTest();
{
  const r = resolvePronounArguments(
    "screen.click_target",
    { target: "the play button" },
    "press the play button",
  );
  check(
    "a named target is not touched",
    r.kind === "unchanged" && r.args.target === "the play button",
    String(r.args.target),
  );
  const other = resolvePronounArguments("web.search", { query: "it" }, "search it");
  check(
    "capabilities outside the resolvable set are left alone",
    other.kind === "unchanged",
    other.kind,
  );
}

// ── Account isolation ────────────────────────────────────────────────────
resetConversationContextForTest();
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", { name: "books" }));
setConversationScope("main-chat", "user-b");
{
  const r = resolvePronounArguments("filesystem.open_item", { name: "it" }, "open it");
  check(
    "after an account switch 'open it' finds nothing and asks",
    r.kind === "clarify",
    r.kind === "clarify" ? r.question : r.kind,
  );
}

// ── The model-pre-resolution bypass ──────────────────────────────────────
// Observed in the running application: "Press it" answered "clicked 'books'"
// and clicked a folder. The model had already turned the pronoun into
// target: "books", so the bridge saw an ordinary name and waved it through.
// Detecting pronouns is not enough — what matters is whether the user named
// this target in THIS turn.
resetConversationContextForTest();
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", { name: "books" }));
{
  const r = resolvePronounArguments("screen.click_target", { target: "books" }, "Press it.");
  check(
    "a model-substituted folder name cannot become a click",
    r.kind === "clarify",
    r.kind === "clarify" ? r.question : `LEAKED: would have clicked "${r.args?.target}"`,
  );
  check(
    "the clarification says the folder WAS found, then asks",
    r.kind === "clarify" && /found the books folder/i.test(r.question) && /press/i.test(r.question),
    r.kind === "clarify" ? r.question : "n/a",
  );
}

// The same substitution for a compatible action is fine — highlighting a folder
// is a normal thing to do, so this must not become a blanket refusal.
{
  const r = resolvePronounArguments("screen.highlight_target", { target: "books" }, "Highlight it.");
  check(
    "a model-substituted folder name is still allowed to be highlighted",
    r.kind === "unchanged" && r.args.target === "books",
    r.kind === "unchanged" ? String(r.args.target) : r.kind,
  );
}

// An explicit request is not a substitution: the user said the word.
{
  const r = resolvePronounArguments(
    "screen.click_target",
    { target: "books" },
    "Click the books folder.",
  );
  check(
    "an explicitly named target follows the normal visual path",
    r.kind === "unchanged",
    `${r.kind} — user said "books" in this turn`,
  );
  check(
    "provenance classifies said vs supplied",
    classifyTargetProvenance("books", "Click the books folder.") === "explicit" &&
      classifyTargetProvenance("books", "Press it.") === "model-substituted",
    "explicit vs model-substituted",
  );
}

// A target nothing knows about is left alone — refusing every unrecognised
// name would break ordinary vision clicks on real on-screen controls.
resetConversationContextForTest();
{
  const r = resolvePronounArguments("screen.click_target", { target: "Sign in" }, "Press it.");
  check(
    "an unknown target is not refused, so real vision clicks still work",
    r.kind === "unchanged",
    r.kind,
  );
}

// A task is not clickable either.
resetConversationContextForTest();
recordEntitiesFromResult("tasks.create", ok("tasks.create", {
  taskId: "task-z", task: { title: "Write the brief" },
}));
{
  const r = resolvePronounArguments("screen.click_target", { target: "Write the brief" }, "Press it.");
  check(
    "a model-substituted task title cannot become a click",
    r.kind === "clarify",
    r.kind === "clarify" ? r.question : "LEAKED",
  );
}

// ── "Here" means the surface we are on, not the Desktop ──────────────────
// Observed: after a YouTube search, "Show me here" produced a Desktop file
// listing. "Here" is a surface, and Desktop was the only context that existed.
resetConversationContextForTest();
recordEntitiesFromResult("web.search", ok("web.search", {
  query: "Cleo Abram", url: "https://www.youtube.com/results?search_query=Cleo+Abram",
}));
{
  const surface = getInteractionSurface();
  check(
    "a YouTube search records YouTube as the current surface",
    surface?.kind === "youtube" && surface.query === "Cleo Abram",
    surface ? `${surface.kind} / ${surface.query}` : "no surface",
  );
  check(
    "'show me here' points at the recorded surface",
    surfaceForRequest("Show me here.")?.kind === "youtube",
    String(surfaceForRequest("Show me here.")?.label),
  );
  const r = resolvePronounArguments(
    "filesystem.list_known_folder",
    { folder: "Desktop" },
    "Show me here.",
  );
  check(
    "a Desktop reader cannot answer 'show me here' while on YouTube",
    r.kind === "clarify",
    r.kind === "clarify" ? r.question : "LEAKED: would have listed the Desktop",
  );
  check(
    "the clarification names YouTube and the query, not the Desktop",
    r.kind === "clarify" && /YouTube/i.test(r.question) && /Cleo Abram/i.test(r.question) &&
      !/desktop/i.test(r.question),
    r.kind === "clarify" ? r.question : "n/a",
  );
}

// On the Desktop, a Desktop reader is exactly right.
resetConversationContextForTest();
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", { name: "books" }));
{
  const r = resolvePronounArguments(
    "filesystem.list_known_folder",
    { folder: "Desktop" },
    "Show me here.",
  );
  check(
    "'show me here' on the Desktop still reads the Desktop",
    r.kind === "unchanged",
    r.kind,
  );
}

// A request with no surface word is untouched.
{
  const r = resolvePronounArguments(
    "filesystem.list_known_folder",
    { folder: "Desktop" },
    "List my Desktop.",
  );
  check("an explicit Desktop request is never blocked", r.kind === "unchanged", r.kind);
}

// ── The user's name is not repeated ──────────────────────────────────────
resetConversationContextForTest();
{
  recordTurn("user", "find the books folder");
  check("the first reply may greet by name", shouldUseUserName(), "allowed");
  noteUserNameUsed();
  recordTurn("user", "highlight it");
  check(
    "the very next reply may not greet by name again",
    !shouldUseUserName(),
    "suppressed on the consecutive turn",
  );
  for (let i = 0; i < 6; i++) recordTurn("user", `turn ${i}`);
  check(
    "the name becomes available again after a cooldown",
    shouldUseUserName(),
    "allowed after 6 turns",
  );
}

// ── Follow-ups do not re-announce discovery ──────────────────────────────
resetConversationContextForTest();
recordTurn("user", "find the books folder");
recordEntitiesFromResult("desktop.find_item", ok("desktop.find_item", { name: "books" }));
{
  check(
    "on the discovery turn the item counts as new",
    !wasEntityAlreadyDiscussed("books"),
    "newly discovered — may say it was found",
  );
  recordTurn("user", "highlight it");
  check(
    "on the follow-up turn the item is already known",
    wasEntityAlreadyDiscussed("books"),
    "already discussed — must not say 'I found it' again",
  );
}

// ── The bridge is actually called by production ──────────────────────────
const engine = readFileSync("src/features/capabilities/capabilityEngine.ts", "utf8");
check(
  "capabilityEngine resolves pronouns before dispatch",
  /resolvePronounArguments/.test(engine),
  "resolvePronounArguments called in the engine",
);
check(
  "capabilityEngine records entities after execution",
  (engine.match(/recordEntitiesFromResult/g) ?? []).length >= 2,
  `${(engine.match(/recordEntitiesFromResult/g) ?? []).length} call sites`,
);
const before = engine.indexOf("resolvePronounArguments");
const dispatch = engine.indexOf("isPlannedCapability(capabilityId)");
check(
  "pronoun resolution happens BEFORE the capability dispatch switch",
  before !== -1 && dispatch !== -1 && before < dispatch,
  before < dispatch ? "resolved first" : "AFTER dispatch — the pronoun would already have been sent",
);
const shell = readFileSync("src/app/AppShell.tsx", "utf8");
check(
  "the ledger is scoped to the signed-in account",
  /setConversationScope\(/.test(shell) && /auth\.user\?\.id/.test(shell),
  "scoped on auth.user.id",
);

console.log("-".repeat(78));
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
