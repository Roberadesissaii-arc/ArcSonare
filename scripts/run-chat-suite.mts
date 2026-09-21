/**
 * End-to-end chat suite: 30 questions through the REAL decision pipeline.
 *
 * For every question it answers three things:
 *   1. ROUTE   — deterministic capability, orchestrated service, or plain chat?
 *      This is the "does it know to call a function?" check. Uses the actual
 *      capabilityRouter / IntentClassifier the app uses.
 *   2. REPLY   — for chat-routed questions, the real model with the real
 *      system prompt. This is the "is it answering or assuming?" check.
 *   3. LATENCY — wall-clock per question, plus a summary distribution.
 *
 * The native layer (Tauri `invoke`) is not exercised here — capability
 * EXECUTION is Rust-side. What is proven is that each utterance reaches the
 * right handler and that chat answers are grounded.
 *
 * Run: npx tsx scripts/run-chat-suite.mts
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
import { buildAssistantPrompt } from "../src/services/assistantPrompt";
import { stripTrailingFiller } from "../src/services/stripFiller";

const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";
const MODEL = process.env.ARCSONARE_TEST_MODEL || "llama3.2:latest";

const SYSTEM = buildAssistantPrompt({
  datetime: new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),
  zone: "America/New_York",
  integrations:
    "Connected integrations: Gmail, Google Calendar, Google Drive. Everything else is not connected.",
  memory: "",
});

function resolveRoute(text: string): Route {
  // Uses the app's own helpers — duplicating them here is what let the harness
  // silently drift out of sync with the code it was supposed to be testing.
  if (needsTaskTitle(text)) return { kind: "ask-clarify" };
  if (needsSearchQuery(text)) return { kind: "ask-clarify" };
  const contract = classifyIntent(text);
  if (isOrchestratedDomain(contract)) {
    return { kind: "orchestrated", id: contract.capabilityId ?? "(unmapped)" };
  }
  const det = routeDeterministic(text);
  if (det) return { kind: "capability", id: det.capabilityId };
  return { kind: "chat" };
}

function routeLabel(r: Route): string {
  switch (r.kind) {
    case "ask-clarify": return "ask-clarify";
    case "capability": return `capability:${r.id}`;
    case "orchestrated": return `orchestrated:${r.id}`;
    default: return "chat";
  }
}

type Case = {
  q: string;
  /** Expected route label, or a prefix like "capability:" when the id may vary. */
  expect: string;
  /** Extra assertions on a chat reply. */
  reply?: { mustNot?: RegExp; must?: RegExp; note?: string };
};

const CASES: Case[] = [
  // ── Actions that must call a function, not be talked about ──────────────
  { q: "open spotify", expect: "capability:applications.open" },
  { q: "open chrome", expect: "capability:applications.open" },
  { q: "take a screenshot", expect: "capability:screen.capture" },
  { q: "what time is it", expect: "capability:system.get_local_datetime" },
  { q: "what's today's date", expect: "capability:system.get_local_datetime" },
  { q: "what's on my desktop", expect: "capability:filesystem.list_known_folder" },
  { q: "what's on my clipboard", expect: "capability:clipboard.read_text" },
  { q: "go to settings", expect: "orchestrated:arcsonare.navigate" },
  { q: "create a task to call the bank", expect: "capability:tasks.create" },
  { q: "remind me to submit the report", expect: "capability:tasks.create" },
  // Title BEFORE the noun — used to fall through and hit tasks.complete.
  { q: "make a chicken task", expect: "capability:tasks.create" },
  { q: "add a dentist task", expect: "capability:tasks.create" },
  // Site-scoped search phrasings.
  { q: "search youtube for lofi", expect: "capability:web.search" },
  { q: "search on youtube for lofi", expect: "capability:web.search" },
  { q: "google rust lifetimes", expect: "capability:web.search" },
  // No search terms — must ask, not fail schema validation.
  { q: "search youtube", expect: "ask-clarify" },
  { q: "search on youtube", expect: "ask-clarify" },

  // ── Missing information must be asked for, never invented ───────────────
  { q: "can you create a task for me", expect: "ask-clarify" },
  { q: "make me a task", expect: "ask-clarify" },

  // ── Connected services: read must not become open ───────────────────────
  { q: "check my email", expect: "orchestrated:email.get_inbox_summary" },
  { q: "what's in my gmail", expect: "orchestrated:email.get_inbox_summary" },
  { q: "what is my latest email", expect: "orchestrated:email.get_latest_message" },
  { q: "do I have any unread emails", expect: "orchestrated:email.list_unread" },
  { q: "open gmail", expect: "orchestrated:email.open_inbox_ui" },
  { q: "what's on my calendar today", expect: "orchestrated:calendar.list_events" },
  { q: "what's my next meeting", expect: "orchestrated:calendar.get_next_event" },
  { q: "open my calendar", expect: "orchestrated:calendar.open_ui" },
  { q: "what's in my google drive", expect: "orchestrated:drive.list" },
  { q: "is my gmail connected", expect: "orchestrated:email.get_connection_status" },
  { q: "is google drive linked", expect: "orchestrated:drive.get_connection_status" },

  // ── Calendar writes must never become tasks ─────────────────────────────
  { q: "i have a apponment today at 1:30 add to my calander", expect: "orchestrated:calendar.create_event" },
  { q: "add dentist tomorrow at 9am to my calendar", expect: "orchestrated:calendar.create_event" },
  { q: "schedule a meeting today at 3pm", expect: "orchestrated:calendar.create_event" },
  { q: "put lunch with Sam on my calendar tomorrow at 12:30", expect: "orchestrated:calendar.create_event" },

  // ── Real conversation: must answer, not recite context or fabricate ─────
  {
    q: "hi",
    expect: "chat",
    reply: { mustNot: /\b(2026|january|february|march|april|may|june|july|august)\b|\d{1,2}:\d{2}/i, note: "no unprompted clock" },
  },
  {
    q: "what is the capital of Japan",
    expect: "chat",
    reply: { must: /tokyo/i, note: "must actually answer" },
  },
  {
    q: "how many days are in a leap year",
    expect: "chat",
    reply: { must: /366/, note: "must actually answer" },
  },
  {
    q: "write me a haiku about rain",
    expect: "chat",
    reply: { mustNot: /\bdraft\b.*\bsend\b|won'?t send/i, note: "must not be treated as an email draft" },
  },
  {
    q: "can you write me an essay about space",
    expect: "chat",
    reply: { mustNot: /won'?t send it|prepared a draft for review/i, note: "must not be treated as an email draft" },
  },
  {
    q: "explain what an API is in one sentence",
    expect: "chat",
    reply: { must: /interface|protocol|communicate/i, note: "must produce a real explanation" },
  },
  {
    q: "thanks",
    expect: "chat",
    reply: { mustNot: /how can I (assist|help) you/i, note: "no filler closer" },
  },
];

async function askModel(prompt: string): Promise<{ text: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0.7 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const json = (await res.json()) as { message?: { content?: string } };
  // Same post-processing the app applies before the user sees a reply.
  return { text: stripTrailingFiller(json.message?.content ?? ""), ms: Date.now() - started };
}

const main = async () => {
  console.log(`Model: ${MODEL}   Cases: ${CASES.length}\n${"=".repeat(74)}`);
  let routeFails = 0;
  let replyFails = 0;
  const latencies: number[] = [];

  for (const c of CASES) {
    const started = Date.now();
    const route = resolveRoute(c.q);
    const label = routeLabel(route);
    const routeOk = label === c.expect;
    if (!routeOk) routeFails++;

    let replyLine = "";
    let replyBad: string | null = null;

    if (route.kind === "chat" && c.reply) {
      try {
        const { text, ms } = await askModel(c.q);
        latencies.push(ms);
        const flat = text.trim().replace(/\n+/g, " ");
        replyLine = `\n      reply (${ms}ms): ${flat.slice(0, 150)}${flat.length > 150 ? "…" : ""}`;
        if (c.reply.must && !c.reply.must.test(text)) replyBad = c.reply.note ?? "missing expected content";
        if (c.reply.mustNot && c.reply.mustNot.test(text)) replyBad = c.reply.note ?? "contained forbidden content";
      } catch (err) {
        replyBad = `model error: ${(err as Error).message}`;
      }
      if (replyBad) replyFails++;
    } else {
      latencies.push(Date.now() - started);
    }

    const status = routeOk && !replyBad ? "PASS" : "FAIL";
    console.log(`[${status}] "${c.q}"\n      route: ${label}${routeOk ? "" : `   (expected ${c.expect})`}${replyLine}${replyBad ? `\n      !! ${replyBad}` : ""}`);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (n: number) => sorted[Math.min(sorted.length - 1, Math.floor((n / 100) * sorted.length))] ?? 0;
  console.log(`\n${"=".repeat(74)}`);
  console.log(`Routing:  ${CASES.length - routeFails}/${CASES.length} correct`);
  console.log(`Replies:  ${replyFails} failed assertions`);
  console.log(`Latency:  median ${p(50)}ms · p90 ${p(90)}ms · max ${sorted[sorted.length - 1] ?? 0}ms`);
  process.exit(routeFails + replyFails > 0 ? 1 : 0);
};

void main();
