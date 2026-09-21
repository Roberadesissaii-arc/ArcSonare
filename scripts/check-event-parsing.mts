/**
 * Event parsing from natural phrasing. Run: npx tsx scripts/check-event-parsing.mts
 */
import { parseEventFromText } from "../src/features/orchestration/parseEventTime";

// Fixed "now" so results are deterministic: Wed 29 Jul 2026, 10:00 local.
const NOW = new Date(2026, 6, 29, 10, 0, 0);

const CASES: {
  input: string;
  title?: string;
  startsAt?: string; // "YYYY-MM-DDTHH:MM"
  expectNull?: boolean;
}[] = [
  // The reported utterance (with the user's misspelling).
  {
    input: "i have a apponment today at 1:30 add to my calander",
    title: "Apponment",
    startsAt: "2026-07-29T13:30",
  },
  { input: "add dentist tomorrow at 9am to my calendar", title: "Dentist", startsAt: "2026-07-30T09:00" },
  { input: "schedule a meeting today at 3pm", title: "Meeting", startsAt: "2026-07-29T15:00" },
  { input: "put lunch with Sam on my calendar tomorrow at 12:30", title: "Lunch with Sam", startsAt: "2026-07-30T12:30" },
  { input: "I have a call today at 14:00", title: "Call", startsAt: "2026-07-29T14:00" },
  { input: "add standup tomorrow", title: "Standup", startsAt: "2026-07-30T09:00" },
  { input: "book a review on friday at 4pm", title: "Review", startsAt: "2026-07-31T16:00" },

  // Too vague — must return null so the caller asks instead of guessing.
  { input: "add something to my calendar", expectNull: true },
  { input: "put it on my calendar", expectNull: true },
];

let failed = 0;
for (const c of CASES) {
  const got = parseEventFromText(c.input, NOW);

  if (c.expectNull) {
    const ok = got === null;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  "${c.input}"\n      → ${got ? JSON.stringify(got) : "null (asks user)"}`);
    continue;
  }

  if (!got) {
    failed++;
    console.log(`FAIL  "${c.input}"\n      → null (expected an event)`);
    continue;
  }

  const startOk = got.start.startsWith(c.startsAt!);
  const titleOk = got.title === c.title;
  const ok = startOk && titleOk;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  "${c.input}"\n      → "${got.title}" @ ${got.start}` +
      (ok ? "" : `\n      want "${c.title}" @ ${c.startsAt}`),
  );
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed.`);
process.exit(failed ? 1 : 0);
