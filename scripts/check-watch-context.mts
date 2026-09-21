/**
 * Watch context selection, privacy and presentation.
 *
 * Each check corresponds to a way the shipped build was wrong. The centrepiece
 * is the reported case — Discord watched, Chrome merely running — asserted
 * against the *actual* model-context payload rather than against intent.
 *
 * Run: npm run test:watch-context
 */

import { existsSync, readFileSync } from "node:fs";

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  listenForWatchChanges,
  refreshWatchSnapshot,
  stopWatchingApplication,
  setWatchPaused,
  watchApplication,
  getWatchSnapshot,
} from "../src/features/watch/watchStore";
import {
  clearAllWatchScopes,
  getWatchScope,
  refreshWatchScope,
  setCurrentConversation,
  setWatchScope,
  toggleWatchScope,
  watchEnvelopeFor,
} from "../src/features/watch/watchScopeStore";
import {
  lastWatchPromptTrace,
  watchContextForPrompt,
} from "../src/features/watch/watchPromptContext";
import { narrowForWatchScope } from "../src/features/watch/watchCapabilityGate";
import {
  AMBIENT_READ_CAPABILITIES,
  isInventoryRequest,
  FORBIDDEN_UNWATCHED_FIELDS,
} from "../src/features/watch/watchPrivacyGate";
import {
  checkWatchResponse,
  isWatchCapabilityQuestion,
} from "../src/features/watch/watchResponseGuard";
import { capabilitiesForOrigin } from "../src/features/capabilities/connectorRegistry";
import { buildRowGroups, rowDetail } from "../src/components/watch/watchRows";
import { abilityCounts, availableNow, afterReopening } from "../src/features/watch/watchAbilityTypes";

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

const CONV = "conv-test";

const DISCORD = {
  instanceKey: "discord:exe:discord-exe:0",
  appCatalogId: "discord",
  executableName: "Discord.exe",
  windowTitle: "#general | ArcSonare Testing",
};
const CHROME = {
  instanceKey: "chrome:exe:chrome-exe:0",
  appCatalogId: "chrome",
  executableName: "chrome.exe",
  windowTitle: "Confidential Q3 compensation review - Google Docs - Google Chrome",
};
const SPOTIFY = {
  instanceKey: "spotify:exe:spotify-exe:0",
  appCatalogId: "spotify",
  executableName: "Spotify.exe",
  windowTitle: "Marconi Union - Weightless",
};
const YOUTUBE = {
  instanceKey: "youtube:exe:chrome-exe:0",
  appCatalogId: "youtube",
  executableName: "chrome.exe",
  windowTitle: "Some Video - YouTube - Google Chrome",
};

async function fresh(instances: unknown[] = []) {
  watchBackend.reset();
  clearAllWatchScopes();
  watchBackend.setRunning(instances as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

// ── 1 & 2. Discord watched, Chrome running ────────────────────────────────
console.log("\n— 1/2. one watched Discord excludes running Chrome —");
await fresh([DISCORD, CHROME]);
await watchApplication("discord");
await setWatchScope(CONV, ["discord"]);
const block = await watchContextForPrompt("What can you do?", CONV);
{
  const sections = block.slice(block.indexOf("## "), block.indexOf("\nAnswer questions"));
  check(
    "Chrome's window title never reaches the model",
    !block.includes("compensation") && !block.includes("Google Docs"),
    block.includes("compensation") ? "LEAKED" : "absent",
  );
  check(
    "Chrome is not named in the watched context at all",
    !/\bchrome\b/i.test(block),
    /\bchrome\b/i.test(block) ? "LEAKED" : "absent",
  );
  const leaked = FORBIDDEN_UNWATCHED_FIELDS.filter((f) => sections.includes(f));
  check(
    "no forbidden unwatched field appears in the application sections",
    leaked.length === 0,
    leaked.length === 0 ? "none" : `leaked: ${leaked.join(", ")}`,
  );
  const trace = lastWatchPromptTrace();
  check(
    "Chrome's identity appears in the diagnostic, but only as an id",
    trace?.excludedApplicationIds.includes("chrome") === true &&
      !JSON.stringify(trace).includes("compensation"),
    `excluded=${trace?.excludedApplicationIds.join(",")} included=${trace?.includedApplicationIds.join(",")}`,
  );
}

// ── 3 & 4. "What can you do?" ─────────────────────────────────────────────
console.log("\n— 3/4. the question resolves to the watched app —");
{
  check(
    "the block scopes the conversation to Discord by name",
    block.includes("WATCH MODE") && block.includes("Discord"),
    block.split("\n")[0],
  );
  check(
    "it forbids the global feature list explicitly",
    /Do NOT describe ArcSonare's general abilities/.test(block),
    "instruction present",
  );
  const scope = getWatchScope(CONV);
  const globalAnswer =
    "I can do things on your PC — open apps and websites, take screenshots, " +
    "manage your tasks, check your calendar and read your email.";
  const verdict = checkWatchResponse({
    responseText: globalAnswer,
    requestText: "What can you do?",
    abilities: scope.abilities,
  });
  check(
    "the shipped global answer is rejected",
    !verdict.ok && verdict.violations.length >= 5,
    `${verdict.violations.length} violations`,
  );
  const scoped =
    "For Discord I can see which controls the window exposes, tell you which " +
    "channel it says you're in, bring it to the front, and prepare a message " +
    "you confirm before I send.";
  check(
    "a correctly scoped answer is accepted",
    checkWatchResponse({
      responseText: scoped,
      requestText: "What can you do?",
      abilities: scope.abilities,
    }).ok,
    "accepted",
  );
}

// ── 5. Multiple active applications ───────────────────────────────────────
console.log("\n— 5. multiple active apps produce grouped capabilities —");
await fresh([DISCORD, SPOTIFY]);
await watchApplication("discord");
await watchApplication("spotify");
await setWatchScope(CONV, ["discord", "spotify"]);
{
  const multi = await watchContextForPrompt("What can you do?", CONV);
  check(
    "both applications appear as separate groups",
    multi.includes("## Discord") && multi.includes("## Spotify"),
    `discord=${multi.includes("## Discord")} spotify=${multi.includes("## Spotify")}`,
  );
  check(
    "the model is told to group rather than merge",
    /Group your answer by application\. Do not merge/.test(multi),
    "instruction present",
  );
  const scope = getWatchScope(CONV);
  check(
    "scope reports multiple mode",
    scope.scope.mode === "multiple" && scope.scope.entries.length === 2,
    `mode=${scope.scope.mode} entries=${scope.scope.entries.length}`,
  );
}

// ── 6. Ambiguous media action ─────────────────────────────────────────────
console.log("\n— 6. an ambiguous action asks which app —");
await fresh([SPOTIFY, YOUTUBE]);
await watchApplication("spotify");
await watchApplication("youtube");
await setWatchScope(CONV, ["spotify", "youtube"]);
{
  const ambiguous = await watchContextForPrompt("Press play", CONV);
  check(
    "with two media apps active, the model is told to ask",
    /If a request could apply to more than one of them, ask which/.test(ambiguous),
    "clarification instruction present",
  );
  const capabilities = getWatchScope(CONV).capabilityIds;
  check(
    "both applications contribute their own capabilities",
    capabilities.includes("spotify.play") &&
      capabilities.some((id) => id.startsWith("browser.")),
    capabilities.join(", "),
  );
}

// ── 7 & 8. Watched but closed ─────────────────────────────────────────────
console.log("\n— 7/8. a closed watched app binds nothing else —");
await fresh([CHROME]);
await watchApplication("youtube");
await setWatchScope(CONV, ["youtube"]);
{
  // A closed application is retired from the *active* scope — it has stopped
  // being what the conversation is about — but it still answers for itself when
  // the user names it, because "YouTube is watched but not running" is the
  // honest answer and silence is not.
  const scope = await refreshWatchScope(CONV);
  check(
    "the closed application is no longer the conversation's subject",
    scope.scope.entries.length === 0,
    `entries=[${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}]`,
  );
  check(
    "no capability is callable while it is closed",
    scope.capabilityIds.length === 0,
    `callable=${scope.capabilityIds.length}`,
  );
  check(
    "it keeps its watch permission",
    getWatchSnapshot().watched.some((w) => w.appCatalogId === "youtube"),
    "still watched",
  );
  const text = await watchContextForPrompt("what can YouTube do?", CONV);
  check(
    "naming it still produces an answer, marked NOT RUNNING",
    text.includes("YouTube") && text.includes("NOT RUNNING"),
    text.split("\n")[0],
  );
  check(
    "the closed application does not bind the running Chrome",
    !/chrome/i.test(text),
    /chrome/i.test(text) ? "CHROME BOUND TO YOUTUBE" : "nothing substituted",
  );
  check(
    "the model is told not to answer from what it knew before",
    /Do NOT answer from anything it was doing earlier/.test(text),
    "no answering from memory",
  );
  check(
    "the only thing offered is opening it",
    /Open YouTube/.test(text) && !/Go back, forward or reload/.test(text),
    "reopen only — nothing readable or controllable",
  );
}

// ── 9 & 10. Unwatched titles and URLs ─────────────────────────────────────
console.log("\n— 9/10. unwatched content never reaches the provider —");
await fresh([DISCORD, CHROME, SPOTIFY]);
await watchApplication("discord");
await setWatchScope(CONV, ["discord"]);
{
  const text = await watchContextForPrompt("what is going on", CONV);
  check(
    "no unwatched window title is present",
    !text.includes("compensation") && !text.includes("Marconi Union"),
    "absent",
  );
  const all = capabilitiesForOrigin("chat", new Set(), getWatchSnapshot().watched);
  const narrowed = narrowForWatchScope(all, {
    watchScoped: true,
    requestText: "what is going on",
    scopeCapabilityIds: getWatchScope(CONV).capabilityIds,
  });
  const remaining = narrowed.capabilities.map((c) => c.id);
  const stillAmbient = remaining.filter((id) => AMBIENT_READ_CAPABILITIES.has(id));
  check(
    "every ambient window/screen reader is withheld",
    stillAmbient.length === 0 && narrowed.withheld.length > 0,
    `withheld ${narrowed.withheld.length}, remaining ambient ${stillAmbient.length}`,
  );
  check(
    "windows.list and get_active_window specifically are gone",
    !remaining.includes("windows.list") &&
      !remaining.includes("system.get_active_window") &&
      !remaining.includes("screen.capture"),
    "all three withheld",
  );
  check(
    "an explicit inventory question restores them",
    narrowForWatchScope(all, {
      watchScoped: true,
      requestText: "what apps are running?",
      scopeCapabilityIds: [],
    }).withheld.length === 0 && isInventoryRequest("what apps are running?"),
    "restored for an inventory request",
  );
  check(
    '"what can you do?" is NOT treated as an inventory request',
    !isInventoryRequest("what can you do?"),
    "not inventory",
  );
}

// ── 11. Chat and voice share the scope ────────────────────────────────────
console.log("\n— 11. chat and voice read one scope —");
{
  const chat = readFileSync("src/services/assistantTools.ts", "utf8");
  const voice = readFileSync("src/features/top-overlay/realtimeOverlay.ts", "utf8");
  check(
    "both surfaces build watch context through the shared function",
    /watchContextForPrompt/.test(chat) && /watchContextForPrompt/.test(voice),
    `chat=${/watchContextForPrompt/.test(chat)} voice=${/watchContextForPrompt/.test(voice)}`,
  );
  const store = readFileSync("src/features/watch/watchScopeStore.ts", "utf8");
  check(
    "the scope store has no local write path — Rust is the authority",
    !/localStorage\.setItem/.test(store) && /invoke<WatchScopeResult>/.test(store),
    "every mutation is a round trip",
  );
}

// ── 12. Account switch clears the scope ───────────────────────────────────
console.log("\n— 12. account switch clears the active scope —");
await fresh([DISCORD]);
await watchApplication("discord");
await setWatchScope(CONV, ["discord"]);
{
  watchBackend.switchAccount("account-b");
  clearAllWatchScopes();
  await refreshWatchSnapshot();
  const after = await refreshWatchScope(CONV);
  check(
    "the other account sees no active scope",
    after.scope.entries.length === 0,
    `entries=${after.scope.entries.length}`,
  );
  watchBackend.switchAccount("account-a");
}

// ── 13. Stop watching removes it from the scope ───────────────────────────
console.log("\n— 13. stop watching removes it from future prompts —");
await fresh([DISCORD, SPOTIFY]);
await watchApplication("discord");
await watchApplication("spotify");
await setWatchScope(CONV, ["discord", "spotify"]);
{
  await stopWatchingApplication("discord");
  const after = await refreshWatchScope(CONV);
  check(
    "the stopped application is gone from the scope",
    after.scope.entries.every((e) => e.appCatalogId !== "discord"),
    `entries=${after.scope.entries.map((e) => e.appCatalogId).join(",") || "none"}`,
  );
  const text = await watchContextForPrompt("What can you do?", CONV);
  check(
    "and gone from the prompt",
    !text.includes("## Discord"),
    "absent",
  );
}

// ── 14. Pause preserves the record ────────────────────────────────────────
console.log("\n— 14. pause stops context but keeps the watch —");
await fresh([SPOTIFY]);
await watchApplication("spotify");
await setWatchScope(CONV, ["spotify"]);
{
  await setWatchPaused("spotify", true);
  await refreshWatchSnapshot();
  const snapshot = getWatchSnapshot();
  const record = snapshot.watched.find((w) => w.appCatalogId === "spotify");
  check(
    "the watched record survives pausing",
    Boolean(record) && record?.state === "paused",
    `state=${record?.state}`,
  );
  const groups = buildRowGroups(snapshot.watched, snapshot.running, ["spotify"]);
  check(
    "the row reports Paused rather than disappearing",
    groups.watching.length === 1 && groups.watching[0].state === "paused",
    `state=${groups.watching[0]?.state}`,
  );
  await setWatchPaused("spotify", false);
}

// ── 15–18. Details modal ──────────────────────────────────────────────────
console.log("\n— 15/16/17/18. the Details modal —");
{
  const modal = readFileSync("src/components/watch/WatchModal.tsx", "utf8");
  check(
    "Details renders through a portal on document.body",
    /createPortal\(/.test(modal) && /document\.body/.test(modal),
    "portal present",
  );
  check(
    "it is positioned against the viewport, not a parent",
    /position: fixed/.test(readFileSync("src/styles/watch.css", "utf8")),
    "fixed backdrop",
  );
  const css = readFileSync("src/styles/watch.css", "utf8");
  check(
    "its size tracks the viewport at the smallest target",
    /width:\s*min\(\d+px, calc\(100vw - \d+px\)\)/.test(css) &&
      /max-height:\s*min\(\d+px, calc\(100vh - \d+px\)\)/.test(css),
    "width and height both viewport-relative",
  );
  // Asserted as a *document* listener, not a React handler on the panel. A
  // panel-level `onKeyDown` only fires for events originating inside it, so it
  // silently stops working the moment focus lands on a non-focusable element —
  // which is what the physical test caught: modal open, Escape did nothing.
  // Escape ownership is explicit, not a race. `GlobalTopOverlay` binds Escape
  // on *window* capture and calls `stopImmediatePropagation()`, so it wins over
  // anything a modal registers — the physical test found the modal open, Escape
  // pressed, and the whole window hiding instead. The stack fixes ownership:
  // innermost surface takes it, global handler stands down.
  const overlay = readFileSync("src/features/top-overlay/GlobalTopOverlay.tsx", "utf8");
  const stack = readFileSync("src/features/ui/escapeStack.ts", "utf8");
  check(
    "Escape closes the modal rather than the window behind it",
    // The modal claims Escape through the shared stack, the stack binds it on
    // window-capture (so it beats the overlay's own capture listener), and the
    // overlay stands down while a claim is held. All three are needed: the
    // physical test found Escape hiding the whole window with the modal open.
    /useEscapeOwner\(true, onClose, useEffect\)/.test(modal) &&
      /window\.addEventListener\("keydown", listener, true\)/.test(stack) &&
      /stack\[stack\.length - 1\]\?\.handler !== onEscape/.test(stack) &&
      /escapeIsClaimed\(\)/.test(overlay),
    "modal claims Escape; only the innermost claim reacts; the overlay defers",
  );
  check(
    "the panel handler is left to trap Tab only",
    /useCallback\(\s*\(event: React\.KeyboardEvent\) => \{\s*if \(event\.key !== "Tab"\) return;/.test(
      modal,
    ),
    "no competing Escape handler on the panel",
  );
  check(
    "focus returns to the opener on close",
    /openerRef\.current\?\.focus/.test(modal),
    "focus restored",
  );
  check(
    "focus is trapped while open",
    /event\.key !== "Tab"/.test(modal) && /shiftKey/.test(modal),
    "trap present",
  );
  const card = readFileSync("src/components/dashboard/RunningAppsCard.tsx", "utf8");
  check(
    "the card no longer renders a details panel inside itself",
    !/WatchDetailsPanel/.test(card) && /WatchDetailsModal/.test(card),
    "modal only",
  );
}

// ── 19 & 20. Composer icon and message metadata ───────────────────────────
console.log("\n— 19/20. composer icons and message metadata —");
{
  // The composer chip has been removed. It put a second, competing Watch
  // control next to the mode pills — application icons, a status dot and a
  // clear button — in a bar that is for composing, not for configuring. Watch
  // is managed in the Running apps card and its Manage modal, nowhere else.
  const composer = readFileSync("src/components/dashboard/CommandComposer.tsx", "utf8");
  check(
    "the composer carries no Watch chip",
    !existsSync("src/components/watch/WatchComposerPill.tsx") &&
      !/WatchComposerPill/.test(composer),
    "component deleted and unreferenced",
  );
  check(
    "no application icons, status dot or Watch pill remain in the composer",
    !/watchAppVisual|WatchAppIcons|watch-chip|watch-dot|toggle-pill-watch/.test(
      composer,
    ),
    "none",
  );
  check(
    "there is exactly one Watch control — not one per assistant reply",
    !/toggle-pill|WatchComposerPill/.test(
      readFileSync("src/components/watch/WatchSourceBadge.tsx", "utf8"),
    ),
    "the response badge carries no controls",
  );
  // The outgoing message no longer stamps one. Stamped from the active scope at
  // send time, it was a claim made before the prompt existed: a weather question
  // carried a "Discord context" badge while the relevance gate had correctly
  // excluded Discord. Only the reply is credited, and only from the trace.
  check(
    "the user message makes no claim about watched sources",
    !/watchedSources/.test(composer.slice(composer.indexOf("pushUserMessage("))),
    "no send-time stamp",
  );
  check(
    "the metadata is not appended to the user's text",
    !/text \+.*watchedSources|watchedSources.*\+ text/.test(composer),
    "structured only",
  );
  await fresh([DISCORD]);
  await watchApplication("discord");
  await setWatchScope(CONV, ["discord"]);
  const envelope = watchEnvelopeFor(CONV);
  check(
    "the envelope carries structured ids, not labels",
    envelope.contextMode === "watch" &&
      envelope.activeWatchedApplicationIds.includes("discord") &&
      envelope.activeInstanceIds.includes(DISCORD.instanceKey),
    JSON.stringify(envelope),
  );
}

// ── 21. The badge appears only when used ──────────────────────────────────
console.log("\n— 21. the source badge is earned, not automatic —");
{
  check(
    "a capability question counts as using the watched context",
    isWatchCapabilityQuestion("what can you do?") &&
      isWatchCapabilityQuestion("what is going on?") &&
      isWatchCapabilityQuestion("why does it keep crashing?"),
    "recognised",
  );
  check(
    "an unrelated question does not",
    !isWatchCapabilityQuestion("what is the capital of France?") &&
      !isWatchCapabilityQuestion("write me an email to Ana"),
    "not credited",
  );
  const service = readFileSync("src/services/AssistantService.ts", "utf8");
  // Crediting comes from this turn's provenance ledger — what reached the
  // prompt and what actually ran — never from the shape of the question or
  // from standing state that outlives the turn.
  check(
    "the reply is credited from this turn's provenance",
    /const contributed = turnContributors\(\);/.test(service) &&
      /if \(contributed\.length === 0\) return reply;/.test(service),
    "turnContributors()",
  );
}

// ── 22. Responsive rules exist for the four targets ───────────────────────
console.log("\n— 22. responsive rules cover the target sizes —");
{
  const css = readFileSync("src/styles/watch.css", "utf8");
  const card = readFileSync("src/components/dashboard/RunningAppsCard.tsx", "utf8");
  const row = readFileSync("src/components/watch/WatchRow.tsx", "utf8");
  check(
    "rows use ArcSonare's existing list language, not a private Watch style",
    /tools-list-row watch-row/.test(row) &&
      /tools-list-icon tools-list-icon-app/.test(row) &&
      /tools-list-title/.test(row) &&
      /tools-list-desc/.test(row),
    "tools-list-* throughout",
  );
  check(
    "the application icon is the standard size, not a miniature",
    /width=\{28\}\s+height=\{28\}/.test(row),
    "28px art in the existing 40px container",
  );
  check(
    "the status dot is large enough to see",
    /\.watch-dot\s*\{[^}]*width:\s*9px/.test(css) &&
      /box-shadow:\s*0 0 0 2px/.test(css),
    "9px solid centre with a dark ring",
  );
  check(
    "the dot sits beside the status text rather than on the application icon",
    /\.watch-row \.tools-list-desc \{[^}]*display: flex/.test(css) &&
      !/\.watch-dot[^}]*position:\s*absolute/.test(css),
    "inline in the description line, not overlaid",
  );
  const frame = readFileSync(
    "src/components/dashboard/PagedApplicationCard.tsx",
    "utf8",
  );
  // The card must not scroll. Popovers and modals may — they are their own
  // surfaces — so this looks at rules that apply to the card, not at the file.
  const cardRules =
    css.match(/\.(?:opened-apps|watch-row|watch-dot)[^{]*\{[^}]*\}/g) ?? [];
  check(
    "the card shows two rows and never scrolls internally",
    /export const VISIBLE_ROWS = 2;/.test(frame) &&
      !cardRules.some((rule) => /overflow(?:-y)?:\s*(?:auto|scroll)/.test(rule)),
    "two rows, no nested scroll region",
  );
  // The card expands in place on the same bottom chevron the Applications card
  // uses. A "View all" link *and* a chevron *and* a Manage button was three
  // controls for one job.
  check(
    "the bottom chevron is the only expander on the card",
    /opened-apps-page-btn/.test(frame) && !/View all applications/.test(card),
    "one control",
  );
  check(
    "the full four-section list is still reachable",
    /setManageOpen\(true\)/.test(card) && /WatchManagerModal/.test(card),
    "Manage opens the modal",
  );
  // The composer's Watch control inherits `toggle-pill` outright: no Watch rule
  // may set a height, padding or font size on it, or the composer's dimensions
  // would change with whether Watch is active.
  // Only rules on the control itself. The artwork inside it is sized like every
  // other application icon, and the popover is its own surface.
  const composerRules = (
    css.match(/\.(?:toggle-pill|watch-composer)(?![-\w])[^{]*\{[^}]*\}/g) ?? []
  ).filter((rule) => !/img/.test(rule));
  const metric = composerRules.filter((rule) =>
    /(?:^|[\s;])(?:height|padding|font-size)\s*:/.test(rule),
  );
  check(
    "the composer's own metrics are untouched",
    metric.length === 0,
    metric.length === 0 ? "no size rules on the control" : metric.join(" | "),
  );
}

// ── 23. Closed apps stay watched and rebind ───────────────────────────────
console.log("\n— 23. a closed app stays watched and rebinds —");
await fresh([SPOTIFY]);
await watchApplication("spotify");
await setWatchScope(CONV, ["spotify"]);
{
  watchBackend.stopApp("spotify");
  await refreshWatchSnapshot();
  let scope = await refreshWatchScope(CONV);
  check(
    "it is retired from the conversation but keeps its watch permission",
    scope.scope.entries.length === 0 &&
      getWatchSnapshot().watched.some((w) => w.appCatalogId === "spotify"),
    `entries=${scope.scope.entries.length} watched=${getWatchSnapshot().watched.length}`,
  );
  watchBackend.setRunning([SPOTIFY] as never[]);
  await refreshWatchSnapshot();
  scope = await refreshWatchScope(CONV);
  check(
    "reopening does not silently re-activate it",
    scope.scope.entries.length === 0,
    `entries=[${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}]`,
  );
  // But the user's own activation binds it to the *new* instance, not the one
  // that died — this is the rebinding the instance key exists for.
  scope = await setWatchScope(CONV, ["spotify"]);
  check(
    "activating it again binds the live instance",
    scope.scope.entries[0]?.running === true &&
      scope.scope.entries[0]?.boundInstanceKey === SPOTIFY.instanceKey,
    `running=${scope.scope.entries[0]?.running} bound=${scope.scope.entries[0]?.boundInstanceKey}`,
  );
}

// ── 24. Row detail never leaks an unwatched window ────────────────────────
console.log("\n— 24. unwatched rows carry identity only —");
await fresh([DISCORD, CHROME]);
await watchApplication("discord");
{
  const snapshot = getWatchSnapshot();
  const groups = buildRowGroups(snapshot.watched, snapshot.running, ["discord"]);
  const chromeRow = groups.otherRunning.find((r) => r.appCatalogId === "chrome");
  check(
    "Chrome is in Other running, not Watching",
    Boolean(chromeRow) && groups.watching.every((r) => r.appCatalogId !== "chrome"),
    `watching=[${groups.watching.map((r) => r.appCatalogId)}] other=[${groups.otherRunning.map((r) => r.appCatalogId)}]`,
  );
  const detail = chromeRow ? rowDetail(chromeRow) : "";
  check(
    "its row line never shows the window title",
    !detail.includes("compensation") && !detail.includes("Google Docs"),
    `"${detail}"`,
  );
  check(
    "toggling scope for an unwatched app is impossible",
    await toggleWatchScope(CONV, "chrome").then(
      () => false,
      () => true,
    ),
    "refused by the backend",
  );
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("All watch-context checks passed.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
