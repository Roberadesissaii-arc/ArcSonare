/**
 * Watch relevance, scope switching and live state.
 *
 * Three reported bugs, one suite:
 *
 *   1. Watch was on by default — a watched application became active by itself.
 *   2. An active application was injected into every request, including
 *      "what's the weather?" and "create a task for tomorrow".
 *   3. Switching Spotify → Discord kept answering from Spotify.
 *
 * Run: npm run test:watch-routing
 */

import { readFileSync } from "node:fs";

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  listenForWatchChanges,
  refreshWatchSnapshot,
  watchApplication,
} from "../src/features/watch/watchStore";
import {
  clearAllWatchScopes,
  getWatchScope,
  refreshWatchScope,
  setCurrentConversation,
  setWatchScope,
  toggleWatchScope,
} from "../src/features/watch/watchScopeStore";
import {
  clearWatchTurnMemory,
  lastWatchPromptTrace,
  watchContextForPrompt,
} from "../src/features/watch/watchPromptContext";
import { watchRelevance } from "../src/features/watch/watchRelevance";

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

const CONV = "conv-routing";

const SPOTIFY = {
  instanceKey: "spotify:exe:spotify-exe:0",
  appCatalogId: "spotify",
  executableName: "Spotify.exe",
  windowTitle: "Marconi Union - Weightless",
};
const DISCORD = {
  instanceKey: "discord:exe:discord-exe:0",
  appCatalogId: "discord",
  executableName: "Discord.exe",
  windowTitle: "#general | ArcSonare Testing",
};

async function fresh() {
  watchBackend.reset();
  clearAllWatchScopes();
  clearWatchTurnMemory();
  watchBackend.setRunning([SPOTIFY, DISCORD] as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

// ── Test 1 — startup default ──────────────────────────────────────────────
console.log("\n═══ Test 1 — Watch starts inactive ═══");
await fresh();
await watchApplication("spotify");
await watchApplication("discord");
{
  // A brand-new conversation, exactly as after a restart.
  const scope = await refreshWatchScope("conv-brand-new");
  check(
    "two applications are watched",
    scope !== null,
    `watched = spotify, discord`,
  );
  check(
    "no application is active in a new conversation",
    scope.scope.entries.length === 0,
    `active = [${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}] (want none)`,
  );
  check(
    "the scope was not inferred behind the user's back",
    scope.implicit === false,
    `implicit = ${scope.implicit}`,
  );
  const rust = readFileSync("src-tauri/src/watch/commands.rs", "utf8");
  check(
    "the backend no longer adopts a watched application implicitly",
    /let implicit = false;/.test(rust) && !/implicit_scope\(&snapshot\.watched\)/.test(rust),
    "no implicit adoption in scope_result",
  );
}

// ── Test 5 / relevance — unrelated requests are not hijacked ─────────────
console.log("\n═══ Test 5 — unrelated requests run normally ═══");
await fresh();
await watchApplication("discord");
await setWatchScope(CONV, ["discord"]);
for (const phrase of [
  "What is the weather?",
  "Create a task for tomorrow",
  "Open my documents folder",
  "Explain this paragraph",
  "Write an email to Ana",
  "What time is it?",
  "what's going on in the world",
]) {
  const block = await watchContextForPrompt(phrase, CONV);
  const trace = lastWatchPromptTrace();
  check(
    `"${phrase}" carries no watched context`,
    block === "" && trace?.contextMode === "global",
    `contextMode=${trace?.contextMode} chars=${block.length}`,
  );
}

// ── Relevance — requests that DO earn the context ────────────────────────
console.log("\n═══ requests that earn the watched context ═══");
for (const [phrase, why] of [
  ["what's going on", "current-activity"],
  ["what channel am I in", "application-action"],
  ["pause it", "application-action"],
  ["tell me about Discord", "named-application"],
] as const) {
  const verdict = watchRelevance({
    requestText: phrase,
    active: getWatchScope(CONV).scope.entries,
  });
  check(
    `"${phrase}" is relevant (${why})`,
    verdict.relevant && verdict.reason === why,
    `relevant=${verdict.relevant} reason=${verdict.reason}`,
  );
}
{
  // A pronoun with nothing behind it must not resolve.
  clearWatchTurnMemory();
  const cold = watchRelevance({
    requestText: "close that",
    active: getWatchScope(CONV).scope.entries,
  });
  check(
    "a bare pronoun with no previous application turn is not relevant",
    !cold.relevant,
    `relevant=${cold.relevant}`,
  );
  const warm = watchRelevance({
    requestText: "close that",
    active: getWatchScope(CONV).scope.entries,
    previousTurnApplicationIds: ["discord"],
  });
  check(
    "the same pronoun after an application turn is relevant",
    warm.relevant && warm.reason === "pronoun-continuation",
    `relevant=${warm.relevant} reason=${warm.reason}`,
  );
}

// ── Test 4 — switching active application ────────────────────────────────
console.log("\n═══ Test 4 — Spotify → Discord switches immediately ═══");
await fresh();
await watchApplication("spotify");
await watchApplication("discord");
await setWatchScope(CONV, ["spotify"]);
{
  const before = await watchContextForPrompt("what's going on", CONV);
  check(
    "with Spotify active, the context is Spotify",
    before.includes("## Spotify") && !before.includes("## Discord"),
    before.split("\n")[0],
  );

  // The user activates Discord.
  await setWatchScope(CONV, ["discord"]);
  const scope = getWatchScope(CONV);
  check(
    "active becomes Discord, and Spotify stays watched but inactive",
    scope.scope.entries.length === 1 &&
      scope.scope.entries[0].appCatalogId === "discord",
    `active = [${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}]`,
  );

  const after = await watchContextForPrompt("what's going on", CONV);
  check(
    "the next request resolves to Discord, not Spotify",
    after.includes("## Discord") && !after.includes("## Spotify"),
    after.split("\n")[0],
  );
  check(
    "no Spotify information survives into the Discord context",
    !/spotify/i.test(after),
    /spotify/i.test(after) ? "SPOTIFY LEAKED" : "absent",
  );
  const trace = lastWatchPromptTrace();
  check(
    "the trace credits Discord alone",
    trace?.includedApplicationIds.length === 1 &&
      trace.includedApplicationIds[0] === "discord",
    `included = [${trace?.includedApplicationIds.join(", ")}]`,
  );
}

// ── Previous-context invalidation ────────────────────────────────────────
console.log("\n═══ the previous application's caches are dropped ═══");
{
  const store = readFileSync("src/features/watch/watchScopeStore.ts", "utf8");
  check(
    "every scope mutation invalidates cached application state",
    (store.match(/await invalidateForScopeChange\(\);/g) ?? []).length === 3,
    `${(store.match(/await invalidateForScopeChange\(\);/g) ?? []).length} of 3 mutations invalidate`,
  );
  check(
    "invalidation clears both the adapter snapshots and the turn memory",
    /invalidateWatchSnapshots\(\)/.test(store) && /clearWatchTurnMemory\(\)/.test(store),
    "snapshots + turn memory",
  );
  // A pronoun must not reach back past a switch.
  clearWatchTurnMemory();
  const stale = watchRelevance({
    requestText: "pause it",
    active: [{ appCatalogId: "discord", displayName: "Discord", running: true }],
    previousTurnApplicationIds: ["spotify"],
  });
  check(
    "a pronoun cannot refer to the application the user just left",
    stale.reason !== "pronoun-continuation" ||
      !stale.applicationIds.includes("spotify"),
    `reason=${stale.reason} apps=[${stale.applicationIds.join(", ")}]`,
  );
}

// ── Live state — every request re-reads ──────────────────────────────────
console.log("\n═══ application state is read fresh per request ═══");
{
  const prompt = readFileSync("src/features/watch/watchPromptContext.ts", "utf8");
  check(
    "the prompt block is rebuilt from a fresh scope read, never a cache",
    /const result = await refreshWatchScope\(conversationId\);/.test(prompt) &&
      !/getWatchScope\(conversationId\)/.test(prompt),
    "refreshWatchScope on every turn",
  );
  check(
    "the model is told not to answer state questions from earlier turns",
    /Never answer from an earlier turn in this conversation/.test(prompt),
    "freshness instruction present",
  );
  const before = watchBackend.calls.scopeGet;
  await watchContextForPrompt("what's going on", CONV);
  await watchContextForPrompt("what's going on", CONV);
  check(
    "two identical requests each re-read the scope",
    watchBackend.calls.scopeGet >= before + 2,
    `scope reads: ${before} → ${watchBackend.calls.scopeGet}`,
  );
}

// ── Test 6 — closed application ──────────────────────────────────────────
console.log("\n═══ Test 6 — a closed application keeps no live state ═══");
await fresh();
await watchApplication("spotify");
await setWatchScope(CONV, ["spotify"]);
{
  watchBackend.stopApp("spotify");
  await refreshWatchSnapshot();
  const scope = await refreshWatchScope(CONV);
  check(
    "Spotify keeps its watch permission but is retired from the conversation",
    scope.scope.entries.length === 0 &&
      watchBackend.rows().some((r) => r.appCatalogId === "spotify"),
    `entries=${scope.scope.entries.length}, still watched`,
  );
  check(
    "no running-instance binding survives",
    scope.scope.entries.every((e) => e.boundInstanceKey === undefined),
    "nothing bound",
  );
  check(
    "no capability is callable while it is closed",
    scope.capabilityIds.length === 0,
    `callable = ${scope.capabilityIds.length}`,
  );
  const block = await watchContextForPrompt("what's playing", CONV);
  check(
    "the prompt says it is not running rather than reporting an old track",
    block.includes("NOT RUNNING") && !block.includes("Weightless"),
    block.includes("Weightless") ? "STALE TRACK LEAKED" : "not running, no stale track",
  );
  check(
    "no other running application is substituted for it",
    !/discord/i.test(block),
    /discord/i.test(block) ? "SUBSTITUTED Discord" : "nothing substituted",
  );
}

// ── Reopened application rebinds ─────────────────────────────────────────
console.log("\n═══ a reopened application binds to the new instance ═══");
{
  watchBackend.setRunning([SPOTIFY, DISCORD] as never[]);
  await refreshWatchSnapshot();
  let scope = await refreshWatchScope(CONV);
  check(
    "reopening alone does not put it back in the conversation",
    scope.scope.entries.length === 0,
    `entries=[${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}]`,
  );
  scope = await setWatchScope(CONV, ["spotify"]);
  check(
    "the user's own activation binds the new instance, not the one that died",
    scope.scope.entries[0]?.running === true &&
      scope.scope.entries[0]?.boundInstanceKey === SPOTIFY.instanceKey,
    `running=${scope.scope.entries[0]?.running} bound=${scope.scope.entries[0]?.boundInstanceKey}`,
  );
}

// ── Explicit activation only ─────────────────────────────────────────────
console.log("\n═══ activation is explicit ═══");
await fresh();
await watchApplication("spotify");
{
  let scope = await refreshWatchScope("conv-explicit");
  check(
    "watching an application does not activate it",
    scope.scope.entries.length === 0,
    `active = ${scope.scope.entries.length}`,
  );
  scope = await toggleWatchScope("conv-explicit", "spotify");
  check(
    "the user's explicit activation does",
    scope.scope.entries.length === 1 &&
      scope.scope.entries[0].appCatalogId === "spotify",
    `active = [${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}]`,
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Watch routing, switching and freshness all correct.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
