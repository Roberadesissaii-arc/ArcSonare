/**
 * The exact reported failure, as a regression.
 *
 * Spotify watched and active, user says "play the current song", ArcSonare
 * answered *"I couldn't find 'that' on the screen."* — a screen capture and a
 * hunt for a UI element named by a pronoun, for a command that needs no pixels.
 *
 * Every assertion here is about the *route*, not about the wording of a reply:
 * which capability was selected, and how many times the vision, cursor and
 * screen-capture paths were touched. Those counts must be zero.
 *
 * Run: npm run test:spotify-execution
 */

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  listenForWatchChanges,
  refreshWatchSnapshot,
  watchApplication,
  getWatchSnapshot,
} from "../src/features/watch/watchStore";
import {
  clearAllWatchScopes,
  getWatchScope,
  refreshWatchScope,
  setCurrentConversation,
  setWatchScope,
} from "../src/features/watch/watchScopeStore";
import {
  retrieveCapabilities,
  routeDeterministic,
} from "../src/features/capabilities/capabilityRouter";
import {
  capabilitiesForWatchContext,
  narrowForWatchScope,
} from "../src/features/watch/watchCapabilityGate";
import {
  isDeictic,
  parseMediaIntent,
  VISION_AND_CURSOR_CAPABILITIES,
} from "../src/features/watch/mediaIntent";
import { capabilitiesForOrigin } from "../src/features/capabilities/connectorRegistry";

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

const CONV = "conv-spotify";

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
const DISCORD = {
  instanceKey: "discord:exe:discord-exe:0",
  appCatalogId: "discord",
  executableName: "Discord.exe",
  windowTitle: "#general | ArcSonare Testing",
};

/**
 * The exact setup the report describes: Spotify watched and active, YouTube
 * watched but secondary, a third application running and unwatched.
 */
async function setUpReportedState() {
  watchBackend.reset();
  clearAllWatchScopes();
  watchBackend.setRunning([SPOTIFY, YOUTUBE, DISCORD] as never[]);
  setCurrentConversation(CONV);
  await listenForWatchChanges();
  await refreshWatchSnapshot();
  await watchApplication("spotify");
  await watchApplication("youtube");
  // Only Spotify is active in this conversation; YouTube is watched but not
  // the subject, which is what makes "play the current song" unambiguous.
  await setWatchScope(CONV, ["spotify"]);
  await refreshWatchScope(CONV);
}

/**
 * The tool list the model would actually be offered, built the way
 * `capabilityEngine` builds it.
 *
 * This mirrors the *live* path deliberately. `routeDeterministic` is dead in
 * production — `capabilityEngine` says so outright: "The model chooses every
 * tool. There is deliberately no pattern-matching stage in front of it." A test
 * that asserted on the router would prove nothing about the running
 * application, which is precisely how the first version of this fix passed its
 * tests and changed nothing on screen.
 */
function offeredFor(requestText: string): string[] {
  const scoped = getWatchScope(CONV);
  const activeIds = new Set(scoped.scope.entries.map((e) => e.appCatalogId));
  const watchedApplications = getWatchSnapshot().watched.filter((w) =>
    activeIds.has(w.appCatalogId),
  );

  let retrieved = retrieveCapabilities(requestText, 6, {
    origin: "chat",
    connectedConnectors: new Set(),
    watchedApplications,
  });

  const narrowed = narrowForWatchScope(
    retrieved.map((r) => r.capability),
    {
      watchScoped: watchedApplications.length > 0,
      requestText,
      scopeCapabilityIds: scoped.capabilityIds,
    },
  );
  if (narrowed.withheld.length > 0) {
    const kept = new Set(narrowed.capabilities.map((c) => c.id));
    retrieved = retrieved.filter((r) => kept.has(r.capability.id));
    for (const capability of capabilitiesForWatchContext(watchedApplications)) {
      if (!retrieved.some((r) => r.capability.id === capability.id)) {
        retrieved.push({ capability, score: 1000 });
      }
    }
  }
  return retrieved.map((r) => r.capability.id);
}

// ── The exact command ─────────────────────────────────────────────────────
console.log("\n═══ “play the current song” ═══");
await setUpReportedState();
{
  const scope = getWatchScope(CONV);
  check(
    "active context resolved to Spotify",
    scope.scope.entries.length === 1 &&
      scope.scope.entries[0].appCatalogId === "spotify" &&
      scope.scope.entries[0].running,
    `active=[${scope.scope.entries.map((e) => e.appCatalogId).join(",")}]`,
  );

  check(
    "intent resolved to media.play",
    parseMediaIntent("play the current song") === "play",
    `intent=${parseMediaIntent("play the current song")}`,
  );

  // The live guarantee: the model is offered the media capability and is not
  // offered anything that could look at the screen.
  const live = offeredFor("play the current song");
  check(
    "the media capability is on the tool list the model actually receives",
    live.includes("spotify.play"),
    `offered=[${live.join(", ")}]`,
  );
  check(
    "the visual locator is not on that list",
    !live.includes("screen.click_target"),
    live.includes("screen.click_target") ? "OFFERED — would be selected" : "withheld",
  );

  // The deterministic router agrees, for the surfaces that still consult it.
  const route = routeDeterministic("play the current song");
  check(
    "the deterministic router also names the media adapter",
    route?.capabilityId === "spotify.play",
    `capability=${route?.capabilityId ?? "NONE"}`,
  );
  check(
    "and carries the resolved Spotify instance",
    route?.arguments.instance_key === SPOTIFY.instanceKey,
    `instance_key=${route?.arguments.instance_key}`,
  );

  // The counters the report asks for. A deterministic route that names
  // `spotify.play` cannot reach any of these, and none is even offered.
  const offered = offeredFor("play the current song");
  const counts = {
    "screen capture": offered.filter((id) => id === "screen.capture").length,
    "visual locator": offered.filter((id) => id === "screen.click_target").length,
    OCR: offered.filter((id) => id === "screen.understand").length,
    "cursor movement": offered.filter((id) => id.startsWith("input.")).length,
    "mouse click": offered.filter((id) => id === "input.click_at").length,
    "UI locator": offered.filter((id) => id.startsWith("annotations.")).length,
  };
  for (const [label, count] of Object.entries(counts)) {
    check(`${label} count = 0`, count === 0, `${count}`);
  }
  check(
    "no vision or cursor capability survives the narrowing at all",
    offered.every((id) => !VISION_AND_CURSOR_CAPABILITIES.has(id)),
    offered.filter((id) => VISION_AND_CURSOR_CAPABILITIES.has(id)).join(", ") || "none",
  );
}

// ── The failure sentence must be unreachable ──────────────────────────────
console.log("\n═══ the reported sentence is unreachable ═══");
{
  const route = routeDeterministic("play the current song");
  // `screen.click_target` is the only capability that produces
  // "I couldn't find X on the screen." Not selecting it is what makes the
  // sentence impossible for this request.
  check(
    'the response cannot be "I couldn\'t find “that” on the screen."',
    route?.capabilityId !== "screen.click_target" &&
      !offeredFor("play the current song").includes("screen.click_target"),
    "screen.click_target is neither routed to nor offered",
  );
}

// ── Pronouns resolve through scope, never through the locator ─────────────
console.log("\n═══ pronouns resolve through the Watch scope ═══");
for (const phrase of ["it", "that", "this", "the current one", "the current song"]) {
  check(
    `"${phrase}" is recognised as deictic, not as a control name`,
    isDeictic(phrase),
    "deictic",
  );
}
for (const [phrase, expected] of [
  ["pause it", "spotify.pause"],
  ["resume it", "spotify.play"],
  ["resume that", "spotify.play"],
  ["next song", "spotify.next"],
  ["skip this song", "spotify.next"],
  ["previous song", "spotify.previous"],
  ["go to the previous one", "spotify.previous"],
  ["what song is playing?", "spotify.get_playback"],
  ["stop", "spotify.pause"],
] as const) {
  const route = routeDeterministic(phrase);
  check(
    `"${phrase}" → ${expected}`,
    route?.capabilityId === expected,
    `${route?.capabilityId ?? "NONE"}`,
  );
  const offered = offeredFor(phrase);
  check(
    `"${phrase}" offers no vision or cursor tool`,
    offered.every((id) => !VISION_AND_CURSOR_CAPABILITIES.has(id)),
    offered.filter((id) => VISION_AND_CURSOR_CAPABILITIES.has(id)).join(", ") || "none",
  );
}

// ── Context stays on Spotify across follow-ups ────────────────────────────
console.log("\n═══ the context stays attached across turns ═══");
{
  for (const phrase of ["pause it", "resume it", "next song", "previous song"]) {
    const route = routeDeterministic(phrase);
    check(
      `"${phrase}" still targets the same Spotify instance`,
      route?.arguments.instance_key === SPOTIFY.instanceKey,
      `instance_key=${route?.arguments.instance_key}`,
    );
  }
}

// ── Reads come only from the watched player ───────────────────────────────
console.log("\n═══ “what song is playing?” reads only Spotify ═══");
{
  const route = routeDeterministic("what song is playing?");
  check(
    "it reads the watched Spotify session",
    route?.capabilityId === "spotify.get_playback" &&
      route?.arguments.instance_key === SPOTIFY.instanceKey,
    `${route?.capabilityId} on ${route?.arguments.instance_key}`,
  );
  const offered = offeredFor("what song is playing?");
  check(
    "it cannot inspect Chrome, Discord or YouTube windows",
    !offered.includes("windows.list") &&
      !offered.includes("system.get_active_window") &&
      !offered.includes("screen.capture"),
    "ambient window reads withheld",
  );
}

// ── Not every "play" is transport ─────────────────────────────────────────
console.log("\n═══ list picks and content requests are left alone ═══");
for (const phrase of [
  "play the second video",
  "play some jazz",
  "play the playlist",
  "open Spotify",
  "show me Spotify",
]) {
  const route = routeDeterministic(phrase);
  check(
    `"${phrase}" is not hijacked by the transport route`,
    route?.capabilityId !== "spotify.play",
    `capability=${route?.capabilityId ?? "model tool-selection"}`,
  );
}
{
  // "Open" and "show me" are application actions, not drawings on the screen.
  const open = routeDeterministic("open spotify");
  check(
    '"open Spotify" launches or focuses natively',
    open?.capabilityId === "applications.open",
    `capability=${open?.capabilityId}`,
  );
  const show = routeDeterministic("show me spotify");
  check(
    '"show me Spotify" does not become a visual point/highlight',
    show?.capabilityId !== "screen.click_target" &&
      show?.capabilityId !== "annotations.point_at",
    `capability=${show?.capabilityId ?? "model tool-selection"}`,
  );
}

// ── Two watched players: ask, never guess, never look ─────────────────────
console.log("\n═══ two active players require a choice ═══");
{
  await setWatchScope(CONV, ["spotify", "youtube"]);
  await refreshWatchScope(CONV);
  const route = routeDeterministic("play the current song");
  check(
    "with two players active, nothing is auto-selected",
    route === null,
    `route=${route?.capabilityId ?? "null (the conversation asks which)"}`,
  );
  const offered = offeredFor("play the current song");
  check(
    "and the visual locator is still not offered as a fallback",
    offered.every((id) => !VISION_AND_CURSOR_CAPABILITIES.has(id)),
    offered.filter((id) => VISION_AND_CURSOR_CAPABILITIES.has(id)).join(", ") || "none",
  );
}

// ── Nothing watched: normal behaviour is untouched ────────────────────────
console.log("\n═══ with nothing watched, routing is unchanged ═══");
{
  watchBackend.reset();
  clearAllWatchScopes();
  watchBackend.setRunning([SPOTIFY] as never[]);
  setCurrentConversation("conv-empty");
  await refreshWatchSnapshot();
  const route = routeDeterministic("play the current song");
  check(
    "no watched player means the transport route stays out of the way",
    route?.capabilityId !== "spotify.play",
    `capability=${route?.capabilityId ?? "model tool-selection"}`,
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Spotify execution routes through the media session, with no vision.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
