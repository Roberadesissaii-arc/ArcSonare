/**
 * Watch state is read at request time, never remembered.
 *
 * The reported symptom: the user changed the song in Spotify, asked what was
 * playing, and got the *previous* track back. Three separate places can cause
 * that, and this suite covers each one:
 *
 *   1. The prompt block carrying a track at all — a value written into the
 *      prompt is by definition as old as the prompt.
 *   2. The adapter snapshot cache surviving a change it should have been
 *      invalidated by.
 *   3. The read itself being served from memory instead of the live session.
 *
 * Run: npm run test:watch-realtime
 */

import { readFileSync } from "node:fs";

import { invoke } from "@tauri-apps/api/core";

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  getWatchSnapshot,
  listenForWatchChanges,
  refreshWatchSnapshot,
  watchApplication,
} from "../src/features/watch/watchStore";
import { buildRowGroups, runningRows } from "../src/components/watch/watchRows";
import {
  clearAllWatchScopes,
  refreshWatchScope,
  setCurrentConversation,
  setWatchScope,
} from "../src/features/watch/watchScopeStore";
import {
  clearWatchTurnMemory,
  watchContextForPrompt,
} from "../src/features/watch/watchPromptContext";
import { invalidateWatchSnapshots } from "../src/features/watch/watchContextBroker";

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

const CONV = "conv-realtime";

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

/** What the fake machine is playing right now. Tests move it between turns. */
let nowPlaying = "Weightless — Marconi Union";

async function fresh() {
  watchBackend.reset();
  clearAllWatchScopes();
  clearWatchTurnMemory();
  invalidateWatchSnapshots();
  watchBackend.setRunning([SPOTIFY, DISCORD] as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
  watchBackend.capabilityResponses = {
    "spotify.get_playback": () => ({
      callId: "c",
      capabilityId: "spotify.get_playback",
      status: "ok",
      summary: nowPlaying,
      evidence: { verified: true, method: "media-session" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
    }),
  };
}

// ── The prompt carries no state, only the way to read it ──────────────────
console.log("\n═══ the prompt block never contains a track ═══");
await fresh();
await watchApplication("spotify");
await setWatchScope(CONV, ["spotify"]);
{
  const block = await watchContextForPrompt("what's playing", CONV);
  check(
    "the block names Spotify and offers reading what is playing",
    block.includes("## Spotify") &&
      block.includes("What you can do right now:") &&
      /See what is playing/.test(block),
    /See what is playing/.test(block)
      ? "the read is offered as something to do, not as an answer"
      : "read ability missing",
  );
  check(
    "no track, artist or album value is baked into the prompt",
    !/Weightless|Marconi Union/.test(block),
    /Weightless/.test(block) ? "A TRACK WAS BAKED IN" : "no track in the prompt",
  );
  check(
    "the model is told to read the state on this turn rather than recall it",
    /Never answer from an earlier turn in this conversation/.test(block) ||
      /Never answer from an earlier turn in this conversation/.test(
        readFileSync("src/features/watch/watchPromptContext.ts", "utf8"),
      ),
    "freshness instruction present",
  );
}

// ── A read reflects a change made outside ArcSonare ───────────────────────
console.log("\n═══ a track changed in Spotify is what the next read returns ═══");
{
  const first = (await invoke("capability_execute", {
    capabilityId: "spotify.get_playback",
    args: { instance_key: SPOTIFY.instanceKey },
  })) as { summary: string };
  check(
    "the first read returns what is playing",
    first.summary === "Weightless — Marconi Union",
    first.summary,
  );

  // The user changes the song in Spotify. Nothing tells ArcSonare.
  nowPlaying = "Nightcall — Kavinsky";

  const second = (await invoke("capability_execute", {
    capabilityId: "spotify.get_playback",
    args: { instance_key: SPOTIFY.instanceKey },
  })) as { summary: string };
  check(
    "the next read returns the NEW track, not the previous one",
    second.summary === "Nightcall — Kavinsky",
    second.summary,
  );
  check(
    "each read is its own backend call — nothing was served from memory",
    watchBackend.capabilityCalls.filter((c) => c === "spotify.get_playback")
      .length === 2,
    `${watchBackend.capabilityCalls.length} capability call(s)`,
  );
}

// ── The read goes to the live session in Rust ─────────────────────────────
console.log("\n═══ the Rust read has nothing to go stale ═══");
{
  const media = readFileSync("src-tauri/src/watch/media.rs", "utf8");
  check(
    "the media module holds no cached session between calls",
    !/static\s+\w+\s*:\s*(?:Lazy|OnceLock|Mutex)/.test(media) &&
      !/lazy_static/.test(media),
    "every call queries the transport controls",
  );
  const adapters = readFileSync("src-tauri/src/watch/adapters.rs", "utf8");
  check(
    "playback is verified by re-reading after the command, not assumed",
    /let before = media::session_for\(/.test(adapters) &&
      /let sample = media::session_for\(/.test(adapters),
    "before/after readback around every transport command",
  );
  check(
    "the readback is polled to a deadline, not sampled once",
    /let deadline =/.test(adapters) && /Instant::now\(\) >= deadline/.test(adapters),
    "polled until the state moves or the deadline passes",
  );
}

// ── Invalidation on every event that can change state ─────────────────────
console.log("\n═══ cached reads are dropped whenever the world moves ═══");
{
  const store = readFileSync("src/features/watch/watchStore.ts", "utf8");
  check(
    "an application stopping drops its cached snapshot",
    /app-instance-stopped[\s\S]{0,400}invalidateWatchSnapshots/.test(store) ||
      /invalidateWatchSnapshots\(event\.instanceKey\)/.test(store),
    "invalidated on stop",
  );
  check(
    "a rebind drops every cached snapshot",
    /invalidateWatchSnapshots\(\);/.test(store),
    "invalidated on rebind",
  );
  const scopeStore = readFileSync(
    "src/features/watch/watchScopeStore.ts",
    "utf8",
  );
  check(
    "switching the active application drops them too",
    /invalidateWatchSnapshots\(\)/.test(scopeStore),
    "invalidated on scope change",
  );
}

// ── Switching applications mid-conversation ──────────────────────────────
console.log("\n═══ switching applications takes effect on the next turn ═══");
await fresh();
await watchApplication("spotify");
await watchApplication("discord");
await setWatchScope(CONV, ["spotify"]);
{
  const before = await watchContextForPrompt("what's going on", CONV);
  await setWatchScope(CONV, ["discord"]);
  const after = await watchContextForPrompt("what's going on", CONV);
  check(
    "the turn immediately after the switch is about the new application",
    before.includes("## Spotify") && after.includes("## Discord"),
    `${before.split("\n")[0]} → ${after.split("\n")[0]}`,
  );
  check(
    "nothing about the old application is still offered",
    !/spotify/i.test(after) && !/See what is playing/.test(after),
    /spotify/i.test(after) ? "SPOTIFY SURVIVED THE SWITCH" : "none",
  );
  check(
    "the instance key in the block belongs to the new application",
    !after.includes(SPOTIFY.instanceKey),
    after.includes(SPOTIFY.instanceKey) ? "STALE INSTANCE KEY" : "Discord's own",
  );
}

// ── A closed application reports closed, not remembered ──────────────────
console.log("\n═══ a closed application never answers from memory ═══");
await fresh();
await watchApplication("spotify");
await setWatchScope(CONV, ["spotify"]);
{
  await watchContextForPrompt("what's playing", CONV);
  watchBackend.stopApp("spotify");
  await refreshWatchSnapshot();
  const block = await watchContextForPrompt("what's playing", CONV);
  check(
    "the block says it is not running",
    block.includes("NOT RUNNING"),
    block.includes("NOT RUNNING") ? "reported closed" : "still claims live",
  );
  check(
    "nothing it was playing before survives",
    !/Weightless|Nightcall|Marconi|Kavinsky/.test(block),
    /Weightless|Nightcall/.test(block) ? "STALE TRACK LEAKED" : "no stale track",
  );
  check(
    "the only thing offered is reopening it",
    /Open Spotify/.test(block) &&
      !/See what is playing/.test(block) &&
      !/Skip to the next track/.test(block),
    /See what is playing/.test(block)
      ? "STILL OFFERED AS CALLABLE"
      : "reopen only — nothing readable or controllable",
  );
}

// ── Objective 17 — the compact card holds running applications only ──────
console.log("\n═══ closing an application removes its row ═══");
await fresh();
{
  const CHROME = {
    instanceKey: "chrome:exe:chrome-exe:0",
    appCatalogId: "chrome",
    executableName: "chrome.exe",
    windowTitle: "ArcSonare — Google Chrome",
  };
  watchBackend.setRunning([SPOTIFY, CHROME, DISCORD] as never[]);
  await refreshWatchSnapshot();
  await watchApplication("spotify");
  await watchApplication("chrome");
  await watchApplication("discord");
  await setWatchScope(CONV, ["spotify"]);

  const snapshot = getWatchSnapshot();
  const before = runningRows(
    buildRowGroups(snapshot.watched, snapshot.running, ["spotify"]),
  );
  check(
    "all three running applications are in the list",
    before.length === 3,
    `[${before.map((r) => r.displayName).join(", ")}]`,
  );
  check(
    "the active one sorts first, so it never pages out of view",
    before[0]?.appCatalogId === "spotify",
    `first = ${before[0]?.appCatalogId}`,
  );

  // Spotify quits.
  watchBackend.stopApp("spotify");
  await refreshWatchSnapshot();
  const scope = await refreshWatchScope(CONV);
  const after = runningRows(
    buildRowGroups(getWatchSnapshot().watched, getWatchSnapshot().running, [
      "spotify",
    ]),
  );
  check(
    "Spotify is gone from Running apps",
    !after.some((r) => r.appCatalogId === "spotify"),
    `[${after.map((r) => r.displayName).join(", ")}]`,
  );
  check(
    "Chrome and Discord are the two rows that remain",
    after.length === 2 &&
      after.map((r) => r.appCatalogId).sort().join(",") === "chrome,discord",
    `[${after.map((r) => r.appCatalogId).join(", ")}]`,
  );
  check(
    "no row in the compact card claims to be watched but not running",
    after.every((r) => r.instances.length > 0),
    "every row has a live instance",
  );
  check(
    "Spotify keeps its watch permission for the manager",
    getWatchSnapshot().watched.some((w) => w.appCatalogId === "spotify"),
    "still watched",
  );
  check(
    "its running-instance binding is cleared",
    scope.scope.entries.find((e) => e.appCatalogId === "spotify")
      ?.boundInstanceKey === undefined,
    `bound = ${scope.scope.entries.find((e) => e.appCatalogId === "spotify")?.boundInstanceKey}`,
  );
  check(
    "no capability of its is callable",
    scope.capabilityIds.length === 0,
    `callable = ${scope.capabilityIds.length}`,
  );
  const block = await watchContextForPrompt("what's playing", CONV);
  check(
    "and it answers that it is not running rather than with the old track",
    block.includes("NOT RUNNING") && !/Weightless|Nightcall/.test(block),
    /Weightless|Nightcall/.test(block) ? "STALE TRACK" : "not running, no track",
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Watch state is live: nothing is answered from a previous turn.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
