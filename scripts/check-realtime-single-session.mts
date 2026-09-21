/**
 * Only one voice session, even when the start is triggered twice.
 *
 * Reported as "there is two AI speaking at the same time". The guard was
 *
 *     if (session) return "started";
 *     ...
 *     await next.connect();   // seconds: token fetch + WebRTC
 *     session = next;         // only now is the guard armed
 *
 * so every trigger arriving during the connect passed straight through and
 * built another session, each with its own audio track. Two assistants, one
 * microphone.
 *
 * This models the guard rather than importing it — realtimeOverlay pulls in
 * Tauri IPC, which does not exist outside the app.
 *
 * Run: npx tsx scripts/check-realtime-single-session.mts
 */

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Builds a starter with the same shape as the real one. */
function makeStarter(guardInFlight: boolean) {
  let session: object | null = null;
  let connecting: Promise<string> | null = null;
  let built = 0;

  async function open(): Promise<string> {
    if (session) return "started";
    // Stands in for the ephemeral token fetch plus WebRTC negotiation.
    await sleep(50);
    built++;
    session = { id: built };
    return "started";
  }

  async function start(): Promise<string> {
    if (session) return "started";
    if (guardInFlight) {
      if (connecting) return connecting;
      connecting = open().finally(() => {
        connecting = null;
      });
      return connecting;
    }
    return open();
  }

  return { start, sessions: () => built };
}

console.log("=== two triggers during the connect window ===");
{
  const fixed = makeStarter(true);
  await Promise.all([fixed.start(), fixed.start()]);
  check(
    "a second trigger mid-connect joins the first session",
    fixed.sessions() === 1,
    `${fixed.sessions()} session(s) built`,
  );

  // Proof the test would have caught the original bug.
  const broken = makeStarter(false);
  await Promise.all([broken.start(), broken.start()]);
  check(
    "the old guard really did build two (regression proof)",
    broken.sessions() === 2,
    `${broken.sessions()} sessions — two voices`,
  );
}

console.log("\n=== a burst of triggers, as a held hotkey produces ===");
{
  const fixed = makeStarter(true);
  await Promise.all(Array.from({ length: 6 }, () => fixed.start()));
  check(
    "six rapid triggers still yield one session",
    fixed.sessions() === 1,
    `${fixed.sessions()} session(s) built`,
  );
}

console.log("\n=== starting again after the first finished ===");
{
  const fixed = makeStarter(true);
  await fixed.start();
  await fixed.start();
  check(
    "a later start reuses the live session rather than adding one",
    fixed.sessions() === 1,
    `${fixed.sessions()} session(s) built`,
  );
}

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed — one session, one voice");
process.exit(failed ? 1 : 0);
