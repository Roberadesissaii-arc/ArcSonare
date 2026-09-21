/**
 * "Highlight it" must resolve to a thing, or ask — never guess.
 *
 * Observed failures this guards:
 *
 *  - "press it" with nothing to refer back to routed a vision click at the
 *    invented target "play button", because the router ended in
 *    `?? "play button"`. Inventing a target is worse than admitting ignorance,
 *    because the click lands somewhere.
 *  - Follow-ups had nothing structured to resolve against: the only record of
 *    "the books folder" was the assistant's own sentence, and re-parsing prose
 *    to recover an identity is guesswork.
 *
 * Drives the real ledger and resolver. Both are dependency-free so they load
 * under plain Node, the same constraint the routing suites already live with.
 *
 * Run: npx tsx scripts/check-conversation-context.mts
 */

import {
  rememberEntity,
  recordTurn,
  referableEntities,
  setConversationScope,
  resetConversationContextForTest,
  ENTITY_TTL_MS,
} from "../src/features/conversation/conversationContext";
import {
  clarificationQuestion,
  isReferencePhrase,
  missingContextQuestion,
  resolveReference,
} from "../src/features/conversation/referenceResolver";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const folder = (label: string, turn: number) => {
  recordTurn("user", `find the ${label} folder`);
  return rememberEntity({
    type: "desktop-item",
    label,
    sourceTool: "desktop.find_item",
    confidence: 1,
    ref: label,
    sourceTurn: turn,
  });
};

// ── 1. Find books → Highlight it ─────────────────────────────────────────
resetConversationContextForTest();
folder("books", 1);
{
  const r = resolveReference("it", "highlight it");
  check(
    "find books then 'highlight it' resolves to the books Desktop item",
    r.kind === "resolved" && r.entity.ref === "books" && r.entity.type === "desktop-item",
    r.kind === "resolved" ? `${r.entity.type} "${r.entity.ref}"` : r.kind,
  );
  check(
    "the resolved reference is a structured ref, not the word 'it'",
    r.kind === "resolved" && r.entity.ref !== "it",
    r.kind === "resolved" ? r.entity.ref : "n/a",
  );
}

// ── 2. Find books → Open it ──────────────────────────────────────────────
{
  const r = resolveReference("it", "open it");
  check(
    "'open it' resolves to the same Desktop item",
    r.kind === "resolved" && r.entity.ref === "books",
    r.kind === "resolved" ? r.entity.ref : r.kind,
  );
}

// ── 3. Create task → Mark it urgent ──────────────────────────────────────
resetConversationContextForTest();
recordTurn("user", "create a task called Apply to Y Combinator");
rememberEntity({
  type: "task",
  label: "Apply to Y Combinator",
  sourceTool: "tasks.create",
  confidence: 1,
  ref: "task-abc123",
  sourceTurn: 1,
});
{
  const r = resolveReference("it", "mark it urgent");
  check(
    "'mark it urgent' resolves to the task id, not its title",
    r.kind === "resolved" && r.entity.ref === "task-abc123" && r.entity.type === "task",
    r.kind === "resolved" ? `${r.entity.type} ${r.entity.ref}` : r.kind,
  );
}
{
  const r = resolveReference("it", "make it due tomorrow");
  check(
    "'make it due tomorrow' resolves to the same task id",
    r.kind === "resolved" && r.entity.ref === "task-abc123",
    r.kind === "resolved" ? r.entity.ref : r.kind,
  );
}

// ── Type compatibility keeps the two apart ───────────────────────────────
resetConversationContextForTest();
folder("books", 1);
recordTurn("user", "create a task called Finish pitch deck");
rememberEntity({
  type: "task",
  label: "Finish pitch deck",
  sourceTool: "tasks.create",
  confidence: 1,
  ref: "task-xyz",
  sourceTurn: 2,
});
{
  const highlight = resolveReference("it", "highlight it");
  check(
    "'highlight it' skips the newer task and picks the highlightable folder",
    highlight.kind === "resolved" && highlight.entity.ref === "books",
    highlight.kind === "resolved" ? highlight.entity.ref : highlight.kind,
  );
  const urgent = resolveReference("it", "mark it urgent");
  check(
    "'mark it urgent' skips the folder and picks the task",
    urgent.kind === "resolved" && urgent.entity.ref === "task-xyz",
    urgent.kind === "resolved" ? urgent.entity.ref : urgent.kind,
  );
}

// ── 5. Find two folders → Open it → clarification ────────────────────────
resetConversationContextForTest();
recordTurn("user", "find the books folder and the Photos folder");
rememberEntity({
  type: "desktop-item", label: "books", sourceTool: "desktop.find_item",
  confidence: 1, ref: "books", sourceTurn: 1,
});
rememberEntity({
  type: "desktop-item", label: "Photos", sourceTool: "desktop.find_item",
  confidence: 1, ref: "Photos", sourceTurn: 1,
});
{
  const r = resolveReference("it", "open it");
  check(
    "two items introduced in the same turn make 'open it' ambiguous",
    r.kind === "ambiguous" && r.candidates.length === 2,
    r.kind === "ambiguous" ? r.candidates.map((c) => c.label).join(" / ") : r.kind,
  );
  if (r.kind === "ambiguous") {
    const q = clarificationQuestion("open it", r.candidates);
    check(
      "the clarification names both candidates",
      q.includes("books") && q.includes("Photos") && q.startsWith("Do you want me to open"),
      q,
    );
  }
  check(
    "an ambiguous reference resolves to no entity, so nothing can act",
    r.kind !== "resolved",
    r.kind,
  );
}

// A later mention breaks the tie — the user has been talking about it since.
{
  rememberEntity({
    type: "desktop-item", label: "books", sourceTool: "desktop.find_item",
    confidence: 1, ref: "books", sourceTurn: 3,
  });
  const r = resolveReference("it", "open it");
  check(
    "mentioning one of them again makes it the referent",
    r.kind === "resolved" && r.entity.ref === "books",
    r.kind === "resolved" ? r.entity.ref : r.kind,
  );
}

// ── 6/7. No history → clarification, zero side effects ───────────────────
resetConversationContextForTest();
{
  const press = resolveReference("it", "press it");
  check(
    "'press it' with no history resolves to nothing",
    press.kind === "none",
    press.kind,
  );
  check(
    "the missing-context question names the action",
    missingContextQuestion("press it") ===
      "I'm not sure what you want me to press. Tell me the button or item.",
    missingContextQuestion("press it"),
  );
  const highlight = resolveReference("it", "highlight it");
  check("'highlight it' with no history resolves to nothing", highlight.kind === "none", highlight.kind);
}

// A folder is not a button: "press it" must not fall back to it.
resetConversationContextForTest();
folder("books", 1);
{
  const r = resolveReference("it", "press it");
  check(
    "'press it' does not fall back to a folder",
    r.kind === "none",
    r.kind,
  );
}

// ── A real name is never treated as a reference ──────────────────────────
{
  const r = resolveReference("the play button", "press the play button");
  check(
    "a named target is passed through untouched",
    r.kind === "not-a-reference" && r.literal === "the play button",
    r.kind === "not-a-reference" ? r.literal : r.kind,
  );
  check(
    "'it' is a reference phrase, 'books' is not",
    isReferencePhrase("it") && isReferencePhrase("that one") && !isReferencePhrase("books"),
    "classified correctly",
  );
}

// ── Ordinals ─────────────────────────────────────────────────────────────
resetConversationContextForTest();
recordTurn("user", "find the books folder and the Photos folder");
rememberEntity({ type: "folder", label: "books", sourceTool: "files.search", confidence: 1, ref: "books", sourceTurn: 1 });
rememberEntity({ type: "folder", label: "Photos", sourceTool: "files.search", confidence: 1, ref: "Photos", sourceTurn: 1 });
{
  const first = resolveReference("the first one", "open the first one");
  const second = resolveReference("the second one", "open the second one");
  check(
    "'the first one' picks the first mentioned, not the most recent",
    first.kind === "resolved" && first.entity.ref === "books",
    first.kind === "resolved" ? first.entity.ref : first.kind,
  );
  check(
    "'the second one' picks the second mentioned",
    second.kind === "resolved" && second.entity.ref === "Photos",
    second.kind === "resolved" ? second.entity.ref : second.kind,
  );
}

// ── Typed phrases ────────────────────────────────────────────────────────
resetConversationContextForTest();
folder("books", 1);
rememberEntity({ type: "task", label: "Finish pitch deck", sourceTool: "tasks.create", confidence: 1, ref: "task-1", sourceTurn: 2 });
{
  const f = resolveReference("the folder", "open the folder");
  const t = resolveReference("the task", "complete the task");
  check(
    "'the folder' selects by type even with a newer task present",
    f.kind === "resolved" && f.entity.ref === "books",
    f.kind === "resolved" ? f.entity.ref : f.kind,
  );
  check(
    "'the task' selects the task",
    t.kind === "resolved" && t.entity.ref === "task-1",
    t.kind === "resolved" ? t.entity.ref : t.kind,
  );
}

// ── 8. Navigation persistence ────────────────────────────────────────────
// The ledger is module state, so it outlives component unmount. Re-scoping to
// the SAME conversation must not wipe it.
resetConversationContextForTest();
folder("books", 1);
setConversationScope("test-conversation", "test-account");
{
  const r = resolveReference("it", "highlight it");
  check(
    "navigating within the same conversation keeps the reference",
    r.kind === "resolved" && r.entity.ref === "books",
    r.kind === "resolved" ? r.entity.ref : r.kind,
  );
}

// ── 10. Account switch clears entity context ─────────────────────────────
setConversationScope("test-conversation", "a-different-account");
{
  const r = resolveReference("it", "highlight it");
  check(
    "switching account leaves nothing to refer to",
    r.kind === "none" && referableEntities().length === 0,
    `${r.kind}, ${referableEntities().length} entities`,
  );
}

// Switching conversation on the same account is also a fresh ledger.
resetConversationContextForTest();
folder("books", 1);
setConversationScope("another-conversation", "test-account");
check(
  "switching conversation leaves nothing to refer to",
  resolveReference("it", "highlight it").kind === "none",
  `${referableEntities().length} entities`,
);

// ── 11. Semantic identity kept, coordinates not ──────────────────────────
resetConversationContextForTest();
recordTurn("user", "find the books folder");
const visual = rememberEntity({
  type: "desktop-item",
  label: "books",
  sourceTool: "desktop.find_item",
  confidence: 1,
  ref: "books",
  sourceTurn: 1,
  meta: { source: "shell-list-view" },
});
{
  const stored = JSON.stringify(visual);
  check(
    "a remembered visual entity carries no coordinates to go stale",
    !/\b(?:x|y|width|height|bounds|rect)\b/i.test(stored),
    "no geometry stored — bounds are re-resolved at action time",
  );
  const r = resolveReference("it", "highlight it");
  check(
    "the entity is remembered semantically, by name",
    r.kind === "resolved" && r.entity.ref === "books",
    r.kind === "resolved" ? `ref="${r.entity.ref}"` : r.kind,
  );
}

// ── Expiry ───────────────────────────────────────────────────────────────
resetConversationContextForTest();
rememberEntity({
  type: "desktop-item", label: "books", sourceTool: "desktop.find_item",
  confidence: 1, ref: "books", sourceTurn: 1,
  timestamp: Date.now() - ENTITY_TTL_MS - 1000,
});
check(
  "an entity older than the TTL is no longer referable",
  resolveReference("it", "highlight it").kind === "none",
  "expired",
);

console.log("-".repeat(78));
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
