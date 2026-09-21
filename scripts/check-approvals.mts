/**
 * One approval, one execution, across two windows.
 *
 * The reported failure was a user approving the same operation over and over:
 * "modify this file" → "may I?" → "yes" → "may I?". Three separate mechanisms
 * produced it, and each gets its own group here:
 *
 *   1. routine work asked at all — opening, reading, downloading, editing a
 *      file the user named;
 *   2. the same question opened twice, because `main` and `sonare-overlay` are
 *      separate WebView2 heaps and each kept its own pending map;
 *   3. "yes" answered twice producing two executions.
 *
 * The stub is a faithful copy of `pending.rs`, so a pass here means the round
 * trip works, not merely that the frontend called something.
 *
 * Run: npm run test:approvals
 */

import {
  approvalCalls,
  resetApprovals,
} from "./register-approvals-backend-stub.mjs";
import {
  actionRisk,
  coverableByPlan,
  requiresApproval,
} from "../src/features/capabilities/permissionPolicy";
import {
  isModifyIntent,
  modifyRedirectMessage,
  shouldRedirectToModify,
} from "../src/features/capabilities/modifyIntent";
import {
  approvePendingAction,
  awaitingPendingAction,
  cancelPendingAction,
  claimPendingAction,
  markSideEffectPossible,
  openPendingAction,
  settlePendingAction,
  grantRequestApproval,
  stepIsCovered,
} from "../src/features/capabilities/approvalGrant";

let failed = 0;
const failures: string[] = [];

function check(name: string, pass: boolean, got: string) {
  if (!pass) {
    failed += 1;
    failures.push(`${name} → ${got}`);
  }
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

const FILE_ARGS = { parent_path: "C:\\Users\\rober\\Desktop", name: "bug.py" };

// ---------------------------------------------------------------------------
section("Routine actions never ask");
// ---------------------------------------------------------------------------

// Every one of these is something a user request is itself authorisation for.
// If any of them starts asking, one sentence turns back into five prompts.
const ROUTINE = [
  "applications.open",
  "applications.focus",
  "filesystem.open_item",
  "filesystem.read_text_file",
  "filesystem.read_for_edit",
  "filesystem.list_directory",
  "filesystem.create_file",
  "filesystem.modify_file",
  "filesystem.write_text_file",
  "web.search",
  "web.open_url",
  "browser.navigate",
  "browser.get_page_context",
  "browser.scroll",
  "browser.download",
  "screen.capture",
  "spotify.play",
];
for (const id of ROUTINE) {
  check(
    `${id} runs without asking`,
    !requiresApproval(id),
    `risk=${actionRisk(id)} asks=${requiresApproval(id)}`,
  );
}

check(
  "a whole routine request produces zero prompts",
  ROUTINE.filter(requiresApproval).length === 0,
  `${ROUTINE.filter(requiresApproval).length} of ${ROUTINE.length} would ask`,
);

// ---------------------------------------------------------------------------
section("Risky actions still ask");
// ---------------------------------------------------------------------------

for (const [id, expected] of [
  ["filesystem.delete", "destructive"],
  ["tasks.delete", "destructive"],
  ["applications.uninstall", "destructive"],
  ["email.send_message", "sensitive"],
  ["browser.login", "sensitive"],
  ["browser.accept_terms", "sensitive"],
  ["installer.install", "elevated"],
  ["system.modify_firewall", "elevated"],
] as const) {
  check(
    `${id} is ${expected} and asks`,
    actionRisk(id) === expected && requiresApproval(id),
    `risk=${actionRisk(id)} asks=${requiresApproval(id)}`,
  );
}

check(
  "an unclassified capability is not silently free",
  actionRisk("something.nobody.classified") === "destructive",
  actionRisk("something.nobody.classified"),
);

check(
  "a plan cannot pre-approve a deletion",
  !coverableByPlan("filesystem.delete"),
  String(coverableByPlan("filesystem.delete")),
);
check(
  "a plan cannot pre-approve elevation",
  !coverableByPlan("installer.install"),
  String(coverableByPlan("installer.install")),
);
check(
  "a plan can cover a sensitive step",
  coverableByPlan("browser.accept_terms"),
  String(coverableByPlan("browser.accept_terms")),
);

// ---------------------------------------------------------------------------
section("Downloading is not installing");
// ---------------------------------------------------------------------------

check(
  "downloading an installer needs no approval",
  !requiresApproval("browser.download"),
  actionRisk("browser.download"),
);
check(
  "launching the downloaded file needs no approval",
  !requiresApproval("installer.launch"),
  actionRisk("installer.launch"),
);
check(
  "installing it does",
  requiresApproval("installer.install") && actionRisk("installer.install") === "elevated",
  actionRisk("installer.install"),
);

// ---------------------------------------------------------------------------
section("One question, both windows");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  const open = {
    runId: "run-1",
    conversationId: "conv-1",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\report.pdf"] },
    title: "Move report.pdf to the Recycle Bin?",
  };

  // The overlay asks.
  const first = await openPendingAction(open);
  // The main window, re-entering the same run, asks about the same thing.
  const second = await openPendingAction(open);

  check(
    "the second window does not open a rival question",
    first !== null && second !== null && second.created === false,
    `created=${second?.created} same=${first?.action.actionId === second?.action.actionId}`,
  );
  check(
    "only one question was ever raised",
    approvalCalls.questionsAsked === 1,
    `questionsAsked=${approvalCalls.questionsAsked}`,
  );

  // The main window looks up what is pending and finds the overlay's question.
  const awaiting = await awaitingPendingAction("conv-1");
  check(
    "both windows resolve the same pending action",
    awaiting?.actionId === first?.action.actionId,
    `awaiting=${awaiting?.actionId} opened=${first?.action.actionId}`,
  );
})();

// ---------------------------------------------------------------------------
section("Repeated yes does not duplicate execution");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  const opened = await openPendingAction({
    runId: "run-2",
    conversationId: "conv-2",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\report.pdf"] },
    title: "Delete report.pdf?",
  });
  const id = opened!.action.actionId;

  // The user says yes in the overlay, and chat also sends one.
  const a = await approvePendingAction(id);
  const b = await approvePendingAction(id);
  check("both yeses are accepted", a.allowed && b.allowed, `${a.allowed}/${b.allowed}`);

  const run1 = await claimPendingAction({
    actionId: id,
    runId: "run-2",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\report.pdf"] },
  });
  const run2 = await claimPendingAction({
    actionId: id,
    runId: "run-2",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\report.pdf"] },
  });

  check("the first claim runs", run1.allowed, String(run1.allowed));
  check(
    "the second claim is refused",
    !run2.allowed,
    `${run2.allowed} reason=${run2.reason}`,
  );
  check(
    "exactly one execution happened",
    approvalCalls.executionCount === 1,
    `executionCount=${approvalCalls.executionCount}`,
  );
})();

// ---------------------------------------------------------------------------
section("Approval is bound to what the user saw");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  const opened = await openPendingAction({
    runId: "run-3",
    conversationId: "conv-3",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\report.pdf"] },
    title: "Delete report.pdf?",
  });
  const id = opened!.action.actionId;
  await approvePendingAction(id);

  const escalated = await claimPendingAction({
    actionId: id,
    runId: "run-3",
    capabilityId: "filesystem.delete",
    // The same file, quietly upgraded to a permanent delete.
    args: { paths: ["C:\\a\\report.pdf"], mode: "permanent" },
  });
  check(
    "a substituted argument is refused",
    !escalated.allowed,
    `${escalated.allowed} reason=${escalated.reason}`,
  );

  const otherRun = await claimPendingAction({
    actionId: id,
    runId: "run-OTHER",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\report.pdf"] },
  });
  check(
    "an approval does not cross runs",
    !otherRun.allowed,
    `${otherRun.allowed} reason=${otherRun.reason}`,
  );
  check(
    "nothing ran",
    approvalCalls.executionCount === 0,
    `executionCount=${approvalCalls.executionCount}`,
  );
})();

// ---------------------------------------------------------------------------
section("Nothing runs before the answer, or after a no");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  const opened = await openPendingAction({
    runId: "run-4",
    conversationId: "conv-4",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\x"] },
    title: "Delete x?",
  });
  const id = opened!.action.actionId;

  const early = await claimPendingAction({
    actionId: id,
    runId: "run-4",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\x"] },
  });
  check("an unanswered question runs nothing", !early.allowed, String(early.reason));

  await cancelPendingAction(id);
  const afterNo = await approvePendingAction(id);
  check("a cancelled question cannot be approved later", !afterNo.allowed, String(afterNo.reason));
  check(
    "still nothing ran",
    approvalCalls.executionCount === 0,
    `executionCount=${approvalCalls.executionCount}`,
  );
})();

// ---------------------------------------------------------------------------
section("A possible side effect is never retried automatically");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  const args = { paths: ["C:\\a\\y"] };
  const opened = await openPendingAction({
    runId: "run-5",
    conversationId: "conv-5",
    capabilityId: "filesystem.delete",
    args,
    title: "Delete y?",
  });
  const id = opened!.action.actionId;
  await approvePendingAction(id);
  await claimPendingAction({ actionId: id, runId: "run-5", capabilityId: "filesystem.delete", args });
  await markSideEffectPossible(id);
  await settlePendingAction(id, false);

  const retry = await claimPendingAction({
    actionId: id,
    runId: "run-5",
    capabilityId: "filesystem.delete",
    args,
  });
  check(
    "a failure past the side-effect line does not retry",
    !retry.allowed,
    `${retry.allowed} reason=${retry.reason}`,
  );
})();

await (async () => {
  resetApprovals();
  const args = { paths: ["C:\\a\\z"] };
  const opened = await openPendingAction({
    runId: "run-6",
    conversationId: "conv-6",
    capabilityId: "filesystem.delete",
    args,
    title: "Delete z?",
  });
  const id = opened!.action.actionId;
  await approvePendingAction(id);
  await claimPendingAction({ actionId: id, runId: "run-6", capabilityId: "filesystem.delete", args });
  // Failed before anything could escape.
  await settlePendingAction(id, false);

  const retry = await claimPendingAction({
    actionId: id,
    runId: "run-6",
    capabilityId: "filesystem.delete",
    args,
  });
  check("a clean failure may retry", retry.allowed, String(retry.allowed));
})();

await (async () => {
  resetApprovals();
  const args = { paths: ["C:\\a\\done"] };
  const opened = await openPendingAction({
    runId: "run-7",
    conversationId: "conv-7",
    capabilityId: "filesystem.delete",
    args,
    title: "Delete done?",
  });
  const id = opened!.action.actionId;
  await approvePendingAction(id);
  await claimPendingAction({ actionId: id, runId: "run-7", capabilityId: "filesystem.delete", args });
  await settlePendingAction(id, true);

  const again = await claimPendingAction({
    actionId: id,
    runId: "run-7",
    capabilityId: "filesystem.delete",
    args,
  });
  check(
    "a completed action never runs again",
    !again.allowed,
    `${again.allowed} reason=${again.reason}`,
  );
})();

// ---------------------------------------------------------------------------
section("Different targets are different questions");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  await openPendingAction({
    runId: "run-8",
    conversationId: "conv-8",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\one"] },
    title: "Delete one?",
  });
  const other = await openPendingAction({
    runId: "run-8",
    conversationId: "conv-8",
    capabilityId: "filesystem.delete",
    args: { paths: ["C:\\a\\two"] },
    title: "Delete two?",
  });
  check(
    "a second file is asked about separately",
    other?.created === true,
    `created=${other?.created}`,
  );
  check(
    "two questions for two files",
    approvalCalls.questionsAsked === 2,
    `questionsAsked=${approvalCalls.questionsAsked}`,
  );
})();

// ---------------------------------------------------------------------------
section("An approved plan does not re-ask per step");
// ---------------------------------------------------------------------------

await (async () => {
  resetApprovals();
  // "Go to the LightBurn site, download it for Windows" — the plan the user
  // approved once. Every step below stays inside it.
  const steps = [
    "applications.open",
    "browser.navigate",
    "browser.get_page_context",
    "browser.find_link",
    "browser.click_element",
    "browser.download",
    "browser.wait_for_download",
    "filesystem.get_metadata",
  ];

  const granted = await grantRequestApproval({
    requestId: "req-lb",
    accountId: "acct-A",
    conversationId: "conv-lb",
    origin: "voice",
    approvedRisk: "reversible",
    approvedCapabilities: steps,
  });
  check("the plan is grantable", granted === "req-lb", String(granted));

  let asked = 0;
  for (const id of steps) {
    if (!requiresApproval(id)) continue;
    const covered = await stepIsCovered({
      requestId: "req-lb",
      accountId: "acct-A",
      conversationId: "conv-lb",
      origin: "voice",
      capabilityId: id,
      risk: "reversible",
    });
    if (!covered) asked += 1;
  }
  check(
    "the whole download plan asks zero further times",
    asked === 0,
    `${asked} further prompts across ${steps.length} steps`,
  );

  // And the grant does not stretch to something outside it.
  const outside = await stepIsCovered({
    requestId: "req-lb",
    accountId: "acct-A",
    conversationId: "conv-lb",
    origin: "voice",
    capabilityId: "filesystem.delete",
    risk: "destructive",
  });
  check("the grant does not cover a deletion", !outside, String(outside));
})();

await (async () => {
  resetApprovals();
  const granted = await grantRequestApproval({
    requestId: "req-del",
    accountId: "acct-A",
    origin: "chat",
    approvedRisk: "destructive",
    approvedCapabilities: ["filesystem.delete"],
  });
  check(
    "a destructive plan is never granted up front",
    granted === null,
    String(granted),
  );
})();

// ---------------------------------------------------------------------------
section("Modifying a file the user named");
// ---------------------------------------------------------------------------

check(
  "read_for_edit does not ask",
  !requiresApproval("filesystem.read_for_edit"),
  actionRisk("filesystem.read_for_edit"),
);
check(
  "modify_file does not ask",
  !requiresApproval("filesystem.modify_file"),
  actionRisk("filesystem.modify_file"),
);
check(
  "the fix-a-file flow produces zero prompts",
  ["filesystem.read_for_edit", "filesystem.modify_file"].filter(requiresApproval).length === 0,
  String(["filesystem.read_for_edit", "filesystem.modify_file"].filter(requiresApproval)),
);
check(
  "deleting it still asks",
  requiresApproval("filesystem.delete"),
  actionRisk("filesystem.delete"),
);

// The misroute itself: a small model sends "fix the bug" to create_file, the
// file exists, and the overwrite question appears. That question is the loop.
for (const request of [
  "fix the bug in that python file",
  "modify the file you created",
  "update the script to print the total",
  "change the value in bug.py",
  "add error handling to it",
  "correct the typo in that file",
]) {
  check(
    `"${request}" is redirected, not asked about`,
    shouldRedirectToModify({
      capabilityId: "filesystem.create_file",
      request,
      reason: "already-exists",
    }),
    `modifyIntent=${isModifyIntent(request)}`,
  );
}

// And a real replacement still asks, because it really is one.
for (const request of [
  "write me a new notes.txt from scratch",
  "make a brand-new config file there",
  "overwrite it with an empty file",
  "create a shopping list called notes.txt",
]) {
  check(
    `"${request}" still asks about overwriting`,
    !shouldRedirectToModify({
      capabilityId: "filesystem.create_file",
      request,
      reason: "already-exists",
    }),
    `modifyIntent=${isModifyIntent(request)}`,
  );
}

check(
  "a create on a path that does not exist is never redirected",
  !shouldRedirectToModify({
    capabilityId: "filesystem.create_file",
    request: "fix the bug in that file",
    reason: undefined,
  }),
  "no already-exists reason",
);
check(
  "the redirect names both the path and the editing tool",
  (() => {
    const m = modifyRedirectMessage("C:\\a\\bug.py");
    return (
      m.includes("C:\\a\\bug.py") &&
      m.includes("filesystem.read_for_edit") &&
      m.includes("filesystem.modify_file") &&
      /do not ask about overwriting/i.test(m)
    );
  })(),
  modifyRedirectMessage("C:\\a\\bug.py").slice(0, 60) + "…",
);

// ---------------------------------------------------------------------------
console.log(`\n${"═".repeat(64)}`);
if (failed === 0) {
  console.log("All approval checks passed.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`${"═".repeat(64)}\n`);
process.exit(failed === 0 ? 0 : 1);

void FILE_ARGS;
