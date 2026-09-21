/**
 * Two user-visible regressions seen in a live overlay run:
 *
 *  1. A missing FOLDER was announced as a missing APP, producing
 *     'I couldn't find an app called "C:\...\reports" does not exist.".
 *      If you meant a YouTube video…' — three wrong things in one sentence.
 *  2. The capsule renders plain text, so markdown replies leaked as
 *     literal "**fantastic** — 5 i…".
 *
 * Run: npx tsx scripts/check-notfound-and-capsule.mts
 */

import { composeResponse } from "../src/features/capabilities/capabilityResponseComposer";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

// ── 1. folder not-found must not mention apps or YouTube ──────────────────
const missingFolder = {
  capabilityId: "filesystem.list_directory",
  status: "not-found",
  summary: '"C:\\Users\\rober\\OneDrive\\Documents\\reports" does not exist.',
  data: {},
} as unknown as ToolResult;

const out = composeResponse(missingFolder, "show me what's in reports in my documents");
check(
  "missing folder names the folder, not an app",
  out.includes("reports") &&
    !/app called/i.test(out) &&
    !/youtube/i.test(out) &&
    !/does not exist\."/.test(out),
  out,
);

// ── 1b. an already-complete message must not be re-wrapped ───────────────
const noWindow = {
  capabilityId: "screen.capture",
  status: "not-found",
  summary: 'No visible window matched "spotify". Is the app running?',
  data: {},
} as unknown as ToolResult;

const out1b = composeResponse(noWindow, "take a screenshot of spotify");
check(
  "complete sentence passes through untouched",
  out1b === 'No visible window matched "spotify". Is the app running?',
  out1b,
);

// ── 1c. a genuine app miss still reads well ──────────────────────────────
const appMiss = {
  capabilityId: "applications.open",
  status: "not-found",
  summary: '"foobar" was not found as an installed app or known service.',
  data: {},
} as unknown as ToolResult;

const out1c = composeResponse(appMiss, "open foobar");
check(
  "app miss names the app cleanly",
  out1c.includes("foobar") && !/does not exist/.test(out1c) && !/youtube/i.test(out1c),
  out1c,
);

// ── 2. capsule flattening ────────────────────────────────────────────────
// Mirrors capsuleText() in overlayActions.ts.
function capsuleText(raw: string, max = 72): string {
  const flat = raw
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean)
    .join(" · ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const markdownReply =
  "**fantastic** — 5 items\n- 5 folders\n- **Alpha** · folder\n- **Beta** · folder";
const capsule = capsuleText(markdownReply);
check(
  "capsule strips markdown",
  !capsule.includes("**") && capsule.startsWith("fantastic — 5 items"),
  capsule,
);

console.log("-".repeat(80));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
