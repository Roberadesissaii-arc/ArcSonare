/**
 * The active set is a set.
 *
 * The reported failure: a person could not have VS Code and Chrome active at
 * once, which is the whole point of the feature — run the project in one, read
 * the result in the other, fix the code, run it again. Activating a second
 * application replaced the first, and the composer, the card and Rust each had
 * their own idea of what was active.
 *
 * There is one authority: the scope in Rust. Everything else reads it.
 *
 * Run: npm run test:watch-multiscope
 */

import { readFileSync } from "node:fs";

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  getWatchSnapshot,
  listenForWatchChanges,
  refreshWatchSnapshot,
  watchApplication,
} from "../src/features/watch/watchStore";
import {
  clearAllWatchScopes,
  currentScopeVersion,
  getWatchScope,
  isScopeVersionStale,
  refreshWatchScope,
  setCurrentConversation,
  toggleWatchScope,
} from "../src/features/watch/watchScopeStore";
import {
  clearWatchTurnMemory,
  watchContextForPrompt,
} from "../src/features/watch/watchPromptContext";
import {
  beginWatchTurn,
  endWatchTurn,
  recordCapabilityCall,
  resetWatchProvenance,
  turnContributors,
} from "../src/features/watch/watchProvenance";
import { buildRowGroups, runningRows } from "../src/components/watch/watchRows";

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

const CONV = "conv-multiscope";

const VSCODE = {
  instanceKey: "vscode:ws:arcsonare",
  appCatalogId: "vscode",
  executableName: "Code.exe",
  workspaceIdentity: "ArcSonare",
  windowTitle: "main.rs — ArcSonare — Visual Studio Code",
};
const CHROME = {
  instanceKey: "chrome:exe:chrome-exe:0",
  appCatalogId: "chrome",
  executableName: "chrome.exe",
  windowTitle: "localhost:3000 — Google Chrome",
};
const DISCORD = {
  instanceKey: "discord:exe:discord-exe:0",
  appCatalogId: "discord",
  executableName: "Discord.exe",
  windowTitle: "#general | ArcSonare Testing",
};

async function fresh(running: unknown[] = [VSCODE, CHROME, DISCORD]) {
  watchBackend.reset();
  clearAllWatchScopes();
  clearWatchTurnMemory();
  resetWatchProvenance();
  watchBackend.setRunning(running as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

/** Exactly what clicking a Running Apps row does. */
async function clickRow(appCatalogId: string) {
  const watched = getWatchSnapshot().watched.some(
    (w) => w.appCatalogId === appCatalogId,
  );
  if (!watched) await watchApplication(appCatalogId);
  await toggleWatchScope(CONV, appCatalogId);
}

const activeIds = () =>
  getWatchScope(CONV).scope.entries.map((e) => e.appCatalogId);

// ── Test 3 — direct row toggle, without the overflow menu ─────────────────
console.log("\n═══ Test 3 — clicking rows builds a set ═══");
await fresh();
{
  check("nothing is active to begin with", activeIds().length === 0, `[${activeIds()}]`);

  await clickRow("chrome");
  check(
    "clicking an unwatched row watches it and makes it active",
    getWatchSnapshot().watched.some((w) => w.appCatalogId === "chrome") &&
      activeIds().join(",") === "chrome",
    `watched=yes active=[${activeIds()}]`,
  );

  await clickRow("discord");
  check(
    "clicking a second row adds it — it does not replace the first",
    activeIds().sort().join(",") === "chrome,discord",
    `[${activeIds().sort()}]`,
  );

  await clickRow("chrome");
  check(
    "clicking an active row removes only that one",
    activeIds().join(",") === "discord",
    `[${activeIds()}]`,
  );
  check(
    "deactivating does not revoke the watch permission",
    getWatchSnapshot().watched.some((w) => w.appCatalogId === "chrome"),
    "Chrome is still watched",
  );

  await clickRow("chrome");
  check(
    "an already-watched row activates without watching again",
    activeIds().sort().join(",") === "chrome,discord",
    `[${activeIds().sort()}]`,
  );
}

// ── Test 8 — VS Code plus a browser, the coordinated case ────────────────
console.log("\n═══ Test 8 — VS Code and Chrome active together ═══");
await fresh();
await clickRow("vscode");
await clickRow("chrome");
{
  const scope = await refreshWatchScope(CONV);
  check(
    "both are in the scope, and Rust reports multiple mode",
    scope.scope.entries.length === 2 && scope.scope.mode === "multiple",
    `mode=${scope.scope.mode} entries=[${scope.scope.entries.map((e) => e.appCatalogId)}]`,
  );
  check(
    "both contribute their own capabilities",
    scope.capabilityIds.some((id) => id.startsWith("vscode.")) &&
      scope.capabilityIds.some((id) => id.startsWith("browser.")),
    scope.capabilityIds.join(", "),
  );

  const block = await watchContextForPrompt(
    "Run this project, check the browser output, and fix the error",
    CONV,
  );
  check(
    "the prompt describes both, as separate groups",
    block.includes("## VS Code") && block.includes("## Chrome"),
    block.split("\n")[0],
  );
  check(
    "and tells the model to group rather than merge them",
    /Group your answer by application\. Do not merge/.test(block),
    "grouping instruction present",
  );
  check(
    "Discord is running but not active, so it contributes nothing",
    !/discord/i.test(block),
    /discord/i.test(block) ? "DISCORD LEAKED" : "absent",
  );

  // Both really did run.
  beginWatchTurn();
  await watchContextForPrompt("Run this project and check the output", CONV);
  recordCapabilityCall("vscode.run_task");
  recordCapabilityCall("browser.get_page_context");
  const credited = turnContributors().sort();
  endWatchTurn();
  check(
    "both are credited when both actually ran",
    credited.join(",") === "chrome,vscode",
    `[${credited}]`,
  );
}

// ── Test 9 — an unrelated request is not hijacked by two active apps ─────
console.log("\n═══ Test 9 — two active applications, one unrelated request ═══");
{
  resetWatchProvenance();
  beginWatchTurn();
  const block = await watchContextForPrompt("Create a task for tomorrow", CONV);
  recordCapabilityCall("tasks.create");
  const credited = turnContributors();
  endWatchTurn();
  check(
    "no watched context is injected",
    block === "",
    `chars=${block.length}`,
  );
  check(
    "VS Code adapter calls = 0 and Chrome adapter calls = 0",
    credited.length === 0,
    `credited=[${credited}]`,
  );
  check(
    "no application badge is earned",
    !credited.includes("vscode") && !credited.includes("chrome"),
    "none",
  );
}

// ── Test 7 — a deep request about an application that is not active ──────
console.log("\n═══ Test 7 — Chrome running, not active ═══");
await fresh();
await clickRow("discord");
{
  const block = await watchContextForPrompt("What page is Chrome showing?", CONV);
  check(
    "Chrome joins the turn, because the user named it",
    block.includes("## Chrome"),
    block.split("\n")[0],
  );
  check(
    "it says it is running but not active, and offers to activate",
    /focused Watch access is not active/.test(block) &&
      /Activate Chrome for this conversation/.test(block),
    "activation offered",
  );
  check(
    "nothing of its content is offered",
    !/Tell you which page this window is showing/.test(block) &&
      !/Go back, forward or reload/.test(block),
    "no readable capability while inactive",
  );
  check(
    "and the model is told not to fall back to the screen",
    /Do NOT read its window, take a screenshot, search the screen/.test(block),
    "no visual fallback",
  );
  check(
    "the active application is unaffected",
    activeIds().join(",") === "discord",
    `[${activeIds()}]`,
  );
}
{
  // A soft request must not reach an inactive application at all.
  const soft = await watchContextForPrompt("what's going on", CONV);
  check(
    "a soft question resolves to the active set only",
    soft.includes("## Discord") && !/chrome/i.test(soft),
    /chrome/i.test(soft) ? "CHROME PULLED IN" : "Discord only",
  );
}

// ── Scope version ────────────────────────────────────────────────────────
console.log("\n═══ the active set has a generation ═══");
await fresh();
await clickRow("vscode");
{
  const before = currentScopeVersion();
  check(
    "a version taken now is current",
    !isScopeVersionStale(before),
    `v${before}`,
  );

  await clickRow("chrome");
  check(
    "changing the set moves the generation on",
    isScopeVersionStale(before) && currentScopeVersion() > before,
    `v${before} → v${currentScopeVersion()}`,
  );

  // A turn that started under the old generation credits nothing.
  resetWatchProvenance();
  beginWatchTurn();
  recordCapabilityCall("vscode.get_context");
  const duringVersion = currentScopeVersion();
  await clickRow("discord");
  const credited = turnContributors();
  endWatchTurn();
  check(
    "an in-flight turn is discarded when the set changes under it",
    credited.length === 0,
    `credited=[${credited}] (v${duringVersion} → v${currentScopeVersion()})`,
  );
}

// ── Test 6 — closing an active application, then reopening it ────────────
console.log("\n═══ Test 6 — a closed application does not come back active ═══");
await fresh();
await clickRow("discord");
await clickRow("chrome");
{
  check(
    "both start active",
    activeIds().sort().join(",") === "chrome,discord",
    `[${activeIds().sort()}]`,
  );

  watchBackend.stopApp("discord");
  await refreshWatchSnapshot();
  await refreshWatchScope(CONV);
  check(
    "closing one removes it from the active set",
    activeIds().join(",") === "chrome",
    `[${activeIds()}]`,
  );
  check(
    "and from the running list",
    !runningRows(
      buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, activeIds()),
    ).some((r) => r.appCatalogId === "discord"),
    "Discord is gone from Running apps",
  );
  check(
    "while keeping its watch permission for the manager",
    getWatchSnapshot().watched.some((w) => w.appCatalogId === "discord"),
    "still watched",
  );
  check(
    "the other active application is untouched",
    activeIds().includes("chrome"),
    "Chrome is still active",
  );

  // It reopens.
  watchBackend.setRunning([VSCODE, CHROME, DISCORD] as never[]);
  await refreshWatchSnapshot();
  await refreshWatchScope(CONV);
  check(
    "reopening does not silently re-activate it",
    activeIds().join(",") === "chrome",
    `[${activeIds()}]`,
  );
  const rows = runningRows(
    buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, activeIds()),
  );
  check(
    "it is back in Running apps, watched but inactive",
    rows.some((r) => r.appCatalogId === "discord" && !r.active && r.watched),
    rows.map((r) => `${r.appCatalogId}${r.active ? "*" : ""}`).join(", "),
  );

  // The retirement happens inside the scope read, so something has to perform
  // that read when an application stops. The card used to refresh only the
  // snapshot, which is why Discord came back already active on screen.
  const card = readFileSync(
    "src/components/dashboard/RunningAppsCard.tsx",
    "utf8",
  );
  check(
    "the card re-reads the scope whenever the running set changes",
    /refreshWatchSnapshot\(\);\s*\n\s*if \(conversationId\) await refreshWatchScope\(conversationId\);/.test(
      card,
    ) && /onWatchEvent\(/.test(card),
    "snapshot and scope refresh together, on events and on a heartbeat",
  );
}

// ── One authority ────────────────────────────────────────────────────────
console.log("\n═══ one active set, read by everything ═══");
{
  const card = readFileSync(
    "src/components/dashboard/RunningAppsCard.tsx",
    "utf8",
  );
  const control = readFileSync(
    "src/components/watch/WatchComposerControl.tsx",
    "utf8",
  );
  check(
    "the card reads the scope store rather than keeping its own set",
    /useWatchScope\(\)/.test(card) && !/useState<.*\[\]>\(\[\]\)/.test(card),
    "scope store",
  );
  check(
    "the composer control reads the same store",
    /useWatchScope\(\)/.test(control),
    "scope store",
  );
  check(
    "both mutate through the same toggle",
    /toggleWatchScope\(/.test(card) && /toggleWatchScope\(/.test(control),
    "toggleWatchScope, which is Rust-backed",
  );
  check(
    "the card and the control build their rows the same way",
    /runningRows\(/.test(card) && /runningRows\(/.test(control),
    "one row builder",
  );
}

// ── The rows the two surfaces show are the same rows ─────────────────────
console.log("\n═══ the card and the composer agree ═══");
await fresh();
await clickRow("vscode");
await clickRow("chrome");
{
  const snapshot = getWatchSnapshot();
  const rows = runningRows(buildRowGroups(snapshot.watched, snapshot.running, activeIds()));
  const active = rows.filter((r) => r.active).map((r) => r.appCatalogId).sort();
  check(
    "the row builder marks exactly the active set as active",
    active.join(",") === "chrome,vscode",
    `[${active}]`,
  );
  check(
    "the active ones sort first, so neither surface has to page to find them",
    rows.slice(0, 2).every((r) => r.active),
    rows.map((r) => `${r.appCatalogId}${r.active ? "*" : ""}`).join(", "),
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Multiple applications, one set, one authority.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
