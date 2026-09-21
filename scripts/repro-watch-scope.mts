/**
 * The exact reported case: Discord watched, Chrome merely running.
 *
 * Prints the real model-context payload so the two failures can be inspected
 * rather than argued about:
 *
 *   1. does Chrome — running but NOT watched — contribute anything?
 *   2. does "What can you do?" produce the global assistant feature list?
 *
 * Run: npm run repro:watch-scope
 */

import { watchBackend } from "./register-watch-backend-stub.mjs";
import {
  listenForWatchChanges,
  refreshWatchSnapshot,
  watchApplication,
  getWatchSnapshot,
} from "../src/features/watch/watchStore";
import {
  refreshWatchScope,
  setWatchScope,
  watchEnvelopeFor,
} from "../src/features/watch/watchScopeStore";
import {
  lastWatchPromptTrace,
  watchContextForPrompt,
} from "../src/features/watch/watchPromptContext";
import { narrowForWatchScope } from "../src/features/watch/watchCapabilityGate";
import { capabilitiesForOrigin } from "../src/features/capabilities/connectorRegistry";
import { checkWatchResponse } from "../src/features/watch/watchResponseGuard";
import { FORBIDDEN_UNWATCHED_FIELDS } from "../src/features/watch/watchPrivacyGate";

const CONVERSATION = "conv-repro";

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

watchBackend.reset();
watchBackend.setRunning([DISCORD, CHROME] as never[]);
await listenForWatchChanges();
await refreshWatchSnapshot();

// Only Discord is watched. Chrome is running and nothing more.
await watchApplication("discord");
await setWatchScope(CONVERSATION, ["discord"]);
const scope = await refreshWatchScope(CONVERSATION);

const snapshot = getWatchSnapshot();
console.log("\n════════ machine state ════════");
console.log(`running        : ${snapshot.running.map((i) => i.appCatalogId).join(", ")}`);
console.log(`watched        : ${snapshot.watched.map((w) => w.appCatalogId).join(", ")}`);
console.log(`active (scope) : ${scope.scope.entries.map((e) => e.appCatalogId).join(", ")}`);

console.log("\n════════ the model-context payload ════════");
const block = await watchContextForPrompt("What can you do?", CONVERSATION);
console.log(block);

console.log("\n════════ envelope sent with the message ════════");
console.log(JSON.stringify(watchEnvelopeFor(CONVERSATION), null, 2));

console.log("\n════════ leak check — Chrome ════════");
const chromeSignals: Array<[string, boolean]> = [
  ["window title", /compensation|Google Docs/i.test(block)],
  ["application named", /\bchrome\b/i.test(block)],
  ["instance key", block.includes(CHROME.instanceKey)],
];
for (const [label, present] of chromeSignals) {
  console.log(`  ${label.padEnd(18)}: ${present ? "PRESENT — LEAK" : "absent"}`);
}
// Checked against the *per-application sections* only. The block's closing
// instructions deliberately name ArcSonare's global abilities in order to
// forbid them, so scanning the whole block for the word "screenshot" would
// flag the very sentence that prevents the failure.
const appSections = block.slice(block.indexOf("## "), block.indexOf("\nAnswer questions"));
console.log(`\n  content fields present in the application sections:`);
const leaked = FORBIDDEN_UNWATCHED_FIELDS.filter((field) =>
  appSections.includes(field),
);
console.log(
  leaked.length === 0 ? "    (none)" : leaked.map((f) => `    ${f}: LEAK`).join("\n"),
);

console.log("\n════════ capability retrieval ════════");
const all = capabilitiesForOrigin("chat", new Set(), snapshot.watched);
const narrowed = narrowForWatchScope(all, {
  watchScoped: true,
  requestText: "What can you do?",
  scopeCapabilityIds: scope.capabilityIds,
});
console.log(`scope capabilities   : ${scope.capabilityIds.join(", ")}`);
console.log(`withheld for privacy : ${narrowed.withheld.join(", ") || "none"}`);
console.log(`  reason             : ${narrowed.reason ?? "n/a"}`);

console.log("\n════════ response guard ════════");
const bad =
  "I can do things on your PC — open apps and websites, take screenshots, manage " +
  "your tasks, check your calendar and read your email.";
const badVerdict = checkWatchResponse({
  responseText: bad,
  requestText: "What can you do?",
  abilities: scope.abilities,
});
console.log(`the previously-shipped answer → ${badVerdict.ok ? "ACCEPTED" : "REJECTED"}`);
for (const violation of badVerdict.violations) console.log(`  - it ${violation}`);

const good =
  "For Discord I can see which controls the window exposes, tell you which server " +
  "and channel it says you're in, bring it to the front, and prepare a message for " +
  "the open channel that I'll send once you confirm. I can't read message content — " +
  "that's turned off in its privacy settings.";
const goodVerdict = checkWatchResponse({
  responseText: good,
  requestText: "What can you do?",
  abilities: scope.abilities,
});
console.log(`a correctly scoped answer     → ${goodVerdict.ok ? "ACCEPTED" : "REJECTED"}`);
for (const violation of goodVerdict.violations) console.log(`  - it ${violation}`);

console.log("\n════════ developer trace ════════");
console.log(JSON.stringify(lastWatchPromptTrace(), null, 2));
