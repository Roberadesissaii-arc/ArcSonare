/**
 * Approving an overwrite must actually let the retry through.
 *
 * Observed twice: "I'm still being asked to confirm the overwrite." The bridge
 * told the model to call again after the user agreed, but the retry was not
 * recognised as approved, so it prompted forever.
 *
 * First cause: nothing carried the approval at all.
 * Second cause: the approval was keyed on ALL arguments, and the model sent
 * corrected `content` on the retry — so the key never matched. The user
 * approved overwriting a FILE, not a specific byte sequence.
 *
 * Run: npx tsx scripts/check-confirm-retry.mts
 */

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** Mirrors callKey() in src/services/realtime/realtimeTools.ts. */
const IDENTITY_KEYS = [
  "path",
  "parent_path",
  "name",
  "source_path",
  "target_path",
  "destination",
  "query",
  "folder",
];

function callKey(capabilityId: string, args: Record<string, unknown>): string {
  const identity: Record<string, unknown> = {};
  for (const k of IDENTITY_KEYS) {
    if (args[k] !== undefined) identity[k] = args[k];
  }
  return `${capabilityId}:${JSON.stringify(identity)}`;
}

const CAP = "filesystem.create_file";
const first = {
  parent_path: "C:\\Users\\rober\\Desktop",
  name: "prime_finder.py",
  content: "print('first attempt')",
};
// The retry the model actually sends: same file, corrected content.
const retry = {
  parent_path: "C:\\Users\\rober\\Desktop",
  name: "prime_finder.py",
  content: "def is_prime(n):\n    ...",
};

check(
  "retry with corrected content is recognised as the same approval",
  callKey(CAP, first) === callKey(CAP, retry),
  callKey(CAP, retry),
);

// A different file must NOT inherit the approval.
const otherFile = { ...retry, name: "other.py" };
check(
  "a different file does not inherit approval",
  callKey(CAP, first) !== callKey(CAP, otherFile),
  callKey(CAP, otherFile),
);

// A different folder must not inherit it either.
const otherDir = { ...retry, parent_path: "C:\\Users\\rober\\Documents" };
check(
  "same name in a different folder does not inherit approval",
  callKey(CAP, first) !== callKey(CAP, otherDir),
  callKey(CAP, otherDir),
);

// A different capability on the same path must not inherit it.
check(
  "a different capability does not inherit approval",
  callKey(CAP, first) !== callKey("filesystem.delete", first),
  callKey("filesystem.delete", first),
);

// The old whole-args behaviour, to show this test would have caught it.
const oldKey = (c: string, a: Record<string, unknown>) => `${c}:${JSON.stringify(a)}`;
check(
  "the previous whole-args key would NOT have matched (regression proof)",
  oldKey(CAP, first) !== oldKey(CAP, retry),
  "old key differed on content — which is why it looped",
);

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed — approval survives a corrected retry");
process.exit(failed ? 1 : 0);
