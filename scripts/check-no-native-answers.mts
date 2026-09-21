/**
 * With no model connected, ArcSonare must not answer or act.
 *
 * This has regressed twice. A deterministic router in front of the model
 * answered "what time is it" from the system clock and opened Spotify with
 * nothing configured — so the app looked like it worked while the user had
 * connected no provider at all.
 *
 * This is a source-level guard: it fails if the pattern-matching stage is
 * reintroduced into the request path, or if "no model selected" silently falls
 * back to a local model.
 *
 * Run: npx tsx scripts/check-no-native-answers.mts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENGINE = readFileSync(
  resolve("src/features/capabilities/capabilityEngine.ts"),
  "utf8",
);

let failed = 0;
const check = (name: string, pass: boolean, detail: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      ${detail}`);
};

/** The body of handleCapabilityRequest — the actual request path. */
const entry = ENGINE.indexOf("export async function handleCapabilityRequest");
const requestPath = entry === -1 ? "" : ENGINE.slice(entry);

check(
  "handleCapabilityRequest exists",
  entry !== -1,
  "could not find the request entry point",
);

check(
  "no deterministic router in the request path",
  !/routeDeterministic\s*\(/.test(requestPath),
  'routeDeterministic() is being called again — the model must choose every tool',
);

check(
  "no compound splitter in the request path",
  !/splitCompound\s*\(/.test(requestPath),
  "splitCompound() guesses multi-step requests from 'and'/'then' instead of asking the model",
);

// "none" (nothing selected) must report, not quietly use a local model.
const routeFn = ENGINE.slice(
  ENGINE.indexOf("async function resolveModelRoute"),
  ENGINE.indexOf("async function runModelToolLoop"),
);

/** Body of the `if (route.provider === "none") { ... }` branch, braces matched. */
function noneBranch(src: string): string {
  const at = src.indexOf('route.provider === "none"');
  if (at === -1) return "";
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return "";
}

const none = noneBranch(routeFn);

check(
  'provider "none" branch exists',
  none.length > 0,
  'no `if (route.provider === "none")` branch found',
);

check(
  'provider "none" does not fall back to a local model',
  none.length > 0 && !/localRoute\(\)/.test(none),
  '"none" routes to localRoute() — a request with nothing connected would run on Ollama',
);

check(
  'provider "none" reports unavailable',
  /unavailable/.test(none),
  '"none" should return an `unavailable` reason so the user is told to connect a model',
);

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed — nothing answers without a model");
process.exit(failed ? 1 : 0);
