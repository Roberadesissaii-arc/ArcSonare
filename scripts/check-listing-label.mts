/**
 * The listing sentence must name the folder that was actually read.
 *
 * Regression: any path containing "desktop" was announced as "Your desktop",
 * so listing Desktop\Fantastic reported the Desktop instead — the data was
 * right but the sentence named the wrong folder.
 *
 * Run: npx tsx scripts/check-listing-label.mts
 */

import { composeResponse } from "../src/features/capabilities/capabilityResponseComposer";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

function listing(path: string): ToolResult {
  return {
    capabilityId: "filesystem.list_directory",
    status: "success",
    summary: "listed",
    data: {
      path,
      total_items: 5,
      counts: { folders: 5 },
      items: [
        { name: "Alpha", type: "directory" },
        { name: "Beta", type: "directory" },
      ],
    },
  } as unknown as ToolResult;
}

const CASES: { path: string; mustContain: string; mustNotContain?: string }[] = [
  {
    path: "C:\\Users\\rober\\Desktop\\Fantastic",
    mustContain: "Fantastic",
    mustNotContain: "Your desktop",
  },
  {
    path: "C:\\Users\\rober\\Desktop\\Fantastic\\Alpha",
    mustContain: "Alpha",
    mustNotContain: "Your desktop",
  },
  { path: "C:\\Users\\rober\\Desktop", mustContain: "Your desktop" },
  { path: "C:\\Users\\rober\\Downloads", mustContain: "Your downloads" },
  {
    path: "C:\\Users\\rober\\OneDrive\\Documents\\q4",
    mustContain: "q4",
    mustNotContain: "Your documents",
  },
];

let failed = 0;
console.log("LISTING LABEL — the sentence must name the folder actually read");
console.log("=".repeat(96));

for (const c of CASES) {
  const out = composeResponse(listing(c.path), "what's inside that folder");
  const first = out.split("\n")[0];
  const okHas = first.includes(c.mustContain);
  const okNot = !c.mustNotContain || !first.includes(c.mustNotContain);
  const pass = okHas && okNot;
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.path}`);
  console.log(`      -> ${first}`);
  if (!pass) {
    if (!okHas) console.log(`      expected to contain "${c.mustContain}"`);
    if (!okNot) console.log(`      must NOT contain "${c.mustNotContain}"`);
  }
}

console.log("-".repeat(96));
console.log(`${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
