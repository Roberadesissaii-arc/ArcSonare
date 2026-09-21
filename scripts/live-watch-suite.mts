/**
 * LIVE Watch / Edge / YouTube suite (~20 steps).
 *
 * This does NOT only check routing. Writing the trigger file makes the
 * running ArcSonare app execute each utterance for real through the overlay
 * (open YouTube, open the first video, screenshot, …) so you can watch
 * Edge and the screen change as it runs.
 *
 * Prerequisites
 *   1. ArcSonare is running: npm run tauri dev
 *   2. Microsoft Edge is open (optional but recommended for Watch context)
 *   3. You can see the desktop / Edge while the suite runs
 *
 * Usage
 *   npx tsx scripts/live-watch-suite.mts           # dry-run routes only
 *   npx tsx scripts/live-watch-suite.mts --live    # fire real overlay run
 *   npx tsx scripts/live-watch-suite.mts --stop    # stop a running suite
 *
 * During --live: Esc in ArcSonare also stops the suite.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRIGGER = join(ROOT, "public", "overlay-test-trigger.json");

/** Seconds between steps — long enough for YouTube to open / a video to load. */
const GAP_MS = 14_000;

type Step = {
  n: number;
  q: string;
  /** What you should see if it worked. */
  expectSee: string;
  /** Expected route label for dry-run. */
  want: string;
};

/**
 * Ordered story: Watch / Edge context → open YouTube → pick videos →
 * screenshot / follow-ups. Spoken-style lowercase (what STT often produces).
 */
export const WATCH_SUITE: Step[] = [
  {
    n: 1,
    q: "what's running",
    expectSee: "Mentions Edge / open apps (Watch list if you selected any)",
    want: "running-apps",
  },
  {
    n: 2,
    q: "which browser is open",
    expectSee: "Says Edge (or your open browser) is open",
    want: "running-apps",
  },
  {
    n: 3,
    q: "is edge open",
    expectSee: "Yes / Edge is open",
    want: "running-apps",
  },
  {
    n: 4,
    q: "what am i watching",
    expectSee: "Watched apps if any are checked; else open apps",
    want: "running-apps",
  },
  {
    n: 5,
    q: "open youtube",
    expectSee: "Edge (or browser) opens YouTube",
    want: "capability:applications.open",
  },
  {
    n: 6,
    q: "what's on youtube",
    expectSee: "Uses window title / watched browser if available",
    want: "running-apps",
  },
  {
    n: 7,
    q: "open the first video",
    expectSee: "A YouTube watch page for the 1st listed video opens",
    want: "capability:web.activate_listed_item",
  },
  {
    n: 8,
    q: "open the second video",
    expectSee: "A different YouTube video (#2) opens",
    want: "capability:web.activate_listed_item",
  },
  {
    n: 9,
    q: "open the third video",
    expectSee: "YouTube video #3 opens",
    want: "capability:web.activate_listed_item",
  },
  {
    n: 10,
    q: "open the theird video",
    expectSee: "Same as third (STT typo) — video #3, not app-not-found",
    want: "capability:web.activate_listed_item",
  },
  {
    n: 11,
    q: "play video 1",
    expectSee: "YouTube video #1 opens",
    want: "capability:web.activate_listed_item",
  },
  {
    n: 12,
    q: "take a screenshot",
    expectSee: "Screenshot captured (overlay/chat shows it)",
    want: "capability:screen.capture",
  },
  {
    n: 13,
    q: "screenshot that",
    expectSee: "Screenshot of last app / watched app (Edge/YouTube)",
    want: "capability:screen.capture",
  },
  {
    n: 14,
    q: "take a screenshot of that application",
    expectSee: "Screenshot of Edge/YouTube window",
    want: "capability:screen.capture",
  },
  {
    n: 15,
    q: "take a screenshot of edge",
    expectSee: "Screenshot of Edge",
    want: "capability:screen.capture",
  },
  {
    n: 16,
    q: "search youtube for lofi hip hop",
    expectSee: "YouTube search results for lofi open",
    want: "capability:web.search",
  },
  {
    n: 17,
    q: "open the first video",
    expectSee: "First result from that search (if media context kept)",
    want: "capability:web.activate_listed_item",
  },
  {
    n: 18,
    q: "what's running",
    expectSee: "Still lists Edge; may show YouTube page title",
    want: "running-apps",
  },
  {
    n: 19,
    q: "open youtube",
    expectSee: "Focuses / reopens YouTube",
    want: "capability:applications.open",
  },
  {
    n: 20,
    q: "open the 2nd video",
    expectSee: "Second video opens (not '2nd video' as an app name)",
    want: "capability:web.activate_listed_item",
  },
];

function resolveRoute(text: string): string {
  if (isRunningAppsQuestion(text)) return "running-apps";
  if (needsTaskTitle(text) || needsSearchQuery(text)) return "clarify";
  const c = classifyIntent(text);
  if (isOrchestratedDomain(c)) {
    return `orchestrated:${c.capabilityId ?? "(unmapped)"}`;
  }
  const d = routeDeterministic(text);
  if (d) return `capability:${d.capabilityId}`;
  return "chat";
}

function expectMatch(got: string, want: string): boolean {
  return got === want || got.startsWith(want);
}

function dryRun(): number {
  console.log("═".repeat(72));
  console.log("WATCH / YOUTUBE LIVE SUITE — dry-run (routes only)");
  console.log("═".repeat(72));
  let fail = 0;
  for (const step of WATCH_SUITE) {
    const got = resolveRoute(step.q);
    const ok = expectMatch(got, step.want);
    if (!ok) fail++;
    console.log(
      `\n${ok ? "PASS" : "FAIL"}  ${step.n}/${WATCH_SUITE.length}  "${step.q}"`,
    );
    console.log(`  route: ${got}${ok ? "" : `  WANT ${step.want}`}`);
    console.log(`  expect to see: ${step.expectSee}`);
  }
  console.log("\n" + "─".repeat(72));
  console.log(
    `Routes: ${WATCH_SUITE.length - fail}/${WATCH_SUITE.length} OK`,
  );
  console.log(
    "\nTo run FOR REAL (you will see Edge/YouTube change):\n  npx tsx scripts/live-watch-suite.mts --live",
  );
  return fail;
}

function fireLive(): void {
  const dryFails = dryRun();
  if (dryFails > 0) {
    console.error(
      `\nRefusing --live: ${dryFails} route failure(s). Fix routing first.`,
    );
    process.exit(1);
  }

  const token = `watch-youtube-${Date.now()}`;
  const payload = {
    token,
    gapMs: GAP_MS,
    utterances: WATCH_SUITE.map((s) => s.q),
  };
  writeFileSync(TRIGGER, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const minutes = Math.ceil((WATCH_SUITE.length * GAP_MS) / 60_000);
  console.log("\n" + "═".repeat(72));
  console.log("LIVE RUN ARMED");
  console.log("═".repeat(72));
  console.log(`Trigger written: public/overlay-test-trigger.json`);
  console.log(`Token: ${token}`);
  console.log(`Steps: ${WATCH_SUITE.length}`);
  console.log(`Gap between steps: ${GAP_MS / 1000}s`);
  console.log(`Rough duration: ~${minutes} min`);
  console.log(`
WHAT YOU SHOULD DO NOW
  1. Keep ArcSonare (tauri dev) focused / visible
  2. Keep Microsoft Edge open
  3. Watch the overlay + Edge — each line below will run for real

STEP GUIDE (follow along)
${WATCH_SUITE.map((s) => `  ${String(s.n).padStart(2)}. "${s.q}"\n      → ${s.expectSee}`).join("\n")}

STOP
  Esc in ArcSonare, or:
  npx tsx scripts/live-watch-suite.mts --stop
`);
}

function stopLive(): void {
  writeFileSync(
    TRIGGER,
    `${JSON.stringify({ token: "stop", stop: true }, null, 2)}\n`,
    "utf8",
  );
  console.log("Stop signal written. Overlay suite should halt within ~2s.");
}

const args = process.argv.slice(2);
if (args.includes("--stop")) {
  stopLive();
} else if (args.includes("--live")) {
  fireLive();
} else {
  const fails = dryRun();
  process.exit(fails ? 1 : 0);
}
