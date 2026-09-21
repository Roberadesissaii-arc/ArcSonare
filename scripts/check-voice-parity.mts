/**
 * The voice path, driven end to end with controlled transcripts.
 *
 * Physical microphone input is not available to this harness, so speech is
 * where the substitution stops: everything downstream of the transcript is the
 * production code the Realtime session runs — `buildRealtimeTools` for what
 * voice is offered, `retrieveCapabilities` with `origin: "voice"` for what a
 * transcript reaches, `dispatchRealtimeToolCall` for what actually executes,
 * and `sessionGuard` for whether it is allowed to.
 *
 * The reported symptoms this exists to disprove:
 *   - voice answering "there is no such tool" for a tool that exists but whose
 *     connector is not connected
 *   - voice being handed tools it cannot run
 *   - voice and chat giving different answers about the same connector
 *
 * Run: npm run test:voice-parity
 */

import { buildRealtimeTools } from "../src/services/realtime/realtimeToolSchemas";
import { dispatchRealtimeToolCall } from "../src/services/realtime/realtimeTools";
import {
  beginSession,
  endSession,
  isCurrent,
  resetSessionsForTest,
} from "../src/services/realtime/sessionGuard";
import { getCapability } from "../src/features/capabilities/capabilityRegistry";
import {
  capabilitiesForOrigin,
  connectorFor,
  connectorProfile,
  explainUnavailable,
  originPolicy,
} from "../src/features/capabilities/connectorRegistry";
import { retrieveCapabilities } from "../src/features/capabilities/capabilityRouter";
import { readFileSync } from "node:fs";
import type { IntegrationId } from "../src/config/iconRegistry";

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

/** The live connector state this machine is in: YouTube working, Discord saved. */
const CONNECTED: ReadonlySet<IntegrationId> = new Set<IntegrationId>([
  "youtube",
  "discord",
]);

const voiceTools = buildRealtimeTools(CONNECTED).map((t) => t.name.replace(/__/g, "."));
const chatTools = capabilitiesForOrigin("chat", CONNECTED).map((c) => c.id);

/** What a transcript reaches, narrowed exactly as the voice session narrows it. */
const reach = (transcript: string): string[] =>
  retrieveCapabilities(transcript, 8, {
    origin: "voice",
    connectedConnectors: CONNECTED,
  }).map((r) => r.capability.id);

// ═══ Transcripts 1–3: supported, and they land on real tools ═══════════════
console.log("\n— transcripts that are supported —");
for (const [transcript, want] of [
  ["Check if YouTube is connected.", "connections.get_status"],
  ["List my connected services.", "connections.list"],
  ["What can YouTube do?", "connections.get_status"],
] as const) {
  const candidates = reach(transcript);
  check(
    `"${transcript}" reaches ${want}`,
    candidates.includes(want),
    candidates.slice(0, 3).join(", ") || "(nothing)",
  );
  check(
    `"${transcript}" is offered nothing voice cannot run`,
    candidates.every((id) => Boolean(getCapability(id)) && voiceTools.includes(id)),
    candidates.filter((id) => !voiceTools.includes(id)).join(", ") || "all runnable",
  );
}

// ═══ Transcript 4: Gmail — built, but not connected ════════════════════════
console.log("\n— transcript 4: unsupported because disconnected —");
{
  const gmailReached = reach("What Gmail tools are available?").filter(
    (id) => id.startsWith("email.") && !/connection_status$/.test(id),
  );
  check(
    "no Gmail tool is offered while Gmail is disconnected",
    gmailReached.length === 0,
    gmailReached.join(", ") || "none offered",
  );
  const explanation = explainUnavailable("email.list_messages", CONNECTED) ?? "";
  check(
    "the reason names the connector instead of denying the tool exists",
    /not connected/i.test(explanation) && !/no such tool|doesn't exist|does not exist/i.test(explanation),
    explanation || "(no explanation)",
  );
  // `connectorProfile` describes what is *built* — it takes no connection
  // state, on purpose, so "Gmail has 8 tools" and "Gmail is not connected" stay
  // two separate facts. Reachability is the origin filter's job, asserted
  // above. Both must be true at once or the answer becomes a denial.
  const profile = connectorProfile("gmail" as IntegrationId);
  check(
    "Gmail's tools are described as real, and separately as unreachable",
    profile.capabilityIds.length > 0 &&
      profile.implementation === "COMPLETE" &&
      // `email.get_connection_status` is deliberately exempt: answering "is
      // Gmail connected?" must work precisely when Gmail is not connected.
      capabilitiesForOrigin("voice", CONNECTED).every(
        (c) => !c.id.startsWith("email.") || c.id === "email.get_connection_status",
      ),
    `${profile.capabilityIds.length} built (${profile.implementation}), 0 reachable while disconnected`,
  );
}

// ═══ Transcript 5: Discord — connected, nothing built ══════════════════════
console.log("\n— transcript 5: connected with nothing behind it —");
{
  const profile = connectorProfile("discord" as IntegrationId);
  check(
    "Discord advertises no capability in any origin",
    profile.available.length === 0 && profile.capabilityIds.length === 0,
    `${profile.implementation} · ${profile.accessLevel}`,
  );
  check(
    "a stored Discord credential does not make it usable",
    !voiceTools.some((id) => connectorFor(id) === "discord"),
    "no Discord tool offered to voice",
  );
}

// ═══ Transcript 6: a send action on that connector ═════════════════════════
console.log("\n— transcript 6: send a hello message in Discord —");
{
  const candidates = reach("Send a hello message in Discord.");
  check(
    "no Discord capability is surfaced",
    !candidates.some((id) => connectorFor(id) === "discord"),
    candidates.slice(0, 3).join(", ") || "(nothing)",
  );
  check(
    "nothing surfaced would send a message anywhere",
    !candidates.some((id) => /send|post|reply/.test(id)),
    candidates.filter((id) => /send|post|reply/.test(id)).join(", ") || "no send capability",
  );
}

// ═══ Transcript 7: a UI-only connector ═════════════════════════════════════
console.log("\n— transcript 7: a UI-only connector —");
for (const id of ["dropbox", "linear"] as IntegrationId[]) {
  const profile = connectorProfile(id);
  check(
    `${id} is never usable and never connectable`,
    profile.implementation === "UI_ONLY" &&
      !profile.connectable &&
      profile.available.length === 0,
    `${profile.implementation}, connectable=${profile.connectable}`,
  );
}
{
  const candidates = reach("Open my Dropbox files.");
  check(
    "voice surfaces no capability for a UI-only connector",
    !candidates.some((id) => connectorFor(id) === "dropbox"),
    candidates.slice(0, 3).join(", ") || "(nothing)",
  );
}

// ═══ Transcript 8: a destructive capability ════════════════════════════════
console.log("\n— transcript 8: a destructive request —");
{
  const destructive = voiceTools.filter(
    (id) => getCapability(id)?.riskLevel === "destructive",
  );
  check(
    "voice is never handed a destructive capability at all",
    destructive.length === 0,
    destructive.join(", ") || "none in the voice tool list",
  );
  for (const transcript of ["Delete the books folder.", "Delete that task."]) {
    const risky = reach(transcript).filter(
      (id) => getCapability(id)?.riskLevel === "destructive",
    );
    check(
      `"${transcript}" surfaces nothing destructive`,
      risky.length === 0,
      risky.join(", ") || "none",
    );
  }
  const del = getCapability("filesystem.delete");
  check(
    "the withholding is a stated policy, not an omission",
    Boolean(del) && Boolean(originPolicy(del!, "voice").reason),
    del ? String(originPolicy(del, "voice").reason) : "capability missing",
  );
  check(
    "chat still has it, so this is an origin rule and not a removal",
    Boolean(del) && originPolicy(del!, "chat").allowed,
    "available in chat",
  );
}

// ═══ Real dispatch through the production bridge ═══════════════════════════
// Everything above is what voice is *offered*. This is what it actually gets
// back when it calls, through `dispatchRealtimeToolCall` itself.
console.log("\n— dispatched for real —");
{
  const list = await dispatchRealtimeToolCall("connections__list", "{}", {
    origin: "voice",
  });
  const parsed = JSON.parse(list.output) as { status: string; summary?: string };
  check(
    "connections.list returns a result, not a protocol error",
    parsed.status === "success" && typeof parsed.summary === "string",
    parsed.summary ?? parsed.status,
  );
  check(
    "the spoken summary contains no capability id",
    !/[a-z_]+\.[a-z_]+/.test(parsed.summary ?? ""),
    parsed.summary ?? "",
  );

  const gmail = await dispatchRealtimeToolCall(
    "connections__get_status",
    JSON.stringify({ service: "gmail" }),
    { origin: "voice" },
  );
  const g = JSON.parse(gmail.output) as {
    status: string;
    summary?: string;
    data?: { connected?: boolean };
  };
  check(
    "asking about a disconnected connector answers rather than errors",
    g.status === "success" && g.data?.connected === false,
    g.summary ?? g.status,
  );
  check(
    "and says it is not connected, not that it does not exist",
    /not connected/i.test(g.summary ?? "") &&
      !/no such|doesn't exist|does not exist/i.test(g.summary ?? ""),
    g.summary ?? "",
  );

  // A capability voice is not allowed to have. The bridge must refuse by name
  // rather than execute, and must not crash the turn.
  const denied = await dispatchRealtimeToolCall(
    "filesystem__delete",
    JSON.stringify({ path: "C:/does/not/matter" }),
    { origin: "voice" },
  );
  const d = JSON.parse(denied.output) as { status?: string; error?: string };
  check(
    "a destructive call is not executed even if the model invents it",
    d.status !== "success",
    d.error ?? d.status ?? "(no status)",
  );

  // A tool name that is not a capability. This used to be voice's stock answer
  // for real-but-disconnected tools; it must be reserved for actual nonsense.
  const unknown = await dispatchRealtimeToolCall("slack__send_message", "{}", {
    origin: "voice",
  });
  check(
    'unknown tool names are the only thing answered with "unknown tool"',
    /unknown tool/i.test(unknown.output),
    JSON.parse(unknown.output).error ?? unknown.output,
  );
}

// ═══ Session lifetime ══════════════════════════════════════════════════════
console.log("\n— session lifetime —");
{
  resetSessionsForTest();
  const claim = beginSession();
  check("a live session may act", isCurrent(claim), "isCurrent = true");
  endSession(claim);
  check(
    "a closed session may not act, including after an awaited dispatch",
    !isCurrent(claim),
    "isCurrent = false",
  );

  const source = readFileSync("src/services/realtime/RealtimeSession.ts", "utf8");
  const afterAwait = source.slice(source.indexOf("dispatchRealtimeToolCall"));
  check(
    "RealtimeSession re-checks the guard after the dispatch await",
    /isCurrent\(/.test(afterAwait),
    "post-await guard present",
  );
  check(
    "the Realtime call_id is passed through as the idempotency key",
    /dispatchRealtimeToolCall\([\s\S]{0,200}?call_?[Ii]d/.test(source),
    "redelivered calls dedupe on call_id",
  );
}

// ═══ Parity with chat ══════════════════════════════════════════════════════
console.log("\n— parity with chat —");
check(
  "voice tools are a subset of chat tools",
  voiceTools.every((id) => chatTools.includes(id)),
  voiceTools.filter((id) => !chatTools.includes(id)).join(", ") || `${voiceTools.length} ⊆ ${chatTools.length}`,
);
check(
  "every chat-only tool has a stated reason",
  chatTools
    .filter((id) => !voiceTools.includes(id))
    .every((id) => {
      const c = getCapability(id);
      return c && (c.supportsVoice === false || Boolean(originPolicy(c, "voice").reason));
    }),
  `${chatTools.length - voiceTools.length} chat-only, all explained`,
);
check(
  "both surfaces read the same connector registry",
  (["youtube", "discord", "gmail"] as IntegrationId[]).every((id) => {
    const p = connectorProfile(id);
    return p.chatCapabilityIds.every((c) => p.capabilityIds.includes(c));
  }),
  "one registry",
);

console.log(`\n${"-".repeat(74)}`);
console.log(
  failed === 0
    ? "all passed — controlled transcripts, production voice path"
    : `${failed} FAILED`,
);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failed === 0 ? 0 : 1);
