/**
 * Prompt conformance harness.
 *
 * Sends a battery of real user utterances to the configured Ollama model using
 * ArcSonare's actual system prompt, then asserts the reply obeys the behavior
 * rules (no unprompted clock, no capability dumps, no robotic filler).
 *
 * Run: npx tsx scripts/run-prompt-conformance.mts
 */

import { buildAssistantPrompt } from "../src/services/assistantPrompt";

const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";
const MODEL = process.env.ARCSONARE_TEST_MODEL || "llama3.2:latest";

const SYSTEM = buildAssistantPrompt({
  datetime: "Wednesday, July 29, 2026 at 5:16:32 AM EDT",
  zone: "America/New_York",
  integrations: "Connected integrations: Gmail, Google Calendar, Google Drive. Everything else is not connected.",
  memory: "",
});

type Check = { name: string; fail: (reply: string) => boolean; hint: string };

const NO_CLOCK: Check = {
  name: "no-unprompted-clock",
  fail: (r) =>
    /\b(july|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(r) ||
    /\b\d{1,2}:\d{2}\b/.test(r) ||
    /\b2026\b/.test(r),
  hint: "recited the date/time without being asked",
};
const NO_CAPABILITY_DUMP: Check = {
  name: "no-capability-dump",
  fail: (r) => (r.match(/^\s*[-*•]/gm) ?? []).length >= 3,
  hint: "dumped a bulleted capability list",
};
const NO_SELF_INTRO: Check = {
  name: "no-self-intro",
  fail: (r) => /I'?m ArcSonare,? (your|a) /i.test(r),
  hint: "introduced itself unprompted",
};
const NO_FILLER: Check = {
  name: "no-trailing-filler",
  fail: (r) =>
    /(how can I (assist|help) you( today)?\?|let me know if (you need|there'?s)|feel free to ask|anything else\?)\s*$/i.test(
      r.trim(),
    ),
  hint: "ended with assistant filler",
};
const SHORT: Check = {
  name: "concise",
  fail: (r) => r.trim().split(/\s+/).length > 40,
  hint: "too long for a simple exchange",
};
const NO_TOOL_LEAK: Check = {
  name: "no-tool-names",
  fail: (r) => /\b(capabilityId|tasks\.create|applications\.open|email\.\w+|function call)\b/i.test(r),
  hint: "leaked internal tool names",
};
const SAYS_CONNECTED: Check = {
  name: "respects-connection-truth",
  fail: (r) =>
    /\bnot connected\b|\bisn'?t connected\b|\bneed to connect\b|\bnot linked\b|\bdon'?t appear\b|\bnot currently\b|\bno,\s/i.test(
      r,
    ),
  hint: "denied a connection that the reference block lists as connected",
};

const CASES: { prompt: string; checks: Check[] }[] = [
  // Greetings — the reported bug.
  { prompt: "hi", checks: [NO_CLOCK, NO_SELF_INTRO, NO_FILLER, SHORT, NO_CAPABILITY_DUMP] },
  { prompt: "hello", checks: [NO_CLOCK, NO_SELF_INTRO, NO_FILLER, SHORT] },
  { prompt: "hey how's it going", checks: [NO_CLOCK, NO_SELF_INTRO, NO_FILLER, SHORT] },
  { prompt: "good morning", checks: [NO_CLOCK, NO_SELF_INTRO, NO_FILLER, SHORT] },
  { prompt: "yo", checks: [NO_CLOCK, NO_SELF_INTRO, SHORT] },
  { prompt: "thanks", checks: [NO_CLOCK, NO_FILLER, SHORT] },
  { prompt: "thank you so much", checks: [NO_CLOCK, SHORT] },
  { prompt: "ok cool", checks: [NO_CLOCK, SHORT] },

  // Small talk — must stay natural, not turn into a product pitch.
  { prompt: "how are you", checks: [NO_CLOCK, NO_SELF_INTRO, NO_CAPABILITY_DUMP, SHORT] },
  { prompt: "what's up", checks: [NO_CLOCK, NO_SELF_INTRO, SHORT] },
  { prompt: "are you a robot", checks: [NO_CLOCK, NO_CAPABILITY_DUMP] },

  // Capability question — a list IS appropriate here, but no clock.
  { prompt: "what can you do", checks: [NO_CLOCK, NO_TOOL_LEAK] },
  { prompt: "who are you", checks: [NO_CLOCK] },

  // Real questions — answer only what was asked.
  { prompt: "what is the capital of France", checks: [NO_CLOCK, NO_FILLER, SHORT] },
  { prompt: "how many ounces in a pound", checks: [NO_CLOCK, NO_FILLER, SHORT] },
  { prompt: "spell necessary", checks: [NO_CLOCK, SHORT] },

  // Connection truth — Gmail IS connected in this fixture.
  { prompt: "is my gmail connected", checks: [SAYS_CONNECTED, NO_CLOCK] },
  { prompt: "do I have google drive linked", checks: [SAYS_CONNECTED, NO_CLOCK] },

  // Tool discipline — must not leak internals.
  { prompt: "create a task to call the bank tomorrow", checks: [NO_TOOL_LEAK] },
  { prompt: "open chrome", checks: [NO_TOOL_LEAK, SHORT] },
];

async function ask(prompt: string): Promise<string> {
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
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? "";
}

const main = async () => {
  console.log(`Model: ${MODEL}\nCases: ${CASES.length}\n${"=".repeat(72)}`);
  let failures = 0;

  for (const testCase of CASES) {
    let reply: string;
    try {
      reply = await ask(testCase.prompt);
    } catch (err) {
      console.log(`\nERROR  "${testCase.prompt}" → ${(err as Error).message}`);
      failures++;
      continue;
    }
    const broken = testCase.checks.filter((c) => c.fail(reply));
    const status = broken.length === 0 ? "PASS" : "FAIL";
    if (broken.length) failures++;
    console.log(`\n[${status}] "${testCase.prompt}"`);
    console.log(`   ${reply.trim().replace(/\n/g, "\n   ")}`);
    for (const b of broken) console.log(`   !! ${b.name}: ${b.hint}`);
  }

  console.log(
    `\n${"=".repeat(72)}\n${CASES.length - failures}/${CASES.length} passed.`,
  );
  process.exit(failures > 0 ? 1 : 0);
};

void main();
