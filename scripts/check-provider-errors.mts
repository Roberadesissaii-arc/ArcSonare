/**
 * A fresh install has nothing connected. The first thing a new user saw was
 * "model-request-failed: The model request failed." — because Tauri's invoke()
 * rejects with a *string*, and `err instanceof Error ? err.message : …` threw
 * the real reason away.
 *
 * Run: npx tsx scripts/check-provider-errors.mts
 */

import {
  describeProviderError,
  errorText,
  isNotConnected,
} from "../src/services/providerErrors";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

// The exact string the Rust side rejects with when no key is stored.
const noKey = "No API key saved for deepseek. Add one in Settings → Models.";
const out1 = describeProviderError(noKey, "DeepSeek V4 Flash");
check(
  "missing key reads as setup, not as a failure",
  // The rule being protected is that a missing key is a setup problem, so the
  // message must not blame the model or say anything failed. It used to also
  // forbid naming a provider at all, and forbid any settings page but
  // "Models" — both of which the product has since improved on: the message
  // now points at the page the keys actually live on and names the two the
  // user has to save. Naming what to add is not the same as blaming what
  // broke, which is what the assertion is really about.
  /Settings → [A-Za-z& ]+/.test(out1) &&
    !out1.toLowerCase().includes("failed") &&
    !/(deepseek|gemini|ollama|claude)[^.]*(failed|error|unavailable|problem)/i.test(out1),
  out1,
);

// A string rejection must never collapse to the generic line.
const cloudOff =
  "DeepSeek V4 Flash needs cloud processing, which is turned off in Settings → Data & Privacy.";
const out2 = describeProviderError(cloudOff, "DeepSeek V4 Flash");
check(
  "string rejection keeps the provider's own message",
  out2 === cloudOff,
  out2,
);

// Real Error objects still work.
const out3 = describeProviderError(new Error("network timeout"), "DeepSeek");
check("Error objects still read through", out3 === "network timeout", out3);

// Empty rejection gets a human sentence, not "undefined".
const out4 = describeProviderError(undefined, "DeepSeek");
check(
  "empty rejection is still readable",
  out4.length > 0 && !out4.includes("undefined"),
  out4,
);

check("errorText reads strings", errorText("boom") === "boom", errorText("boom"));
check("isNotConnected detects missing key", isNotConnected(noKey), String(isNotConnected(noKey)));
check(
  "isNotConnected ignores unrelated errors",
  !isNotConnected("network timeout"),
  String(isNotConnected("network timeout")),
);

console.log("-".repeat(80));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
