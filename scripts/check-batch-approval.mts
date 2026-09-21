/**
 * Several named deletions are one question.
 *
 * "Delete these three test tasks" asked three times: the model emits three
 * `tasks.delete` calls in one assistant turn, and the engine confirmed per
 * call. Three identical prompts for a list the user enumerated themselves is
 * not extra safety — it is the same question three times, and the prompts named
 * one task each, so nobody could see the whole set they were agreeing to.
 *
 * These cover the grouping. The exactly-once and scope guarantees live in
 * `src-tauri/src/capabilities/approval_plan.rs` and are tested there against
 * the store that enforces them.
 *
 * Run: npm run test:batch-approval
 */

import { describeBatch, findDeletionBatch } from "../src/features/capabilities/deletionBatch";
import { permissionFor } from "../src/features/capabilities/permissionPolicy";
import type { ParsedToolCall } from "../src/features/capabilities/capabilityTypes";

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

const call = (
  id: string,
  capabilityId: string,
  args: Record<string, unknown>,
): ParsedToolCall => ({ id, capabilityId, arguments: args });

const deletes = (...tasks: Array<[string, string]>) =>
  tasks.map(([id, title], i) =>
    call(`call-${i}`, "tasks.delete", { task_id: id, title }),
  );

/** What the user would actually be asked, as a prompt count. */
function promptsFor(calls: ParsedToolCall[]): number {
  const batch = findDeletionBatch(calls);
  if (batch) return 1;
  let granted = false;
  let n = 0;
  for (const c of calls) {
    const { tier } = permissionFor(c.capabilityId);
    if (tier === "always" || (tier === "per-request" && !granted)) {
      n += 1;
      if (tier === "per-request") granted = true;
    }
  }
  return n;
}

// ── The requirement ───────────────────────────────────────────────────────
console.log("\n— three named deletions —");
{
  const calls = deletes(
    ["task-a", "Task A"],
    ["task-b", "Task B"],
    ["task-c", "Task C"],
  );
  check(
    "three explicitly selected deletions ask exactly once",
    promptsFor(calls) === 1,
    `${promptsFor(calls)} prompt(s)`,
  );

  const batch = findDeletionBatch(calls)!;
  const described = describeBatch(batch);
  check(
    "the one prompt names every item",
    described.affectedItems.map((i) => i.name).join(", ") === "Task A, Task B, Task C",
    described.affectedItems.map((i) => i.name).join(", "),
  );
  check(
    "and says how many, in one sentence",
    /^Delete these 3 tasks\?$/.test(described.title),
    described.title,
  );
  check(
    "the rows keep their tool-call ids, so results map back",
    batch.items.map((i) => i.toolCallId).join(",") === "call-0,call-1,call-2",
    batch.items.map((i) => i.toolCallId).join(","),
  );
  check(
    "and their resource identities, so the plan can enforce exactly-once",
    batch.items.map((i) => i.resource).join(",") === "task-a,task-b,task-c",
    batch.items.map((i) => i.resource).join(","),
  );
}

// ── What must not be batched ──────────────────────────────────────────────
console.log("\n— what is not a batch —");
check(
  "one deletion is already one question",
  findDeletionBatch(deletes(["task-a", "Task A"])) === null,
  "single call left to the per-call path",
);
check(
  "two different capabilities are not one sentence",
  findDeletionBatch([
    call("a", "tasks.delete", { task_id: "task-a" }),
    call("b", "filesystem.delete", { path: "C:\\tmp\\x" }),
  ]) === null,
  "mixed capabilities not batched",
);
check(
  "reversible work is not turned into a confirmation it never needed",
  findDeletionBatch([
    call("a", "screen.capture", { target: "screen" }),
    call("b", "screen.capture", { target: "window" }),
  ]) === null,
  "only always-confirm capabilities batch",
);
check(
  "the same target twice is not a list",
  findDeletionBatch(deletes(["task-a", "Task A"], ["task-a", "Task A again"])) === null,
  "duplicate resource refuses the batch",
);
check(
  "an item with no identifiable target is not put in a list",
  findDeletionBatch([
    call("a", "tasks.delete", { task_id: "task-a" }),
    call("b", "tasks.delete", {}),
  ]) === null,
  "unidentified row falls back to per-call confirmation",
);
check(
  "tasks named by title still batch, because that is what the model sends",
  findDeletionBatch([
    call("a", "tasks.delete", { title_query: "Batch probe one" }),
    call("b", "tasks.delete", { title_query: "Batch probe two" }),
    call("c", "tasks.delete", { title_query: "Batch probe three" }),
  ])?.items.length === 3,
  "three titled deletions group into one question",
);

// ── Nothing here loosens the policy ───────────────────────────────────────
console.log("\n— the policy is unchanged —");
check(
  "deletion is still always-confirm",
  permissionFor("tasks.delete").tier === "always",
  permissionFor("tasks.delete").tier,
);
check(
  "a batch is still described as destructive",
  findDeletionBatch(deletes(["a", "A"], ["b", "B"]))!.items.every(
    (i) => permissionFor(i.capabilityId).tier === "always",
  ),
  "every row would have asked on its own",
);
check(
  "the description says the approval does not extend",
  /needs a new confirmation/i.test(
    describeBatch(findDeletionBatch(deletes(["a", "A"], ["b", "B"]))!).description,
  ),
  describeBatch(findDeletionBatch(deletes(["a", "A"], ["b", "B"]))!).description,
);

// ── The engine actually uses it ───────────────────────────────────────────
console.log("\n— wired into the engine —");
{
  const { readFileSync } = await import("node:fs");
  const engine = readFileSync("src/features/capabilities/capabilityEngine.ts", "utf8");
  check(
    "model-selected calls pass through the confirmation gate",
    /needsFrontendConfirmation\(call\.capabilityId\)/.test(engine),
    // The gate used to exist only in the deterministic router, so every
    // model-chosen deletion ran without asking anything at all.
    "the gate is on the path the model actually uses",
  );
  check(
    "the model loop looks for a batch before executing calls",
    /findDeletionBatch\(reply\.toolCalls\)/.test(engine),
    "checked once per assistant turn",
  );
  check(
    "approving a batch runs every item",
    /runApprovedBatch\(/.test(engine) && /for \(const item of batch\.items\)/.test(engine),
    "one answer, every row",
  );
  check(
    "each item carries its tool-call id as the idempotency key",
    /item\.toolCallId,/.test(engine),
    "a redelivered call cannot delete twice",
  );
  check(
    "a half-failed batch is not reported as done",
    /of \$\{done\.length\} done/.test(engine),
    "per-item results are reported",
  );
  check(
    "an approved run does not re-detect the same batch",
    /batchApproved\.has\(run\.id\)/.test(engine) && /batchApproved\.add\(runId\)/.test(engine),
    "the model's follow-up turn does not ask again",
  );
}

console.log(`\n${"-".repeat(74)}`);
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failed === 0 ? 0 : 1);
