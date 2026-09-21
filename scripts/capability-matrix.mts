/**
 * Capability matrix — 30 real, functional requests.
 *
 * Asserts BOTH the capability chosen AND the arguments extracted. A request
 * that reaches the right function with the wrong arguments is still broken
 * ("create a task to renew my passport" reaching tasks.create with the title
 * "to renew" would pass a routing-only test and fail the user).
 *
 * Run: npx tsx scripts/capability-matrix.mts
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
import { parseEventFromText } from "../src/features/orchestration/parseEventTime";

type Expect = {
  /** Capability id, or "ask-clarify". */
  id: string;
  /** Argument subset that must match exactly. */
  args?: Record<string, unknown>;
};

type Case = { n: number; q: string; expect: Expect; note?: string };

const CASES: Case[] = [
  // ── Tasks: create, with the full title preserved ────────────────────────
  { n: 1, q: "create a task to renew my passport", expect: { id: "tasks.create", args: { title: "renew my passport" } } },
  { n: 2, q: "add a task to call the dentist tomorrow", expect: { id: "tasks.create", args: { title: "call the dentist tomorrow" } } },
  { n: 3, q: "make a grocery shopping task", expect: { id: "tasks.create", args: { title: "grocery shopping" } } },
  { n: 4, q: "remind me to pay the electricity bill", expect: { id: "tasks.create", args: { title: "pay the electricity bill" } } },
  { n: 5, q: "can you create a task for me", expect: { id: "ask-clarify" }, note: "no title → must ask" },
  { n: 6, q: "mark the passport task done", expect: { id: "tasks.complete" } },

  // ── Filesystem: folders and files with correct targets ──────────────────
  { n: 7, q: "what's on my desktop", expect: { id: "filesystem.list_known_folder", args: { folder: "desktop" } } },
  { n: 8, q: "what's in my downloads", expect: { id: "filesystem.list_known_folder", args: { folder: "downloads" } } },
  { n: 9, q: "show me my documents", expect: { id: "filesystem.list_known_folder", args: { folder: "documents" } } },
  { n: 10, q: "find my budget spreadsheet", expect: { id: "filesystem.find" } },
  { n: 31, q: "create a folder called Reports on my desktop", expect: { id: "filesystem.create_directory", args: { __known_parent: "desktop", name: "Reports" } } },
  { n: 32, q: "make a new folder on my desktop named Invoices", expect: { id: "filesystem.create_directory", args: { __known_parent: "desktop", name: "Invoices" } } },
  { n: 33, q: "create a folder called Q4 in my documents", expect: { id: "filesystem.create_directory", args: { __known_parent: "documents", name: "Q4" } } },
  { n: 34, q: "list my tasks", expect: { id: "tasks.list" } },
  { n: 35, q: "close spotify", expect: { id: "applications.close", args: { query: "spotify" } } },
  { n: 36, q: "summarize my inbox", expect: { id: "email.get_inbox_summary" } },

  // ── Applications ────────────────────────────────────────────────────────
  { n: 11, q: "open spotify", expect: { id: "applications.open", args: { query: "spotify" } } },
  { n: 12, q: "launch visual studio code", expect: { id: "applications.open", args: { query: "visual studio code" } } },
  { n: 13, q: "open the calculator app", expect: { id: "applications.open", args: { query: "calculator" } } },

  // ── System ──────────────────────────────────────────────────────────────
  { n: 14, q: "what time is it", expect: { id: "system.get_local_datetime" } },
  { n: 15, q: "what's today's date", expect: { id: "system.get_local_datetime" } },
  { n: 16, q: "take a screenshot", expect: { id: "screen.capture", args: { target: "active-display" } } },
  { n: 17, q: "what's on my clipboard", expect: { id: "clipboard.read_text" } },

  // ── Web search: query and site extracted correctly ──────────────────────
  { n: 18, q: "search youtube for jazz piano", expect: { id: "web.search", args: { query: "jazz piano", site: "youtube" } } },
  { n: 19, q: "google rust ownership rules", expect: { id: "web.search", args: { query: "rust ownership rules" } } },
  { n: 20, q: "search youtube", expect: { id: "ask-clarify" }, note: "no query → must ask" },

  // ── Gmail / Calendar / Drive: read must not become open ─────────────────
  { n: 21, q: "what's in my gmail", expect: { id: "email.get_inbox_summary" } },
  { n: 22, q: "do I have any unread emails", expect: { id: "email.list_unread" } },
  { n: 23, q: "what is my latest email", expect: { id: "email.get_latest_message" } },
  { n: 24, q: "open gmail", expect: { id: "email.open_inbox_ui" }, note: "explicit open" },
  { n: 25, q: "what's on my calendar today", expect: { id: "calendar.list_events" } },
  { n: 26, q: "what's my next meeting", expect: { id: "calendar.get_next_event" } },
  { n: 27, q: "what files are in my google drive", expect: { id: "drive.list" } },
  { n: 28, q: "is my gmail connected", expect: { id: "email.get_connection_status" } },

  // ── Calendar write: must create an event, never a task ──────────────────
  { n: 29, q: "add a dentist appointment tomorrow at 2:30 to my calendar", expect: { id: "calendar.create_event" } },
  { n: 30, q: "schedule a team sync friday at 10am", expect: { id: "calendar.create_event" } },
];

type Resolved = { id: string; args: Record<string, unknown> };

/** Reproduces askAssistant()'s routing order. */
function resolve(text: string): Resolved {
  if (needsTaskTitle(text) || needsSearchQuery(text)) return { id: "ask-clarify", args: {} };
  const contract = classifyIntent(text);
  if (isOrchestratedDomain(contract)) {
    return { id: contract.capabilityId ?? "(unmapped)", args: {} };
  }
  const det = routeDeterministic(text);
  if (det) return { id: det.capabilityId, args: det.arguments ?? {} };
  return { id: "chat", args: {} };
}

const rows: {
  n: number;
  q: string;
  want: string;
  got: string;
  pass: boolean;
  why: string;
}[] = [];

for (const c of CASES) {
  const r = resolve(c.q);
  let pass = r.id === c.expect.id;
  let why = pass ? "" : `wrong capability`;

  if (pass && c.expect.args) {
    for (const [k, v] of Object.entries(c.expect.args)) {
      if (r.args[k] !== v) {
        pass = false;
        why = `arg ${k}=${JSON.stringify(r.args[k])} (want ${JSON.stringify(v)})`;
        break;
      }
    }
  }

  // Calendar creates must also yield a usable event.
  if (pass && c.expect.id === "calendar.create_event") {
    const ev = parseEventFromText(c.q);
    if (!ev) {
      pass = false;
      why = "no event time parsed";
    } else {
      why = `→ "${ev.title}" @ ${ev.start.slice(0, 16)}`;
    }
  }

  rows.push({ n: c.n, q: c.q, want: c.expect.id, got: r.id, pass, why });
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(
  `${pad("#", 3)}${pad("REQUEST", 46)}${pad("EXPECTED", 30)}${pad("GOT", 30)}RESULT`,
);
console.log("-".repeat(122));
for (const r of rows) {
  console.log(
    `${pad(String(r.n), 3)}${pad(r.q, 46)}${pad(r.want, 30)}${pad(r.got, 30)}${r.pass ? "PASS" : "FAIL"}${r.why && !r.pass ? "  ← " + r.why : ""}`,
  );
}
const failed = rows.filter((r) => !r.pass);
console.log("-".repeat(122));
console.log(`${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.n}. "${f.q}"  → ${f.got}  (${f.why})`);
}
process.exit(failed.length ? 1 : 0);
