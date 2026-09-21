/**
 * Does "what's the news today" come back with actual news?
 *
 * The old web.search only opened a browser tab and returned no text, so the
 * model either reported that it opened a tab or answered from training data —
 * stale information presented as current. This checks the replacement really
 * retrieves, by requiring citations and a date that could not be known from
 * training alone.
 *
 * Run: npx tsx scripts/check-web-answer.mts
 */

import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const KEY = process.env.ARCSONARE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
if (!KEY) {
  console.error("No Gemini key in .env");
  process.exit(2);
}

/** Mirrors web_grounded_answer in src-tauri/src/web_answer.rs. */
async function ask(question: string) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      }),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as any;
  const cand = json.candidates?.[0];
  const text: string =
    cand?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
  const sources: string[] = [
    ...new Set(
      chunks
        .map((c: any) => c.web?.uri)
        .filter((u: unknown): u is string => typeof u === "string"),
    ),
  ];
  return { text: text.trim(), sources };
}

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

console.log("=== today's news ===");
{
  const { text, sources } = await ask("What are the main news headlines today?");
  console.log(`\n${text.slice(0, 400)}\n`);
  check(
    "an actual answer comes back, not 'I opened a tab'",
    text.length > 80,
    `${text.length} characters`,
  );
  check(
    "it is grounded in retrieved pages, not recalled from training",
    sources.length > 0,
    sources.length ? `${sources.length} sources, e.g. ${sources[0]}` : "NO CITATIONS",
  );
}

console.log("\n=== something unknowable from training data ===");
{
  // A question whose answer changes constantly: only retrieval can answer it.
  const { text, sources } = await ask(
    "What is today's date, and what is one thing that happened in the world this week?",
  );
  console.log(`\n${text.slice(0, 300)}\n`);
  const year = new Date().getFullYear().toString();
  check(
    "the answer refers to the current year",
    text.includes(year),
    `looking for ${year} in the reply`,
  );
  check("it cites where that came from", sources.length > 0, `${sources.length} sources`);
}

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed — answers are retrieved, not remembered");
process.exit(failed ? 1 : 0);
