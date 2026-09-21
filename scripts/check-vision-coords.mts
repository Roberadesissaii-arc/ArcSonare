/**
 * Turning a Gemini box into a click point.
 *
 * Two failure modes seen in practice, both ported from a working locator:
 *
 *  1. The model sometimes emits [xmin, ymin, xmax, ymax] instead of the
 *     documented [ymin, xmin, ymax, xmax]. Assuming one order silently
 *     transposes the box and the click lands somewhere unrelated.
 *  2. On grids (desktop icons, file lists) it sometimes boxes a whole column
 *     rather than one cell. The centre of that strip is the wrong row.
 *
 * Run: npx tsx scripts/check-vision-coords.mts
 */

import { box2dToPixels } from "../src/services/visionCoords";

const W = 1920;
const H = 1080;

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

// Documented order: [ymin, xmin, ymax, xmax]
const normal = box2dToPixels([100, 200, 300, 500], W, H);
check(
  "documented order maps correctly",
  normal !== null &&
    normal.top === Math.round(0.1 * H) &&
    normal.left === Math.round(0.2 * W),
  normal ? `top=${normal.top} left=${normal.left}` : "null",
);

// A transposed array cannot be recovered: whenever both readings are
// internally consistent they are indistinguishable, and when one is invalid so
// is the other. It is rejected rather than guessed at, which is the safe
// outcome — a wrong box means clicking the wrong thing.
check(
  "an inconsistent box is rejected rather than guessed",
  box2dToPixels([500, 100, 200, 300], W, H) === null,
  "rejected",
);

// A tall narrow strip is a boxed column, not a target.
const strip = box2dToPixels([50, 400, 950, 480], W, H);
check(
  "tall narrow column strip is rejected",
  strip === null,
  strip ? `accepted: ${strip.width}x${strip.height}` : "rejected",
);

// A normal icon cell must still be accepted.
const iconCell = box2dToPixels([120, 200, 200, 290], W, H);
check(
  "a normal grid cell is still accepted",
  iconCell !== null,
  iconCell ? `${iconCell.width}x${iconCell.height}` : "rejected",
);

// A tall but wide region (a sidebar panel) is legitimate.
const panel = box2dToPixels([50, 100, 950, 500], W, H);
check(
  "a tall but wide region is kept",
  panel !== null,
  panel ? `${panel.width}x${panel.height}` : "rejected",
);

// Degenerate input must not produce a point.
check("zero-area box is rejected", box2dToPixels([500, 500, 500, 500], W, H) === null, "rejected");
check("short array is rejected", box2dToPixels([1, 2, 3], W, H) === null, "rejected");

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
