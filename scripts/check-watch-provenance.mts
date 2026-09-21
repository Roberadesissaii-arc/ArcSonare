/**
 * Which application a reply is credited to, and when it is credited to none.
 *
 * The reported failure: a "Spotify context" badge under replies to "open the
 * nft folder", "tell me what is in that file" and "is this an Expo app?".
 * Spotify was watched, had been active, and in one case was not even running.
 * The badge came from standing state rather than from the turn, so it followed
 * the conversation around long after Spotify had stopped contributing anything.
 *
 * Provenance is now per-turn: opened empty, written to only by the prompt
 * builder and the capability executor, read only within the same turn.
 *
 * Run: npm run test:watch-provenance
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
  refreshWatchScope,
  setCurrentConversation,
  setWatchScope,
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
  applicationForCapability,
  currentTurnProvenance,
} from "../src/features/watch/watchProvenance";

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

const CONV = "conv-provenance";

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

async function fresh(running: unknown[] = [SPOTIFY, DISCORD]) {
  watchBackend.reset();
  clearAllWatchScopes();
  clearWatchTurnMemory();
  resetWatchProvenance();
  watchBackend.setRunning(running as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
}

/** One turn, exactly as `askAssistant` runs it. */
async function turn(requestText: string, capabilityCalls: string[] = []) {
  beginWatchTurn();
  const block = await watchContextForPrompt(requestText, CONV);
  for (const id of capabilityCalls) recordCapabilityCall(id);
  const credited = turnContributors();
  const provenance = currentTurnProvenance();
  endWatchTurn();
  return { block, credited, provenance };
}

// ── Objective 18 — an unrelated filesystem request credits nothing ────────
console.log("\n═══ Spotify watched, previously active, then a file request ═══");
await fresh([SPOTIFY, DISCORD]);
await watchApplication("spotify");
await setWatchScope(CONV, ["spotify"]);
{
  // The user really was talking about Spotify a moment ago.
  const before = await turn("what's playing", ["spotify.get_playback"]);
  check(
    "the Spotify turn is credited to Spotify",
    before.credited.length === 1 && before.credited[0] === "spotify",
    `credited = [${before.credited.join(", ")}]`,
  );

  // Then a filesystem request, with Spotify still watched and still active.
  const file = await turn("Open the nft folder and tell me what is inside it", [
    "filesystem.list_directory",
  ]);
  check(
    "the filesystem turn injects no watched context",
    file.block === "" && file.provenance?.watchContextUsed === false,
    `watchContextUsed=${file.provenance?.watchContextUsed} chars=${file.block.length}`,
  );
  check(
    "Spotify adapter calls = 0",
    (file.provenance?.adaptersQueried ?? []).length === 0,
    `adaptersQueried = [${(file.provenance?.adaptersQueried ?? []).join(", ")}]`,
  );
  check(
    "no Spotify badge",
    !file.credited.includes("spotify"),
    file.credited.includes("spotify") ? "SPOTIFY BADGE LEAKED" : "no badge",
  );
  check(
    "no Discord badge either",
    !file.credited.includes("discord"),
    `credited = [${file.credited.join(", ")}]`,
  );
  check(
    "the previous turn's credit did not survive into this one",
    file.credited.length === 0,
    `credited = [${file.credited.join(", ")}] (want none)`,
  );

  const followUp = await turn("Is this an Expo application?", [
    "filesystem.read_file",
  ]);
  check(
    "the follow-up project question credits nothing either",
    followUp.credited.length === 0 && followUp.block === "",
    `credited = [${followUp.credited.join(", ")}]`,
  );
  check(
    "no watched application was queried for it",
    (followUp.provenance?.adaptersQueried ?? []).length === 0,
    "0 watched-app calls",
  );
}

// ── The same, with the active application closed ─────────────────────────
console.log("\n═══ the same requests with Spotify closed ═══");
{
  watchBackend.stopApp("spotify");
  await refreshWatchSnapshot();
  await refreshWatchScope(CONV);
  const file = await turn("Tell me what is inside this file", [
    "filesystem.read_file",
  ]);
  check(
    "a closed watched application still credits nothing",
    file.credited.length === 0,
    `credited = [${file.credited.join(", ")}]`,
  );
  check(
    "and contributes no context",
    file.block === "",
    `chars=${file.block.length}`,
  );
}

// ── A relevant turn still earns its badge ────────────────────────────────
console.log("\n═══ a relevant turn is still credited ═══");
await fresh([DISCORD]);
await watchApplication("discord");
await setWatchScope(CONV, ["discord"]);
{
  const t = await turn("what channel am I in", [
    "discord_desktop.get_current_location",
  ]);
  check(
    "the Discord question is credited to Discord",
    t.credited.length === 1 && t.credited[0] === "discord",
    `credited = [${t.credited.join(", ")}]`,
  );
  check(
    "its adapter is recorded as having run",
    (t.provenance?.adaptersQueried ?? []).includes("discord"),
    `adaptersQueried = [${(t.provenance?.adaptersQueried ?? []).join(", ")}]`,
  );

  // Immediately followed by something unrelated.
  const after = await turn("What is the weather?", ["weather.get_forecast"]);
  check(
    "the very next unrelated turn is credited to nothing",
    after.credited.length === 0,
    `credited = [${after.credited.join(", ")}]`,
  );
}

// ── Credit requires a turn to be open ────────────────────────────────────
console.log("\n═══ nothing is credited outside a turn ═══");
{
  resetWatchProvenance();
  recordCapabilityCall("spotify.get_playback");
  check(
    "a capability call with no open turn credits nothing",
    turnContributors().length === 0,
    `credited = [${turnContributors().join(", ")}]`,
  );
  beginWatchTurn();
  recordCapabilityCall("spotify.get_playback");
  const during = turnContributors();
  endWatchTurn();
  check(
    "the same call inside a turn does credit",
    during.length === 1 && during[0] === "spotify",
    `credited = [${during.join(", ")}]`,
  );
  check(
    "and the credit is gone once the turn closes",
    turnContributors().length === 0,
    "the ledger does not outlive its turn",
  );
}

// ── Attribution comes from the registry, not the id's prefix ─────────────
console.log("\n═══ capabilities are attributed from the registry ═══");
{
  check(
    "a Spotify capability names Spotify",
    applicationForCapability("spotify.get_playback") === "spotify",
    `${applicationForCapability("spotify.get_playback")}`,
  );
  check(
    "a Discord capability names Discord",
    applicationForCapability("discord_desktop.get_current_location") === "discord",
    `${applicationForCapability("discord_desktop.get_current_location")}`,
  );
  check(
    "a filesystem capability names no application",
    applicationForCapability("filesystem.list_directory") === null,
    `${applicationForCapability("filesystem.list_directory")}`,
  );
  check(
    "focusing a window is not evidence that it informed the answer",
    applicationForCapability("applications.focus_watched") === null,
    "any-watched capabilities credit nothing",
  );
}

// ── Nested turns ─────────────────────────────────────────────────────────
console.log("\n═══ a turn survives the assistant re-entering itself ═══");
{
  resetWatchProvenance();
  beginWatchTurn(); // askAssistant
  recordCapabilityCall("spotify.get_playback");
  // The assistant calls itself to style or summarise the answer.
  beginWatchTurn();
  endWatchTurn();
  const afterInner = turnContributors();
  check(
    "an inner call does not wipe the outer turn's ledger",
    afterInner.length === 1 && afterInner[0] === "spotify",
    `credited = [${afterInner.join(", ")}]`,
  );
  const outer = endWatchTurn();
  check(
    "the outer turn still closes with its contributors intact",
    outer?.adaptersQueried.join(",") === "spotify",
    `[${outer?.adaptersQueried.join(", ")}]`,
  );
  check(
    "and the ledger is closed once the outermost turn ends",
    turnContributors().length === 0,
    "closed",
  );
}

// ── The executor really is the thing that records ────────────────────────
console.log("\n═══ the real execution path records the call ═══");
{
  const { executeCapabilityById } = await import(
    "../src/features/capabilities/capabilityEngine"
  );
  resetWatchProvenance();
  beginWatchTurn();
  watchBackend.capabilityResponses = {
    "spotify.play": () => ({
      callId: "c",
      capabilityId: "spotify.play",
      status: "ok",
      summary: "Playing.",
      evidence: { verified: true, method: "media-session" },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
    }),
  };
  await executeCapabilityById("spotify.play", {}, "Play the current song", {});
  const credited = turnContributors();
  endWatchTurn();
  check(
    "running spotify.play through the engine credits Spotify",
    credited.includes("spotify"),
    `credited = [${credited.join(", ")}]`,
  );
}

// ── The badge is read from the ledger and nowhere else ───────────────────
console.log("\n═══ the badge has one source ═══");
{
  const service = readFileSync("src/services/AssistantService.ts", "utf8");
  check(
    "a turn is opened before the request and closed after it",
    /beginWatchTurn\(\)/.test(service) && /endWatchTurn\(\)/.test(service),
    "opened empty, closed after the reply",
  );
  check(
    "the badge is taken from this turn's contributors",
    /const contributed = turnContributors\(\);/.test(service),
    "turnContributors()",
  );
  check(
    "it is not taken from the active scope, the question, or the last reply",
    !/isWatchCapabilityQuestion\(routingText\)\s*\?/.test(service) &&
      !/watchedSources: scope\.scope\.entries/.test(service),
    "no standing-state fallback",
  );
  const engine = readFileSync(
    "src/features/capabilities/capabilityEngine.ts",
    "utf8",
  );
  check(
    "contribution is recorded where capabilities execute, not where they are offered",
    /recordCapabilityCall\(capabilityId, args\.instance_key\);/.test(engine),
    "recorded in executeCapability, with the instance it addressed",
  );
  const composer = readFileSync(
    "src/components/dashboard/CommandComposer.tsx",
    "utf8",
  );
  check(
    "the outgoing message stamps no source of its own",
    !/watchedSources/.test(composer.slice(composer.indexOf("pushUserMessage("))),
    "the reply carries the badge, not the question",
  );
  // The credit has to survive all the way to the bubble. It did not: the store
  // accepted `watchedSources` in its extras type and then dropped it, so the
  // earned badge never rendered and the only one anyone saw was the composer's
  // send-time guess.
  const store = readFileSync("src/stores/chatStore.ts", "utf8");
  check(
    "the store actually persists the credited sources onto the reply",
    /watchedSources: extras\?\.watchedSources \?\? m\.watchedSources/.test(store),
    "resolveAssistantMessage keeps them",
  );
  const page = readFileSync("src/pages/DashboardPage.tsx", "utf8");
  check(
    "the badge is rendered on the answer and only on the answer",
    /message\.role === "assistant"[\s\S]{0,120}watchedSources/.test(page) &&
      !/message\.role === "user"[\s\S]{0,80}watchedSources/.test(page),
    "answered only, never sent",
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Every badge is earned within the turn that shows it.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
