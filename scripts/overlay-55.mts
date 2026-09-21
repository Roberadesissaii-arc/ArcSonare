/**
 * 55 overlay utterances — the loose, spoken phrasings the voice path actually
 * receives, rather than the tidy ones a person would type.
 *
 * Speech has no punctuation and no capitals, so every case here is lowercase
 * and unpunctuated on purpose: that is what the STT layer hands over.
 *
 * Run: npx tsx scripts/overlay-55.mts
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

type Case = {
  q: string;
  /** Expected capability id, "clarify", or "chat". */
  want: string;
  /** Argument subset that must match. */
  args?: Record<string, unknown>;
  /** Nested-object argument check (for __known_subpath). */
  sub?: { folder: string; name: string };
};

function route(text: string): { id: string; args: Record<string, unknown> } {
  if (needsTaskTitle(text) || needsSearchQuery(text)) return { id: "clarify", args: {} };
  const c = classifyIntent(text);
  if (isOrchestratedDomain(c)) return { id: c.capabilityId ?? "(unmapped)", args: {} };
  const d = routeDeterministic(text);
  if (d) return { id: d.capabilityId, args: d.arguments ?? {} };
  return { id: "chat", args: {} };
}

const CASES: Case[] = [
  // ── Named subfolder — the bug that kept returning the whole desktop ──────
  { q: "what's inside fantastic folder which is on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "what's inside the fantastic folder which is on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "tell me what's inside fantastic which is on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "what is in fantastic folder that is on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "what's in the fantastic folder on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "go to my desktop and tell me what's inside fantastic", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "list the contents of fantastic on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "what's inside the folder called fantastic on my desktop", want: "filesystem.list_directory", sub: { folder: "desktop", name: "fantastic" } },
  { q: "show me what's in reports in my documents", want: "filesystem.list_directory", sub: { folder: "documents", name: "reports" } },

  // ── Known folders — must NOT become a subfolder lookup ───────────────────
  { q: "what's on my desktop", want: "filesystem.list_known_folder", args: { folder: "desktop" } },
  { q: "what's in my downloads", want: "filesystem.list_known_folder", args: { folder: "downloads" } },
  { q: "show me my documents", want: "filesystem.list_known_folder", args: { folder: "documents" } },
  { q: "list my pictures", want: "filesystem.list_known_folder", args: { folder: "pictures" } },
  { q: "what do i have in my videos", want: "filesystem.list_known_folder", args: { folder: "videos" } },

  // ── Create ───────────────────────────────────────────────────────────────
  { q: "create a folder called reports on my desktop", want: "filesystem.create_directory", args: { name: "reports" } },
  { q: "make a new folder on my desktop named invoices", want: "filesystem.create_directory", args: { name: "invoices" } },
  { q: "create a folder called q4 in my documents", want: "filesystem.create_directory", args: { __known_parent: "documents" } },

  // ── Find ─────────────────────────────────────────────────────────────────
  { q: "find red_distortion_4.heic", want: "filesystem.find" },
  { q: "find my budget spreadsheet", want: "filesystem.find" },
  { q: "where is my resume", want: "filesystem.find" },

  // ── Apps ─────────────────────────────────────────────────────────────────
  { q: "open spotify", want: "applications.open", args: { query: "spotify" } },
  { q: "launch visual studio code", want: "applications.open", args: { query: "visual studio code" } },
  { q: "open the calculator app", want: "applications.open", args: { query: "calculator" } },
  { q: "close spotify", want: "applications.close", args: { query: "spotify" } },
  { q: "what apps do i have open", want: "chat" },

  // ── System ───────────────────────────────────────────────────────────────
  { q: "what time is it", want: "system.get_local_datetime" },
  { q: "what's today's date", want: "system.get_local_datetime" },
  { q: "what timezone am i in", want: "system.get_local_datetime" },
  { q: "what's on my clipboard", want: "clipboard.read_text" },

  // ── Screenshots ──────────────────────────────────────────────────────────
  { q: "take a screenshot", want: "screen.capture", args: { target: "active-display" } },
  { q: "screenshot my second monitor", want: "screen.capture", args: { target: "display", display_id: "2" } },
  { q: "screenshot my first monitor", want: "screen.capture", args: { target: "display", display_id: "1" } },
  { q: "screenshot the left half", want: "screen.capture", args: { target: "portion", portion: "left-half" } },
  { q: "screenshot the right half", want: "screen.capture", args: { target: "portion", portion: "right-half" } },
  { q: "screenshot the center third", want: "screen.capture", args: { target: "portion", portion: "center-third" } },
  { q: "take a screenshot of spotify", want: "screen.capture", args: { target: "application", application_query: "spotify" } },

  // ── Tasks ────────────────────────────────────────────────────────────────
  { q: "create a task to renew my passport", want: "tasks.create", args: { title: "renew my passport" } },
  { q: "remind me to pay the electricity bill", want: "tasks.create", args: { title: "pay the electricity bill" } },
  { q: "make a grocery shopping task", want: "tasks.create", args: { title: "grocery shopping" } },
  { q: "list my tasks", want: "tasks.list" },
  { q: "what are my urgent tasks", want: "tasks.list", args: { filter: "urgent" } },
  { q: "mark the passport task done", want: "tasks.complete" },
  { q: "can you create a task for me", want: "clarify" },

  // ── Connected services ───────────────────────────────────────────────────
  { q: "check my email", want: "email.get_inbox_summary" },
  { q: "what's in my gmail", want: "email.get_inbox_summary" },
  { q: "what is my latest email", want: "email.get_latest_message" },
  { q: "do i have any unread emails", want: "email.list_unread" },
  { q: "open gmail", want: "email.open_inbox_ui" },
  { q: "is my gmail connected", want: "email.get_connection_status" },
  { q: "what's on my calendar today", want: "calendar.list_events" },
  { q: "what's my next meeting", want: "calendar.get_next_event" },
  { q: "what's in my google drive", want: "drive.list" },
  { q: "add a dentist appointment tomorrow at 2 30 to my calendar", want: "calendar.create_event" },

  // ── Web ──────────────────────────────────────────────────────────────────
  { q: "search youtube for jazz piano", want: "web.search", args: { query: "jazz piano", site: "youtube" } },
  { q: "search youtube", want: "clarify" },
];

const rows: { n: number; q: string; want: string; got: string; pass: boolean; why: string }[] = [];

CASES.forEach((c, i) => {
  const r = route(c.q);
  let pass = r.id === c.want;
  let why = pass ? "" : `got ${r.id}`;

  if (pass && c.args) {
    for (const [k, v] of Object.entries(c.args)) {
      if (r.args[k] !== v) {
        pass = false;
        why = `${k}=${JSON.stringify(r.args[k])} want ${JSON.stringify(v)}`;
        break;
      }
    }
  }
  if (pass && c.sub) {
    const s = r.args.__known_subpath as { folder?: string; name?: string } | undefined;
    const nameOk = (s?.name ?? "").toLowerCase() === c.sub.name.toLowerCase();
    if (s?.folder !== c.sub.folder || !nameOk) {
      pass = false;
      why = `subpath=${JSON.stringify(s)} want ${JSON.stringify(c.sub)}`;
    }
  }
  rows.push({ n: i + 1, q: c.q, want: c.want, got: r.id, pass, why });
});

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(`OVERLAY UTTERANCES — ${CASES.length} cases (lowercase, unpunctuated, as speech arrives)`);
console.log("=".repeat(112));
console.log(`${pad("#", 4)}${pad("UTTERANCE", 56)}${pad("ROUTED TO", 34)}RESULT`);
console.log("-".repeat(112));
for (const r of rows) {
  console.log(
    `${pad(String(r.n), 4)}${pad(r.q, 56)}${pad(r.got, 34)}${r.pass ? "PASS" : "FAIL"}`,
  );
}
const failed = rows.filter((r) => !r.pass);
console.log("-".repeat(112));
console.log(`${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.log("\nFAILURES:");
  for (const f of failed) console.log(`  ${f.n}. "${f.q}"\n     want ${f.want} — ${f.why}`);
}
process.exit(failed.length ? 1 : 0);
