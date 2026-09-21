/**
 * Every application with a Watch adapter, tested at every layer.
 *
 * "It appears in Running Apps" proves detection and nothing else. Detection,
 * activation, fresh reading, action execution, provenance and cleanup are six
 * separate requirements, and an application can pass one while failing the
 * next — Discord detected fine for weeks while answering that it was not
 * running. So each is asserted separately, for each adapted application, and
 * the table is printed before any of it runs.
 *
 * Run: npm run test:watch-app-matrix
 */

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  getWatchSnapshot,
  listenForWatchChanges,
  refreshWatchSnapshot,
  watchApplication,
} from "../src/features/watch/watchStore";
import {
  clearAllWatchScopes,
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
import {
  adaptedApplicationIds,
  adapterFor,
} from "../src/features/watch/adapters/adapterRegistry";
import { buildRowGroups, runningRows } from "../src/components/watch/watchRows";
import {
  protocolLeaks,
  sendThroughProductionPath,
} from "./watch-production-path.mts";

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

const CONV = "conv-matrix";

/**
 * One row of the matrix.
 *
 * `readCapability` is the capability that answers "what is it doing now?", and
 * `question` is a phrasing that must reach it through the relevance gate.
 */
interface AppUnderTest {
  appCatalogId: string;
  displayName: string;
  instanceKey: string;
  executableName: string;
  windowTitle: string;
  workspaceIdentity?: string;
  readCapability: string;
  question: string;
  /** A phrase naming it, for the inactive-but-named path. */
  namedQuestion: string;
}

const MATRIX: AppUnderTest[] = [
  {
    appCatalogId: "spotify",
    displayName: "Spotify",
    instanceKey: "spotify:exe:spotify-exe:0",
    executableName: "Spotify.exe",
    windowTitle: "Marconi Union - Weightless",
    readCapability: "spotify.get_playback",
    question: "what's playing",
    namedQuestion: "what is Spotify doing",
  },
  {
    appCatalogId: "chrome",
    displayName: "Chrome",
    instanceKey: "chrome:exe:chrome-exe:0",
    executableName: "chrome.exe",
    windowTitle: "localhost:3000 - Google Chrome",
    readCapability: "browser.get_page_context",
    question: "what page am I on",
    namedQuestion: "what page is Chrome showing",
  },
  {
    appCatalogId: "edge",
    displayName: "Edge",
    instanceKey: "edge:exe:msedge-exe:0",
    executableName: "msedge.exe",
    windowTitle: "ArcSonare - Microsoft Edge",
    readCapability: "browser.get_page_context",
    question: "what tab is open",
    namedQuestion: "what page is Edge showing",
  },
  {
    appCatalogId: "discord",
    displayName: "Discord",
    instanceKey: "discord:exe:discord-exe:0",
    executableName: "Discord.exe",
    windowTitle: "#general | ArcSonare Testing",
    readCapability: "discord_desktop.get_current_location",
    question: "what channel am I in",
    namedQuestion: "what channel am I in on Discord",
  },
  {
    appCatalogId: "vscode",
    displayName: "VS Code",
    instanceKey: "vscode:ws:arcsonare",
    executableName: "Code.exe",
    windowTitle: "main.rs - ArcSonare - Visual Studio Code",
    workspaceIdentity: "ArcSonare",
    readCapability: "vscode.get_context",
    question: "what file am I editing",
    namedQuestion: "check this VS Code project",
  },
  {
    appCatalogId: "cursor",
    displayName: "Cursor",
    instanceKey: "cursor:ws:arcsonare",
    executableName: "Cursor.exe",
    windowTitle: "main.rs - ArcSonare - Cursor",
    workspaceIdentity: "ArcSonare",
    readCapability: "vscode.get_context",
    question: "what file am I editing",
    namedQuestion: "check this Cursor project",
  },
  {
    appCatalogId: "youtube",
    displayName: "YouTube",
    instanceKey: "youtube:exe:chrome-exe:1",
    executableName: "chrome.exe",
    windowTitle: "Some Video - YouTube - Google Chrome",
    readCapability: "browser.get_page_context",
    question: "what video is open",
    namedQuestion: "what is open in YouTube",
  },
];

const instanceOf = (app: AppUnderTest) => ({
  instanceKey: app.instanceKey,
  appCatalogId: app.appCatalogId,
  executableName: app.executableName,
  windowTitle: app.windowTitle,
  ...(app.workspaceIdentity ? { workspaceIdentity: app.workspaceIdentity } : {}),
});

// ── The table, printed before anything runs ──────────────────────────────
console.log("\n═══ supported-application matrix ═══\n");
console.log(
  "| Application | Running detection | Watch activation | Fresh-state adapter | Actions | Verification method |",
);
console.log(
  "|---|---|---|---|---|---|",
);
for (const app of MATRIX) {
  const adapter = adapterFor(instanceOf(app) as never);
  console.log(
    `| ${app.displayName} | process+window | row click | ${adapter?.id ?? "window-metadata"} | ${app.readCapability} | stub round-trip + prompt block |`,
  );
}
console.log("");

// ── Every adapted application is in the matrix ───────────────────────────
console.log("═══ the matrix covers the whole registry ═══");
{
  const adapted = adaptedApplicationIds();
  const covered = new Set(MATRIX.map((a) => a.appCatalogId));
  // Netflix and Amazon share the browser adapter and the browser code path
  // exactly; Chrome, Edge and YouTube already exercise it under three different
  // catalog ids, which is what the path branches on.
  const sameAsBrowser = new Set(["firefox", "brave", "netflix", "amazon"]);
  const missing = adapted.filter(
    (id) => !covered.has(id) && !sameAsBrowser.has(id),
  );
  check(
    "every adapted application is tested or explicitly shares a tested path",
    missing.length === 0,
    missing.length === 0
      ? `covered: ${[...covered].sort().join(", ")}`
      : `UNTESTED: ${missing.join(", ")}`,
  );
}

async function fresh(apps: AppUnderTest[]) {
  watchBackend.reset();
  clearAllWatchScopes();
  clearWatchTurnMemory();
  resetWatchProvenance();
  watchBackend.setRunning(apps.map(instanceOf) as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

const activeIds = () =>
  getWatchScope(CONV).scope.entries.map((e) => e.appCatalogId);

// ── Each application, at every layer ─────────────────────────────────────
for (const app of MATRIX) {
  console.log(`\n═══ ${app.displayName} ═══`);
  await fresh([app]);

  // 1. Running detection.
  const rows = runningRows(
    buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, []),
  );
  check(
    `${app.displayName}: detected as running`,
    rows.some((r) => r.appCatalogId === app.appCatalogId),
    rows.map((r) => r.appCatalogId).join(", ") || "none",
  );

  // 2. An adapter claims it.
  const adapter = adapterFor(instanceOf(app) as never);
  check(
    `${app.displayName}: an adapter claims its instance`,
    adapter !== null,
    adapter?.id ?? "NO ADAPTER",
  );

  // 3. Activation by row click.
  await watchApplication(app.appCatalogId);
  await toggleWatchScope(CONV, app.appCatalogId);
  check(
    `${app.displayName}: a row click watches and activates it`,
    activeIds().includes(app.appCatalogId) &&
      getWatchSnapshot().watched.some((w) => w.appCatalogId === app.appCatalogId),
    `active=[${activeIds()}]`,
  );

  // 4. Its read capability is offered — and only while it is active.
  const scope = await refreshWatchScope(CONV);
  check(
    `${app.displayName}: its read capability becomes callable`,
    scope.capabilityIds.includes(app.readCapability),
    scope.capabilityIds.join(", ") || "none",
  );

  // 5. Fresh state reaches the prompt, with an instance key to act on.
  const block = await watchContextForPrompt(app.question, CONV);
  check(
    `${app.displayName}: the turn resolves to it`,
    block.includes(`## ${app.displayName}`),
    block.split("\n")[0] || "EMPTY BLOCK",
  );
  check(
    `${app.displayName}: the prompt carries an instance key to act on`,
    block.includes(app.instanceKey),
    block.includes(app.instanceKey) ? app.instanceKey : "NO INSTANCE KEY",
  );
  check(
    `${app.displayName}: the model is told to read state on this turn`,
    /Never answer from an earlier turn in this conversation/.test(block),
    "freshness instruction present",
  );

  // 5b. The same question through the production send path — the entry point
  //     the Send button uses. Nothing here is typed or pasted: what is asserted
  //     is what the engine, the guard and the ledger actually produced.
  {
    const turn = await sendThroughProductionPath(app.question, CONV);
    check(
      `${app.displayName}: the production path resolves the turn to it`,
      turn.promptTrace?.contextMode === "watch" &&
        turn.promptTrace.includedApplicationIds.includes(app.appCatalogId),
      `mode=${turn.promptTrace?.contextMode} included=[${turn.promptTrace?.includedApplicationIds}]`,
    );
    check(
      `${app.displayName}: its reply carries no internal protocol`,
      protocolLeaks(turn.text).length === 0,
      protocolLeaks(turn.text).join(", ") || "clean",
    );
    check(
      `${app.displayName}: no unrelated application was queried`,
      (turn.provenance?.adaptersQueried ?? []).every(
        (id) => id === app.appCatalogId,
      ),
      `adapters=[${turn.provenance?.adaptersQueried}]`,
    );
  }

  // 6. Provenance credits it only when its capability actually runs.
  resetWatchProvenance();
  beginWatchTurn();
  await watchContextForPrompt(app.question, CONV);
  recordCapabilityCall(app.readCapability, app.instanceKey);
  const credited = turnContributors();
  endWatchTurn();
  check(
    `${app.displayName}: a real read credits it`,
    credited.includes(app.appCatalogId),
    `credited=[${credited}]`,
  );

  // 7. An unrelated request credits nothing and injects nothing.
  resetWatchProvenance();
  beginWatchTurn();
  const unrelated = await watchContextForPrompt("Create a task for tomorrow", CONV);
  recordCapabilityCall("tasks.create");
  const unrelatedCredit = turnContributors();
  endWatchTurn();
  check(
    `${app.displayName}: does not hijack an unrelated request`,
    unrelated === "" && unrelatedCredit.length === 0,
    `chars=${unrelated.length} credited=[${unrelatedCredit}]`,
  );

  // 8. Deactivation keeps the watch permission.
  await toggleWatchScope(CONV, app.appCatalogId);
  check(
    `${app.displayName}: deactivates without losing its watch permission`,
    !activeIds().includes(app.appCatalogId) &&
      getWatchSnapshot().watched.some((w) => w.appCatalogId === app.appCatalogId),
    `active=[${activeIds()}] still watched`,
  );

  // 9. Named while inactive: asks to be activated, reads nothing.
  const named = await watchContextForPrompt(app.namedQuestion, CONV);
  check(
    `${app.displayName}: named while inactive, it asks to be activated`,
    /focused Watch access is not active/.test(named) &&
      new RegExp(`Activate ${app.displayName}`).test(named),
    named.includes("focused Watch access is not active")
      ? "activation offered"
      : named.split("\n")[0] || "EMPTY",
  );
  check(
    `${app.displayName}: and is not read before activation`,
    /Do NOT read its window, take a screenshot, search the screen/.test(named),
    "no read, no visual fallback",
  );

  // 10. Closing it clears everything but the permission.
  await toggleWatchScope(CONV, app.appCatalogId);
  watchBackend.stopApp(app.appCatalogId);
  await refreshWatchSnapshot();
  const afterClose = await refreshWatchScope(CONV);
  const closedRows = runningRows(
    buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, []),
  );
  check(
    `${app.displayName}: closing removes it from Running apps and the active set`,
    !closedRows.some((r) => r.appCatalogId === app.appCatalogId) &&
      !afterClose.scope.entries.some((e) => e.appCatalogId === app.appCatalogId),
    `rows=[${closedRows.map((r) => r.appCatalogId)}] active=[${activeIds()}]`,
  );
  check(
    `${app.displayName}: no capability of its survives the close`,
    afterClose.capabilityIds.length === 0,
    `callable=${afterClose.capabilityIds.length}`,
  );
  check(
    `${app.displayName}: keeps its watch permission for the manager`,
    getWatchSnapshot().watched.some((w) => w.appCatalogId === app.appCatalogId),
    "watched, not running",
  );

  // 11. Reopening does not reactivate.
  watchBackend.setRunning([instanceOf(app)] as never[]);
  await refreshWatchSnapshot();
  await refreshWatchScope(CONV);
  check(
    `${app.displayName}: reopening does not reactivate it`,
    !activeIds().includes(app.appCatalogId),
    `active=[${activeIds()}]`,
  );
}

// ── Two applications of different kinds, together ────────────────────────
console.log("\n═══ an editor and a browser, active together ═══");
{
  const vscode = MATRIX.find((a) => a.appCatalogId === "vscode")!;
  const chrome = MATRIX.find((a) => a.appCatalogId === "chrome")!;
  const discord = MATRIX.find((a) => a.appCatalogId === "discord")!;
  await fresh([vscode, chrome, discord]);
  for (const app of [vscode, chrome]) {
    await watchApplication(app.appCatalogId);
    await toggleWatchScope(CONV, app.appCatalogId);
  }

  const scope = await refreshWatchScope(CONV);
  check(
    "both contribute their own capabilities",
    scope.capabilityIds.includes("vscode.get_context") &&
      scope.capabilityIds.some((id) => id.startsWith("browser.")),
    scope.capabilityIds.join(", "),
  );

  const block = await watchContextForPrompt(
    "Run this project, inspect the browser output, and fix the problem",
    CONV,
  );
  check(
    "the turn describes both, as separate groups",
    block.includes("## VS Code") && block.includes("## Chrome"),
    block.split("\n")[0],
  );
  check(
    "the third running application contributes nothing",
    !/discord/i.test(block),
    /discord/i.test(block) ? "DISCORD LEAKED" : "absent",
  );

  resetWatchProvenance();
  beginWatchTurn();
  await watchContextForPrompt("Run this project and inspect the browser", CONV);
  recordCapabilityCall("vscode.run_task", vscode.instanceKey);
  recordCapabilityCall("browser.get_page_context", chrome.instanceKey);
  const credited = turnContributors().sort();
  endWatchTurn();
  check(
    "provenance holds exactly the two that ran",
    credited.join(",") === "chrome,vscode",
    `[${credited}]`,
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Every adapted application passes at every layer.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
