/**
 * Vision-click routing and follow-up reference.
 *
 * Observed failure: asking "press it" after a click sent the literal string
 * "it" to the vision model as the control to find, so it matched nothing and
 * the assistant claimed a click that never happened.
 *
 * Run: npx tsx scripts/check-click-followup.mts
 */

import { routeDeterministic } from "../src/features/capabilities/capabilityRouter";
import {
  rememberClickTarget,
  resolveClickTarget,
} from "../src/features/capabilities/clickTargetMemory";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

function clickTargetOf(text: string): string | null {
  const route = routeDeterministic(text);
  if (!route || route.capabilityId !== "screen.click_target") return null;
  return String((route.arguments ?? {}).target ?? "");
}

// ── A real control still routes normally ─────────────────────────────────
check(
  'press "start your project brief" routes to a vision click',
  clickTargetOf("press start your project brief") === "start your project brief",
  String(clickTargetOf("press start your project brief")),
);

// ── A pronoun with no history must NOT become a literal search ───────────
const cold = clickTargetOf("press it");
check(
  '"press it" with no history does not search for "it"',
  cold === null,
  cold === null ? "falls through to conversation" : `routed with target "${cold}"`,
);

// ── After a click, the pronoun resolves to it ────────────────────────────
rememberClickTarget("start your project brief");
check(
  '"press it" after a click resolves to the previous control',
  clickTargetOf("press it") === "start your project brief",
  String(clickTargetOf("press it")),
);
check(
  '"click that button" resolves too',
  clickTargetOf("click that button") === "start your project brief",
  String(clickTargetOf("click that button")),
);

// ── A pronoun must never be stored as the thing to click ─────────────────
rememberClickTarget("it");
check(
  "a pronoun is never remembered as a target",
  resolveClickTarget("it") === "start your project brief",
  String(resolveClickTarget("it")),
);

console.log("-".repeat(80));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
