/**
 * Chat quality eval (~40 questions) — same decision order as dashboard chat.
 *
 * Stages (mirrors AssistantService.askAssistant):
 *   1. Running-apps / watch questions
 *   2. Deterministic capabilities
 *   3. Orchestrated services (Gmail / Calendar / Drive)
 *   4. Plain chat (optional live model via Ollama)
 *
 * Scores:
 *   ROUTE     — expected handler
 *   ROBOTIC   — canned templates, fake status tables, tool ids, brochure filler
 *   NATURAL   — short human confirmations for actions when we simulate compose
 *
 * Run: npx tsx scripts/chat-quality-eval.mts
 * Live chat replies: OLLAMA_HOST=http://127.0.0.1:11434 npx tsx scripts/chat-quality-eval.mts --live
 */

import { routeDeterministic } from "../src/features/capabilities/capabilityRouter";
import {
  classifyIntent,
  isOrchestratedDomain,
} from "../src/features/orchestration/IntentClassifier";
import {
  needsSearchQuery,
  needsTaskTitle,
} from "../src/features/capabilities/clarifyGuards";
import { isRunningAppsQuestion } from "../src/services/runningAppsQuestions";
import { composeResponse } from "../src/features/capabilities/capabilityResponseComposer";
import { buildAssistantPrompt } from "../src/services/assistantPrompt";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

const LIVE = process.argv.includes("--live");
const OLLAMA = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const MODEL = process.env.ARCSONARE_TEST_MODEL || "llama3.2:latest";

type PathKind =
  | "running-apps"
  | "clarify"
  | "capability"
  | "orchestrated"
  | "chat";

type Path = {
  kind: PathKind;
  id?: string;
  args?: Record<string, unknown>;
};

function resolvePath(text: string): Path {
  // Same order as askAssistant (simplified — no async desktop scan here).
  if (isRunningAppsQuestion(text)) return { kind: "running-apps" };
  if (needsTaskTitle(text) || needsSearchQuery(text)) return { kind: "clarify" };
  const contract = classifyIntent(text);
  if (isOrchestratedDomain(contract)) {
    return { kind: "orchestrated", id: contract.capabilityId ?? "(unmapped)" };
  }
  const det = routeDeterministic(text);
  if (det) {
    return {
      kind: "capability",
      id: det.capabilityId,
      args: det.arguments,
    };
  }
  return { kind: "chat" };
}

function pathLabel(p: Path): string {
  if (p.kind === "capability") return `capability:${p.id}`;
  if (p.kind === "orchestrated") return `orchestrated:${p.id}`;
  return p.kind;
}

/** Red flags in any user-facing string. */
function roboticFlags(text: string): string[] {
  const flags: string[] = [];
  if (/\*\*Actions Taken\*\*/i.test(text)) flags.push("fake-actions-taken");
  if (/\*\*Verified Facts\*\*/i.test(text)) flags.push("fake-verified-facts");
  if (/\| Time \| Action \|/i.test(text)) flags.push("status-table");
  if (/not found as an installed app/i.test(text)) flags.push("raw-app-not-found");
  if (/\b(applications\.open|web\.activate|capability_execute|invalid-arguments)\b/i.test(text)) {
    flags.push("tool-id-leak");
  }
  if (/I'm ArcSonare, your Windows desktop assistant/i.test(text)) {
    flags.push("brochure-intro");
  }
  if (/How can I (help|assist) you today\?/i.test(text)) flags.push("filler-closer");
  if (/Let me know if you need anything/i.test(text)) flags.push("filler-closer");
  if (/Certainly!|Great question!/i.test(text)) flags.push("padded-affirmation");
  if (/I('ll| will) first call the system/i.test(text)) flags.push("plumbing-narration");
  // Robot template openers for failures
  if (/^I couldn't find an app called/i.test(text) && /video/i.test(text)) {
    flags.push("video-as-app-error");
  }
  return flags;
}

/** Chat-only turns must never claim tool actions. */
function fabricatedActionFlags(text: string, pathKind: PathKind): string[] {
  if (pathKind !== "chat" && pathKind !== "clarify") return [];
  const flags: string[] = [];
  if (
    /\b(opened|opening|created|added|playing|captured|screenshot|searched|launched)\b/i.test(
      text,
    ) &&
    !/\b(can|could|would|i can help)\b/i.test(text.slice(0, 40))
  ) {
    // Allow capability lists: "I can open apps…"
    if (!/\bi can\b/i.test(text) && !/\bhelp with\b/i.test(text)) {
      flags.push("fabricated-action-in-chat");
    }
  }
  return flags;
}

type Case = {
  id: string;
  category: string;
  q: string;
  /** Expected path label or prefix (capability:, orchestrated:, running-apps, chat, clarify). */
  expect: string;
  /** Optional arg checks for capability routes. */
  args?: Record<string, unknown>;
  /** If set, simulate composeResponse with this stub result and score wording. */
  composeStub?: {
    capabilityId: string;
    status: ToolResult["status"];
    summary: string;
    data?: Record<string, unknown>;
  };
};

const CASES: Case[] = [
  // ── Connection status (6) ───────────────────────────────────────────────
  {
    id: "conn-gmail",
    category: "connect",
    q: "is my gmail connected",
    expect: "orchestrated:email.get_connection_status",
  },
  {
    id: "conn-email",
    category: "connect",
    q: "is my email connected",
    expect: "orchestrated:email.get_connection_status",
  },
  {
    id: "conn-drive",
    category: "connect",
    q: "is google drive linked",
    expect: "orchestrated:drive.get_connection_status",
  },
  {
    id: "conn-calendar",
    category: "connect",
    q: "is my calendar connected",
    expect: "orchestrated:calendar.get_connection_status",
  },
  {
    id: "email-check",
    category: "connect",
    q: "check my email",
    expect: "orchestrated:email.get_inbox_summary",
  },
  {
    id: "email-latest",
    category: "connect",
    q: "what is my latest email",
    expect: "orchestrated:email.get_latest_message",
  },

  // ── Watch / running apps (8) ────────────────────────────────────────────
  {
    id: "run-whats",
    category: "watch",
    q: "what's running",
    expect: "running-apps",
  },
  {
    id: "run-what-apps",
    category: "watch",
    q: "what apps are running",
    expect: "running-apps",
  },
  {
    id: "run-open-now",
    category: "watch",
    q: "what is open right now",
    expect: "running-apps",
  },
  {
    id: "run-browser",
    category: "watch",
    q: "which browser is open",
    expect: "running-apps",
  },
  {
    id: "run-edge",
    category: "watch",
    q: "is edge open",
    expect: "running-apps",
  },
  {
    id: "run-watching",
    category: "watch",
    q: "what am i watching",
    expect: "running-apps",
  },
  {
    id: "run-youtube-page",
    category: "watch",
    q: "what's on youtube",
    expect: "running-apps",
  },
  {
    id: "shot-that",
    category: "watch",
    q: "take a screenshot of that application",
    expect: "capability:screen.capture",
    args: { target: "application" },
  },

  // ── YouTube media follow-ups (8) ────────────────────────────────────────
  {
    id: "yt-open",
    category: "youtube",
    q: "open youtube",
    expect: "capability:applications.open",
    args: { query: "youtube" },
    composeStub: {
      capabilityId: "applications.open",
      status: "success",
      summary: "Opened YouTube in your browser.",
      data: { application: "YouTube", method: "web-fallback" },
    },
  },
  {
    id: "yt-first",
    category: "youtube",
    q: "open the first video",
    expect: "capability:web.activate_listed_item",
    args: { index: 1, site: "youtube" },
    composeStub: {
      capabilityId: "web.activate_listed_item",
      status: "success",
      summary: 'Opened YouTube "Sample Video".',
      data: { title: '"Sample Video"', index: 1, site: "youtube" },
    },
  },
  {
    id: "yt-second",
    category: "youtube",
    q: "open the second video",
    expect: "capability:web.activate_listed_item",
    args: { index: 2 },
  },
  {
    id: "yt-third",
    category: "youtube",
    q: "open the third video",
    expect: "capability:web.activate_listed_item",
    args: { index: 3 },
  },
  {
    id: "yt-theird-stt",
    category: "youtube",
    q: "open the theird video",
    expect: "capability:web.activate_listed_item",
    args: { index: 3 },
  },
  {
    id: "yt-3rd",
    category: "youtube",
    q: "open the 3rd video",
    expect: "capability:web.activate_listed_item",
    args: { index: 3 },
  },
  {
    id: "yt-like-third",
    category: "youtube",
    q: "i like to open the third video",
    expect: "capability:web.activate_listed_item",
    args: { index: 3 },
  },
  {
    id: "yt-play-3",
    category: "youtube",
    q: "play video 3",
    expect: "capability:web.activate_listed_item",
    args: { index: 3 },
  },

  // ── Screenshots (4) ─────────────────────────────────────────────────────
  {
    id: "shot-screen",
    category: "screen",
    q: "take a screenshot",
    expect: "capability:screen.capture",
    composeStub: {
      capabilityId: "screen.capture",
      status: "success",
      summary: "Captured active display (1920×1080).",
      data: { capture_id: "cap1", width: 1920, height: 1080 },
    },
  },
  {
    id: "shot-that-short",
    category: "screen",
    q: "screenshot that",
    expect: "capability:screen.capture",
  },
  {
    id: "shot-snapshot",
    category: "screen",
    q: "snapshot of that application",
    expect: "capability:screen.capture",
  },
  {
    id: "shot-edge",
    category: "screen",
    q: "take a screenshot of edge",
    expect: "capability:screen.capture",
    args: { target: "application" },
  },

  // ── Apps / system (6) ───────────────────────────────────────────────────
  {
    id: "app-spotify",
    category: "apps",
    q: "open spotify",
    expect: "capability:applications.open",
    composeStub: {
      capabilityId: "applications.open",
      status: "success",
      summary: "I opened Spotify.",
      data: { application: "Spotify", method: "native" },
    },
  },
  {
    id: "app-time",
    category: "apps",
    q: "what time is it",
    expect: "capability:system.get_local_datetime",
  },
  {
    id: "app-desktop",
    category: "apps",
    q: "what's on my desktop",
    expect: "capability:filesystem.list_known_folder",
  },
  {
    id: "app-clipboard",
    category: "apps",
    q: "what's on my clipboard",
    expect: "capability:clipboard.read_text",
  },
  {
    id: "app-search-yt",
    category: "apps",
    q: "search youtube for jazz piano",
    expect: "capability:web.search",
  },
  {
    id: "app-settings",
    category: "apps",
    q: "go to settings",
    expect: "orchestrated:arcsonare.navigate",
  },

  // ── Chat / naturalness (6) ──────────────────────────────────────────────
  {
    id: "chat-hi",
    category: "chat",
    q: "hi",
    expect: "chat",
  },
  {
    id: "chat-thanks",
    category: "chat",
    q: "thanks",
    expect: "chat",
  },
  {
    id: "chat-how",
    category: "chat",
    q: "hey how's it going",
    expect: "chat",
  },
  {
    id: "chat-what-can",
    category: "chat",
    q: "what can you do",
    expect: "chat",
  },
  {
    id: "clarify-task",
    category: "chat",
    q: "can you create a task for me",
    expect: "clarify",
  },
  {
    id: "clarify-search",
    category: "chat",
    q: "search youtube",
    expect: "clarify",
  },

  // ── Calendar / drive (2) ────────────────────────────────────────────────
  {
    id: "cal-today",
    category: "connect",
    q: "what's on my calendar today",
    expect: "orchestrated:calendar.list_events",
  },
  {
    id: "cal-aug-8",
    category: "connect",
    q: "what do I have on August 8th",
    expect: "orchestrated:calendar.list_events",
  },
  {
    id: "cal-check-aug",
    category: "connect",
    q: "check my calendar for August 8",
    expect: "orchestrated:calendar.list_events",
  },
  {
    id: "drive-list",
    category: "connect",
    q: "what's in my google drive",
    expect: "orchestrated:drive.list",
  },
];

function expectMatch(got: string, expect: string): boolean {
  if (got === expect) return true;
  if (expect.endsWith(":") && got.startsWith(expect)) return true;
  // prefix match: capability:web.activate_listed_item
  if (got.startsWith(expect)) return true;
  return false;
}

function argsMatch(
  got: Record<string, unknown> | undefined,
  want: Record<string, unknown> | undefined,
): boolean {
  if (!want) return true;
  if (!got) return false;
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v && String(got[k]) !== String(v)) return false;
  }
  return true;
}

async function liveChat(user: string): Promise<string> {
  const system = buildAssistantPrompt({
    datetime: new Date().toLocaleString(),
    zone: "America/New_York",
    integrations:
      "Connected integrations: Gmail, Google Calendar, Google Drive. Everything else is not connected.",
    memory: "",
    desktop:
      "WATCHED apps: Edge — Active page/window: \"YouTube\". Zoom is also open.",
  });
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0.4 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const json = (await res.json()) as { message?: { content?: string } };
  return (json.message?.content ?? "").trim();
}

type Row = {
  id: string;
  category: string;
  q: string;
  expect: string;
  got: string;
  routeOk: boolean;
  argsOk: boolean;
  robotic: string[];
  sampleReply?: string;
  note?: string;
};

async function main() {
  const rows: Row[] = [];

  for (const c of CASES) {
    const path = resolvePath(c.q);
    const got = pathLabel(path);
    const routeOk = expectMatch(got, c.expect);
    const argsOk = argsMatch(path.args, c.args);

    let sampleReply = "";
    const robotic: string[] = [];

    if (c.composeStub) {
      const stub: ToolResult = {
        callId: "eval",
        capabilityId: c.composeStub.capabilityId,
        status: c.composeStub.status,
        summary: c.composeStub.summary,
        data: c.composeStub.data,
        evidence: { verified: true, method: "eval" },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
      sampleReply = composeResponse(stub, c.q);
      robotic.push(...roboticFlags(sampleReply));
    }

    if (LIVE && path.kind === "chat") {
      try {
        const live = await liveChat(c.q);
        sampleReply = live;
        robotic.push(...roboticFlags(live));
        robotic.push(...fabricatedActionFlags(live, path.kind));
      } catch (e) {
        sampleReply = `(live failed: ${e instanceof Error ? e.message : e})`;
      }
    }
    // Clarify path in-app asks one question — mirror that, don't free-chat invent actions.
    if (LIVE && path.kind === "clarify") {
      try {
        const instruction = [
          "The user asked you to do something but left out a detail.",
          `What they said: "${c.q}"`,
          "Ask one short friendly question for the missing detail. Do not perform any action. Do not claim you opened, searched, or created anything.",
        ].join("\n");
        const live = await liveChat(instruction);
        sampleReply = live;
        robotic.push(...roboticFlags(live));
        robotic.push(...fabricatedActionFlags(live, "clarify"));
      } catch (e) {
        sampleReply = `(live failed: ${e instanceof Error ? e.message : e})`;
      }
    }

    // Route-level red flags
    if (
      path.kind === "capability" &&
      path.id === "applications.open" &&
      /\bvideo\b/i.test(c.q)
    ) {
      robotic.push("video-routed-as-app");
    }

    rows.push({
      id: c.id,
      category: c.category,
      q: c.q,
      expect: c.expect,
      got,
      routeOk,
      argsOk,
      robotic: [...new Set(robotic)],
      sampleReply: sampleReply || undefined,
    });
  }

  const routeFails = rows.filter((r) => !r.routeOk || !r.argsOk);
  const roboticFails = rows.filter((r) => r.robotic.length > 0);
  const pass = rows.filter((r) => r.routeOk && r.argsOk && r.robotic.length === 0);

  console.log("═".repeat(72));
  console.log(`CHAT QUALITY EVAL — ${CASES.length} questions (chat decision path)`);
  console.log(`Live model replies: ${LIVE ? `yes (${MODEL})` : "no (routing + compose only)"}`);
  console.log("═".repeat(72));

  for (const r of rows) {
    const mark =
      r.routeOk && r.argsOk && r.robotic.length === 0
        ? "PASS"
        : !r.routeOk || !r.argsOk
          ? "FAIL-ROUTE"
          : "FAIL-STYLE";
    console.log(
      `\n[${mark}] ${r.id} (${r.category})\n  Q: "${r.q}"\n  route: ${r.got}${r.routeOk ? "" : `  WANT ${r.expect}`}${r.argsOk ? "" : "  (args mismatch)"}`,
    );
    if (r.robotic.length) console.log(`  robotic: ${r.robotic.join(", ")}`);
    if (r.sampleReply) {
      const preview = r.sampleReply.replace(/\s+/g, " ").slice(0, 160);
      console.log(`  reply: ${preview}${r.sampleReply.length > 160 ? "…" : ""}`);
    }
  }

  console.log("\n" + "─".repeat(72));
  console.log(
    `SUMMARY  route+style pass: ${pass.length}/${rows.length}  |  route fails: ${routeFails.length}  |  style flags: ${roboticFails.length}`,
  );

  // Category breakdown
  const cats = [...new Set(rows.map((r) => r.category))];
  for (const cat of cats) {
    const subset = rows.filter((r) => r.category === cat);
    const ok = subset.filter((r) => r.routeOk && r.argsOk && r.robotic.length === 0).length;
    console.log(`  ${cat}: ${ok}/${subset.length}`);
  }

  // Persist JSON for later
  const out = {
    at: new Date().toISOString(),
    live: LIVE,
    model: LIVE ? MODEL : null,
    total: rows.length,
    pass: pass.length,
    routeFails: routeFails.map((r) => r.id),
    styleFails: roboticFails.map((r) => ({ id: r.id, flags: r.robotic })),
    rows,
  };
  const { writeFileSync } = await import("node:fs");
  writeFileSync("chat-quality-eval-report.json", JSON.stringify(out, null, 2));
  console.log("\nWrote chat-quality-eval-report.json");

  process.exit(routeFails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
