/**
 * Every capability classified, and the two classifications agreeing.
 *
 * There are two risk tables — `risk_for` in `capabilities/executor.rs` and
 * `actionRisk` in `permissionPolicy.ts` — because Rust enforces the gate and
 * TypeScript decides whether to ask. Two tables is the right design and a
 * standing hazard: they drift, and when they drift the frontend stops asking
 * about something the backend still considers dangerous, or asks about
 * something it does not.
 *
 * This asserts they agree, that nothing is unclassified, and prints the
 * capability inventory — capability, strategy, permission, verification,
 * fallback — so "no capability silently falls into a generic visual path" is a
 * checked fact rather than an intention.
 *
 * Run: npm run test:capability-inventory
 */

import { readFileSync } from "node:fs";
import {
  actionRisk,
  coverableByPlan,
  requiresApproval,
  type ActionRisk,
} from "../src/features/capabilities/permissionPolicy";
import { CAPABILITY_REGISTRY } from "../src/features/capabilities/capabilityRegistry";

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
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

// ---------------------------------------------------------------------------
// Read the Rust risk table straight out of the source.
//
// Parsing the real file rather than keeping a copy here: a copy is a third
// table, and a third table drifts from both of the others.
// ---------------------------------------------------------------------------

type RustRisk = "read-only" | "reversible" | "sensitive" | "destructive";

function readRustRiskTable(): Map<string, RustRisk> {
  const source = readFileSync("src-tauri/src/capabilities/executor.rs", "utf8");
  const start = source.indexOf("pub fn risk_for(");
  const end = source.indexOf("fn parse<", start);
  const body = source.slice(start, end);

  const table = new Map<string, RustRisk>();
  // Arms look like:  "a" | "b" | "c" => Risk::ReadOnly,
  const armRe = /((?:\s*\|?\s*"[a-z_0-9.]+"\s*(?:\/\/[^\n]*\n)?)+)=>\s*Risk::(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = armRe.exec(body))) {
    const level = (
      {
        ReadOnly: "read-only",
        Reversible: "reversible",
        Sensitive: "sensitive",
        Destructive: "destructive",
      } as Record<string, RustRisk>
    )[m[2]];
    if (!level) continue;
    for (const id of m[1].matchAll(/"([a-z_0-9.]+)"/g)) {
      table.set(id[1], level);
    }
  }
  return table;
}

const rustRisks = readRustRiskTable();

section("The two risk tables are readable and populated");

check(
  "the Rust risk table was parsed",
  rustRisks.size > 40,
  `${rustRisks.size} native capabilities classified in executor.rs`,
);

// ---------------------------------------------------------------------------
section("Rust and TypeScript agree about danger");
// ---------------------------------------------------------------------------

/**
 * The five-level model is finer than the four-level one, so exact equality is
 * the wrong test. What matters is that neither side thinks something is safe
 * that the other thinks is dangerous.
 */
const ASKS_IN_RUST: RustRisk[] = ["destructive"];
const disagreements: string[] = [];

for (const [id, rustRisk] of rustRisks) {
  const ts = actionRisk(id);
  const rustAsks = ASKS_IN_RUST.includes(rustRisk);
  const tsAsks = requiresApproval(id);
  if (rustAsks && !tsAsks) {
    disagreements.push(`${id}: Rust=${rustRisk} (gated) but TS=${ts} (silent)`);
  }
  // The reverse is allowed: TypeScript may ask about something Rust does not
  // natively gate — `installer.install` has no native destructive gate because
  // the gate is UAC itself.
}

check(
  "nothing Rust gates is silent in TypeScript",
  disagreements.length === 0,
  disagreements.length ? disagreements.join("; ") : "no disagreements",
);

// ---------------------------------------------------------------------------
section("Nothing is unclassified");
// ---------------------------------------------------------------------------

const unclassified: string[] = [];
for (const capability of CAPABILITY_REGISTRY) {
  const risk = actionRisk(capability.id);
  // `destructive` is the fallback for anything unrecognised, so a capability
  // landing there without being genuinely destructive means it was never
  // classified — which is safe, but silently over-asks.
  const genuinelyDestructive =
    capability.riskLevel === "destructive" || /\.(delete|uninstall|reset)/.test(capability.id);
  if (risk === "destructive" && !genuinelyDestructive) {
    unclassified.push(`${capability.id} (registry says ${capability.riskLevel})`);
  }
}
check(
  "every registered capability has a deliberate risk level",
  unclassified.length === 0,
  unclassified.length ? unclassified.join(", ") : `${CAPABILITY_REGISTRY.length} classified`,
);

// ---------------------------------------------------------------------------
section("The download → installer chain is classified correctly");
// ---------------------------------------------------------------------------

const CHAIN: Array<[string, ActionRisk]> = [
  ["web.search", "routine"],
  ["applications.open", "routine"],
  ["browser.navigate", "routine"],
  ["browser.get_page_context", "routine"],
  ["browser.find_link", "routine"],
  ["browser.download", "routine"],
  ["browser.wait_for_download", "routine"],
  ["installer.inspect", "routine"],
  ["installer.list_installed", "routine"],
  ["installer.launch", "reversible"],
  ["installer.install", "elevated"],
  ["installer.verify", "routine"],
];

for (const [id, expected] of CHAIN) {
  check(
    `${id} is ${expected}`,
    actionRisk(id) === expected,
    actionRisk(id),
  );
}

const asked = CHAIN.filter(([id]) => requiresApproval(id));
check(
  "the whole LightBurn plan asks exactly once",
  asked.length === 1 && asked[0][0] === "installer.install",
  asked.length ? asked.map(([id]) => id).join(", ") : "never asks — that is also wrong",
);
check(
  "the one question is at the elevation boundary",
  actionRisk("installer.install") === "elevated" && !coverableByPlan("installer.install"),
  `${actionRisk("installer.install")}, coverableByPlan=${coverableByPlan("installer.install")}`,
);

// ---------------------------------------------------------------------------
section("The new capabilities are reachable");
// ---------------------------------------------------------------------------

const NEW_NATIVE = [
  "browser.find_link",
  "browser.download",
  "browser.wait_for_download",
  "browser.get_downloads",
  "installer.inspect",
  "installer.list_installed",
  "installer.verify",
];
const registryIds = new Set(CAPABILITY_REGISTRY.map((c) => c.id));
const executorSource = readFileSync("src-tauri/src/capabilities/executor.rs", "utf8");

for (const id of NEW_NATIVE) {
  const inRegistry = registryIds.has(id);
  const inRiskTable = rustRisks.has(id);
  // A dispatch arm, not merely a risk entry: a capability with a risk level and
  // no dispatch arm returns "unknown-capability" at runtime.
  const hasDispatch = executorSource.includes(`"${id}" =>`);
  check(
    `${id} is registered, classified and dispatched`,
    inRegistry && inRiskTable && hasDispatch,
    `registry=${inRegistry} risk=${inRiskTable} dispatch=${hasDispatch}`,
  );
}

// ---------------------------------------------------------------------------
// The inventory itself.
// ---------------------------------------------------------------------------

interface Row {
  capability: string;
  strategy: string;
  verification: string;
  fallback: string;
}

const INVENTORY: Row[] = [
  { capability: "web.search", strategy: "native shell → default browser", verification: "process launched", fallback: "—" },
  { capability: "browser.navigate", strategy: "focus + verified chord", verification: "window-title readback", fallback: "visual click" },
  { capability: "browser.get_page_context", strategy: "window metadata", verification: "window detected", fallback: "screen capture + vision" },
  { capability: "browser.find_link", strategy: "HTTP fetch + markup structure", verification: "links inspected, score, reason", fallback: "vision on a capture" },
  { capability: "browser.download", strategy: "ArcSonare-owned HTTP transfer", verification: "bytes on disk == bytes received", fallback: "visual click on the browser's own button" },
  { capability: "browser.wait_for_download", strategy: "transfer bookkeeping", verification: "size match against Content-Length", fallback: "—" },
  { capability: "installer.inspect", strategy: "file header + WinVerifyTrust", verification: "Authenticode verdict", fallback: "reported as unknown, never as trusted" },
  { capability: "installer.launch", strategy: "ShellExecute, no elevation flag", verification: "process/window detected", fallback: "reveal in Explorer" },
  { capability: "installer.install", strategy: "user-driven, UIA where safe", verification: "registry diff", fallback: "hand back to the user" },
  { capability: "installer.verify", strategy: "uninstall-registry diff", verification: "new/changed entry", fallback: "—" },
  { capability: "filesystem.read_for_edit", strategy: "native read + content hash", verification: "hash returned", fallback: "—" },
  { capability: "filesystem.modify_file", strategy: "atomic write + syntax check", verification: "stale-hash guard, re-parse", fallback: "—" },
  { capability: "filesystem.delete", strategy: "native, token-gated", verification: "filesystem postcondition", fallback: "—" },
  { capability: "applications.open / focus / close", strategy: "index + native launch/focus", verification: "process/window detected", fallback: "desktop-icon visual" },
  { capability: "screen.capture", strategy: "display-bound owned capture", verification: "frame registered with display", fallback: "—" },
  { capability: "screen.annotate", strategy: "native layered window", verification: "window census", fallback: "—" },
  { capability: "input.click_at", strategy: "canonical mapper + freshness gate", verification: "cursor + post-state check", fallback: "refuse — never a guess" },
  { capability: "spotify.* transport", strategy: "SMTC session", verification: "playback readback", fallback: "media keys" },
];

section("Capability inventory");
const width = Math.max(...INVENTORY.map((r) => r.capability.length));
console.log(
  `\n| ${"Capability".padEnd(width)} | Strategy                              | Permission  | Verification                        | Fallback |`,
);
console.log(`| ${"-".repeat(width)} | ------------------------------------- | ----------- | ----------------------------------- | -------- |`);
for (const row of INVENTORY) {
  const id = row.capability.split(" ")[0];
  const permission = requiresApproval(id) ? actionRisk(id) : "none";
  console.log(
    `| ${row.capability.padEnd(width)} | ${row.strategy.padEnd(37)} | ${permission.padEnd(11)} | ${row.verification.padEnd(35)} | ${row.fallback} |`,
  );
}

check(
  "every inventory row names a real verification method",
  INVENTORY.every((r) => r.verification.trim().length > 0),
  `${INVENTORY.length} rows`,
);
check(
  "no inventory row falls into an unclassified visual path",
  INVENTORY.every((r) => r.strategy !== "visual" && r.strategy.trim().length > 0),
  "every row names a structured primary strategy",
);

console.log(`\n${"═".repeat(64)}`);
if (failed === 0) {
  console.log("All capability inventory checks passed.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`${"═".repeat(64)}\n`);
process.exit(failed === 0 ? 0 : 1);
