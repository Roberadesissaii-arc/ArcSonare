/**
 * Activation recency: what the two visible rows are, and who decides.
 *
 * The reported failure: activate VS Code from page three and it stays on page
 * three, because the active applications were sorted alphabetically and the
 * pager kept its old offset. A person who has just chosen an application should
 * not have to go looking for it.
 *
 * The order is a property of the conversation's scope, supplied by Rust as
 * `activatedSequence`. Every surface sorts by it; none of them re-derives it.
 *
 * Run: npm run test:watch-ordering
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
  getWatchScope,
  refreshWatchScope,
  setCurrentConversation,
  toggleWatchScope,
} from "../src/features/watch/watchScopeStore";
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

const CONV = "conv-ordering";
const OTHER = "conv-ordering-other";
const VISIBLE_ROWS = 2;

const APPS = {
  spotify: {
    instanceKey: "spotify:exe:spotify-exe:0",
    appCatalogId: "spotify",
    executableName: "Spotify.exe",
    windowTitle: "Marconi Union - Weightless",
  },
  chrome: {
    instanceKey: "chrome:exe:chrome-exe:0",
    appCatalogId: "chrome",
    executableName: "chrome.exe",
    windowTitle: "localhost:3000 - Google Chrome",
  },
  discord: {
    instanceKey: "discord:exe:discord-exe:0",
    appCatalogId: "discord",
    executableName: "Discord.exe",
    windowTitle: "#general | ArcSonare Testing",
  },
  edge: {
    instanceKey: "edge:exe:msedge-exe:0",
    appCatalogId: "edge",
    executableName: "msedge.exe",
    windowTitle: "ArcSonare - Microsoft Edge",
  },
  vscode: {
    instanceKey: "vscode:ws:arcsonare",
    appCatalogId: "vscode",
    executableName: "Code.exe",
    workspaceIdentity: "ArcSonare",
    windowTitle: "main.rs - ArcSonare - Visual Studio Code",
  },
};

async function fresh(conversation = CONV) {
  watchBackend.reset();
  clearAllWatchScopes();
  watchBackend.setRunning(Object.values(APPS) as never[]);
  setCurrentConversation(conversation);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

/** The active set, in the order Rust says it was activated. */
function activeOrder(conversation = CONV): string[] {
  return [...getWatchScope(conversation).scope.entries]
    .sort((a, b) => (a.activatedSequence ?? 0) - (b.activatedSequence ?? 0))
    .map((e) => e.appCatalogId);
}

/** The rows the compact card would draw, in order. */
function cardRows(conversation = CONV): string[] {
  const snapshot = getWatchSnapshot();
  return runningRows(
    buildRowGroups(snapshot.watched, snapshot.running, activeOrder(conversation)),
  ).map((r) => r.appCatalogId);
}

/** Exactly what clicking a Running Apps row does. */
async function clickRow(appCatalogId: string, conversation = CONV) {
  if (!getWatchSnapshot().watched.some((w) => w.appCatalogId === appCatalogId)) {
    await watchApplication(appCatalogId);
  }
  await toggleWatchScope(conversation, appCatalogId);
}

// ── Rust supplies the order ──────────────────────────────────────────────
console.log("\n═══ the order comes from the scope, not from React ═══");
await fresh();
await clickRow("chrome");
await clickRow("discord");
{
  const scope = getWatchScope(CONV).scope;
  check(
    "every active entry carries an activation sequence",
    scope.entries.every((e) => typeof e.activatedSequence === "number"),
    scope.entries
      .map((e) => `${e.appCatalogId}:${e.activatedSequence}`)
      .join(", "),
  );
  check(
    "the most recently activated has sequence 0",
    scope.entries.find((e) => e.activatedSequence === 0)?.appCatalogId ===
      "discord",
    `seq 0 = ${scope.entries.find((e) => e.activatedSequence === 0)?.appCatalogId}`,
  );
  const rust = readFileSync("src-tauri/src/watch/scope.rs", "utf8");
  check(
    "Rust owns the sequence and orders by activation, newest first",
    /pub activated_sequence: u64/.test(rust) &&
      /ORDER BY s\.created_at DESC, s\.rowid DESC/.test(rust),
    "activated_sequence, created_at DESC",
  );
}

// ── Newly activated becomes row 1, previous becomes row 2 ───────────────
console.log("\n═══ the newly activated application is row 1 ═══");
await fresh();
{
  check(
    "with nothing active the list is the plain running order",
    cardRows().length === 5,
    `[${cardRows()}]`,
  );

  await clickRow("chrome");
  check(
    "activating Chrome makes it row 1",
    cardRows()[0] === "chrome",
    `[${cardRows().slice(0, VISIBLE_ROWS)}]`,
  );

  await clickRow("discord");
  check(
    "activating Discord makes it row 1 and Chrome row 2",
    cardRows().slice(0, 2).join(",") === "discord,chrome",
    `[${cardRows().slice(0, VISIBLE_ROWS)}]`,
  );

  await clickRow("vscode");
  check(
    "activating VS Code makes it row 1 and Discord row 2",
    cardRows().slice(0, 2).join(",") === "vscode,discord",
    `[${cardRows().slice(0, VISIBLE_ROWS)}]`,
  );
  check(
    "Chrome is still active, one page down",
    activeOrder().join(",") === "vscode,discord,chrome" &&
      cardRows()[2] === "chrome",
    `active=[${activeOrder()}] rows=[${cardRows()}]`,
  );
  check(
    "no active application is ever sorted alphabetically",
    cardRows().slice(0, 3).join(",") !== "chrome,discord,vscode",
    `[${cardRows().slice(0, 3)}]`,
  );
}

// ── Deactivation recalculates ───────────────────────────────────────────
console.log("\n═══ deactivating one recalculates the rest ═══");
{
  await clickRow("discord");
  check(
    "the active order closes the gap",
    activeOrder().join(",") === "vscode,chrome",
    `[${activeOrder()}]`,
  );
  check(
    "the visible rows become the two that remain active",
    cardRows().slice(0, 2).join(",") === "vscode,chrome",
    `[${cardRows().slice(0, VISIBLE_ROWS)}]`,
  );
  check(
    "Discord keeps its watch permission",
    getWatchSnapshot().watched.some((w) => w.appCatalogId === "discord"),
    "still watched",
  );
  const snapshot = getWatchSnapshot();
  const groups = buildRowGroups(snapshot.watched, snapshot.running, activeOrder());
  const discord = groups.watching.find((r) => r.appCatalogId === "discord");
  check(
    "and returns to the watched-but-inactive part of the order",
    discord !== undefined && !discord.active,
    `discord active=${discord?.active}`,
  );
}

// ── Recency is per conversation ─────────────────────────────────────────
console.log("\n═══ activation recency is conversation-specific ═══");
await fresh();
{
  await clickRow("chrome", CONV);
  await clickRow("discord", CONV);
  await clickRow("vscode", OTHER);
  await refreshWatchScope(OTHER);
  check(
    "one conversation's order is discord, chrome",
    activeOrder(CONV).join(",") === "discord,chrome",
    `[${activeOrder(CONV)}]`,
  );
  check(
    "the other's is vscode alone",
    activeOrder(OTHER).join(",") === "vscode",
    `[${activeOrder(OTHER)}]`,
  );
  check(
    "each conversation's card shows its own first row",
    cardRows(CONV)[0] === "discord" && cardRows(OTHER)[0] === "vscode",
    `${cardRows(CONV)[0]} / ${cardRows(OTHER)[0]}`,
  );
}

// ── The pager returns to the top ────────────────────────────────────────
console.log("\n═══ the window resets when the order changes ═══");
{
  const hook = readFileSync("src/components/dashboard/useRowPager.ts", "utf8");
  const frame = readFileSync(
    "src/components/dashboard/PagedApplicationCard.tsx",
    "utf8",
  );
  const card = readFileSync(
    "src/components/dashboard/RunningAppsCard.tsx",
    "utf8",
  );
  const applications = readFileSync(
    "src/components/dashboard/ConnectedToolsCard.tsx",
    "utf8",
  );
  check(
    "the pager can be told to go back to the top",
    /resetKey\?: string/.test(hook) &&
      /setWindowStart\(0\);/.test(hook),
    "resetKey sends the window to row 0",
  );
  check(
    "the frame passes it through",
    /props\.resetKey/.test(frame),
    "PagedApplicationCard forwards resetKey",
  );
  check(
    "Running Apps resets on any change to the active set",
    /resetKey=\{activeIds\.join\(","\)\}/.test(card),
    "keyed on the active set",
  );
  check(
    "Applications does not reset — its order does not move under the reader",
    !/resetKey/.test(applications),
    "no reset on the reference card",
  );
}

// ── One order, every surface ────────────────────────────────────────────
console.log("\n═══ one order, read by every surface ═══");
{
  const card = readFileSync(
    "src/components/dashboard/RunningAppsCard.tsx",
    "utf8",
  );
  const control = readFileSync(
    "src/components/watch/WatchComposerControl.tsx",
    "utf8",
  );
  const rows = readFileSync("src/components/watch/watchRows.ts", "utf8");
  const sortByRecency =
    /\.sort\(\(a, b\) => \(a\.activatedSequence \?\? 0\) - \(b\.activatedSequence \?\? 0\)\)/;
  check(
    "the card sorts by the scope's sequence",
    sortByRecency.test(card),
    "activatedSequence",
  );
  check(
    "the composer control sorts by the same sequence",
    sortByRecency.test(control),
    "activatedSequence",
  );
  check(
    "the row builder honours the order it is given rather than re-sorting",
    /const recency = new Map\(activeIds\.map\(\(id, index\) => \[id, index\]\)\)/.test(
      rows,
    ) && /recency\.get\(a\.appCatalogId\)/.test(rows),
    "active rows ordered by the caller's order",
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("The application you just activated is the one you can see.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
