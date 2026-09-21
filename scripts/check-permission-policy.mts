/**
 * How many times one request may ask.
 *
 * The reported failure was five to ten prompts for one spoken sentence, all of
 * them for things that change nothing — opening an image, looking at it, drawing
 * a temporary outline. These count the prompts a request would produce, so
 * "asks too often" and "stopped asking about deletions" are both failures rather
 * than both invisible.
 *
 * Run: npm run test:permission-policy
 */

import {
  isExternal,
  needsPrompt,
  permissionFor,
  planApproval,
  policyRisk,
} from "../src/features/capabilities/permissionPolicy";
import { CAPABILITY_REGISTRY, getCapability } from "../src/features/capabilities/capabilityRegistry";

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

/**
 * Run a request's steps and count the prompts.
 *
 * `granted` flips to true after the first `per-request` prompt, which is exactly
 * what the Rust grant store does for the rest of the request.
 */
function promptsFor(steps: string[]): { count: number; asked: string[] } {
  let granted = false;
  const asked: string[] = [];
  for (const id of steps) {
    if (needsPrompt(id, granted)) {
      asked.push(id);
      if (permissionFor(id).tier === "per-request") granted = true;
    }
  }
  return { count: asked.length, asked };
}

const expectPrompts = (label: string, steps: string[], expected: number) => {
  const { count, asked } = promptsFor(steps);
  check(
    `${label}: ${expected} prompt(s)`,
    count === expected,
    count === expected
      ? `${count} — ${asked.join(", ") || "none"}`
      : `got ${count}: ${asked.join(", ") || "none"}`,
  );
};

// ── Read-only inspection: five steps, no prompts ──────────────────────────
console.log("\n— read-only inspection —");
expectPrompts(
  "inspect the screen five ways",
  [
    "screen.capture",
    "windows.list",
    "screen.understand",
    "system.get_running_processes",
    "connections.list",
  ],
  0,
);

// ── The reported request ──────────────────────────────────────────────────
console.log("\n— open image, highlight person, circle face —");
expectPrompts(
  "the whole plan",
  [
    "applications.open",
    "screen.capture",
    "screen.highlight_target",
    "screen.capture",
    "screen.highlight_target",
  ],
  0,
);
{
  // Re-resolution: the same steps again, because the target moved.
  expectPrompts(
    "re-running every step after a target refresh",
    [
      "screen.capture",
      "screen.highlight_target",
      "screen.capture",
      "screen.highlight_target",
      "screen.capture",
      "screen.highlight_target",
    ],
    0,
  );
}

// ── Reversible application action ─────────────────────────────────────────
console.log("\n— reversible application action —");
{
  const { count } = promptsFor([
    "screen.capture",
    "screen.highlight_target",
    "screen.click_target",
  ]);
  check(
    "inspect, highlight, then click asks at most once",
    count <= 1,
    `${count} prompt(s)`,
  );
}

// ── Deletion ──────────────────────────────────────────────────────────────
console.log("\n— deletion —");
expectPrompts("delete one task", ["tasks.delete"], 1);
expectPrompts(
  "a delete inside a longer plan still asks",
  ["screen.capture", "tasks.list", "tasks.delete"],
  1,
);
{
  // Three deletes are three prompts here, and the *plan* is what collapses them
  // into one described batch — a grant must never do it silently.
  const { count } = promptsFor(["tasks.delete", "tasks.delete", "tasks.delete"]);
  check(
    "an approval never covers a second deletion",
    count === 3,
    `${count} prompt(s) for three deletes`,
  );
  const plan = planApproval(["tasks.delete", "tasks.delete", "tasks.delete"]);
  check(
    "the batch is described as one confirmation instead",
    plan.alwaysAsk.length === 3 && !plan.needsApproval,
    `${plan.alwaysAsk.length} enumerated, grant needed: ${plan.needsApproval}`,
  );
}

// ── Scope change ──────────────────────────────────────────────────────────
console.log("\n— scope change —");
{
  const granted = true; // highlighting was approved earlier in this request
  check(
    "an approved highlight does not authorise sending a message",
    needsPrompt("email.send_message", granted),
    "still asks",
  );
  check(
    "and the reason says why",
    permissionFor("email.send_message").reason === "this sends something out" ||
      permissionFor("email.send_message").tier === "always",
    permissionFor("email.send_message").reason ?? permissionFor("email.send_message").tier,
  );
}

// ── The classification itself ─────────────────────────────────────────────
console.log("\n— classification —");
{
  const never = [
    "screen.capture",
    "screen.highlight_target",
    "applications.open",
    "applications.focus",
    "filesystem.open_item",
    "filesystem.list_directory",
    "connections.list",
    "web.search",
  ].filter((id) => getCapability(id));
  const wrong = never.filter((id) => permissionFor(id).tier !== "none");
  check(
    "inspection, opening and temporary visuals never ask",
    wrong.length === 0,
    wrong.join(", ") || `${never.length} capabilities, none ask`,
  );

  const always = ["filesystem.delete", "tasks.delete"].filter((id) => getCapability(id));
  const lax = always.filter((id) => permissionFor(id).tier !== "always");
  check(
    "deletion always asks",
    lax.length === 0,
    lax.join(", ") || "always",
  );

  check(
    "no destructive capability is classified below `always`",
    CAPABILITY_REGISTRY.filter((c) => c.riskLevel === "destructive").every(
      (c) => permissionFor(c.id).tier === "always",
    ),
    "every destructive capability asks",
  );
  check(
    "no capability the registry calls read-only is made to ask",
    CAPABILITY_REGISTRY.filter((c) => c.riskLevel === "read-only").every(
      (c) => permissionFor(c.id).tier === "none",
    ),
    "reading never asks",
  );
  check(
    "an unknown capability is not silently allowed",
    permissionFor("totally.made.up").tier === "always",
    permissionFor("totally.made.up").tier,
  );
  check(
    "sending is recognised as leaving the machine",
    isExternal("email.send_message") && !isExternal("screen.capture"),
    "external verbs detected",
  );
  check(
    "every capability maps onto exactly one grant risk",
    CAPABILITY_REGISTRY.every((c) =>
      ["read-only", "reversible", "moderate", "destructive"].includes(policyRisk(c)),
    ),
    `${CAPABILITY_REGISTRY.length} capabilities classified`,
  );
}

// ── Annotations are temporary visual operations ───────────────────────────
// The whole border/circle conversation changes nothing: it draws overlays on
// top of the screen and never touches the underlying image. Asking permission
// to point at something is asking permission to speak.
console.log(`${String.fromCharCode(10)}— annotations —`);
{
  const annotationCapabilities = [
    "screen.annotate",
    "screen.update_annotation",
    "screen.remove_annotation",
    "screen.clear_annotations",
    "screen.highlight_target",
  ];
  const risky = annotationCapabilities.filter((id) => permissionFor(id).tier !== "none");
  check(
    "no annotation capability ever asks permission",
    risky.length === 0,
    risky.join(", ") || `${annotationCapabilities.length} capabilities, none ask`,
  );
  const misclassified = annotationCapabilities.filter((id) => {
    const c = getCapability(id);
    return !c || (c.riskLevel !== "reversible" && c.riskLevel !== "read-only");
  });
  check(
    "and each is classified as a reversible visual operation",
    misclassified.length === 0,
    misclassified.join(", ") || "reversible",
  );

  // The whole conversation, as a prompt count.
  expectPrompts(
    "border → circle → recolour → remove → clear",
    [
      "screen.capture",
      "screen.annotate",
      "screen.capture",
      "screen.annotate",
      "screen.update_annotation",
      "screen.remove_annotation",
      "screen.clear_annotations",
    ],
    0,
  );
  // And with two automatic target re-resolutions folded in.
  expectPrompts(
    "the same conversation with target refreshes",
    [
      "screen.capture",
      "screen.annotate",
      "screen.capture",
      "screen.capture",
      "screen.annotate",
      "screen.update_annotation",
    ],
    0,
  );
}

// ── The plan builder ──────────────────────────────────────────────────────
console.log("\n— one approval per plan —");
{
  const plan = planApproval([
    "screen.capture",
    "screen.highlight_target",
    "filesystem.modify_file",
  ]);
  check(
    "a plan with one changing step needs one approval",
    plan.needsApproval && plan.alwaysAsk.length === 0,
    `risk ${plan.approvedRisk}, ${plan.capabilities.length} capabilities covered`,
  );
  check(
    "read-only steps are inside the grant, so re-inspection cannot fall outside it",
    plan.capabilities.includes("screen.capture"),
    plan.capabilities.join(", "),
  );

  const readOnlyPlan = planApproval(["screen.capture", "windows.list"]);
  check(
    "a plan that only looks needs no approval at all",
    !readOnlyPlan.needsApproval,
    `risk ${readOnlyPlan.approvedRisk}`,
  );
}

console.log(`\n${"-".repeat(74)}`);
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failed === 0 ? 0 : 1);
