/**
 * The chat repair, asserted where it can be asserted without a live model.
 *
 * Four separate claims, each of which failed in the running application:
 *
 *   1. A connection question reaches a connection tool — the model is only ever
 *      as good as the schemas it is offered, and `connections.get_status` has to
 *      outrank `web.search` for "is YouTube connected?".
 *   2. "Show me here" after a YouTube search does not read the Desktop and does
 *      not fire a blind click.
 *   3. The reply plan hides model/provider metadata, blocks a repeated name,
 *      and stops a follow-up re-announcing a discovery.
 *   4. Progress text never names a vendor.
 *
 * Run: npx tsx --import ./scripts/register-asset-stub.mjs scripts/check-chat-presentation.mts
 */

import { readFileSync, readdirSync } from "node:fs";
import { buildAppIconIndex } from "../src/config/appIconMatch";
import { retrieveCapabilities } from "../src/features/capabilities/capabilityRouter";
import { getCapability } from "../src/features/capabilities/capabilityRegistry";
import {
  resolveServiceId,
  summarizeConnection,
} from "../src/features/capabilities/connectionStatus";
import {
  buildResponsePlan,
  sourceForCapabilityId,
} from "../src/features/conversation/responsePlan";
import {
  recordEntitiesFromResult,
  resolvePronounArguments,
} from "../src/features/conversation/productionBridge";
import {
  noteUserNameUsed,
  recordTurn,
  resetConversationContextForTest,
  shouldUseUserName,
} from "../src/features/conversation/conversationContext";
import { safeProgressText } from "../src/components/chat/ThinkingTool";
import { judgeFinalText } from "../src/features/capabilities/finalTextJudge";
import {
  labelForStatus,
  reduceStatus,
  thoughtSteps,
} from "../src/features/chat/statusReducer";
import { buildFinalResponseContract } from "../src/features/conversation/responsePlan";
import { stripGreetingName } from "../src/services/nameGreeting";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

function ok(capabilityId: string, data: Record<string, unknown>): ToolResult {
  return {
    callId: "t",
    capabilityId,
    status: "success",
    summary: "done",
    evidence: { verified: true, method: "state-readback" },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1,
    data,
  };
}

// ── 1. Connection questions reach a connection tool ────────────────────────
console.log("\n— connection questions —");
for (const q of [
  "can you check if youtube is connected",
  "is youtube connected",
  "is my spotify connected",
  "did discord connect properly",
]) {
  const ranked = retrieveCapabilities(q, 8).map((r) => r.capability.id);
  const top = ranked[0];
  check(
    `"${q}" ranks the connection tool first`,
    top === "connections.get_status",
    ranked.slice(0, 3).join(", "),
  );
  const searchIndex = ranked.indexOf("web.search");
  check(
    `"${q}" does not prefer a web search`,
    searchIndex === -1 || searchIndex > ranked.indexOf("connections.get_status"),
    searchIndex === -1 ? "web.search not offered" : `web.search at #${searchIndex + 1}`,
  );
}

const conn = getCapability("connections.get_status");
check(
  "the connection tool description separates check from open and search",
  Boolean(
    conn &&
      /does NOT open/i.test(conn.description) &&
      /does NOT search/i.test(conn.description) &&
      /web\.search/.test(conn.description),
  ),
  conn ? `${conn.description.slice(0, 72)}…` : "missing",
);

// This used to assert `web.search`. It now asserts the connected adapter: a
// YouTube question is answered from the user's own connection and shown in
// chat, not by throwing a browser tab at them. What has not changed is that it
// must never be read as a search of the local disk.
check(
  "a YouTube search routes to the connected adapter, not the local disk",
  retrieveCapabilities("can you find Cleo Abram on YouTube", 6)[0].capability.id ===
    "youtube.search",
  retrieveCapabilities("can you find Cleo Abram on YouTube", 6)
    .map((r) => r.capability.id)
    .slice(0, 3)
    .join(", "),
);

// ── 2. Service resolution and honest wording ───────────────────────────────
console.log("\n— service resolution —");
check("youtube resolves", resolveServiceId("YouTube") === "youtube", String(resolveServiceId("YouTube")));
check("my youtube resolves", resolveServiceId("my YouTube") === "youtube", String(resolveServiceId("my YouTube")));
check("gmail alias resolves", resolveServiceId("gmail") === "gmail", String(resolveServiceId("gmail")));
check(
  "an unknown service is refused rather than guessed",
  resolveServiceId("blorptron") === null,
  String(resolveServiceId("blorptron")),
);
// The footer icon comes from the same resolution, so an app the user has in
// Connect must reach its Connect id — that is what makes chat and Connect show
// the same logo.
for (const [name, want] of [
  ["Discord", "discord"],
  ["Spotify", "spotify"],
  ["Notion", "notion"],
  ["Google Drive", "googleDrive"],
] as const) {
  check(
    `"${name}" reaches its Connect icon id`,
    resolveServiceId(name) === want,
    String(resolveServiceId(name)),
  );
}
check(
  "an unverifiable connection is not reported as working",
  summarizeConnection({
    displayName: "YouTube",
    state: "error",
    credentialPresent: true,
    capabilities: [],
  }).includes("could not verify"),
  summarizeConnection({
    displayName: "YouTube",
    state: "error",
    credentialPresent: true,
    capabilities: [],
  }),
);

// ── 3. Surface follow-up: "show me here" after a YouTube search ────────────
console.log("\n— youtube surface follow-up —");
resetConversationContextForTest();
recordTurn("user", "can you find Cleo Abram on YouTube");
recordEntitiesFromResult(
  "web.search",
  ok("web.search", {
    url: "https://www.youtube.com/results?search_query=Cleo%20Abram",
    site: "youtube",
    query: "Cleo Abram",
  }),
);
recordTurn("user", "show me here");

const desktopAttempt = resolvePronounArguments(
  "filesystem.list_known_folder",
  { folder: "desktop" },
  "show me here",
);
check(
  "a Desktop listing cannot answer “here” on YouTube",
  desktopAttempt.kind === "clarify" &&
    desktopAttempt.question.includes("Cleo Abram") &&
    desktopAttempt.question.includes("YouTube"),
  desktopAttempt.kind === "clarify" ? desktopAttempt.question : desktopAttempt.kind,
);

const blindClick = resolvePronounArguments(
  "screen.click_target",
  { target: "the result" },
  "show me here",
);
check(
  "a click with no named target is refused, not aimed",
  blindClick.kind === "clarify",
  blindClick.kind === "clarify" ? blindClick.question : JSON.stringify(blindClick),
);

const namedClick = resolvePronounArguments(
  "screen.click_target",
  { target: "play button" },
  "click the play button here",
);
check(
  "a click the user actually named still runs",
  namedClick.kind === "unchanged",
  namedClick.kind,
);

// ── 4. Response plan: metadata, name policy, discovery ─────────────────────
console.log("\n— response plan —");
const searchPlan = buildResponsePlan({
  capabilityId: "web.search",
  result: ok("web.search", { site: "youtube", query: "Cleo Abram" }),
  facts: "Opened a youtube search.",
});
check(
  "a YouTube search shows a YouTube badge, not a model name",
  searchPlan.source.iconKey === "youtube" &&
    searchPlan.source.label === "YouTube results opened" &&
    !/deepseek|model|provider/i.test(searchPlan.source.label),
  `${searchPlan.source.iconKey} · ${searchPlan.source.label}`,
);
check(
  "technical details stay out of the plan",
  searchPlan.showTechnicalDetails === false,
  String(searchPlan.showTechnicalDetails),
);
check(
  "no plan label leaks a capability id",
  ![
    sourceForCapabilityId("filesystem.list_known_folder").label,
    sourceForCapabilityId("screen.click_target").label,
    sourceForCapabilityId("tasks.update").label,
    searchPlan.source.label,
  ].some((l) => /\./.test(l)),
  [
    sourceForCapabilityId("filesystem.list_known_folder").label,
    sourceForCapabilityId("tasks.update").label,
  ].join(" | "),
);

resetConversationContextForTest();
recordTurn("user", "find books");
const found = ok("desktop.find_item", {
  name: "books",
  path: "C:\\Users\\me\\Desktop\\books",
});
recordEntitiesFromResult("desktop.find_item", found);
const discovery = buildResponsePlan({
  capabilityId: "desktop.find_item",
  result: found,
  facts: "Found books on the Desktop.",
});
check(
  "the first mention counts as a discovery",
  discovery.newlyDiscovered && discovery.entityRef === "books",
  `newlyDiscovered=${discovery.newlyDiscovered} ref=${discovery.entityRef}`,
);
check(
  "a discovery offers open and highlight, and no more",
  discovery.actions.length === 2 &&
    discovery.actions.every((a) => Boolean(getCapability(a.capabilityId))),
  discovery.actions.map((a) => `${a.label}→${a.capabilityId}`).join(", "),
);

// Next turn: the same folder, now highlighted.
if (discovery.mayUseName) noteUserNameUsed();
recordTurn("user", "highlight it");
const highlighted = ok("screen.highlight_target", {
  name: "books",
  path: "C:\\Users\\me\\Desktop\\books",
});
recordEntitiesFromResult("screen.highlight_target", highlighted);
const followUp = buildResponsePlan({
  capabilityId: "screen.highlight_target",
  result: highlighted,
  facts: "Border drawn around books.",
});
check(
  "the follow-up is not allowed to re-announce the find",
  followUp.newlyDiscovered === false,
  `newlyDiscovered=${followUp.newlyDiscovered}`,
);
check(
  "the follow-up may not use the name again",
  followUp.mayUseName === false && shouldUseUserName() === false,
  `mayUseName=${followUp.mayUseName}`,
);
check(
  "the follow-up suggests opening the folder, not finding it again",
  followUp.actions.length === 1 && followUp.actions[0].capabilityId === "filesystem.open_item",
  followUp.actions.map((a) => a.label).join(", ") || "(none)",
);

// A badge names what happened. Observed live: "Show me here" was answered with
// a clarifying question and the footer still read "Highlighted on screen" — the
// label of the action the model asked for, not of the one that ran.
const clarifyPlan = buildResponsePlan({
  capabilityId: "screen.highlight_target",
  result: {
    ...ok("screen.highlight_target", { clarification: true }),
    status: "needs-confirmation",
    summary: "Do you want me to show that here in chat, or bring YouTube to the front?",
  },
  facts: "Do you want me to show that here in chat, or bring YouTube to the front?",
});
check(
  "a clarification does not claim the action happened",
  clarifyPlan.outcome === "clarification" &&
    !/highlight/i.test(clarifyPlan.source.label) &&
    clarifyPlan.actions.length === 0,
  `${clarifyPlan.outcome} · ${clarifyPlan.source.label}`,
);
check(
  "a clarification never uses the name",
  clarifyPlan.mayUseName === false,
  `mayUseName=${clarifyPlan.mayUseName}`,
);

const failedPlan = buildResponsePlan({
  capabilityId: "applications.open",
  result: {
    ...ok("applications.open", {}),
    status: "error",
    summary: "Could not find that app.",
  },
  facts: "Could not find that app.",
});
check(
  "a failure offers no follow-up actions and no name",
  failedPlan.outcome === "failure" &&
    failedPlan.actions.length === 0 &&
    failedPlan.mayUseName === false,
  `${failedPlan.outcome} actions=${failedPlan.actions.length}`,
);

// ── 4b. The name rule survives a model that ignores it ─────────────────────
//
// Observed live: with the cooldown active and the prompt saying "do NOT use the
// name in this reply", the reply came back "Hey Robera, opened a youtube
// search…". A prompt is a request; this is the guarantee.
console.log("\n— name greeting —");
for (const [text, name, want] of [
  ['Hey Robera, opened a YouTube search for "Cleo Abram".', "Robera", 'Opened a YouTube search for "Cleo Abram".'],
  ["Robera — the books folder is highlighted now.", "Robera", "The books folder is highlighted now."],
  ["Opened the folder, Robera.", "Robera", "Opened the folder."],
] as const) {
  check(
    `"${text.slice(0, 34)}…" loses the greeting`,
    stripGreetingName(text, name) === want,
    stripGreetingName(text, name),
  );
}
check(
  "a reply that is allowed the name keeps it",
  stripGreetingName("Hey Robera, all set.", null) === "Hey Robera, all set.",
  stripGreetingName("Hey Robera, all set.", null),
);
check(
  "the name inside real content is left alone",
  stripGreetingName("Your file Robera.txt is on the Desktop.", "Robera") ===
    "Your file Robera.txt is on the Desktop.",
  stripGreetingName("Your file Robera.txt is on the Desktop.", "Robera"),
);

// The deterministic fallback builds its own "Hey {name}, " opening. It is used
// at three exits, and the name decision used to be made after it — so every
// fallback reply wrote the greeting the policy had just forbidden.
const styleSource = readFileSync("src/services/styleAssistantOutput.ts", "utf8");
const namePos = styleSource.indexOf("const mayUseName =");
const fallbackPos = styleSource.indexOf("const naturalFallback =");
check(
  "the name policy is decided before the fallback is built",
  namePos > 0 && fallbackPos > namePos,
  namePos > 0 && fallbackPos > namePos ? "policy first" : "fallback first",
);
check(
  "the fallback is name-enforced too, not just the model text",
  /const naturalFallback = enforceName\(/.test(styleSource),
  /const naturalFallback = enforceName\(/.test(styleSource)
    ? "enforced"
    : "unenforced",
);


// ── 7. Final-response provenance ───────────────────────────────────────────
//
// The second provider call was already happening — the model saw the verified
// tool result and wrote a reply — and the engine threw that sentence away and
// substituted a template. Every successful action therefore produced the same
// handful of shapes. The judge is the gate that lets the model's wording
// through while keeping the facts deterministic.
console.log("\n— final-response provenance —");
check(
  "a natural model sentence is accepted",
  judgeFinalText(
    'The Cleo Abram results are open on YouTube. Want me to open the first video?',
    'Opened a YouTube search for "Cleo Abram".',
  ).ok,
  "accepted",
);
for (const [text, facts, reason] of [
  ["", "Opened a YouTube search.", "model-returned-empty"],
  [
    "I ran web.search for you.",
    "Opened a YouTube search.",
    "model-leaked-internal-id",
  ],
  [
    "DeepSeek opened the search.",
    "Opened a YouTube search.",
    "model-leaked-provider-metadata",
  ],
  [
    "I couldn't open that.",
    "Opened a YouTube search.",
    "model-claimed-failure",
  ],
  [
    "All set — it's open.",
    "Couldn't find that app.",
    "model-claimed-success",
  ],
] as const) {
  const verdict = judgeFinalText(text, facts);
  check(
    `rejected: ${reason}`,
    !verdict.ok && verdict.reason === reason,
    verdict.ok ? "accepted" : verdict.reason,
  );
}

const contract = buildFinalResponseContract({
  originalRequest: "highlight it",
  plan: {
    outcome: "success",
    facts: "Border drawn around books.",
    entityLabel: "books",
    entityRef: "books",
    newlyDiscovered: false,
    mayUseName: false,
    source: { iconKey: "folder", label: "Highlighted on screen" },
    actions: [
      {
        id: "open-item",
        label: "Open folder",
        capabilityId: "filesystem.open_item",
        args: { path: "C:/x/books" },
      },
    ],
    showTechnicalDetails: false,
  },
  action: "draw a border",
  verifiedFacts: "Border drawn around books.",
  userFirstName: "Robera",
});
check(
  "the contract forbids the name when the policy says so",
  /Do NOT use the user's name/.test(contract) && !/may use the user's first name/i.test(contract),
  "name forbidden",
);
check(
  "the contract blocks repeating a discovery",
  /Do NOT say you found, located or discovered it/.test(contract),
  "discovery suppressed",
);
check(
  "the contract allows exactly the one planned follow-up",
  /exactly one follow-up[\s\S]*"Open folder"/.test(contract) &&
    /Do not invent others/.test(contract),
  "one allowed recommendation",
);
check(
  "the contract never ships a capability id to the model",
  !/filesystem\.open_item|screen\.highlight_target/.test(contract),
  "no capability ids",
);

const engineSourceForProvenance = readFileSync(
  "src/features/capabilities/capabilityEngine.ts",
  "utf8",
);
check(
  "a successful tool no longer discards the model's reply",
  /verdict\.ok \? candidate : facts/.test(engineSourceForProvenance),
  "model text kept when it passes the fact check",
);
check(
  "response provenance is recorded for the developer trace",
  /recordResponseProvenance\(/.test(engineSourceForProvenance) &&
    /providerCalls: loop\.providerCalls/.test(engineSourceForProvenance) &&
    /toolExecutions: loop\.toolExecutions/.test(engineSourceForProvenance),
  "source + counts recorded",
);
check(
  "a model-written answer is not re-templated downstream",
  /responseSource === "MODEL_GENERATED"/.test(
    readFileSync("src/services/AssistantService.ts", "utf8"),
  ),
  "presenter skipped for model-generated text",
);

// ── 8. Status deduplication ────────────────────────────────────────────────
//
// The engine emits progress on every loop iteration, so the raw stream is
// Thinking → Searching → Thinking → Writing. Rendered as history it read as
// "Thinking, Working, Thinking, Working" — a debug console, not an assistant.
console.log("\n— status deduplication —");
const reduced = reduceStatus([
  { message: "Thinking..." },
  { message: "Working...", capabilityId: "web.search" },
  { message: "Searching the web…", capabilityId: "web.search" },
  { message: "Searching the web…", capabilityId: "web.search" },
  { message: "Thinking..." },
  { message: "Writing the answer…" },
]);
check(
  "only one current status survives",
  reduced.current === "Writing the answer…",
  reduced.current,
);
check(
  "repeated and generic events never become steps",
  reduced.steps.length === 1 && reduced.steps[0] === "Searching the web…",
  reduced.steps.join(" | ") || "(none)",
);
// Composing the reply happens on every turn, including pure conversation. As a
// step it gave "7 times 6 is 42" a Thought row reading only "Wrote the reply".
check(
  "a turn that only talked gets no Thought row",
  reduceStatus([{ message: "Thinking…" }, { message: "Writing the answer…" }])
    .steps.length === 0,
  "no steps for a toolless turn",
);
check(
  "a run of nothing but waiting produces no steps",
  reduceStatus([
    { message: "Thinking..." },
    { message: "Working..." },
    { message: "Thinking..." },
  ]).steps.length === 0,
  "no fake steps",
);
check(
  "a retry of the same tool does not stack a second row",
  reduceStatus([
    { message: "Working...", capabilityId: "tasks.update" },
    { message: "Working...", capabilityId: "tasks.update" },
  ]).steps.length === 1,
  "one row",
);
check(
  "vendor names never reach a status line",
  labelForStatus({ message: "Formatting with DeepSeek V4 Flash…" }) === "Thinking" &&
    labelForStatus({ message: "filesystem.list_known_folder" }) === "Thinking",
  "collapsed to Thinking",
);
check(
  "the completed account reads as things that happened",
  thoughtSteps(["Searching the web…", "Checking the connection…"]).join(" | ") ===
    "Searched the web | Checked the connection",
  thoughtSteps(["Searching the web…", "Checking the connection…"]).join(" | "),
);

// ── 5. Progress text never names a vendor ──────────────────────────────────
console.log("\n— progress text —");
for (const raw of [
  "Formatting with DeepSeek V4 Flash…",
  "Asking DeepSeek V4 Flash…",
  "filesystem.list_known_folder",
  "System",
  "Assistant",
]) {
  check(`"${raw}" is not shown`, safeProgressText(raw) === "Thinking", safeProgressText(raw));
}
for (const raw of [
  "Searching YouTube for Cleo Abram…",
  "Looking for the books folder…",
  "Checking your youtube connection…",
]) {
  check(`"${raw}" survives`, safeProgressText(raw) === raw, safeProgressText(raw));
}

// ── 6. Wiring — the rules must be reachable from production ───────────────
//
// Every rule above is countable in turns, and for a while nothing in the
// running application counted any. Source checks, because a policy module with
// no caller passes its own tests forever.
console.log("\n— production wiring —");
const assistantSource = readFileSync("src/services/AssistantService.ts", "utf8");
check(
  "chat records the user's turn",
  /recordTurn\("user"/.test(assistantSource),
  /recordTurn\("user"/.test(assistantSource) ? "recorded" : "never recorded",
);
check(
  "chat records the assistant's turn",
  /recordTurn\("assistant"/.test(assistantSource),
  /recordTurn\("assistant"/.test(assistantSource) ? "recorded" : "never recorded",
);
check(
  "internal presentation prompts are excluded from the turn count",
  /const internal =[\s\S]{0,160}skipOrchestration/.test(assistantSource),
  "internal prompts skip recordTurn",
);
check(
  "the reply carries the plan's source and actions",
  /source: plan\?\.source/.test(assistantSource) &&
    /actions: plan\?\.actions/.test(assistantSource),
  "plan.source + plan.actions returned",
);

const dashboardSource = readFileSync("src/pages/DashboardPage.tsx", "utf8");
const composerSourceForId = readFileSync(
  "src/components/dashboard/CommandComposer.tsx",
  "utf8",
);
check(
  "the footer renders the friendly source, not the model label",
  /message\.resultSource/.test(dashboardSource) &&
    !/chat-source-model/.test(dashboardSource) &&
    !/agentForTool/.test(dashboardSource),
  "resultSource only",
);
// Thinking and the answer must be the SAME message. The detached panel that
// stacked progress events and then vanished is what made them feel unrelated.
check(
  "Thinking and Thought both render inside the assistant message shell",
  /<ThinkingRow/.test(dashboardSource) &&
    /<ThoughtRow/.test(dashboardSource) &&
    !/chat-bubble-thinking-label/.test(dashboardSource),
  "ThinkingRow + ThoughtRow inline",
);
check(
  "no detached thinking panel remains",
  !/thinking-tool/.test(dashboardSource) &&
    !/thinking-tool/.test(readFileSync("src/styles/dashboard.css", "utf8")) &&
    !/thinking-tool/.test(
      readFileSync("src/components/chat/ThinkingTool.tsx", "utf8"),
    ),
  "no .thinking-tool anywhere",
);
check(
  "the pending bubble and the answer share one message id",
  /pushPendingAssistantMessage\(\)/.test(composerSourceForId) &&
    /resolveAssistantMessage\(assistantId/.test(composerSourceForId),
  "same assistantId used for both",
);
check(
  "auto-scroll observes late layout and offers Jump to latest",
  /ResizeObserver/.test(dashboardSource) &&
    /chat-bottom-sentinel/.test(dashboardSource) &&
    /chat-jump-latest/.test(dashboardSource),
  "observer + sentinel + jump button",
);

// The footer icon: Connect's own logos first, and a concept key must never be
// allowed to match an app. "folder" matched the overlay pack's File Explorer
// entry (its aliases include "folder"), so "Folder read" drew a Windows
// Explorer logo clipped inside a circle it did not fit.
const iconSource = readFileSync("src/components/chat/SourceIcon.tsx", "utf8");
check(
  "concept keys never look up an app icon",
  ["folder", "task", "connection", "browser", "system"].every((k) =>
    new RegExp(`GLYPH_KEYS[\\s\\S]{0,160}"${k}"`).test(iconSource),
  ),
  "folder, task, connection, browser, system are glyphs",
);
check(
  "Connect integration icons are preferred over the overlay pack",
  iconSource.indexOf("integrationIcons[integration]") <
    iconSource.indexOf("TOP_OVERLAY_ICONS.find"),
  "Connect first, overlay last",
);
// A product logo fills its circle. Padding it inside a bordered disc left a
// small mark adrift in a large ring, which reads as a layout fault.
const chatCss = readFileSync("src/styles/dashboard.css", "utf8");
const iconRule = /\.chat-source-icon\s*\{([^}]*)\}/.exec(chatCss)?.[1] ?? "";
const iconImgRule = /\.chat-source-icon img\s*\{([^}]*)\}/.exec(chatCss)?.[1] ?? "";
check(
  "the mark fills its circle instead of floating inside it",
  !/padding:\s*[1-9]/.test(iconRule) &&
    /width:\s*100%/.test(iconImgRule) &&
    /height:\s*100%/.test(iconImgRule) &&
    /object-fit:\s*cover/.test(iconImgRule),
  "unpadded circle + full-bleed image",
);
check(
  "only the drawn glyph keeps the disc behind it",
  /\.chat-source-icon\.is-glyph\s*\{[^}]*background/.test(chatCss) &&
    !/^\s*background:/m.test(iconRule),
  "glyph has a disc, logos do not",
);

// The bundled application library behind Connect's own logos: "open After
// Effects" should show that app's mark, not a generic monitor glyph. Matched
// against the real filenames, because a matcher only exercised through a
// bundler is a matcher nobody checks.
const appIconFiles = Object.fromEntries(
  readdirSync("src/assets/app-icons")
    .filter((f) => f.endsWith(".ico"))
    .map((f) => [f, `/icons/${f}`]),
);
const appIcons = buildAppIconIndex(appIconFiles);
check(
  "the application icon library is bundled",
  appIcons.size > 500,
  `${appIcons.size} marks`,
);
for (const [query, want] of [
  ["After Effects", "Adobe After Effects.ico"],
  ["Premiere Pro", "Adobe Premiere Pro.ico"],
  ["Photoshop", "Adobe Photoshop.ico"],
  ["Blender", "Blender.ico"],
  ["DaVinci Resolve", "DaVinci Resolve.ico"],
  ["Visual Studio Code", "Microsoft Visual Studio Code.ico"],
  ["Chrome", "Google Chrome.ico"],
] as const) {
  check(
    `"${query}" finds its own mark`,
    appIcons.lookup(query) === `/icons/${want}`,
    appIcons.lookup(query) ?? "no match",
  );
}
for (const junk of ["it", "a", "zzzz nonexistent app", "Adobe"]) {
  check(
    `"${junk}" matches nothing rather than guessing`,
    appIcons.lookup(junk) === null,
    appIcons.lookup(junk) ?? "null",
  );
}

const composerSource = readFileSync(
  "src/components/dashboard/CommandComposer.tsx",
  "utf8",
);
check(
  "the composer forwards the friendly source and the actions",
  /resultSource: reply\.source/.test(composerSource) &&
    /actions: reply\.actions/.test(composerSource),
  "forwarded",
);

const engineSource = readFileSync(
  "src/features/capabilities/capabilityEngine.ts",
  "utf8",
);
check(
  "every model tool call is traced before it runs",
  /recordExecutionTrace\(/.test(engineSource) &&
    /completeExecutionTrace\(/.test(engineSource) &&
    /retrievalCandidates: \[\.\.\.loop\.toolNames\]/.test(engineSource),
  "trace records candidates, call and outcome",
);
check(
  "deterministic routing is still not wired into production chat",
  !/routeDeterministic\(/.test(engineSource),
  "routeDeterministic absent from the engine",
);

console.log(
  `\n${"-".repeat(74)}\n${failed === 0 ? "all passed" : `${failed} FAILED`}`,
);
process.exit(failed === 0 ? 0 : 1);
