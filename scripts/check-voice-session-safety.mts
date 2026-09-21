/**
 * A closed voice session must not be able to do anything.
 *
 * Observed failure: the voice overlay was opened, picked up ambient room audio,
 * and created a task called "Beauty and the Beast" that nobody asked for. The
 * session had been dismissed, but `runToolCall` is async — it awaits
 * `dispatchRealtimeToolCall`, and the only `closed` check happened at the top of
 * `handleEvent`, before that await. So a tool call that arrived one tick before
 * the overlay closed still reached a capability and still wrote to SQLite.
 *
 * Two halves:
 *
 *  1. The guard's own semantics, unit-tested. `RealtimeSession` itself cannot be
 *     imported here — its module graph reaches `import.meta.glob`, which only
 *     Vite understands — so the guard was extracted into a dependency-free
 *     module precisely so this could be tested without WebRTC or a microphone.
 *  2. A source check that `RealtimeSession` actually consults the guard in the
 *     places that matter, including *after* the await. Without this the guard
 *     could be perfect and unused, which is the state the code was already in.
 *
 * Run: npx tsx scripts/check-voice-session-safety.mts
 */

import { readFileSync } from "node:fs";
import {
  beginSession,
  endSession,
  isCurrent,
  resetSessionsForTest,
} from "../src/services/realtime/sessionGuard";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

// ── The guard ────────────────────────────────────────────────────────────
resetSessionsForTest();
{
  const live = beginSession();
  check("a live session may act", isCurrent(live), "isCurrent = true");
  endSession(live);
  check(
    "a closed session may not act",
    !isCurrent(live),
    "isCurrent = false after endSession",
  );
}

resetSessionsForTest();
{
  // The reported bug in miniature: the claim was taken while live, the session
  // was dismissed during the await, and the post-await check must now fail.
  const claim = beginSession();
  const stillAllowedBeforeClose = isCurrent(claim);
  endSession(claim);
  check(
    "a session dismissed mid-flight fails its post-await check",
    stillAllowedBeforeClose && !isCurrent(claim),
    `before close ${stillAllowedBeforeClose}, after close ${isCurrent(claim)}`,
  );
}

resetSessionsForTest();
{
  const a = beginSession();
  const b = beginSession();
  check(
    "opening a new session retires the old one",
    !isCurrent(a) && isCurrent(b),
    `old ${isCurrent(a)}, new ${isCurrent(b)}`,
  );
  // Closing the retired session must not revive or disturb the live one.
  endSession(a);
  check(
    "closing an already-superseded session leaves the live one alone",
    isCurrent(b),
    `live session still current: ${isCurrent(b)}`,
  );
}

resetSessionsForTest();
{
  const s = beginSession();
  endSession(s);
  endSession(s);
  check("closing twice is safe and does not revive", !isCurrent(s), "still retired");
}

resetSessionsForTest();
{
  // Session A's late transcript arriving while session B is live.
  const a = beginSession();
  endSession(a);
  const b = beginSession();
  check(
    "a transcript from an earlier session is rejected during a later one",
    !isCurrent(a) && isCurrent(b),
    `old session current: ${isCurrent(a)}`,
  );
}

// ── The guard is actually used ───────────────────────────────────────────
const src = readFileSync("src/services/realtime/RealtimeSession.ts", "utf8");

check(
  "handleEvent rejects events from a session that is not current",
  /private async handleEvent[\s\S]{0,400}?isCurrent\(\)/.test(src),
  "isCurrent() checked on entry",
);

// The check that actually fixes the reported bug.
const runToolCall = src.slice(src.indexOf("private async runToolCall"));
const body = runToolCall.slice(0, runToolCall.indexOf("\n  close("));
const awaitAt = body.indexOf("await dispatchRealtimeToolCall");
const guardAfterAwait = body.indexOf("isCurrent()", awaitAt);
check(
  "runToolCall re-checks the session AFTER awaiting the capability",
  awaitAt !== -1 && guardAfterAwait !== -1,
  guardAfterAwait !== -1
    ? "isCurrent() found after the await"
    : "NO post-await guard — a dismissed session can still act",
);
check(
  "runToolCall checks the session BEFORE reaching a capability",
  body.slice(0, awaitAt).includes("isCurrent()"),
  "isCurrent() found before the await",
);
check(
  "a redelivered tool call id is not executed twice",
  body.includes("handledCalls.has(callId)") && body.includes("handledCalls.add(callId)"),
  "call id de-duplication present",
);
check(
  "close retires the session before tearing anything down",
  /close\(\): void \{[\s\S]{0,300}?endSession\(this\.claim\)/.test(src),
  "endSession called in close()",
);
check(
  "close still cancels in-flight audio directly, not through the guarded send",
  /endSession\(this\.claim\)[\s\S]{0,400}?this\.dc\.send\(JSON\.stringify\(\{ type: "response\.cancel" \}\)\)/.test(
    src,
  ),
  "response.cancel sent on the raw channel",
);

console.log("-".repeat(78));
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
