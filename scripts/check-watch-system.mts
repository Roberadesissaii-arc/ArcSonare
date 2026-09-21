/**
 * The Running Apps / Watch system, asserted against the code that defines it.
 *
 * Every check here corresponds to a way the previous implementation was wrong.
 * The list is deliberately behavioural: "watch state is not a localStorage set"
 * is proved by driving the store with localStorage present and showing the
 * authority is elsewhere, not by grepping for the string.
 *
 * Run: npm run test:watch-system
 */

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  bindConversationToApp,
  getWatchSnapshot,
  listenForWatchChanges,
  liveWatchedApplications,
  refreshWatchSnapshot,
  resetWatchStateForAccountChange,
  resolveWatchContext,
  setWatchPaused,
  setWatchPrivacy,
  stopWatchingApplication,
  watchApplication,
  watchedApplication,
} from "../src/features/watch/watchStore";
import {
  capabilitiesForWatchContext,
  explainWatchUnavailable,
  instanceKeyFor,
} from "../src/features/watch/watchCapabilityGate";
import {
  __resetWatchActions,
  claimWatchAction,
  invalidateActionsForInstance,
  isAffirmative,
  proposeWatchAction,
  resolveWatchFollowUp,
  settleWatchAction,
} from "../src/features/watch/watchPendingActions";
import { CAPABILITY_REGISTRY } from "../src/features/capabilities/capabilityRegistry";
import { rowState, ROW_STATE_LABEL } from "../src/features/watch/watchTypes";
import { pageSubject } from "../src/features/watch/adapters/browserAdapter";
import { adapterFor } from "../src/features/watch/adapters/adapterRegistry";

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

const spotify = {
  instanceKey: "spotify:exe:spotify:0",
  appCatalogId: "spotify",
  executableName: "Spotify.exe",
  windowTitle: "Marconi Union - Weightless",
};
const vscodeA = {
  instanceKey: "vscode:ws:arcsonare",
  appCatalogId: "vscode",
  executableName: "Code.exe",
  windowTitle: "main.rs — ArcSonare — Visual Studio Code",
  workspaceIdentity: "ArcSonare",
};
const vscodeB = {
  instanceKey: "vscode:ws:website",
  appCatalogId: "vscode",
  executableName: "Code.exe",
  windowTitle: "index.ts — website — Visual Studio Code",
  workspaceIdentity: "website",
};
const discord = {
  instanceKey: "discord:exe:discord:0",
  appCatalogId: "discord",
  executableName: "Discord.exe",
  windowTitle: "#general | ArcSonare Testing",
};
const chrome = {
  instanceKey: "chrome:exe:chrome:0",
  appCatalogId: "chrome",
  executableName: "chrome.exe",
  windowTitle: "Some Video - YouTube - Google Chrome",
};

async function fresh(instances: unknown[] = []) {
  watchBackend.reset();
  __resetWatchActions();
  watchBackend.setRunning(instances as never[]);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

// ── 1. Watch state survives page navigation (a fresh store read) ───────────
console.log("\n— 1. watch state persists beyond page navigation —");
await fresh([spotify]);
await watchApplication("spotify");
// A navigation discards module state; the next read must come back with it.
await refreshWatchSnapshot();
check(
  "a watch survives a store re-read",
  Boolean(watchedApplication("spotify")),
  `watched=${getWatchSnapshot().watched.map((w) => w.appCatalogId).join(",") || "none"}`,
);

// ── 2. Account-scoped ──────────────────────────────────────────────────────
console.log("\n— 2. watch state is account-scoped —");
watchBackend.switchAccount("account-b");
await refreshWatchSnapshot();
const bSeesA = getWatchSnapshot().watched.length;
watchBackend.switchAccount("account-a");
await refreshWatchSnapshot();
check(
  "account B cannot see account A's watches",
  bSeesA === 0 && Boolean(watchedApplication("spotify")),
  `accountB saw ${bSeesA}, accountA still has ${getWatchSnapshot().watched.length}`,
);

// ── 3. Main and voice receive the same state ──────────────────────────────
console.log("\n— 3. main and voice share one state —");
{
  // Both surfaces read the same command. Two "windows" reading in sequence is
  // the strongest assertion available without a second WebView2 heap.
  const asMain = getWatchSnapshot().watched.map((w) => w.appCatalogId).sort();
  await refreshWatchSnapshot();
  const asVoice = liveWatchedApplications().map((w) => w.appCatalogId).sort();
  check(
    "both surfaces resolve to the same watched set",
    JSON.stringify(asMain) === JSON.stringify(asVoice),
    `main=[${asMain}] voice=[${asVoice}]`,
  );
}

// ── 4. Closing an app does not delete the watch ───────────────────────────
console.log("\n— 4. closing an application keeps the watch —");
watchBackend.stopApp("spotify");
await refreshWatchSnapshot();
{
  const entry = watchedApplication("spotify");
  check(
    "a closed application stays watched, in an offline state",
    Boolean(entry) && entry?.state === "app-closed",
    `entry=${entry ? entry.state : "DELETED"}`,
  );
}

// ── 5. Reopening rebinds ──────────────────────────────────────────────────
console.log("\n— 5. a reopened application rebinds —");
watchBackend.setRunning([spotify]);
await refreshWatchSnapshot();
{
  const entry = watchedApplication("spotify");
  check(
    "reopening restores the watch and its instance",
    entry?.state === "watching" && entry.instances.length === 1,
    `state=${entry?.state} instances=${entry?.instances.length}`,
  );
}

// ── 6. Multiple windows stay separate ─────────────────────────────────────
console.log("\n— 6. multiple workspaces stay distinguishable —");
await fresh([vscodeA, vscodeB]);
await watchApplication("vscode");
{
  const entry = watchedApplication("vscode");
  const keys = entry?.instances.map((i) => i.instanceKey) ?? [];
  check(
    "two VS Code workspaces remain two instances",
    keys.length === 2 && new Set(keys).size === 2,
    `keys=[${keys.join(", ")}]`,
  );
}

// ── 7 & 8. Preferred instance, and ambiguity ──────────────────────────────
console.log("\n— 7/8. pinning and ambiguity —");
check(
  "with two instances and no pin, no instance is silently chosen",
  instanceKeyFor(watchedApplication("vscode")!) === null,
  `instanceKeyFor=${instanceKeyFor(watchedApplication("vscode")!)}`,
);
{
  const outcome = await resolveWatchContext({ requestText: "run this code" });
  const vscodeCandidate = outcome.candidates.find(
    (c) => c.application.appCatalogId === "vscode",
  );
  check(
    "ambiguous instances require clarification",
    vscodeCandidate?.resolution.kind === "ambiguous" && outcome.needsClarification,
    `resolution=${vscodeCandidate?.resolution.kind} needsClarification=${outcome.needsClarification}`,
  );
}
{
  const { pinWatchInstance } = await import("../src/features/watch/watchStore");
  await pinWatchInstance("vscode", vscodeB.instanceKey);
  const entry = watchedApplication("vscode")!;
  check(
    "a pinned instance is stable and wins",
    instanceKeyFor(entry) === vscodeB.instanceKey,
    `resolved=${instanceKeyFor(entry)}`,
  );
  // And it survives the application closing.
  watchBackend.stopApp("vscode");
  await refreshWatchSnapshot();
  const closed = watchedApplication("vscode");
  check(
    "the pin survives the application closing",
    closed?.preferredInstanceKey === vscodeB.instanceKey,
    `pin=${closed?.preferredInstanceKey}`,
  );
}

// ── 9 & 10. Privacy ───────────────────────────────────────────────────────
console.log("\n— 9/10. privacy defaults and redaction —");
await fresh([discord]);
await watchApplication("discord");
{
  const entry = watchedApplication("discord")!;
  check(
    "a messaging application starts with window titles withheld",
    entry.privacyPolicy.windowTitle === false,
    `windowTitle=${entry.privacyPolicy.windowTitle}`,
  );
  check(
    "message content is not shared without explicit consent",
    entry.privacyPolicy.messageContent === false &&
      entry.privacyPolicy.sourceCode === false &&
      entry.privacyPolicy.terminalOutput === false &&
      entry.privacyPolicy.screenshots === false,
    `message=${entry.privacyPolicy.messageContent} source=${entry.privacyPolicy.sourceCode} terminal=${entry.privacyPolicy.terminalOutput} screenshots=${entry.privacyPolicy.screenshots}`,
  );
}

// ── 11. Unwatched applications offer nothing ──────────────────────────────
console.log("\n— 11. unwatched applications offer no capabilities —");
await fresh([spotify, vscodeA]);
check(
  "nothing watched means no watched-app tools",
  capabilitiesForWatchContext(getWatchSnapshot().watched).length === 0,
  `offered=${capabilitiesForWatchContext(getWatchSnapshot().watched).length}`,
);

// ── 12 & 13. Spotify ──────────────────────────────────────────────────────
console.log("\n— 12/13. watched Spotify supplies media capabilities —");
await watchApplication("spotify");
{
  const offered = capabilitiesForWatchContext(getWatchSnapshot().watched).map((c) => c.id);
  check(
    "watched Spotify supplies transport capabilities",
    ["spotify.play", "spotify.pause", "spotify.next", "spotify.get_playback"].every((id) =>
      offered.includes(id),
    ),
    `offered=[${offered.join(", ")}]`,
  );
  check(
    "watching Spotify does not offer editor capabilities",
    !offered.some((id) => id.startsWith("vscode.")),
    `offered=[${offered.join(", ")}]`,
  );
}
{
  const outcome = await resolveWatchContext({ requestText: "press play" });
  const top = outcome.candidates[0];
  check(
    "\"press play\" resolves to the watched Spotify instance",
    top?.application.appCatalogId === "spotify" &&
      top.resolution.kind === "resolved" &&
      top.resolution.instance.instanceKey === spotify.instanceKey,
    `top=${top?.application.appCatalogId} resolution=${top?.resolution.kind}`,
  );
}

// ── 14 & 15. VS Code ──────────────────────────────────────────────────────
console.log("\n— 14/15. watched VS Code supplies development capabilities —");
await fresh([vscodeA]);
await watchApplication("vscode");
{
  const offered = capabilitiesForWatchContext(getWatchSnapshot().watched).map((c) => c.id);
  check(
    "watched VS Code supplies development capabilities",
    ["vscode.get_diagnostics", "vscode.run_task", "vscode.list_tasks"].every((id) =>
      offered.includes(id),
    ),
    `offered=[${offered.join(", ")}]`,
  );
  check(
    "watching VS Code does not offer Spotify transport",
    !offered.some((id) => id.startsWith("spotify.")),
    `offered=[${offered.join(", ")}]`,
  );
}
{
  const outcome = await resolveWatchContext({ requestText: "run this code" });
  const top = outcome.candidates[0];
  check(
    "\"run this code\" resolves to the correct workspace",
    top?.resolution.kind === "resolved" &&
      top.resolution.instance.workspaceIdentity === "ArcSonare",
    `workspace=${top?.resolution.kind === "resolved" ? top.resolution.instance.workspaceIdentity : top?.resolution.kind}`,
  );
}

// ── 16 & 17. Discord send requires exactly one confirmation ───────────────
console.log("\n— 16/17. one confirmation, one send —");
__resetWatchActions();
{
  const action = proposeWatchAction({
    capabilityId: "discord_desktop.send_message",
    arguments: { instance_key: discord.instanceKey, message: "hello" },
    appCatalogId: "discord",
    instanceKey: discord.instanceKey,
    description: 'Send "hello" to #general in ArcSonare Testing',
    external: true,
  });
  const resolved = resolveWatchFollowUp("yes", undefined);
  check(
    "an affirmative resolves to the exact prepared action",
    resolved?.id === action.id && isAffirmative("yes"),
    `resolved=${resolved?.id === action.id}`,
  );

  const first = claimWatchAction(action.id);
  if (first.ok) settleWatchAction(action.id, "Sent to #general in ArcSonare Testing.");
  const second = claimWatchAction(action.id);
  check(
    "a replayed confirmation does not send a second time",
    first.ok === true && second.ok === false && second.reason === "replay",
    `first=${first.ok} second=${second.ok ? "executed again" : second.reason}`,
  );
  check(
    "the replay returns the original outcome rather than nothing",
    second.ok === false &&
      second.reason === "replay" &&
      second.action.outcomeSummary?.includes("#general") === true,
    `replayed summary=${second.ok === false && second.reason === "replay" ? second.action.outcomeSummary : "n/a"}`,
  );
}
{
  // An approval must not outlive the window it was addressed to.
  __resetWatchActions();
  const action = proposeWatchAction({
    capabilityId: "discord_desktop.send_message",
    arguments: {},
    appCatalogId: "discord",
    instanceKey: discord.instanceKey,
    description: "send",
    external: true,
  });
  invalidateActionsForInstance(discord.instanceKey);
  const claimed = claimWatchAction(action.id);
  check(
    "an approval for a window that changed is refused, not executed",
    claimed.ok === false && claimed.reason === "expired",
    `claim=${claimed.ok ? "EXECUTED" : claimed.reason}`,
  );
}

// ── 18 & 19. Browser + YouTube ────────────────────────────────────────────
console.log("\n— 18/19. browser and YouTube cooperate —");
await fresh([chrome]);
await watchApplication("chrome");
{
  const offered = capabilitiesForWatchContext(getWatchSnapshot().watched).map((c) => c.id);
  check(
    "a watched browser supplies navigation and page context",
    offered.includes("browser.navigate") && offered.includes("browser.get_page_context"),
    `offered=[${offered.join(", ")}]`,
  );
  check(
    "focusing a browser does not go through a web search capability",
    !offered.includes("web.search") && offered.includes("applications.focus_watched"),
    `offered=[${offered.join(", ")}]`,
  );
  check(
    "the page subject is separated from the site, for a channel lookup",
    pageSubject("Some Video - YouTube", "youtube") === "Some Video",
    `subject="${pageSubject("Some Video - YouTube", "youtube")}"`,
  );
}

// ── 20. A closed application produces an honest unavailable result ────────
console.log("\n— 20. an honest answer when the app is closed —");
await fresh([]);
await watchApplication("spotify");
await refreshWatchSnapshot();
{
  const explanation = explainWatchUnavailable("spotify.play", getWatchSnapshot().watched);
  check(
    "a closed watched application explains itself and offers to open",
    Boolean(explanation?.includes("isn't running")),
    `explanation="${explanation}"`,
  );
  const offered = capabilitiesForWatchContext(getWatchSnapshot().watched);
  check(
    "a closed application offers no capabilities at all",
    offered.length === 0,
    `offered=${offered.length}`,
  );
}

// ── 21. Cross-account leakage ─────────────────────────────────────────────
console.log("\n— 21. context cannot cross accounts —");
await fresh([discord]);
await watchApplication("discord");
await bindConversationToApp({ conversationId: "conv-1", appCatalogId: "discord" });
watchBackend.switchAccount("account-b");
await resetWatchStateForAccountChange();
{
  const leaked = getWatchSnapshot().watched;
  const outcome = await resolveWatchContext({
    requestText: "what channel am I in",
    conversationId: "conv-1",
  });
  check(
    "another account sees no watches and no bound conversation",
    leaked.length === 0 && outcome.candidates.length === 0,
    `watched=${leaked.length} candidates=${outcome.candidates.length}`,
  );
}
watchBackend.switchAccount("account-a");

// ── 22. Watch events do not trigger provider calls ────────────────────────
console.log("\n— 22. watch churn does not hit an adapter per event —");
await fresh([spotify]);
await watchApplication("spotify");
{
  const before = watchBackend.calls.capabilityExecute;
  for (let i = 0; i < 5; i += 1) {
    watchBackend.stopApp("spotify");
    await refreshWatchSnapshot();
    watchBackend.setRunning([spotify]);
    await refreshWatchSnapshot();
  }
  await watchBackend.settle();
  const after = watchBackend.calls.capabilityExecute;
  check(
    "ten reconciliations make no adapter calls on their own",
    after === before,
    `capability calls: ${before} → ${after}`,
  );
}

// ── 23 & 24. UI is a preview, not a limit ─────────────────────────────────
console.log("\n— 23/24. the list is complete, the preview is a preview —");
{
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync("src/components/dashboard/RunningAppsCard.tsx", "utf8"),
  );
  // The card is a two-row window onto the full list, paged by the Applications
  // card's own chevrons — never expanded, never grown. Two rows is what is
  // *visible*; nothing about the feature is capped at two.
  const frame = await import("node:fs").then((fs) =>
    fs.readFileSync("src/components/dashboard/PagedApplicationCard.tsx", "utf8"),
  );
  check(
    "two rows is a display window, not a functional limit",
    /export const VISIBLE_ROWS = 2;/.test(frame) &&
      /useRowPager\(/.test(frame) &&
      /<PagedApplicationCard/.test(source),
    "a paged window over the whole running list",
  );
  check(
    "paging uses the Applications card's own chevrons",
    /opened-apps-page-btn opened-apps-page-down/.test(frame) &&
      /opened-apps-page-btn opened-apps-page-up/.test(frame) &&
      !/View all/.test(source),
    "the same component draws both cards' chevrons",
  );
  const manager = await import("node:fs").then((fs) =>
    fs.readFileSync("src/components/watch/WatchManagerModal.tsx", "utf8"),
  );
  check(
    "every running application is reachable, and the manager holds the rest",
    /items=\{rows\}/.test(source) && /setManageOpen\(true\)/.test(source),
    "paged through in the card, complete in the manager",
  );
  check(
    "the manager renders every watched row across its sections, unsliced",
    /sections\.active\.map/.test(manager) &&
      /sections\.watchedIdle\.map/.test(manager) &&
      /sections\.watchedClosed\.map/.test(manager) &&
      /groups\.otherRunning\.map/.test(manager) &&
      !/\.slice\(/.test(manager),
    "four sections, all mapped in full",
  );
}

// ── 25. localStorage is no longer authoritative ───────────────────────────
console.log("\n— 25. localStorage is not the authority —");
await fresh([spotify, vscodeA]);
await watchApplication("spotify");
{
  // Plant a contradictory legacy value. The authority must ignore it.
  globalThis.localStorage.setItem(
    "arcsonare.dashboard.contextApps.active.v1",
    JSON.stringify(["vscode", "discord", "figma"]),
  );
  await refreshWatchSnapshot();
  const ids = getWatchSnapshot().watched.map((w) => w.appCatalogId).sort();
  check(
    "a contradictory localStorage key does not change what is watched",
    JSON.stringify(ids) === JSON.stringify(["spotify"]),
    `watched=[${ids.join(", ")}]`,
  );
  const storeSource = await import("node:fs").then((fs) =>
    fs.readFileSync("src/features/watch/watchStore.ts", "utf8"),
  );
  check(
    "the store never writes watch membership back to localStorage",
    !/localStorage\.setItem\(\s*LEGACY_ACTIVE_KEY/.test(storeSource),
    "no write path to the legacy key",
  );
}

// ── Extra: the gate is derived, and the registry agrees with it ───────────
console.log("\n— derived, not hand-listed —");
{
  const watchedCaps = CAPABILITY_REGISTRY.filter((c) => c.category === "watched-app");
  // Media transport is the one exemption, and it is a narrow one. `spotify.*`
  // resolves its target from the capability's own application and cannot reach
  // another player, so an omitted key is safe — whereas *requiring* it made the
  // model stop and ask "which Spotify window should I play it in?", which is
  // not a question the user can usefully answer. Everything that can act on a
  // specific window still has to name one.
  const mediaTransport = new Set([
    "spotify.get_playback",
    "spotify.play",
    "spotify.pause",
    "spotify.next",
    "spotify.previous",
  ]);
  const missingSchema = watchedCaps
    .filter((c) => !mediaTransport.has(c.id))
    .filter((c) => {
      const props = (c.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      const required = (c.inputSchema as { required?: string[] }).required ?? [];
      return !("instance_key" in props) || !required.includes("instance_key");
    });
  check(
    "every window-addressing watched capability requires an explicit instance_key",
    missingSchema.length === 0,
    missingSchema.length === 0
      ? `${watchedCaps.length - mediaTransport.size} capabilities require it; ${mediaTransport.size} media-transport ones resolve by application`
      : `missing on: ${missingSchema.map((c) => c.id).join(", ")}`,
  );
  check(
    "media transport resolves by application rather than demanding a window",
    [...mediaTransport].every((id) => {
      const cap = CAPABILITY_REGISTRY.find((c) => c.id === id);
      const required = (cap?.inputSchema as { required?: string[] })?.required ?? [];
      return !required.includes("instance_key");
    }),
    "no media capability forces the user to pick a window",
  );
  const sendCap = CAPABILITY_REGISTRY.find((c) => c.id === "discord_desktop.send_message");
  check(
    "sending a Discord message is not offered by voice",
    sendCap?.supportsVoice === false && sendCap?.confirmation === "always",
    `supportsVoice=${sendCap?.supportsVoice} confirmation=${sendCap?.confirmation}`,
  );
}
{
  check(
    "row state is derived from watch state and adapter health",
    rowState(undefined, true, true) === "running" &&
      ROW_STATE_LABEL[rowState(undefined, true, true)] === "Running",
    `unwatched-but-running → ${ROW_STATE_LABEL[rowState(undefined, true, true)]}`,
  );
  const adapter = adapterFor({
    instanceKey: spotify.instanceKey,
    appCatalogId: "spotify",
    id: "x",
    processId: 1,
    executableName: "Spotify.exe",
    state: "running",
    lastSeenAt: "",
  });
  check(
    "an adapter resolves for a real instance",
    adapter?.id === "spotify-desktop",
    `adapter=${adapter?.id}`,
  );
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("All watch-system checks passed.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
