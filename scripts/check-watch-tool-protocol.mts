/**
 * Internal protocol never reaches the screen.
 *
 * The reported failure: a Chrome question came back as a chat bubble holding a
 * raw DSML envelope and an invoke tag. The model had chosen a tool
 * correctly and the provider serialised it into `content`; every layer that
 * could have caught it declined, and the last one just rendered it.
 *
 * `guardVisibleText` is the layer that cannot decline. This suite drives it with
 * the exact shapes that have been observed, plus ordinary prose that must
 * survive untouched — a guard that eats real answers is worse than the leak.
 *
 * Run: npm run test:watch-tool-protocol
 */

import { readFileSync } from "node:fs";

import {
  PROTOCOL_ONLY_FALLBACK,
  guardVisibleText,
  stripToolProtocol,
} from "../src/features/capabilities/toolProtocolGuard";

let failed = 0;
const failures: string[] = [];
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) {
    failed += 1;
    failures.push(`${name} -> ${got}`);
  }
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** Everything that must never survive into a bubble. */
const FORBIDDEN = [
  "DSML",
  "toolcalls",
  "tool_calls",
  "invoke",
  "applications.list",
  "<|",
  "|>",
];

const clean = (text: string) =>
  FORBIDDEN.filter((token) => text.toLowerCase().includes(token.toLowerCase()));

// The shapes actually seen, assembled rather than written out so this file is
// not itself a source of the tokens it forbids.
const OPEN = "<" + "｜｜" + "DSML" + "｜｜" + "tool_calls>";
const ASCII = "<" + "|" + "DSML" + "|" + ">";

const CASES: Array<[string, string]> = [
  [
    "the reported Chrome reply",
    ASCII +
      "\ntoolcalls\n<invoke name=\"applications.list\">\n<parameter name=\"query\">chrome</parameter>\n</invoke>",
  ],
  [
    "the fullwidth DSML envelope",
    OPEN + '\n{"name": "browser.get_page_context"}\n',
  ],
  [
    "a truncated stream with no closing tag",
    "Let me check that.\n<invoke name=\"browser.get_page_context\">\n<parameter name=\"instance_key\">chrome:exe",
  ],
  [
    "a nested block with both wrappers",
    "<function_calls><invoke name=\"web.search\"></invoke></function_calls>",
  ],
  [
    "a bare user_tool_call wrapper",
    "<user_tool_call>spotify.play</user_tool_call>",
  ],
];

console.log("\n=== Test 10 — no protocol survives ===");
for (const [label, raw] of CASES) {
  const shown = guardVisibleText(raw);
  const leaked = clean(shown);
  check(
    `nothing forbidden survives: ${label}`,
    leaked.length === 0,
    leaked.length === 0 ? "clean" : `LEAKED ${leaked.join(", ")}`,
  );
}

console.log("\n=== a reply that was only protocol says so ===");
{
  const onlyProtocol = guardVisibleText(ASCII + "\ntoolcalls\n");
  check(
    "an empty result becomes an honest message, not an empty bubble",
    onlyProtocol === PROTOCOL_ONLY_FALLBACK,
    onlyProtocol,
  );
  check(
    "and that message contains no protocol either",
    clean(onlyProtocol).length === 0,
    "clean",
  );
}

console.log("\n=== prose is left alone ===");
{
  const KEEP = [
    "Chrome is showing localhost:3000 right now.",
    "I can invoke the build task for you if you want.",
    "The function parameters are documented in the README.",
    "Use a < b to compare them, and a > b for the other way.",
    "Here is some code: `const x = a || b;` and `y = c |> d`.",
  ];
  for (const text of KEEP) {
    const result = stripToolProtocol(text);
    check(
      `unchanged: "${text.slice(0, 44)}..."`,
      result.text === text && !result.stripped,
      result.text === text ? "untouched" : `CHANGED to "${result.text}"`,
    );
  }
}

console.log("\n=== the guard sits on the path every reply takes ===");
{
  const service = readFileSync("src/services/AssistantService.ts", "utf8");
  check(
    "askAssistant guards its reply before returning it",
    /guardVisibleText\(reply\.text\)/.test(service),
    "guarded in askAssistant",
  );
  check(
    "the guard is applied to internal turns too",
    // An internal turn's text is fed back to the model; markup carried forward
    // there resurfaces in the next visible answer.
    service.indexOf("guardVisibleText(reply.text)") >
      service.indexOf("if (!internal) {"),
    "outside the !internal branch",
  );
  const guard = readFileSync(
    "src/features/capabilities/toolProtocolGuard.ts",
    "utf8",
  );
  check(
    "the guard never executes what it strips",
    !/executeCapability|invokeTool|capability_execute/.test(guard),
    "strips only, never runs",
  );
  check(
    "its diagnostics carry a length, never the removed text",
    /chars\)/.test(guard) &&
      !/console\.(?:warn|error|log)\([^)]*result\.text(?!\.length)/.test(guard),
    "privacy-safe logging",
  );
}

console.log("\n----------------------------------------------");
if (failed === 0) {
  console.log("No internal protocol can reach a chat bubble.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
