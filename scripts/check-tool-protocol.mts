/**
 * The tool-call protocol, exercised through the real assembler.
 *
 * Reproduces the reported failure — "An assistant message with tool_calls must
 * be followed by tool messages responding to each tool_call_id" — and pins the
 * three ways the engine used to produce it.
 *
 * Run: npm run test:tool-protocol
 */

import {
  repairTurns,
  ToolTurn,
  validateTurns,
} from "../src/features/capabilities/toolTurn";
import type { ChatTurn } from "../src/features/capabilities/providerToolAdapter";
import type {
  ParsedToolCall,
  ToolResult,
} from "../src/features/capabilities/capabilityTypes";

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

function call(id: string, capabilityId = "connections.get_status"): ParsedToolCall {
  return { id, capabilityId, arguments: { service: "youtube" } };
}

function ok(capabilityId: string): ToolResult {
  return {
    callId: "x",
    capabilityId,
    status: "success",
    summary: "done",
    evidence: { verified: true, method: "state-readback" },
    startedAt: "",
    completedAt: "",
    durationMs: 1,
  };
}

function failure(capabilityId: string): ToolResult {
  return { ...ok(capabilityId), status: "error", summary: "it broke" };
}

/** The shape a provider checks: roles and ids, in order. */
function shape(turns: ChatTurn[]): string {
  return turns
    .map((t) =>
      t.role === "assistant" && t.toolCalls?.length
        ? `assistant[${t.toolCalls.map((c) => c.id).join(",")}]`
        : t.role === "tool"
          ? `tool(${t.toolCallId})`
          : t.role,
    )
    .join(" → ");
}

// ── 1. The invariant, across every tool outcome ────────────────────────────
console.log("\n— one result per declared call —");

for (const [name, outcomes] of [
  ["both succeed", ["ok", "ok"]],
  ["first succeeds, second fails", ["ok", "fail"]],
  ["first fails, second succeeds", ["fail", "ok"]],
  ["both fail", ["fail", "fail"]],
] as const) {
  const turns: ChatTurn[] = [{ role: "user", content: "list connected apps" }];
  const calls = [call("A"), call("B")];
  const turn = ToolTurn.begin(turns, "", calls);
  outcomes.forEach((outcome, i) => {
    turn.settle(calls[i].id, outcome === "ok" ? ok("connections.list") : failure("connections.list"));
  });
  turn.close();
  const v = validateTurns(turns);
  check(`${name}: protocol stays valid`, v.valid, v.valid ? shape(turns) : v.problems.join("; "));
}

for (const reason of ["refused", "timed-out", "cancelled", "not-executed"] as const) {
  const turns: ChatTurn[] = [{ role: "user", content: "x" }];
  const calls = [call("A"), call("B")];
  const turn = ToolTurn.begin(turns, "", calls);
  turn.settle("A", ok("connections.list"));
  turn.leaveUnsettled("B", reason);
  turn.close();
  const v = validateTurns(turns);
  const toolMessages = turns.filter((t) => t.role === "tool");
  check(
    `a ${reason} call still gets a result message`,
    v.valid && toolMessages.length === 2 && toolMessages[1].content.includes(reason),
    v.valid ? `${toolMessages.length} results` : v.problems.join("; "),
  );
}

// ── 2. Defect 1: a user turn between two tool results ──────────────────────
//
// The final-response contract was appended straight after the first result, so
// the second landed after a `user` message. This is the reported bug.
console.log("\n— contract turns must wait —");
{
  const broken: ChatTurn[] = [
    { role: "user", content: "list connected apps" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "A", name: "connections__get_status", arguments: "{}" },
        { id: "B", name: "connections__get_status", arguments: "{}" },
      ],
    },
    { role: "tool", toolCallId: "A", content: "{}" },
    { role: "user", content: "contract for A" },
    { role: "tool", toolCallId: "B", content: "{}" },
  ];
  const v = validateTurns(broken);
  check(
    "the old interleaved shape is detected as invalid",
    !v.valid,
    v.problems.join("; "),
  );

  const turns: ChatTurn[] = [{ role: "user", content: "list connected apps" }];
  const calls = [call("A"), call("B")];
  const turn = ToolTurn.begin(turns, "", calls);
  turn.settle("A", ok("connections.list"));
  turn.settle("B", ok("connections.get_status"));
  turn.close();
  turns.push({ role: "user", content: "contract for A" });
  turns.push({ role: "user", content: "contract for B" });
  check(
    "contracts appended after the turn closes are valid",
    validateTurns(turns).valid,
    shape(turns),
  );
}

// ── 3. Defect 2: a pause abandoning the remaining calls ────────────────────
console.log("\n— a pause still closes the turn —");
{
  const turns: ChatTurn[] = [{ role: "user", content: "delete two things" }];
  const calls = [call("A", "tasks.delete"), call("B", "tasks.delete")];
  const turn = ToolTurn.begin(turns, "", calls);
  // Call A pauses for confirmation; B is never reached.
  turn.leaveUnsettled("A", "awaiting-confirmation");
  for (const id of turn.unansweredIds()) turn.leaveUnsettled(id, "not-executed");
  turn.close();
  const v = validateTurns(turns);
  check(
    "a confirmation pause leaves valid history",
    v.valid && turns.filter((t) => t.role === "tool").length === 2,
    v.valid ? shape(turns) : v.problems.join("; "),
  );
  check(
    "the paused call is reported as awaiting confirmation",
    turns.some((t) => t.role === "tool" && t.content.includes("awaiting")),
    "awaiting-user-confirmation recorded",
  );
}

// ── 4. Defect 3: the fabricated "confirmed" id ─────────────────────────────
console.log("\n— resume must not invent an id —");
{
  const turns: ChatTurn[] = [
    { role: "user", content: "delete it" },
    { role: "assistant", content: "", toolCalls: [{ id: "A", name: "tasks__delete", arguments: "{}" }] },
    { role: "tool", toolCallId: "A", content: "{}" },
    // What the resume used to append.
    { role: "tool", toolCallId: "confirmed", content: "{}" },
  ];
  check(
    "an invented tool_call_id is rejected",
    !validateTurns(turns).valid,
    validateTurns(turns).problems.join("; "),
  );

  const fixed: ChatTurn[] = [
    { role: "user", content: "delete it" },
    { role: "assistant", content: "", toolCalls: [{ id: "A", name: "tasks__delete", arguments: "{}" }] },
    { role: "tool", toolCallId: "A", content: "{}" },
    { role: "user", content: "The user approved the action, and it has now run." },
  ];
  check(
    "the resume as a user turn is valid",
    validateTurns(fixed).valid,
    shape(fixed),
  );
}

// ── 5. Duplicate ids and closing twice ─────────────────────────────────────
console.log("\n— idempotence and duplicates —");
{
  const turns: ChatTurn[] = [{ role: "user", content: "x" }];
  const turn = ToolTurn.begin(turns, "", [call("A")]);
  turn.settle("A", ok("connections.list"));
  turn.close();
  turn.close();
  turn.close();
  check(
    "closing repeatedly appends one result, not three",
    turns.filter((t) => t.role === "tool").length === 1 && validateTurns(turns).valid,
    `${turns.filter((t) => t.role === "tool").length} result(s)`,
  );
}
{
  const dup: ChatTurn[] = [
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "A", name: "x", arguments: "{}" },
        { id: "A", name: "x", arguments: "{}" },
      ],
    },
    { role: "tool", toolCallId: "A", content: "{}" },
    { role: "tool", toolCallId: "A", content: "{}" },
  ];
  check(
    "a duplicate tool_call_id is caught",
    validateTurns(dup).problems.some((p) => p.includes("duplicate")),
    validateTurns(dup).problems.join("; "),
  );
}

// ── 6. Restoring malformed history ─────────────────────────────────────────
console.log("\n— repairing stored history —");
{
  const stored: ChatTurn[] = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: "working on it",
      toolCalls: [
        { id: "A", name: "x", arguments: "{}" },
        { id: "B", name: "x", arguments: "{}" },
      ],
    },
    { role: "tool", toolCallId: "A", content: "{}" },
    // B's result never made it to storage.
  ];
  check("the truncated history is invalid", !validateTurns(stored).valid, validateTurns(stored).problems.join("; "));
  const repaired = repairTurns(stored);
  check(
    "repair fills the missing result and validates",
    repaired.repaired && validateTurns(repaired.turns).valid,
    shape(repaired.turns),
  );
  check(
    "the synthesized result says it did not run, rather than inventing one",
    repaired.turns.some(
      (t) => t.role === "tool" && t.toolCallId === "B" && t.content.includes("not-executed"),
    ),
    "honest placeholder",
  );
}
{
  const orphaned: ChatTurn[] = [
    { role: "user", content: "hello" },
    { role: "tool", toolCallId: "ghost", content: "{}" },
    { role: "assistant", content: "hi" },
  ];
  const repaired = repairTurns(orphaned);
  check(
    "an orphan tool result is dropped, not sent",
    validateTurns(repaired.turns).valid && repaired.dropped === 1,
    shape(repaired.turns),
  );
}
{
  const clean: ChatTurn[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ];
  const untouched = repairTurns(clean);
  check(
    "a valid history is left completely alone",
    !untouched.repaired && untouched.turns === clean,
    "unchanged",
  );
}

// ── 7. The engine routes through the assembler ─────────────────────────────
console.log("\n— production wiring —");
{
  const { readFileSync } = await import("node:fs");
  const engine = readFileSync("src/features/capabilities/capabilityEngine.ts", "utf8");
  check(
    "the engine builds turns with the assembler",
    /ToolTurn\.begin\(/.test(engine),
    "ToolTurn.begin used",
  );
  check(
    "the engine validates before every provider call",
    /validateTurns\(loop\.turns\)/.test(engine) && /repairTurns\(loop\.turns\)/.test(engine),
    "validate + repair before chat()",
  );
  check(
    "a pause closes the turn before returning",
    /turn\.leaveUnsettled\(call\.id, "awaiting-confirmation"\)[\s\S]{0,240}turn\.close\(\)/.test(engine),
    "pause path closes",
  );
  check(
    'the fabricated "confirmed" tool id is gone',
    !/toolCallId: "confirmed"/.test(engine),
    "no invented ids",
  );
  check(
    "contracts are queued, not appended mid-turn",
    /pendingContracts\.push\(/.test(engine) &&
      /turn\.close\(\);[\s\S]{0,200}for \(const contract of pendingContracts\)/.test(engine),
    "contracts follow the closed turn",
  );
}

console.log(`\n${"-".repeat(74)}`);
if (failed > 0) {
  console.log(`${failed} FAILED\n`);
  failures.forEach((f) => console.log(`  x ${f}`));
} else {
  console.log("all passed");
}
process.exit(failed === 0 ? 0 : 1);
