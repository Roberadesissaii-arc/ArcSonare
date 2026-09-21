/**
 * Can it actually find the controls on a real screen?
 *
 * This is the case the whole feature exists for: someone is in an app they do
 * not know — YouTube, Photoshop, an installer — and asks "which one do I press
 * to pause it?". Answering that means locating a specific small control in a
 * real screenshot, not describing the page.
 *
 * Everything else about pointing is verified offline (check-pointer-geometry)
 * or on screen (verify-pointer.ps1). The part that cannot be faked is whether
 * the vision model returns the RIGHT box for a named control, so that is what
 * this measures, against a screenshot of the real thing.
 *
 * Capture one first:
 *   powershell -File scripts\grab-screen.ps1 out.png
 * Then:
 *   npx tsx scripts/check-youtube-controls.mts out.png
 *
 * Each control is checked for: found at all, a box small enough to be a control
 * rather than half the page, and a position in the region such a control
 * actually occupies. A confident answer in the wrong place is the failure this
 * is looking for — it is worse than "not found", because it gets clicked.
 */

import { readFileSync, existsSync } from "node:fs";

// Small .env reader rather than a dependency: this script is the only thing
// that needs it, and the key must not be passed on the command line.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

import { LOCATOR_SYSTEM_PROMPT, locatorPrompt } from "../src/services/visionPrompts";
import { box2dToPixels, parseDetectedTarget } from "../src/services/visionCoords";

const KEY =
  process.env.ARCSONARE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
if (!KEY) {
  console.error("No Gemini key: set ARCSONARE_GEMINI_API_KEY in .env");
  process.exit(2);
}
const MODEL = process.env.ARCSONARE_GEMINI_VISION_MODEL ?? "gemini-2.5-flash";

/**
 * The app reaches Gemini through Tauri IPC, which does not exist here, so this
 * calls the same endpoint directly with the same prompt.
 */
async function locate(base64Png: string, target: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: LOCATOR_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: locatorPrompt(target) },
              { inline_data: { mime_type: "image/png", data: base64Png } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return parseDetectedTarget(text) ?? { found: false, label: target };
}

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/check-youtube-controls.mts <screenshot.png>");
  process.exit(2);
}

/** Fraction-of-screen regions a control may legitimately sit in. */
type Expect = {
  target: string;
  /** Largest share of the screen the control may occupy. */
  maxArea: number;
  /** Allowed centre, as fractions of width/height. */
  xRange: [number, number];
  yRange: [number, number];
  note: string;
};

const EXPECTED: Expect[] = [
  {
    target: "the play or pause button in the video player controls",
    maxArea: 0.01,
    xRange: [0.0, 0.12],
    yRange: [0.72, 0.95],
    note: "far left of the control bar",
  },
  {
    target: "the mute / volume button in the video player controls",
    maxArea: 0.01,
    xRange: [0.0, 0.18],
    yRange: [0.72, 0.95],
    note: "just right of play/pause",
  },
  {
    target: "the settings (gear) button in the video player controls",
    maxArea: 0.01,
    xRange: [0.45, 0.72],
    yRange: [0.72, 0.95],
    note: "right side of the control bar",
  },
  {
    target: "the fullscreen button in the video player controls",
    maxArea: 0.01,
    xRange: [0.55, 0.75],
    yRange: [0.72, 0.95],
    note: "far right of the control bar",
  },
  {
    target: "the search box at the top of the page",
    maxArea: 0.06,
    xRange: [0.2, 0.62],
    yRange: [0.02, 0.18],
    note: "top centre",
  },
];


const base64Png = readFileSync(file).toString("base64");

// The model returns boxes normalised to 0-1000, so any image size works here;
// 1000x1000 keeps the reported fractions directly comparable.
const W = 1000;
const H = 1000;

let failed = 0;

for (const exp of EXPECTED) {
  process.stdout.write(`\n${exp.target}\n`);
  let detection;
  try {
    detection = await locate(base64Png, exp.target);
  } catch (err) {
    console.log(`  FAIL  vision call failed: ${err instanceof Error ? err.message : err}`);
    failed++;
    continue;
  }

  if (!detection.found || !detection.box_2d) {
    console.log("  FAIL  not found");
    failed++;
    continue;
  }
  const px = box2dToPixels(detection.box_2d, W, H);
  if (!px) {
    console.log(`  FAIL  box rejected as implausible: ${JSON.stringify(detection.box_2d)}`);
    failed++;
    continue;
  }

  const area = (px.width * px.height) / (W * H);
  const fx = px.centerX / W;
  const fy = px.centerY / H;

  const sizeOk = area <= exp.maxArea;
  const placeOk =
    fx >= exp.xRange[0] && fx <= exp.xRange[1] && fy >= exp.yRange[0] && fy <= exp.yRange[1];

  console.log(
    `  centre (${fx.toFixed(3)}, ${fy.toFixed(3)})  area ${(area * 100).toFixed(2)}%  "${detection.label}"`,
  );
  if (sizeOk && placeOk) {
    console.log(`  PASS  a control-sized box, ${exp.note}`);
  } else {
    if (!sizeOk) {
      console.log(`  FAIL  box covers ${(area * 100).toFixed(1)}% of the screen — that is not a control`);
    }
    if (!placeOk) {
      console.log(`  FAIL  expected ${exp.note}, got (${fx.toFixed(2)}, ${fy.toFixed(2)})`);
    }
    failed++;
  }
}

console.log("\n" + "-".repeat(78));
console.log(failed ? `${failed} of ${EXPECTED.length} FAILED` : `all ${EXPECTED.length} controls located`);
process.exit(failed ? 1 : 0);
