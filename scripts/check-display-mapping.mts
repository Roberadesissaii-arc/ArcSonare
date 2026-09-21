/**
 * The display-mapping logic that lives in TypeScript.
 *
 * Which is deliberately very little: every physical coordinate is calculated in
 * Rust, because the wizard exists to check ArcSonare's geometry and a check that
 * used the webview's own arithmetic would be measuring the wrong thing.
 *
 * What is left here is the arrangement diagram — which must not misrepresent
 * where the monitors are — and the mapping from a stored status to what the user
 * is told. Both are worth pinning down: a diagram that quietly flips a monitor
 * to the wrong side, or a status that reads as permission it does not grant, is
 * wrong in a way nobody notices until it matters.
 *
 * Run: npx tsx scripts/check-display-mapping.mts
 */

import { readFileSync } from "node:fs";
import {
  arrangementLayout,
  formatTimestamp,
  statusExplanation,
  statusLabel,
  type DisplayConfigurationSummary,
  type DisplayProfileStatus,
} from "../src/features/display-mapping/displayMappingService";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** The real arrangement on the development machine. */
function display(
  over: Partial<DisplayConfigurationSummary> & { displayId: string },
): DisplayConfigurationSummary {
  return {
    friendlyName: "Generic PnP Monitor",
    label: "Display A",
    x: 0,
    y: 0,
    width: 3840,
    height: 1080,
    scaleFactor: 1,
    rotationDegrees: 0,
    primary: true,
    orientation: "Landscape",
    connected: true,
    status: "unconfigured",
    averageErrorPx: 0,
    maximumErrorPx: 0,
    sampleCount: 0,
    configuredAtMs: 0,
    validatedAtMs: 0,
    needsConfiguration: true,
    allowsVisualInteraction: false,
    ...over,
  };
}

const ultrawide = display({ displayId: "ultrawide" });
const portrait = display({
  displayId: "portrait",
  x: -1080,
  y: -661,
  width: 1080,
  height: 1920,
  primary: false,
  orientation: "Portrait",
  label: "Display B",
});

// ---------------------------------------------------------------------------
// Arrangement diagram
// ---------------------------------------------------------------------------

const layout = arrangementLayout([ultrawide, portrait], 420, 190);
const boxOf = (id: string) => layout.find((b) => b.displayId === id)!;

check("every connected display appears in the diagram", layout.length === 2, `${layout.length}`);

check(
  "a monitor to the left is drawn to the left",
  boxOf("portrait").left < boxOf("ultrawide").left,
  `portrait ${boxOf("portrait").left.toFixed(1)} < ultrawide ${boxOf("ultrawide").left.toFixed(1)}`,
);

check(
  "a monitor above is drawn above",
  boxOf("portrait").top < boxOf("ultrawide").top,
  `portrait ${boxOf("portrait").top.toFixed(1)} < ultrawide ${boxOf("ultrawide").top.toFixed(1)}`,
);

// A negative origin is normal — anything left of or above the primary has one.
// Assuming the bounding box starts at 0,0 would push those monitors off-diagram.
check(
  "negative origins do not push a monitor outside the diagram",
  layout.every((b) => b.left >= -0.001 && b.top >= -0.001),
  layout.map((b) => `${b.displayId}(${b.left.toFixed(1)},${b.top.toFixed(1)})`).join(" "),
);

check(
  "the diagram stays inside its box",
  layout.every((b) => b.left + b.width <= 420.001 && b.top + b.height <= 190.001),
  "within bounds",
);

// One scale for both axes, or a portrait monitor stops looking portrait.
const portraitBox = boxOf("portrait");
const ultrawideBox = boxOf("ultrawide");
check(
  "a portrait monitor still reads as portrait",
  portraitBox.height > portraitBox.width,
  `${portraitBox.width.toFixed(1)}x${portraitBox.height.toFixed(1)}`,
);
check(
  "an ultrawide still reads as ultrawide",
  ultrawideBox.width > ultrawideBox.height * 3,
  `${ultrawideBox.width.toFixed(1)}x${ultrawideBox.height.toFixed(1)}`,
);

const ultrawideAspect = ultrawideBox.width / ultrawideBox.height;
check(
  "aspect ratio is preserved rather than stretched to fit",
  Math.abs(ultrawideAspect - 3840 / 1080) < 0.01,
  `${ultrawideAspect.toFixed(3)} vs ${(3840 / 1080).toFixed(3)}`,
);

check(
  "a disconnected display is left out of the arrangement",
  arrangementLayout([display({ displayId: "gone", connected: false })], 420, 190).length === 0,
  "excluded",
);

check("no displays produces no diagram", arrangementLayout([], 420, 190).length === 0, "empty");

// ---------------------------------------------------------------------------
// Status semantics
// ---------------------------------------------------------------------------

const ALL: DisplayProfileStatus[] = [
  "unconfigured",
  "configuring",
  "valid",
  "stale",
  "failed",
  "ignored",
  "disconnected",
];

check(
  "every status has a label and an explanation",
  ALL.every((s) => statusLabel(s).length > 0 && statusExplanation(s).length > 0),
  "all covered",
);

// "Verified" is a claim about coordinates only. If the wording ever implies the
// recogniser is accurate, the two failure modes become indistinguishable to the
// user — which is exactly how a wrong highlight gets trusted.
check(
  "a verified display does not claim anything about recognition",
  !/recognis|identif|accurate target|correct target/i.test(statusExplanation("valid")),
  statusExplanation("valid"),
);

check(
  "an unverified display says native actions still work",
  /everything else works/i.test(statusExplanation("unconfigured")),
  statusExplanation("unconfigured"),
);

check(
  "a stale profile explains that the display changed",
  /changed/i.test(statusExplanation("stale")),
  statusExplanation("stale"),
);

check(
  "a disconnected profile says its measurements are kept",
  /kept/i.test(statusExplanation("disconnected")),
  statusExplanation("disconnected"),
);

check(
  "the failed status is not softened into something reassuring",
  statusLabel("failed") === "Failed" && /blocked/i.test(statusExplanation("failed")),
  `${statusLabel("failed")} — ${statusExplanation("failed")}`,
);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

check("a never-validated profile reads as Never", formatTimestamp(0) === "Never", formatTimestamp(0));
check(
  "a real timestamp is rendered",
  formatTimestamp(1_700_000_000_000).length > 4,
  formatTimestamp(1_700_000_000_000),
);

// ---------------------------------------------------------------------------
// The calibration target must never come back into the DOM
// ---------------------------------------------------------------------------
//
// This is the bug that produced a 443 px average error on the first real run.
// The ring was a DOM element positioned as a percentage of the *display*, but a
// `position: fixed` element is placed against the window viewport — and the
// ArcSonare window covers about a third of the screen. The user aimed at the
// ring correctly; the ring was hundreds of pixels from the point Rust was
// comparing against.
//
// A source check rather than a behavioural one, because the failure is invisible
// from inside the webview: every DOM measurement agrees with itself. Only the
// native cursor position disagrees, and by then it has been recorded as the
// display's error.

const wizardSource = readFileSync(
  new URL("../src/features/display-mapping/DisplayMappingWizard.tsx", import.meta.url),
  "utf8",
);

// Strip comments so prose explaining the bug does not trip its own guard.
const wizardCode = wizardSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

check(
  "the wizard renders no positioned calibration target",
  !/className="dmw-target"/.test(wizardCode) && !/dmw-target-ring|dmw-target-dot/.test(wizardCode),
  "no target element",
);

check(
  "the wizard sets no inline left/top from display coordinates",
  !/style=\{\{[^}]*(left|top)\s*:/.test(wizardCode),
  "no inline positioning",
);

check(
  "no display-relative percentage is computed for a target",
  !/displayX\s*\/|displayY\s*\/|desktopX\s*\/|desktopY\s*\//.test(wizardCode),
  "no percentage geometry",
);

// A mouse event's clientX/clientY are CSS pixels inside the window. Submitting
// one as a calibration sample would measure the webview, not the display.
check(
  "no frontend mouse coordinate is used as a sample",
  !/clientX|clientY|pageX|pageY|screenX|screenY|offsetX|offsetY/.test(wizardCode),
  "no event coordinates",
);

check(
  "sampling is driven by a key press, not by clicking a target",
  /e\.repeat/.test(wizardCode) && /keydown/.test(wizardCode),
  "keydown with repeat guard",
);

// Holding the key must not fill in every remaining target with one position.
check(
  "a held key cannot record more than one sample",
  /e\.repeat\s*\|\|/.test(wizardCode) && /keyup/.test(wizardCode),
  "repeat rejected and key-up required",
);

const serviceSource = readFileSync(
  new URL("../src/features/display-mapping/displayMappingService.ts", import.meta.url),
  "utf8",
);
check(
  "recordMappingClick sends no coordinate at all",
  /recordMappingClick[\s\S]{0,220}invoke\("record_mapping_click",\s*\{\s*sessionId\s*\}\)/.test(
    serviceSource,
  ),
  "session id only",
);

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
