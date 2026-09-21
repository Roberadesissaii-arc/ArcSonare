/**
 * Task-creation routing. Guards the bug where "can you create a task for me"
 * fell through to plain chat and the model fabricated a created task.
 * Run: npx tsx scripts/check-task-creation.mts
 */
import { routeDeterministic } from "../src/features/capabilities/capabilityRouter";

// Mirrors needsTaskTitle() in capabilityEngine.ts.
function needsTaskTitle(text: string): string | null {
  const q = text.trim().toLowerCase().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!/\b(?:create|add|make|new|set up|start)\b[\w\s]*\btasks?\b/.test(q)) return null;
  if (/\b(?:list|show|what|which|how many|my tasks|due)\b/.test(q)) return null;
  const remainder = q
    .replace(/^(?:hey |ok |please |can you |could you |would you |will you |i want you to |i need you to |i'd like you to )+/g, "")
    .replace(/\b(?:create|add|make|set up|start)\b/g, " ")
    .replace(/\b(?:a|an|the|new|another|quick)\b/g, " ")
    .replace(/\btasks?\b/g, " ")
    .replace(/\b(?:for|to)\s+me\b/g, " ")
    .replace(/\bplease\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (remainder.length > 2) return null;
  return "Sure — what should the task be?";
}

type Expect = { kind: "ask" } | { kind: "create"; title: string } | { kind: "chat" };

const CASES: { input: string; expect: Expect }[] = [
  // The reported bug — must ASK, never claim success.
  { input: "can you create a task for me", expect: { kind: "ask" } },
  { input: "can you crate a task for me", expect: { kind: "chat" } }, // typo → chat, must not fabricate
  { input: "create a task", expect: { kind: "ask" } },
  { input: "make me a task", expect: { kind: "ask" } },
  { input: "add a new task please", expect: { kind: "ask" } },
  { input: "I want you to create a task", expect: { kind: "ask" } },

  // Real requests must actually create.
  { input: "create a task to call the bank", expect: { kind: "create", title: "call the bank" } },
  { input: "can you create a task to buy milk", expect: { kind: "create", title: "buy milk" } },
  { input: "add task finish the report", expect: { kind: "create", title: "finish the report" } },
  { input: "create a task called Drone", expect: { kind: "create", title: "drone" } },
  { input: "remind me to submit the form", expect: { kind: "create", title: "submit the form" } },

  // Must NOT be treated as creation.
  { input: "show my tasks", expect: { kind: "chat" } },
  { input: "what tasks do I have", expect: { kind: "chat" } },
  { input: "how many tasks are due", expect: { kind: "chat" } },
];

let failed = 0;
for (const c of CASES) {
  const ask = needsTaskTitle(c.input);
  const route = ask ? null : routeDeterministic(c.input);
  const isCreate = route?.capabilityId === "tasks.create";

  let got: string;
  if (ask) got = "ask";
  else if (isCreate) got = `create:${String(route?.arguments?.title ?? "")}`;
  else got = "chat";

  const want =
    c.expect.kind === "ask"
      ? "ask"
      : c.expect.kind === "create"
        ? `create:${c.expect.title}`
        : "chat";

  // "chat" is acceptable for list-style inputs even if another route claims them.
  const ok = got === want || (want === "chat" && !got.startsWith("create") && got !== "ask");
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${c.input}"\n      → ${got}${ok ? "" : `   (expected ${want})`}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed.`);
process.exit(failed ? 1 : 0);
