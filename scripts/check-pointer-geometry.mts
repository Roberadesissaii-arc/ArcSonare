/**
 * Where the pointer and the highlight actually land.
 *
 * "Is it in the exact location, or is it just assuming?" is a coordinate
 * question, and every wrong answer so far came from the same three places:
 *
 *  1. The arrow's tip is not the centre of its window - the body runs down and
 *     right from it. The window is offset by the tip's own coordinates, and
 *     getting that wrong puts every click down-right of what the model matched.
 *  2. Screen coordinates are virtual-desktop coordinates. A second monitor to
 *     the LEFT of the primary has negative X. Code that clamps to >= 0, or
 *     assumes the capture started at (0,0), silently retargets the primary
 *     monitor â€” the click lands on the wrong screen entirely.
 *  3. The highlight window is padded so its glow is not clipped, so the border
 *     must inset by exactly that padding or it will not sit on the box.
 *
 * Run: npx tsx scripts/check-pointer-geometry.mts
 */

import { box2dToPixels, diagnosticClickPointFromDetection } from "../src/services/visionCoords";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** Mirrors POINTER_SIZE / TIP_X / TIP_Y in src-tauri/src/native_overlay.rs. */
const POINTER_SIZE = 76;
const TIP_X = 24;
const TIP_Y = 20;
const pointerWindowOrigin = (x: number, y: number) => ({
  left: x - TIP_X,
  top: y - TIP_Y,
});

/** Mirrors PADDING in src-tauri/src/agent_highlight.rs. */
const HIGHLIGHT_PADDING = 10;
const highlightWindow = (b: { left: number; top: number; width: number; height: number }) => ({
  left: b.left - HIGHLIGHT_PADDING,
  top: b.top - HIGHLIGHT_PADDING,
  width: b.width + HIGHLIGHT_PADDING * 2,
  height: b.height + HIGHLIGHT_PADDING * 2,
});

console.log("=== pointer tip sits on the target, not below-right of it ===");
{
  const o = pointerWindowOrigin(500, 400);
  const tipX = o.left + TIP_X;
  const tipY = o.top + TIP_Y;
  check(
    "arrow tip lands on the click point",
    tipX === 500 && tipY === 400,
    `window at (${o.left},${o.top}) -> tip (${tipX},${tipY})`,
  );
  check(
    "the body has room to run down-right of the tip",
    POINTER_SIZE - TIP_X > 40 && POINTER_SIZE - TIP_Y > 40,
    `${POINTER_SIZE - TIP_X}x${POINTER_SIZE - TIP_Y} available`,
  );
}

console.log("\n=== the located box maps to the exact centre of the match ===");
{
  // A 3840x2160 capture of a large screen; target box in the lower-right.
  const W = 3840;
  const H = 2160;
  const det = { found: true, label: "Spotify", box_2d: [800, 600, 860, 700] };
  const p = diagnosticClickPointFromDetection(det as never, W, H, 0, 0);
  // 0.83 of height, 0.65 of width -> centre of that box.
  const expectX = Math.round(((600 + 700) / 2 / 1000) * W);
  const expectY = Math.round(((800 + 860) / 2 / 1000) * H);
  check(
    "4K capture: click point is the box centre, not a guess",
    p !== null && p.x === expectX && p.y === expectY,
    p ? `(${p.x},${p.y}) expected (${expectX},${expectY})` : "null",
  );
  check(
    "the matched box travels with the point so it can be outlined",
    p !== null &&
      p.box.width === box2dToPixels(det.box_2d, W, H)!.width &&
      p.box.height === box2dToPixels(det.box_2d, W, H)!.height,
    p ? `box ${p.box.width}x${p.box.height} at (${p.box.left},${p.box.top})` : "null",
  );
}

console.log("\n=== second monitor: capture origin must be carried through ===");
{
  // Monitor 2 sits to the RIGHT of a 2560-wide primary.
  const W = 1920;
  const H = 1080;
  const originX = 2560;
  const det = { found: true, label: "Chrome tab", box_2d: [500, 500, 540, 560] };
  const p = diagnosticClickPointFromDetection(det as never, W, H, originX, 0);
  const expectX = originX + Math.round(((500 + 560) / 2 / 1000) * W);
  check(
    "right-hand monitor: point is offset by the capture origin",
    p !== null && p.x === expectX,
    p ? `x=${p.x} expected ${expectX}` : "null",
  );
  check(
    "right-hand monitor: the outline is offset too",
    p !== null && p.box.left >= originX,
    p ? `box.left=${p.box.left} (monitor starts at ${originX})` : "null",
  );
}

console.log("\n=== second monitor to the LEFT: negative coordinates survive ===");
{
  // This is the case that silently retargets the primary monitor if any step
  // clamps to zero. A monitor left of primary has a negative origin.
  const W = 1920;
  const H = 1080;
  const originX = -1920;
  const det = { found: true, label: "Explorer window", box_2d: [400, 100, 460, 200] };
  const p = diagnosticClickPointFromDetection(det as never, W, H, originX, 0);
  const expectX = originX + Math.round(((100 + 200) / 2 / 1000) * W);
  check(
    "left-hand monitor: click point stays negative",
    p !== null && p.x === expectX && p.x < 0,
    p ? `x=${p.x} expected ${expectX}` : "null",
  );
  const o = p ? pointerWindowOrigin(p.x, p.y) : null;
  check(
    "left-hand monitor: pointer window origin stays negative (not clamped)",
    o !== null && o.left < 0,
    o ? `window left=${o.left}` : "null",
  );
  const hw = p ? highlightWindow(p.box) : null;
  check(
    "left-hand monitor: highlight window origin stays negative",
    hw !== null && hw.left < 0,
    hw ? `highlight left=${hw.left}` : "null",
  );
}

console.log("\n=== vertical stacking: monitor above primary ===");
{
  const W = 1920;
  const H = 1080;
  const originY = -1080;
  const det = { found: true, label: "toolbar button", box_2d: [100, 400, 140, 460] };
  const p = diagnosticClickPointFromDetection(det as never, W, H, 0, originY);
  const expectY = originY + Math.round(((100 + 140) / 2 / 1000) * H);
  check(
    "monitor above primary: y stays negative",
    p !== null && p.y === expectY && p.y < 0,
    p ? `y=${p.y} expected ${expectY}` : "null",
  );
}

console.log("\n=== highlight outlines the box itself, padding included ===");
{
  const box = { left: 300, top: 200, width: 120, height: 40 };
  const w = highlightWindow(box);
  // The CSS insets the border by the same padding, so the drawn border must
  // land back exactly on the original box.
  const borderLeft = w.left + HIGHLIGHT_PADDING;
  const borderTop = w.top + HIGHLIGHT_PADDING;
  const borderW = w.width - HIGHLIGHT_PADDING * 2;
  const borderH = w.height - HIGHLIGHT_PADDING * 2;
  check(
    "drawn border lands exactly on the matched box",
    borderLeft === box.left &&
      borderTop === box.top &&
      borderW === box.width &&
      borderH === box.height,
    `border (${borderLeft},${borderTop}) ${borderW}x${borderH} vs box (${box.left},${box.top}) ${box.width}x${box.height}`,
  );
  check(
    "the glow has room and is not clipped by the window edge",
    w.width > box.width && w.height > box.height,
    `window ${w.width}x${w.height} around box ${box.width}x${box.height}`,
  );
}

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);

