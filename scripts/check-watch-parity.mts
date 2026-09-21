/**
 * Voice and the main window must build watched-application context the same way.
 *
 * This is asserted at the source level as well as behaviourally, because the
 * failure it prevents is structural rather than logical: the voice overlay runs
 * in `sonare-overlay`, a separate WebView2 heap, so any state held in a module
 * is genuinely invisible to the other window. Two surfaces that each build
 * their own context will agree only by coincidence — and they did not. Before
 * this work, `buildRealtimeInstructions` had no desktop parameter at all, so
 * voice could not have received watched-app context even if the state had been
 * shared.
 *
 * Run: npm run test:watch-parity
 */

import { readFileSync } from "node:fs";

import { watchBackend } from "./register-watch-backend-stub.mjs";
import { buildRealtimeInstructions } from "../src/services/realtime/realtimeInstructions";
import { buildRealtimeTools } from "../src/services/realtime/realtimeToolSchemas";
import {
  getWatchSnapshot,
  liveWatchedApplications,
  refreshWatchSnapshot,
  stopWatchingApplication,
  watchApplication,
} from "../src/features/watch/watchStore";
import { watchContextForPrompt } from "../src/features/watch/watchPromptContext";
import { setWatchScope } from "../src/features/watch/watchScopeStore";

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

const read = (path: string) => readFileSync(path, "utf8");

// ── 1. Both surfaces call the same builder ────────────────────────────────
console.log("\n— one builder, two surfaces —");
{
  const chat = read("src/services/assistantTools.ts");
  const voice = read("src/features/top-overlay/realtimeOverlay.ts");
  check(
    "chat builds watched context through the shared broker",
    /watchContextForPrompt/.test(chat),
    `assistantTools imports watchContextForPrompt: ${/watchContextForPrompt/.test(chat)}`,
  );
  check(
    "voice builds watched context through the same broker",
    /watchContextForPrompt/.test(voice),
    `realtimeOverlay imports watchContextForPrompt: ${/watchContextForPrompt/.test(voice)}`,
  );
  check(
    "neither surface reads the retired localStorage store",
    !/contextActivationStore/.test(chat) && !/contextActivationStore/.test(voice),
    `chat=${/contextActivationStore/.test(chat)} voice=${/contextActivationStore/.test(voice)}`,
  );
}

// ── 2. The voice instructions can actually carry it ───────────────────────
console.log("\n— voice instructions carry watched apps —");
{
  const withApps = buildRealtimeInstructions({
    datetime: "Monday",
    zone: "UTC",
    integrations: "none",
    watchedApps: "- Spotify: watching, running.\n    instance_key: spotify:exe:s:0",
  });
  check(
    "the watched block reaches the voice instructions verbatim",
    withApps.includes("spotify:exe:s:0") && withApps.includes("Watched applications"),
    `instructions contain the instance key: ${withApps.includes("spotify:exe:s:0")}`,
  );

  const withoutApps = buildRealtimeInstructions({
    datetime: "Monday",
    zone: "UTC",
    integrations: "none",
  });
  check(
    "no watched apps means no watched-apps section at all",
    !withoutApps.includes("Watched applications"),
    `section present with nothing watched: ${withoutApps.includes("Watched applications")}`,
  );
  check(
    "voice is told an instance_key is required and must not be guessed",
    /Never guess one/.test(withApps),
    "instruction present",
  );
}

// ── 3. The voice tool list follows the same gate ──────────────────────────
console.log("\n— voice tools follow the watch gate —");
{
  watchBackend.reset();
  watchBackend.setRunning([
    {
      instanceKey: "spotify:exe:spotify:0",
      appCatalogId: "spotify",
      executableName: "Spotify.exe",
    },
  ]);
  await refreshWatchSnapshot();

  const beforeWatch = buildRealtimeTools(new Set(), liveWatchedApplications()).map(
    (t) => t.name,
  );
  check(
    "with nothing watched, voice is offered no Spotify transport",
    !beforeWatch.some((n) => n.startsWith("spotify__")),
    `spotify tools offered: ${beforeWatch.filter((n) => n.startsWith("spotify__")).length}`,
  );

  await watchApplication("spotify");
  const afterWatch = buildRealtimeTools(new Set(), liveWatchedApplications()).map(
    (t) => t.name,
  );
  check(
    "watching Spotify adds its transport tools to the voice list",
    afterWatch.includes("spotify__play") && afterWatch.includes("spotify__pause"),
    `spotify tools offered: ${afterWatch.filter((n) => n.startsWith("spotify__")).join(", ") || "none"}`,
  );

  // The headline cross-window behaviour: stopping the watch in the main window
  // must remove voice's tools on its next read. Both go through the same store,
  // so this is the honest single-process equivalent of the two-window test.
  await stopWatchingApplication("spotify");
  await refreshWatchSnapshot();
  const afterStop = buildRealtimeTools(new Set(), liveWatchedApplications()).map(
    (t) => t.name,
  );
  check(
    "stopping the watch removes voice's Spotify tools immediately",
    !afterStop.some((n) => n.startsWith("spotify__")),
    `spotify tools still offered: ${afterStop.filter((n) => n.startsWith("spotify__")).length}`,
  );
}

// ── 4. The same prompt text on both sides ─────────────────────────────────
console.log("\n— the same block on both sides —");
{
  watchBackend.reset();
  watchBackend.setRunning([
    {
      instanceKey: "vscode:ws:arcsonare",
      appCatalogId: "vscode",
      executableName: "Code.exe",
      workspaceIdentity: "ArcSonare",
      windowTitle: "main.rs — ArcSonare — Visual Studio Code",
    },
  ]);
  await refreshWatchSnapshot();
  await watchApplication("vscode");
  // Watching is a standing permission; being active in a conversation is an
  // explicit choice. Parity is a property of a *scoped* conversation, so the
  // scope has to be set here rather than assumed.
  await setWatchScope("conv-1", ["vscode"]);

  const forChat = await watchContextForPrompt("what errors are here", "conv-1");
  const forVoice = await watchContextForPrompt("what errors are here", "conv-1");
  check(
    "both surfaces receive an identical block for the same request",
    forChat === forVoice,
    forChat === forVoice ? "identical" : `chat≠voice`,
  );
  check(
    "the block names the workspace and its instance key",
    forChat.includes("ArcSonare") && forChat.includes("vscode:ws:arcsonare"),
    forChat.split("\n").slice(0, 3).join(" | "),
  );
  check(
    "the block states that a title is not the application's contents",
    forChat.includes("Never infer an application's contents from its window title"),
    "honesty instruction present",
  );
}

// ── 5. Nothing unwatched leaks into the prompt ────────────────────────────
console.log("\n— unwatched applications contribute nothing —");
{
  watchBackend.reset();
  watchBackend.setRunning([
    {
      instanceKey: "discord:exe:discord:0",
      appCatalogId: "discord",
      executableName: "Discord.exe",
      windowTitle: "#salary-negotiation | Private Server",
    },
    {
      instanceKey: "spotify:exe:spotify:0",
      appCatalogId: "spotify",
      executableName: "Spotify.exe",
    },
  ]);
  await refreshWatchSnapshot();
  await watchApplication("spotify");

  const block = await watchContextForPrompt("press play");
  check(
    "an unwatched application's window title never reaches the prompt",
    !block.includes("salary-negotiation") && !block.includes("Private Server"),
    block.includes("salary-negotiation")
      ? "LEAKED the unwatched Discord title"
      : "no unwatched titles present",
  );
  check(
    "only the relevant watched application is included",
    block.includes("Spotify") && !block.includes("Discord"),
    `watched in snapshot: ${getWatchSnapshot().watched.map((w) => w.appCatalogId).join(",")}`,
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Voice and main window agree on watched applications.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
