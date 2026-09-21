/**
 * Saved settings must survive a reload.
 *
 * Regression: `mergeNode` kept a saved value only when
 * `typeof saved === typeof defaults`. `typeof null` is "object", so once the
 * assistant model default became `null`, a saved id like "google-gemini" was
 * compared against "object", failed, and was replaced by the default.
 *
 * The symptom was maddening: connecting a model appeared to work, Test passed,
 * and the dashboard still said "No default model selected" — because the value
 * was erased every time prefs were normalized.
 *
 * Run: npx tsx scripts/check-prefs-merge.mts
 */

import { DEFAULT_PREFS, normalizePrefs } from "../src/config/prefs";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

// The exact case that broke: a role whose default is null.
const saved = normalizePrefs({
  models: { roles: { assistant: "google-gemini" } },
});
check(
  "a saved model role survives normalize (default is null)",
  saved.models.roles.assistant === "google-gemini",
  String(saved.models.roles.assistant),
);

// Other nullable roles behave the same.
const withFast = normalizePrefs({
  models: { roles: { assistant: "deepseek-v4-flash", fast: "ollama-local" } },
});
check(
  "several nullable roles all survive",
  withFast.models.roles.assistant === "deepseek-v4-flash" &&
    withFast.models.roles.fast === "ollama-local",
  `${withFast.models.roles.assistant} / ${withFast.models.roles.fast}`,
);

// The chat assistant is deliberately never empty.
//
// These two assertions used to require `assistant` to be null when unset and to
// stay null when explicitly cleared. That was true when every role defaulted to
// null, and stopped being true when the product decided the app must always
// have a chat model — an assistant of `null` is an app that cannot answer
// anything. `normalizePrefs` now fills it, and also refuses to leave a voice or
// local-only model there, which is a rule worth asserting rather than removing.
const empty = normalizePrefs({});
check(
  "an unset assistant falls back to the product default",
  empty.models.roles.assistant === "deepseek-v4-flash",
  String(empty.models.roles.assistant),
);
const clearedAssistant = normalizePrefs({ models: { roles: { assistant: null } } });
check(
  "clearing the assistant restores it rather than leaving chat unusable",
  clearedAssistant.models.roles.assistant === "deepseek-v4-flash",
  String(clearedAssistant.models.roles.assistant),
);
check(
  "a voice model is never left as the chat assistant",
  normalizePrefs({ models: { roles: { assistant: "gpt-realtime" } } }).models.roles
    .assistant === "deepseek-v4-flash",
  String(
    normalizePrefs({ models: { roles: { assistant: "gpt-realtime" } } }).models.roles.assistant,
  ),
);

// What those assertions were really protecting — that a nullable role is not
// silently filled in — still holds for the roles that genuinely are optional.
const optional = normalizePrefs({});
check(
  "genuinely optional roles stay null when unset",
  optional.models.roles.screen === null && optional.models.roles.image === null,
  `screen=${optional.models.roles.screen}, image=${optional.models.roles.image}`,
);
const cleared = normalizePrefs({ models: { roles: { screen: null, image: null } } });
check(
  "and stay null when explicitly cleared",
  cleared.models.roles.screen === null && cleared.models.roles.image === null,
  `screen=${cleared.models.roles.screen}, image=${cleared.models.roles.image}`,
);

// Typed defaults must still reject mismatched junk.
const junk = normalizePrefs({ appearance: { textScale: "not-a-number" } });
check(
  "wrong-typed value still falls back to the default",
  junk.appearance.textScale === DEFAULT_PREFS.appearance.textScale,
  String(junk.appearance.textScale),
);

// And a correctly typed value is still kept.
const scaled = normalizePrefs({ appearance: { textScale: 125 } });
check("correctly typed value is kept", scaled.appearance.textScale === 125, String(scaled.appearance.textScale));

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed — saved settings survive a reload");
process.exit(failed ? 1 : 0);
