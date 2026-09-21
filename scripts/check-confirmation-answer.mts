/**
 * A question the assistant asks must be answerable where it was asked.
 *
 * The batch confirmation worked — one prompt, all three tasks named — and then
 * "Yes, go ahead" got:
 *
 *   Sure — go ahead with what? I don't have a pending request on my end.
 *
 * Two unrelated mechanisms had grown up next to each other. `PendingAction` is
 * something the assistant *offered*, and `resolveFollowUp` answers it. A pending
 * confirmation is something the assistant is *blocked on*, and
 * `resolvePendingConfirmation` was reachable only from the voice overlay's
 * buttons — so in chat the run stayed parked forever and the user's answer was
 * routed as a brand-new request.
 *
 * Run: npm run test:confirmation-answer
 */

import { readFileSync } from "node:fs";
import { classifyConfirmation } from "../src/features/conversation/confirmationIntent";

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

const engine = readFileSync("src/features/capabilities/capabilityEngine.ts", "utf8");

// ── The answers the user actually typed ───────────────────────────────────
console.log("\n— what counts as an answer —");
for (const yes of ["Yes, go ahead", "yes", "yep", "go ahead", "do it", "sure", "yes please", "ok, do it", "yes, delete them"]) {
  check(
    `"${yes}" reads as approval`,
    classifyConfirmation(yes) === "affirm",
    classifyConfirmation(yes),
  );
}
for (const no of ["no", "cancel", "don't", "stop", "no, cancel", "no thanks", "leave it"]) {
  check(
    `"${no}" reads as a refusal`,
    classifyConfirmation(no) === "decline",
    classifyConfirmation(no),
  );
}
check(
  "a contradiction is read as the safe answer",
  classifyConfirmation("no, go ahead") === "decline",
  classifyConfirmation("no, go ahead"),
);
check(
  "an approval with an instruction attached is not an approval",
  classifyConfirmation("yes, delete the other one instead") === "none",
  // Approving this would delete three tasks the user has just changed their
  // mind about.
  classifyConfirmation("yes, delete the other one instead"),
);
check(
  "a fresh instruction is not an answer",
  classifyConfirmation("delete the other one instead") === "none",
  // Reading this as "yes" would delete the three the user just changed their
  // mind about.
  classifyConfirmation("delete the other one instead"),
);

// ── The engine routes it ──────────────────────────────────────────────────
console.log("\n— the engine answers the parked run —");
check(
  "a parked confirmation is answered before anything else is routed",
  /const answered = await answerPendingConfirmation\(trimmed, options\);/.test(engine) &&
    engine.indexOf("answerPendingConfirmation(trimmed, options)") <
      engine.indexOf("runFollowUpTurn(trimmed, options)"),
  "checked ahead of offers and fresh routing",
);
check(
  "and it resolves through the same path the overlay buttons use",
  /return resolvePendingConfirmation\(claimed\.runId, kind === "affirm"\);/.test(engine),
  "one resolver, two surfaces",
);
check(
  "yes and no are the only things that answer it",
  /if \(kind !== "affirm" && kind !== "decline"\) return null;/.test(engine),
  "anything else falls through to normal routing",
);

// ── It cannot answer the wrong question ───────────────────────────────────
console.log("\n— scope of an answer —");
check(
  "every pause records which run is waiting",
  (engine.match(/markAwaitingConfirmation\(run\.id, options/g) ?? []).length ===
    (engine.match(/confirmationStatus: "pending",/g) ?? []).length,
  `${(engine.match(/markAwaitingConfirmation\(run\.id, options/g) ?? []).length} of ` +
    `${(engine.match(/confirmationStatus: "pending",/g) ?? []).length} pause sites marked`,
);
check(
  "an answer is scoped to its conversation",
  /conversationKey\(options\)/.test(engine),
  "keyed by conversation, not global",
);
check(
  "an answer given in one origin does not resolve a question asked in another",
  /if \(entry\.origin !== options\.origin\) return null;/.test(engine),
  "chat cannot approve what voice asked, and the reverse",
);
check(
  "a stale question is re-asked rather than acted on",
  /AWAITING_TTL_MS/.test(engine) && /went stale before you answered/.test(engine),
  "expired approvals do not execute",
);
check(
  "resolving clears the marker, however it was resolved",
  /clearAwaitingConfirmation\(runId\);/.test(engine),
  "the overlay's buttons clear it too",
);
check(
  "a marker whose run has gone is not answerable",
  /!pendingByRun\.has\(entry\.runId\)/.test(engine),
  "the marker cannot outlive the run",
);

console.log(`\n${"-".repeat(74)}`);
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failed === 0 ? 0 : 1);
