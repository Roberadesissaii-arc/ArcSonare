/**
 * Typed display refusals must reach the user as something they can act on.
 *
 * Observed failure: every display refusal arrived as `display-not-verified`
 * with a sentence attached, so eleven different situations — never checked,
 * deliberately ignored, point on no monitor at all — produced one identical
 * "capability failed". This checks the mapper covers every code the Rust side
 * can emit, and that none of them falls through to something generic.
 *
 * Run: npx tsx scripts/check-display-refusal.mts
 */

import {
  DISPLAY_INTERACTION_ERROR_CODES,
  isDisplayInteractionError,
  renderDisplayRefusal,
  type DisplayInteractionError,
} from "../src/features/display-mapping/displayRefusal";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const base = (
  codeStr: string,
  extra: Partial<DisplayInteractionError> = {},
): DisplayInteractionError => ({
  codeStr,
  message: "backend sentence",
  sideEffectOccurred: false,
  ...extra,
});

// ── Every code the backend can emit is handled ───────────────────────────
for (const code of DISPLAY_INTERACTION_ERROR_CODES) {
  const rendered = renderDisplayRefusal(base(code));
  check(
    `${code} renders a headline`,
    rendered.headline.length > 0 && rendered.code === code,
    rendered.headline,
  );
}

// ── Nothing renders the generic failure ──────────────────────────────────
const generic = DISPLAY_INTERACTION_ERROR_CODES.filter((code) => {
  const text = renderDisplayRefusal(base(code)).headline.toLowerCase();
  return text.includes("capability failed") || text.includes("unknown error");
});
check(
  "no code falls through to a generic message",
  generic.length === 0,
  generic.length === 0 ? "all specific" : generic.join(", "),
);

// ── The display is named where it is known ───────────────────────────────
const named = renderDisplayRefusal(
  base("DISPLAY_NOT_CONFIGURED", { details: { displayName: "Display B" } }),
);
check(
  "the display is named in the sentence",
  named.headline.includes("Display B"),
  named.headline,
);
check(
  "not-configured offers exactly one action, Verify display",
  named.actions.length === 1 && named.actions[0].label === "Verify display",
  named.actions.map((a) => a.label).join(", ") || "(none)",
);

// A device path is diagnostics, not prose.
const pathOnly = renderDisplayRefusal(
  base("DISPLAY_NOT_CONFIGURED", {
    displayId: "\\\\?\\DISPLAY#GSM5BB1#5&2a33d992&0&UID4356",
  }),
);
check(
  "an EDID device path is never shown in the sentence",
  !pathOnly.headline.includes("DISPLAY#") &&
    pathOnly.headline.includes("this display"),
  pathOnly.headline,
);

// ── Stale shows what actually changed ────────────────────────────────────
const stale = renderDisplayRefusal(
  base("DISPLAY_PROFILE_STALE", {
    details: {
      displayName: "Display B",
      changedProperties: ["scale"],
      savedGeometry: {
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
        scaleFactor: 1.0,
        rotationDegrees: 90,
      },
      currentGeometry: {
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
        scaleFactor: 1.25,
        rotationDegrees: 90,
      },
    },
  }),
);
check(
  "a scale change is reported as 100% → 125%",
  stale.facts.includes("Scale 100% → 125%"),
  stale.facts.join(" | ") || "(none)",
);
check(
  "stale offers Re-check display",
  stale.actions.some((a) => a.label === "Re-check display"),
  stale.actions.map((a) => a.label).join(", "),
);
// Only the property that changed is listed.
check(
  "an unchanged property is not reported as changed",
  !stale.facts.some((f) => f.startsWith("Resolution")),
  stale.facts.join(" | "),
);

// ── Failed shows the measurements ────────────────────────────────────────
const failedCheck = renderDisplayRefusal(
  base("DISPLAY_PROFILE_FAILED", {
    details: { displayName: "Display B", averageErrorPx: 7.5, maximumErrorPx: 14.25 },
  }),
);
check(
  "failed reports the average and maximum error",
  failedCheck.facts.some((f) => f.includes("7.50")) &&
    failedCheck.facts.some((f) => f.includes("14.25")),
  failedCheck.facts.join(" | "),
);
check(
  "failed offers both Review measurements and Run again",
  failedCheck.actions.length === 2,
  failedCheck.actions.map((a) => a.label).join(", "),
);

// ── Outside every display: no action, and say nothing happened ───────────
const outside = renderDisplayRefusal(base("TARGET_OUTSIDE_CONNECTED_DISPLAY"));
check(
  "an outside-display point offers no display action",
  outside.actions.length === 0,
  outside.actions.map((a) => a.label).join(", ") || "(none)",
);
check(
  "an outside-display point states that nothing happened",
  outside.reassurance === "No cursor movement or click was performed.",
  String(outside.reassurance),
);

// ── An unsupported store version must not offer to rewrite it ────────────
const newer = renderDisplayRefusal(base("DISPLAY_PROFILE_VERSION_UNSUPPORTED"));
check(
  "an unsupported store version offers no action that would rewrite it",
  newer.actions.length === 0,
  newer.actions.map((a) => a.label).join(", ") || "(none)",
);

// ── Expired is the only one that offers a plain retry ────────────────────
const retryable = DISPLAY_INTERACTION_ERROR_CODES.filter((code) =>
  renderDisplayRefusal(base(code)).actions.some((a) => a.id === "retry"),
);
check(
  "only an expired authority offers Try again",
  retryable.length === 1 && retryable[0] === "AUTHORITY_EXPIRED",
  retryable.join(", ") || "(none)",
);

// ── A side effect that did happen is never described as harmless ─────────
const afterSideEffect = renderDisplayRefusal(
  base("AUTHORITY_TOPOLOGY_CHANGED", { sideEffectOccurred: true }),
);
check(
  "a refusal after a side effect does not claim nothing happened",
  afterSideEffect.reassurance === undefined,
  String(afterSideEffect.reassurance),
);

// ── Recognising a display refusal at all ─────────────────────────────────
check(
  "a typed display error is recognised",
  isDisplayInteractionError(base("DISPLAY_IGNORED")),
  "yes",
);
check(
  "an unrelated capability error is not claimed by this mapper",
  !isDisplayInteractionError({ codeStr: "network-timeout" }) &&
    !isDisplayInteractionError({ code: "invalid-arguments" }) &&
    !isDisplayInteractionError(null),
  "left alone",
);

console.log("-".repeat(78));
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
