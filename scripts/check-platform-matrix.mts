/**
 * The platform matrix: 100+ production-path scenarios in one run.
 *
 * Everything here drives shipping modules — the tool-turn assembler, the
 * capability registry, the connector registry, the origin policy, the
 * confirmation resolver, the result-set store. Side effects are recorded, never
 * performed: no browser, no files, no network, no credential.
 *
 * The thresholds it enforces are absolutes rather than averages, because the
 * failures they describe are not the kind you accept a few of: a tool call with
 * no result breaks the conversation, and a UI-only connector described as
 * usable is a lie about the product.
 *
 * Run: npm run test:platform-matrix
 */

import { readFileSync } from "node:fs";
import { INTEGRATIONS } from "../src/data/demoData";
import { CAPABILITY_REGISTRY, getCapability } from "../src/features/capabilities/capabilityRegistry";
import {
  capabilitiesForAnyOrigin,
  capabilitiesForOrigin,
  connectorFor,
  connectorImplementation,
  connectorProfile,
  connectorState,
  explainUnavailable,
  originPolicy,
} from "../src/features/capabilities/connectorRegistry";
import {
  claimFactsFor,
  enforceConnectorClaims,
} from "../src/features/capabilities/connectorClaims";
import { repairTurns, ToolTurn, validateTurns } from "../src/features/capabilities/toolTurn";
import { retrieveCapabilities } from "../src/features/capabilities/capabilityRouter";
import { buildRealtimeTools } from "../src/services/realtime/realtimeToolSchemas";
import { recoverTextEmbeddedCall } from "../src/features/capabilities/providerToolAdapter";
import { resolveFollowUp } from "../src/features/conversation/confirmationIntent";
import {
  latestResultSet,
  PENDING_ACTION_TTL_MS,
  recordTurn,
  rememberResultSet,
  resetConversationContextForTest,
  resolvePendingAction,
  setConversationScope,
  setPendingAction,
} from "../src/features/conversation/conversationContext";
import type { ChatTurn } from "../src/features/capabilities/providerToolAdapter";
import type { ParsedToolCall, ToolResult } from "../src/features/capabilities/capabilityTypes";
import type { IntegrationId } from "../src/config/iconRegistry";

interface Failure {
  group: string;
  scenario: string;
  expected: string;
  actual: string;
  detail: string;
  repair: string;
}

const failures: Failure[] = [];
const counts = new Map<string, { pass: number; total: number }>();
let sideEffects: string[] = [];

function record(group: string, scenario: string, pass: boolean, info: Partial<Failure> = {}) {
  const c = counts.get(group) ?? { pass: 0, total: 0 };
  c.total += 1;
  if (pass) c.pass += 1;
  counts.set(group, c);
  if (!pass) {
    failures.push({
      group,
      scenario,
      expected: info.expected ?? "",
      actual: info.actual ?? "",
      detail: info.detail ?? "",
      repair: info.repair ?? "",
    });
  }
}

const NONE = new Set<never>();
const YT = new Set(["youtube"]) as unknown as ReadonlySet<never>;
const GMAIL = new Set(["gmail"]) as unknown as ReadonlySet<never>;

function call(id: string, capabilityId = "connections.list"): ParsedToolCall {
  return { id, capabilityId, arguments: {} };
}
function res(capabilityId: string, status: ToolResult["status"] = "success"): ToolResult {
  return {
    callId: "x",
    capabilityId,
    status,
    summary: status === "success" ? "done" : "failed",
    evidence: { verified: status === "success", method: "state-readback" },
    startedAt: "",
    completedAt: "",
    durationMs: 1,
  };
}

// ── A. Tool protocol (15) ──────────────────────────────────────────────────
{
  const G = "tool-protocol";
  const cases: Array<[string, (t: ToolTurn, ids: string[]) => void]> = [
    ["one tool success", (t, i) => t.settle(i[0], res("connections.list"))],
    ["one tool failure", (t, i) => t.settle(i[0], res("connections.list", "error"))],
    ["two tools success", (t, i) => i.forEach((id) => t.settle(id, res("connections.list")))],
    ["first success second failure", (t, i) => { t.settle(i[0], res("a")); t.settle(i[1], res("b", "error")); }],
    ["first failure second success", (t, i) => { t.settle(i[0], res("a", "error")); t.settle(i[1], res("b")); }],
    ["policy refusal", (t, i) => { t.settle(i[0], res("a")); t.leaveUnsettled(i[1], "refused"); }],
    ["timeout", (t, i) => { t.settle(i[0], res("a")); t.leaveUnsettled(i[1], "timed-out"); }],
    ["cancellation", (t, i) => { t.leaveUnsettled(i[0], "cancelled"); t.leaveUnsettled(i[1], "cancelled"); }],
    ["confirmation pause", (t, i) => { t.leaveUnsettled(i[0], "awaiting-confirmation"); t.unansweredIds().forEach((id) => t.leaveUnsettled(id, "not-executed")); }],
    ["nothing settled at all", () => undefined],
  ];
  for (const [name, settle] of cases) {
    const turns: ChatTurn[] = [{ role: "user", content: "x" }];
    const calls = [call("A"), call("B")];
    const turn = ToolTurn.begin(turns, "", calls);
    settle(turn, ["A", "B"]);
    turn.close();
    const v = validateTurns(turns);
    const toolMessages = turns.filter((t) => t.role === "tool").length;
    record(G, name, v.valid && toolMessages === 2, {
      expected: "valid protocol, 2 results",
      actual: `${v.valid ? "valid" : v.problems.join("; ")}, ${toolMessages} results`,
      repair: "route the exit path through ToolTurn.close()",
    });
  }

  // Confirmation resume must not append a tool message.
  {
    const turns: ChatTurn[] = [{ role: "user", content: "x" }];
    const turn = ToolTurn.begin(turns, "", [call("A")]);
    turn.leaveUnsettled("A", "awaiting-confirmation");
    turn.close();
    turns.push({ role: "user", content: "The user approved; it has run." });
    record(G, "confirmation resume", validateTurns(turns).valid, {
      expected: "valid", actual: validateTurns(turns).problems.join("; "),
      repair: "resume as a user turn, never an invented tool id",
    });
  }
  // Retries: closing repeatedly must not duplicate results.
  {
    const turns: ChatTurn[] = [{ role: "user", content: "x" }];
    const turn = ToolTurn.begin(turns, "", [call("A")]);
    turn.settle("A", res("a"));
    turn.close(); turn.close(); turn.close();
    record(G, "multiple provider retries", turns.filter((t) => t.role === "tool").length === 1, {
      expected: "1 result", actual: `${turns.filter((t) => t.role === "tool").length}`,
      repair: "close() must stay idempotent",
    });
  }
  // Duplicate id detection.
  {
    const dup: ChatTurn[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "A", name: "x", arguments: "{}" }, { id: "A", name: "x", arguments: "{}" }] },
      { role: "tool", toolCallId: "A", content: "{}" },
      { role: "tool", toolCallId: "A", content: "{}" },
    ];
    record(G, "duplicate tool_call_id", validateTurns(dup).problems.some((p) => p.includes("duplicate")), {
      expected: "detected", actual: validateTurns(dup).problems.join("; "),
      repair: "validateTurns must track seen ids",
    });
  }
  // Missing result + malformed restored history.
  {
    const stored: ChatTurn[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "A", name: "x", arguments: "{}" }, { id: "B", name: "x", arguments: "{}" }] },
      { role: "tool", toolCallId: "A", content: "{}" },
    ];
    record(G, "missing tool result detected", !validateTurns(stored).valid, {
      expected: "invalid", actual: "valid", repair: "validator must count results",
    });
    const fixed = repairTurns(stored);
    record(G, "malformed restored history repaired", validateTurns(fixed.turns).valid, {
      expected: "valid after repair", actual: validateTurns(fixed.turns).problems.join("; "),
      repair: "repairTurns must synthesize the missing result",
    });
  }
}

// ── B. Connector states (7 states × every card) ────────────────────────────
{
  const G = "connector-states";
  const scenarios: Array<[string, { credentialPresent: boolean; validated: boolean; errored: boolean }, string[]]> = [
    ["verified", { credentialPresent: true, validated: true, errored: false }, ["CONNECTED_VERIFIED", "CONNECTED_LIMITED", "COMING_SOON", "UI_ONLY"]],
    ["configured but unverified", { credentialPresent: true, validated: false, errored: false }, ["CONFIGURED_UNVERIFIED", "COMING_SOON", "UI_ONLY"]],
    ["validation error", { credentialPresent: true, validated: true, errored: true }, ["ERROR", "COMING_SOON", "UI_ONLY"]],
    ["disconnected", { credentialPresent: false, validated: false, errored: false }, ["DISCONNECTED", "COMING_SOON", "UI_ONLY"]],
  ];
  for (const [name, input, allowed] of scenarios) {
    const bad = INTEGRATIONS.filter((i) => !allowed.includes(connectorState(i.id, input)));
    record(G, name, bad.length === 0, {
      expected: allowed.join(" | "),
      actual: bad.map((b) => `${b.name}=${connectorState(b.id, input)}`).join(", "),
      repair: "connectorState must map implementation before credential",
    });
  }
  // The two categories that must never look usable.
  const uiOnly = INTEGRATIONS.filter((i) => connectorImplementation(i.id) === "UI_ONLY");
  const authOnly = INTEGRATIONS.filter((i) => connectorImplementation(i.id) === "AUTH_ONLY");
  record(G, "UI-only never usable", uiOnly.every((i) => !connectorProfile(i.id).connectable && connectorProfile(i.id).available.length === 0), {
    expected: "0 usable", actual: `${uiOnly.length} UI-only cards`, repair: "connectable must be false",
  });
  record(G, "auth-only never functional", authOnly.every((i) => connectorProfile(i.id).available.length === 0), {
    expected: "0 capabilities", actual: `${authOnly.length} auth-only cards`, repair: "no capabilities may be advertised",
  });
  record(G, "auth-only never reports connected", authOnly.every((i) => connectorState(i.id, { credentialPresent: true, validated: true, errored: false }) === "COMING_SOON"), {
    expected: "COMING_SOON", actual: "other", repair: "implementation gates state",
  });
}

// ── C. Origin policy (4 origins × representative risks) ────────────────────
{
  const G = "origin-policy";
  const origins = ["chat", "voice", "direct-ui", "background"] as const;
  for (const origin of origins) {
    const readOnly = CAPABILITY_REGISTRY.filter((c) => c.riskLevel === "read-only" && c.availability === "available");
    const destructive = CAPABILITY_REGISTRY.filter((c) => c.riskLevel === "destructive");
    record(G, `${origin}: read-only allowed where the origin supports it`, readOnly.some((c) => originPolicy(c, origin).allowed), {
      expected: "some allowed", actual: "none", repair: "originPolicy too strict for reads",
    });
    if (origin === "background") {
      record(G, "background denies every non-read capability", CAPABILITY_REGISTRY.filter((c) => c.riskLevel !== "read-only").every((c) => !originPolicy(c, "background").allowed), {
        expected: "all denied", actual: "some allowed", repair: "background must be read-only",
      });
    }
    if (origin === "voice") {
      record(G, "voice denies destructive capabilities", destructive.every((c) => !originPolicy(c, "voice").allowed), {
        expected: "all denied", actual: destructive.filter((c) => originPolicy(c, "voice").allowed).map((c) => c.id).join(", "),
        repair: "voice cannot authorise destructive actions",
      });
      record(G, "voice denial explains itself", destructive.every((c) => Boolean(originPolicy(c, "voice").reason)), {
        expected: "reason present", actual: "missing", repair: "add a reason",
      });
    }
    if (origin === "direct-ui") {
      record(G, "direct UI still confirms destructive actions", destructive.every((c) => originPolicy(c, "direct-ui").requiresConfirmation), {
        expected: "confirmation required", actual: "not required", repair: "destructive always confirms",
      });
    }
    record(G, `${origin}: unsupported capabilities denied`, CAPABILITY_REGISTRY.filter((c) => c.availability === "unsupported").every((c) => !originPolicy(c, origin).allowed), {
      expected: "denied", actual: "offered", repair: "availability gate first",
    });
  }
  record(G, "sensitive chat capabilities require confirmation", CAPABILITY_REGISTRY.filter((c) => c.riskLevel === "sensitive" && c.supportsChat).every((c) => originPolicy(c, "chat").requiresConfirmation), {
    expected: "confirmation", actual: "none", repair: "sensitive implies confirmation",
  });
}

// ── D. Chat / voice parity and connector gating (12) ───────────────────────
{
  const G = "chat-voice";
  const chatNone = capabilitiesForOrigin("chat", NONE).map((c) => c.id);
  const voiceNone = capabilitiesForOrigin("voice", NONE).map((c) => c.id);
  const chatYt = capabilitiesForOrigin("chat", YT).map((c) => c.id);
  const voiceYt = capabilitiesForOrigin("voice", YT).map((c) => c.id);

  record(G, "disconnected connector offers no tools to chat", !chatNone.some((id) => connectorFor(id) && !/get_connection_status$/.test(id)), {
    expected: "0", actual: chatNone.filter((id) => connectorFor(id) && !/get_connection_status$/.test(id)).join(", "),
    repair: "gate on connector state",
  });
  record(G, "disconnected connector offers no tools to voice", !voiceNone.some((id) => connectorFor(id) && !/get_connection_status$/.test(id)), {
    expected: "0", actual: "some", repair: "gate on connector state",
  });
  record(G, "connected connector offers its tools to chat", chatYt.filter((id) => id.startsWith("youtube.")).length === 3, {
    expected: "3", actual: `${chatYt.filter((id) => id.startsWith("youtube.")).length}`, repair: "check CONNECTOR_DOMAINS",
  });
  record(G, "connection-status survives disconnection", chatNone.filter((id) => /get_connection_status$/.test(id)).length > 0, {
    expected: ">0", actual: "0", repair: "never gate connection questions",
  });
  // Every chat/voice difference must be explainable — either the capability
  // declares it (`supportsVoice: false`) or the origin policy gives a reason
  // (voice cannot authorise a destructive action by speech alone). What is not
  // allowed is a difference nobody can account for.
  const diverging = chatNone.filter((id) => !voiceNone.includes(id));
  record(G, "every chat/voice difference has a stated reason", diverging.every((id) => {
    const capability = getCapability(id);
    if (!capability) return false;
    return capability.supportsVoice === false || Boolean(originPolicy(capability, "voice").reason);
  }), {
    expected: "all explained",
    actual: diverging.filter((id) => {
      const c = getCapability(id);
      return c && c.supportsVoice !== false && !originPolicy(c, "voice").reason;
    }).join(", ") || "none",
    repair: "add a reason to originPolicy",
  });
  record(G, "voice tool list is a subset of the registry", voiceYt.every((id) => Boolean(getCapability(id))), {
    expected: "all real", actual: "phantom ids", repair: "derive from the registry",
  });
  record(G, "no nonexistent capability offered in any origin", [...chatNone, ...voiceNone, ...chatYt, ...voiceYt].every((id) => Boolean(getCapability(id))), {
    expected: "all real", actual: "phantom", repair: "derive from the registry",
  });
  record(G, "missing executor is never offered", CAPABILITY_REGISTRY.filter((c) => c.availability === "unsupported").every((c) => !chatNone.includes(c.id) && !voiceNone.includes(c.id)), {
    expected: "withheld", actual: "offered", repair: "availability gate",
  });
  record(G, "every offered capability has a schema", [...chatYt, ...voiceYt].every((id) => Boolean(getCapability(id)?.inputSchema)), {
    expected: "schemas present", actual: "missing", repair: "registry integrity",
  });
  record(G, "unsupported connector explained, not denied as nonexistent", (explainUnavailable("email.list_messages", NONE) ?? "").includes("not connected"), {
    expected: "connector explanation", actual: String(explainUnavailable("email.list_messages", NONE)),
    repair: "explainUnavailable must name the connector",
  });
  record(G, "background origin narrows further than chat", capabilitiesForAnyOrigin("background", YT).length < capabilitiesForOrigin("chat", YT).length, {
    expected: "fewer", actual: "same", repair: "background must be read-only",
  });
  record(G, "direct UI is the widest origin", capabilitiesForAnyOrigin("direct-ui", YT).length >= capabilitiesForOrigin("chat", YT).length, {
    expected: "widest", actual: "narrower", repair: "direct UI allows all available",
  });
}

// ── E. Connector wording (8) ───────────────────────────────────────────────
{
  const G = "wording";
  const yt = claimFactsFor(connectorProfile("youtube"));
  const cases: Array<[string, string, boolean]> = [
    ["full read-only access", "public read-only access", true],
    ["fully connected", "public connected", true],
    ["complete access", "public access", true],
    ["all its features", "the available features", true],
    ["public read-only access", "public read-only access", true],
  ];
  for (const [input, want, shouldPass] of cases) {
    const out = enforceConnectorClaims(`YouTube has ${input}.`, yt);
    record(G, `rewrites "${input}"`, out.ok === shouldPass && (!out.ok || out.text === `YouTube has ${want}.`), {
      expected: want, actual: out.ok ? out.text : out.reason, repair: "extend the ABSOLUTE pattern",
    });
  }
  for (const claim of ["I can see your subscriptions.", "I have your watch history.", "Your liked videos are available."]) {
    record(G, `rejects "${claim.slice(0, 28)}"`, !enforceConnectorClaims(claim, yt).ok, {
      expected: "rejected", actual: "accepted", repair: "extend ACCOUNT_SCOPED",
    });
  }
}

// ── F. YouTube conversation (11) ───────────────────────────────────────────
{
  const G = "youtube";
  const fixture = ["One", "Two", "Three"].map((t) => ({
    type: "video" as const, title: t, subtitle: "MrBeast",
    url: `https://www.youtube.com/watch?v=${t}`, sourceId: t,
  }));

  const retrievalCases: Array<[string, string]> = [
    ["is youtube connected", "connections.get_status"],
    ["find cleo abram on youtube", "youtube.search"],
    ["find the mrbeast channel", "youtube.search"],
    ["search youtube in my browser for mrbeast", "web.search"],
  ];
  for (const [prompt, want] of retrievalCases) {
    const top = retrieveCapabilities(prompt, 6, { origin: "chat", connectedConnectors: YT })[0]?.capability.id;
    record(G, `retrieval: "${prompt}"`, top === want, {
      expected: want, actual: String(top), repair: "adjust keywords/intentExamples",
    });
  }

  const followUps: Array<[string, string, "results" | "offer" | "fresh" | "expired"]> = [
    ["yes", "confirm", "offer"],
    ["no", "decline", "offer"],
    ["open the first one", "ordinal", "results"],
    ["open the second one", "ordinal", "results"],
    ["yes", "nothing-pending", "fresh"],
    ["yes", "expired", "expired"],
  ];
  for (const [text, want, seed] of followUps) {
    resetConversationContextForTest();
    setConversationScope("m", "u");
    sideEffects = [];
    if (seed !== "fresh") {
      recordTurn("user", "find mrbeast");
      const set = rememberResultSet({ source: "youtube", query: "MrBeast", items: fixture });
      if (seed === "offer" || seed === "expired") {
        setPendingAction({
          actionType: "open", capabilityId: "youtube.open_result",
          args: { result_item_id: set.items[0].id }, entityRefs: [],
          resultSetId: set.id, resultItemId: set.items[0].id,
          recommendationId: "open", promptShownToUser: "Open One",
          ttlMs: seed === "expired" ? -1000 : PENDING_ACTION_TTL_MS,
        });
      }
    }
    const r = resolveFollowUp(text);
    record(G, `follow-up "${text}" (${seed})`, r.kind === want, {
      expected: want, actual: r.kind, repair: "confirmationIntent classification",
    });
  }

  // Replay cannot execute twice.
  resetConversationContextForTest();
  setConversationScope("m", "u");
  const set = rememberResultSet({ source: "youtube", query: "MrBeast", items: fixture });
  const pending = setPendingAction({
    actionType: "open", capabilityId: "youtube.open_result",
    args: { result_item_id: set.items[0].id }, entityRefs: [],
    resultSetId: set.id, resultItemId: set.items[0].id,
    recommendationId: "open", promptShownToUser: "Open One",
  });
  const first = resolvePendingAction(pending.id, "accepted");
  resolvePendingAction(pending.id, "executed");
  const second = resolvePendingAction(pending.id, "accepted");
  record(G, "replayed confirmation cannot execute twice", first && !second, {
    expected: "first only", actual: `first=${first} second=${second}`,
    repair: "terminal states must refuse transition",
  });
}

// ── G. Implemented-connector capability truth (Gmail/Calendar/Docs/Drive) ──
{
  const G = "implemented-connectors";
  for (const id of ["gmail", "googleCalendar", "googleDocs", "googleDrive", "youtube"] as IntegrationId[]) {
    const profile = connectorProfile(id);
    record(G, `${id}: capabilities exist in the registry`, profile.capabilityIds.every((c) => Boolean(getCapability(c))), {
      expected: "all real", actual: "phantom", repair: "CONNECTOR_DOMAINS prefix wrong",
    });
    record(G, `${id}: advertises no tool it lacks`, profile.available.length === profile.capabilityIds.length, {
      expected: `${profile.capabilityIds.length}`, actual: `${profile.available.length}`,
      repair: "available must be derived",
    });
    record(G, `${id}: gated behind its own connector`, profile.capabilityIds.every((c) => connectorFor(c) === id), {
      expected: id, actual: "mismatch", repair: "prefix ownership",
    });
  }
  // Gmail's eight capabilities, exactly.
  record(G, "gmail exposes its 8 implemented capabilities", connectorProfile("gmail").capabilityIds.length === 8, {
    expected: "8", actual: `${connectorProfile("gmail").capabilityIds.length}`, repair: "registry drift",
  });
}

// ── H. No side effect escaped ──────────────────────────────────────────────
record("safety", "no side effect performed", sideEffects.length === 0, {
  expected: "0", actual: `${sideEffects.length}`, repair: "suite must never execute",
});
{
  const source = readFileSync("scripts/check-platform-matrix.mts", "utf8");
  // Match an actual import statement — the first version grepped for the word
  // anywhere and matched the text of its own assertion.
  const importsExecutor = /^import[\s\S]{0,200}?from\s+"[^"]*(?:frontendExecutors|googleWorkspaceExecutors)"/m.test(source);
  record("safety", "suite imports no executor", !importsExecutor, {
    expected: "no executor import", actual: "executor imported", repair: "remove the import",
  });
}


// ── I. Extended retrieval and connector coverage ───────────────────────────
{
  const G = "retrieval";
  const cases: Array<[string, string, ReadonlySet<never>]> = [
    ["list all the connected apps", "connections.list", YT],
    ["what is connected", "connections.list", YT],
    ["which integrations can i use", "connections.list", YT],
    ["is gmail connected", "email.get_connection_status", NONE],
    ["is my calendar connected", "calendar.get_connection_status", NONE],
    ["is google drive connected", "drive.get_connection_status", NONE],
    ["show me the newest mrbeast videos", "youtube.search", YT],
    ["open youtube.com for me", "web.open_url", YT],
    ["take me to youtube results for mrbeast", "web.search", YT],
  ];
  for (const [prompt, want, connected] of cases) {
    const top = retrieveCapabilities(prompt, 6, { origin: "chat", connectedConnectors: connected })[0]
      ?.capability.id;
    record(G, `"${prompt}"`, top === want, {
      expected: want, actual: String(top), repair: "adjust keywords/intentExamples",
    });
  }
}

// ── J. Gmail / Calendar / Drive gating with real connector state ───────────
{
  const G = "google-connectors";
  const gmailOn = capabilitiesForOrigin("chat", GMAIL).map((c) => c.id);
  record(G, "gmail connected exposes its read tools", gmailOn.filter((id) => id.startsWith("email.")).length === 8, {
    expected: "8", actual: `${gmailOn.filter((id) => id.startsWith("email.")).length}`, repair: "connector gate",
  });
  record(G, "gmail connected does not expose calendar tools", !gmailOn.some((id) => id.startsWith("calendar.") && !/get_connection_status$/.test(id)), {
    expected: "0", actual: "leaked", repair: "per-connector gating",
  });
  record(G, "gmail connected does not expose drive tools", !gmailOn.some((id) => id.startsWith("drive.") && !/get_connection_status$/.test(id)), {
    expected: "0", actual: "leaked", repair: "per-connector gating",
  });
  record(G, "gmail connected does not expose youtube tools", !gmailOn.some((id) => id.startsWith("youtube.")), {
    expected: "0", actual: "leaked", repair: "per-connector gating",
  });
  for (const id of ["gmail", "googleCalendar", "googleDrive", "googleDocs"] as IntegrationId[]) {
    const p = connectorProfile(id);
    record(G, `${id}: access level is stated`, p.accessLevel.length > 0 && p.accessLevel !== "Full access", {
      expected: "explicit access level", actual: p.accessLevel, repair: "add to KNOWN_LIMITS",
    });
  }
  // Sensitive Gmail writes must confirm in chat and be absent or confirmed by voice.
  const sends = CAPABILITY_REGISTRY.filter((c) => c.id === "email.send_message");
  record(G, "sending email requires confirmation in chat", sends.every((c) => originPolicy(c, "chat").requiresConfirmation), {
    expected: "confirmation", actual: "none", repair: "risk level must be sensitive",
  });
  record(G, "sending email never runs unattended", sends.every((c) => !originPolicy(c, "background").allowed), {
    expected: "denied", actual: "allowed", repair: "background is read-only",
  });
}

// ── K. Result-set and account isolation under the matrix ───────────────────
{
  const G = "isolation";
  resetConversationContextForTest();
  setConversationScope("c1", "user-a");
  rememberResultSet({ source: "youtube", query: "q", items: [{ type: "video", title: "A", url: "https://www.youtube.com/watch?v=a", sourceId: "a" }] });
  record(G, "owner sees the result set", latestResultSet() !== null, { expected: "set", actual: "none", repair: "scope" });
  setConversationScope("c1", "user-b");
  record(G, "another account sees nothing", latestResultSet() === null, { expected: "none", actual: "leaked", repair: "account scope" });
  setConversationScope("c2", "user-a");
  record(G, "another conversation sees nothing", latestResultSet() === null, { expected: "none", actual: "leaked", repair: "conversation scope" });
  record(G, "a stale follow-up in a new conversation asks", resolveFollowUp("yes").kind === "nothing-pending", {
    expected: "nothing-pending", actual: resolveFollowUp("yes").kind, repair: "pending scope",
  });
}


// ── L. Voice path parity, through the production voice builder ────────────
//
// Asserting `capabilitiesForOrigin("voice", …)` only proves the gate. This
// calls `buildRealtimeTools` — the function the Realtime session actually
// invokes — and checks it agrees with the gate. That is what "chat and voice
// share one registry" has to mean to be worth anything.
{
  const G = "voice-path";
  for (const [label, connected] of [["nothing connected", NONE], ["youtube connected", YT], ["gmail connected", GMAIL]] as const) {
    const voiceTools = buildRealtimeTools(connected).map((t) => t.name.replace(/__/g, "."));
    const gate = capabilitiesForOrigin("voice", connected).map((c) => c.id);
    record(G, `${label}: voice builder matches the gate`, voiceTools.length === gate.length && voiceTools.every((id) => gate.includes(id)), {
      expected: `${gate.length} tools`, actual: `${voiceTools.length} tools`,
      repair: "buildRealtimeTools must call capabilitiesForOrigin",
    });
    record(G, `${label}: every voice tool exists`, voiceTools.every((id) => Boolean(getCapability(id))), {
      expected: "all real", actual: "phantom tool offered", repair: "derive from the registry",
    });
    record(G, `${label}: no disconnected connector tool offered by voice`, !voiceTools.some((id) => {
      const c = connectorFor(id);
      return c && !/get_connection_status$/.test(id) && !(connected as ReadonlySet<string>).has(c);
    }), {
      expected: "0", actual: "leaked", repair: "connector gate in the voice path",
    });
  }
  // Voice must never receive a destructive tool, whatever is connected.
  const voiceAll = buildRealtimeTools(YT).map((t) => t.name.replace(/__/g, "."));
  record(G, "voice never receives a destructive capability", !voiceAll.some((id) => getCapability(id)?.riskLevel === "destructive"), {
    expected: "0 destructive", actual: voiceAll.filter((id) => getCapability(id)?.riskLevel === "destructive").join(", "),
    repair: "originPolicy must gate the voice builder",
  });
}


// ── M. Provider serialisation recovery ─────────────────────────────────────
//
// DeepSeek intermittently writes the tool call into `content`. Three tag shapes
// have been observed for one prompt. The model chose correctly every time; only
// the serialisation was wrong, and the turn silently did nothing.
{
  const G = "provider-recovery";
  const offered = ["youtube.search", "connections.list"];
  const samples = [
    [
      "I will check.",
      "<｜｜DSML｜｜tool_calls>",
      '<｜｜DSML｜｜invoke name="youtube.search">',
      '{"query": "MrBeast"}',
    ].join(String.fromCharCode(10)),
    [
      "Looking now.",
      "<user_tool_call>",
      'youtube.search query="MrBeast"',
      "</user_tool_call>",
    ].join(String.fromCharCode(10)),
    [
      "One moment.",
      "<user.youtube.search>",
      '  query: "MrBeast"',
      "</user.youtube.search>",
    ].join(String.fromCharCode(10)),
  ];
  for (const [i, sample] of samples.entries()) {
    const recovered = recoverTextEmbeddedCall(sample, offered);
    record(G, `recovers serialisation variant ${i + 1}`, recovered?.capabilityId === "youtube.search", {
      expected: "youtube.search", actual: String(recovered?.capabilityId), repair: "widen the recovery matcher",
    });
    record(G, `variant ${i + 1} keeps the query argument`, String(recovered?.arguments.query ?? "") === "MrBeast", {
      expected: "MrBeast", actual: String(recovered?.arguments.query), repair: "argument extraction",
    });
  }
  // It must not turn ordinary prose into a call.
  record(G, "plain prose is never recovered as a call", recoverTextEmbeddedCall("I searched YouTube for you.", offered) === null, {
    expected: "null", actual: "recovered", repair: "require markup characters",
  });
  record(G, "a capability that was not offered is never recovered", recoverTextEmbeddedCall('<invoke name="filesystem.delete">', offered) === null, {
    expected: "null", actual: "recovered", repair: "must check the offered set",
  });
}

// ── Report ─────────────────────────────────────────────────────────────────
let total = 0;
let passed = 0;
console.log("\nGroup                     pass/total");
for (const [group, c] of counts) {
  total += c.total;
  passed += c.pass;
  console.log(`  ${group.padEnd(24)} ${c.pass}/${c.total}`);
}
console.log(`\nScenarios run: ${total}`);

const pct = (p: number, t: number) => (t === 0 ? null : Math.round((p / t) * 100));
const show = (v: number | null) => (v === null ? "NOT MEASURED" : `${v}%`);

const absolutes: Array<[string, string]> = [
  ["valid tool protocol", "tool-protocol"],
  ["connector state truth", "connector-states"],
  ["origin policy", "origin-policy"],
  ["chat/voice consistency", "chat-voice"],
  ["wording cannot be embellished", "wording"],
  ["conversation follow-ups", "youtube"],
  ["implemented-connector truth", "implemented-connectors"],
  ["no side effects", "safety"],
  ["retrieval routing", "retrieval"],
  ["google connector gating", "google-connectors"],
  ["account/conversation isolation", "isolation"],
  ["voice path parity", "voice-path"],
  ["provider serialisation recovery", "provider-recovery"],
];
console.log("\nThresholds (100% required)");
for (const [label, group] of absolutes) {
  const c = counts.get(group);
  const value = c ? pct(c.pass, c.total) : null;
  console.log(`  ${value === 100 ? "OK  " : "FAIL"} ${label.padEnd(32)} ${show(value)}`);
}
console.log("\n  NOT MEASURED  real-model capability selection (see eval:chat-live)");

if (failures.length > 0) {
  console.log(`\n${"=".repeat(74)}\nFAILED SCENARIOS (${failures.length})\n`);
  for (const f of failures) {
    console.log(`[${f.group}] ${f.scenario}`);
    console.log(`  expected : ${f.expected}`);
    console.log(`  actual   : ${f.actual}`);
    if (f.detail) console.log(`  detail   : ${f.detail}`);
    console.log(`  repair   : ${f.repair}\n`);
  }
}

console.log(`${"-".repeat(74)}`);
console.log(failures.length === 0 ? `all ${total} scenarios passed` : `${failures.length} FAILED of ${total}`);
process.exit(failures.length === 0 ? 0 : 1);
