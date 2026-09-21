/**
 * Verifies connection-status and action utterances are routed deterministically
 * (never left to the model to guess). Run: npx tsx scripts/check-intent-routing.mts
 */
import { classifyIntent } from "../src/features/orchestration/IntentClassifier";

const CASES: { utterance: string; expect: string }[] = [
  { utterance: "is my gmail connected", expect: "email.get_connection_status" },
  { utterance: "is my email connected", expect: "email.get_connection_status" },
  { utterance: "do I have gmail linked", expect: "email.get_connection_status" },
  { utterance: "do I have google drive linked", expect: "drive.get_connection_status" },
  { utterance: "is google drive connected", expect: "drive.get_connection_status" },
  { utterance: "is my drive set up", expect: "drive.get_connection_status" },
  { utterance: "is my calendar connected", expect: "calendar.get_connection_status" },

  { utterance: "what's in my gmail", expect: "email.get_inbox_summary" },
  { utterance: "what is my latest email", expect: "email.get_latest_message" },
  { utterance: "open gmail", expect: "email.open_inbox_ui" },
  { utterance: "what's on my calendar", expect: "calendar.list_events" },
  { utterance: "open my calendar", expect: "calendar.open_ui" },
  { utterance: "what's in my google drive", expect: "drive.list" },
  { utterance: "open google drive", expect: "drive.open_ui" },
];

let failed = 0;
for (const c of CASES) {
  const got = classifyIntent(c.utterance).capabilityId ?? "(none)";
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${c.utterance}"\n      → ${got}${ok ? "" : `   (expected ${c.expect})`}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} routed correctly.`);
process.exit(failed ? 1 : 0);
