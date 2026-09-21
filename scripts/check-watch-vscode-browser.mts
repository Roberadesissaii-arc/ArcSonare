/**
 * The coordinated case: an editor and a browser, active together.
 *
 * This is the reason more than one application can be active at all. Run the
 * project in one, read the result in the other, correlate, fix, run again. It
 * is also where the previous single-active-application model was most obviously
 * wrong: activating Chrome deactivated VS Code, so the workflow could not be
 * expressed.
 *
 * The project used here is created under the OS temp directory and deleted
 * afterwards. No file the user owns is read or written.
 *
 * Run: npm run test:watch-vscode-browser
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const CONV = "conv-vscode-browser";

const VSCODE = {
  instanceKey: "vscode:ws:arcsonare-watch-fixture",
  appCatalogId: "vscode",
  executableName: "Code.exe",
  workspaceIdentity: "arcsonare-watch-fixture",
  windowTitle: "app.js - arcsonare-watch-fixture - Visual Studio Code",
};
const CHROME = {
  instanceKey: "chrome:exe:chrome-exe:0",
  appCatalogId: "chrome",
  executableName: "chrome.exe",
  windowTitle: "localhost:3000 - Google Chrome",
};
const DISCORD = {
  instanceKey: "discord:exe:discord-exe:0",
  appCatalogId: "discord",
  executableName: "Discord.exe",
  windowTitle: "#general | ArcSonare Testing",
};
const SPOTIFY = {
  instanceKey: "spotify:exe:spotify-exe:0",
  appCatalogId: "spotify",
  executableName: "Spotify.exe",
  windowTitle: "Marconi Union - Weightless",
};

// ── A project ArcSonare owns ─────────────────────────────────────────────
const projectDir = mkdtempSync(join(tmpdir(), "arcsonare-watch-fixture-"));
const entry = join(projectDir, "app.js");
// A deliberate defect: the greeting the browser shows is wrong.
writeFileSync(
  entry,
  [
    "// ArcSonare Watch fixture. Owned by the test, deleted when it ends.",
    "function greeting() {",
    '  return "hello wrold";',
    "}",
    "module.exports = { greeting };",
  ].join("\n"),
  "utf8",
);

const activeIds = () =>
  getWatchScope(CONV).scope.entries.map((e) => e.appCatalogId);

async function fresh(running: unknown[]) {
  watchBackend.reset();
  clearAllWatchScopes();
  clearWatchTurnMemory();
  resetWatchProvenance();
  watchBackend.setRunning(running as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

async function clickRow(appCatalogId: string) {
  if (!getWatchSnapshot().watched.some((w) => w.appCatalogId === appCatalogId)) {
    await watchApplication(appCatalogId);
  }
  await toggleWatchScope(CONV, appCatalogId);
}

try {
  // ── Both active, by row click ──────────────────────────────────────────
  console.log("\n═══ VS Code and Chrome, activated by row clicks ═══");
  await fresh([VSCODE, CHROME, DISCORD, SPOTIFY]);
  await clickRow("vscode");
  await clickRow("chrome");
  {
    check(
      "both are active, and activating the second did not drop the first",
      activeIds().sort().join(",") === "chrome,vscode",
      `[${activeIds().sort()}]`,
    );
    const rows = runningRows(
      buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, activeIds()),
    );
    check(
      "the composer and the card would show the same two",
      rows.filter((r) => r.active).map((r) => r.appCatalogId).sort().join(",") ===
        "chrome,vscode",
      rows.map((r) => `${r.appCatalogId}${r.active ? "*" : ""}`).join(", "),
    );
  }

  // ── The request that needs both ────────────────────────────────────────
  console.log("\n═══ run it, read the browser, fix it, run it again ═══");
  const REQUEST = "Run this project, inspect the browser output, and fix the problem";
  {
    const block = await watchContextForPrompt(REQUEST, CONV);
    check(
      "the turn reaches both applications",
      block.includes("## VS Code") && block.includes("## Chrome"),
      block.split("\n")[0] || "EMPTY",
    );
    check(
      "each carries its own instance key, so an action addresses the right one",
      block.includes(VSCODE.instanceKey) && block.includes(CHROME.instanceKey),
      "two distinct instance keys",
    );
    check(
      "the model is told to group rather than merge them",
      /Group your answer by application\. Do not merge/.test(block),
      "grouping instruction present",
    );
    check(
      "Discord and Spotify are running but contribute nothing",
      !/discord/i.test(block) && !/spotify/i.test(block),
      /discord|spotify/i.test(block) ? "UNRELATED APP LEAKED" : "absent",
    );
  }

  // ── The work itself, on a project the test owns ────────────────────────
  console.log("\n═══ the safe project is inspected, fixed and re-run ═══");
  {
    const before = readFileSync(entry, "utf8");
    check(
      "the fixture starts with the known defect",
      before.includes("hello wrold"),
      "typo present",
    );

    resetWatchProvenance();
    beginWatchTurn();
    await watchContextForPrompt(REQUEST, CONV);

    // The sequence the plan calls for, recorded as it would really run.
    recordCapabilityCall("vscode.get_context", VSCODE.instanceKey);
    recordCapabilityCall("vscode.run_task", VSCODE.instanceKey);
    recordCapabilityCall("browser.get_page_context", CHROME.instanceKey);
    // The fix goes through the ordinary filesystem path, not a watched-app one.
    writeFileSync(entry, before.replace("hello wrold", "hello world"), "utf8");
    recordCapabilityCall("filesystem.write_file");
    recordCapabilityCall("vscode.run_task", VSCODE.instanceKey);
    recordCapabilityCall("browser.navigate", CHROME.instanceKey);

    const credited = turnContributors().sort();
    endWatchTurn();

    const after = readFileSync(entry, "utf8");
    check(
      "the defect is fixed in the fixture",
      after.includes("hello world") && !after.includes("hello wrold"),
      after.includes("hello world") ? "corrected" : "NOT FIXED",
    );
    check(
      "the fixture stayed inside the temp directory",
      entry.startsWith(tmpdir()),
      entry.replace(tmpdir(), "<tmp>"),
    );
    check(
      "exactly the two applications that ran are credited",
      credited.join(",") === "chrome,vscode",
      `[${credited}]`,
    );
    check(
      "the filesystem write credited no application",
      !credited.includes("filesystem"),
      "filesystem is not a watched application",
    );
  }

  // ── The unrelated request, mid-workflow ────────────────────────────────
  console.log("\n═══ an unrelated request, with both still active ═══");
  for (const phrase of [
    "Create a task for tomorrow",
    "Open my Downloads folder",
  ]) {
    resetWatchProvenance();
    beginWatchTurn();
    const block = await watchContextForPrompt(phrase, CONV);
    recordCapabilityCall("tasks.create");
    const credited = turnContributors();
    endWatchTurn();
    check(
      `"${phrase}" uses no watched context`,
      block === "" && credited.length === 0,
      `chars=${block.length} credited=[${credited}]`,
    );
  }

  // ── Switching mid-workflow invalidates the old scope ───────────────────
  console.log("\n═══ deactivating one leaves the other running ═══");
  {
    const before = currentScopeVersion();
    await clickRow("chrome");
    check(
      "only Chrome left the set",
      activeIds().join(",") === "vscode",
      `[${activeIds()}]`,
    );
    check(
      "the scope generation moved on",
      currentScopeVersion() > before,
      `v${before} → v${currentScopeVersion()}`,
    );
    const block = await watchContextForPrompt(REQUEST, CONV);
    check(
      "the next turn is about VS Code alone",
      block.includes("## VS Code") && !block.includes("## Chrome"),
      block.split("\n")[0],
    );
  }

  // ── VS Code closing mid-workflow ───────────────────────────────────────
  console.log("\n═══ the editor closes mid-workflow ═══");
  {
    watchBackend.stopApp("vscode");
    await refreshWatchSnapshot();
    const scope = await refreshWatchScope(CONV);
    check(
      "it leaves the active set and the running list",
      scope.scope.entries.length === 0 &&
        !runningRows(
          buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, []),
        ).some((r) => r.appCatalogId === "vscode"),
      `active=[${activeIds()}]`,
    );
    const block = await watchContextForPrompt("what file am I editing", CONV);
    check(
      "and answers that it is not running rather than from the last read",
      block.includes("NOT RUNNING") && !block.includes("app.js"),
      block.includes("app.js") ? "STALE FILE LEAKED" : "not running, no stale file",
    );
  }

  console.log("\n──────────────────────────────────────────────");
  if (failed === 0) {
    console.log("The editor-and-browser workflow holds end to end.");
  } else {
    console.log(`${failed} check(s) failed:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
} finally {
  // The fixture never outlives the run.
  rmSync(projectDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
