/**
 * Gemini vision bounding boxes are normalized to [0, 1000] as
 * [ymin, xmin, ymax, xmax]. Convert to pixel space for click targeting.
 */

export type Box2d = [number, number, number, number];

/**
 * Which order a provider puts its box corners in.
 *
 * Gemini documents `[ymin, xmin, ymax, xmax]`; OpenAI models routinely emit
 * `[xmin, ymin, xmax, ymax]` for the same request. The two are
 * indistinguishable from the numbers alone whenever both readings are
 * internally consistent — which is exactly the case for a tall subject — so a
 * transposed box produced a plausible rectangle in the wrong place: shifted
 * left of the person, top edge aligned, right edge cutting through them.
 *
 * The order therefore has to be declared by whoever knows it. Each provider
 * adapter tags its own answer; nothing downstream guesses.
 */
export type BoxOrder = "yxyx" | "xyxy";

/** Put a provider's box into the canonical `[ymin, xmin, ymax, xmax]` order. */
export function canonicalBoxOrder(box: number[], order: BoxOrder): number[] {
  if (order === "yxyx") return box;
  const [xmin, ymin, xmax, ymax] = box;
  return [ymin, xmin, ymax, xmax];
}

export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** Descale a Gemini box_2d (0â€“1000) into pixel coordinates for an image. */
export function box2dToPixels(
  box: Box2d | number[],
  imageWidth: number,
  imageHeight: number,
): PixelBox | null {
  if (!Array.isArray(box) || box.length < 4) return null;
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  // Gemini's documented order, and the only one we can act on: a transposed
  // array is indistinguishable from a valid one whenever both readings are
  // internally consistent, so there is no fallback worth writing here. A box
  // that is invalid in this order is invalid in the other one too, and gets
  // rejected below.
  const [ymin, xmin, ymax, xmax] = box.map((n) => Number(n));
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return null;

  const clamp01k = (v: number) => Math.min(1000, Math.max(0, v));
  const top = Math.round((clamp01k(ymin) / 1000) * imageHeight);
  const left = Math.round((clamp01k(xmin) / 1000) * imageWidth);
  const bottom = Math.round((clamp01k(ymax) / 1000) * imageHeight);
  const right = Math.round((clamp01k(xmax) / 1000) * imageWidth);

  if (right <= left || bottom <= top) return null;

  // A tall sliver is almost never the thing asked for — it is the model boxing
  // a whole column of a grid (a desktop icon column, a file list) rather than
  // one cell. Clicking its centre hits the wrong row.
  const w = right - left;
  const h = bottom - top;
  if (h > imageHeight * 0.32 && w < imageWidth * 0.16) return null;

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
  };
}

/**
 * A model box, kept in the model's own normalised space.
 *
 * Nothing here converts to pixels or adds an origin â€” that conversion belongs
 * in Rust, where the frame says which display the numbers refer to. What is
 * still worth doing on this side is rejecting a box that is the wrong *shape*,
 * because that judgement is about the match rather than about the geometry, and
 * ratios are the same in any coordinate space.
 */
export function modelGeometryFromBox2d(
  box: Box2d | number[],
  normalizedMax = 1000,
  /**
   * What kind of thing was asked for.
   *
   * The sliver guard below exists for `ui-control`, where a tall thin box means
   * the model outlined a whole column of a grid. A standing person is *also*
   * tall and thin — the left figure in the annotation test is 180x630 — so
   * applying that guard to content rejected a perfectly good box and reported
   * the person as absent. The rule is right for controls and wrong for people,
   * so the caller says which it wants.
   */
  category: "ui-control" | "visual-content" = "ui-control",
): {
  x: number;
  y: number;
  normalizedMax: number;
  box: { x: number; y: number; width: number; height: number };
} | null {
  if (!Array.isArray(box) || box.length < 4) return null;
  // Gemini's documented order, and the only one we can act on: a transposed
  // array is indistinguishable from a valid one whenever both readings are
  // internally consistent, so there is no fallback worth writing here.
  const [ymin, xmin, ymax, xmax] = box.map((n) => Number(n));
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return null;

  const clamp = (v: number) => Math.min(normalizedMax, Math.max(0, v));
  const top = clamp(ymin);
  const left = clamp(xmin);
  const bottom = clamp(ymax);
  const right = clamp(xmax);
  if (right <= left || bottom <= top) return null;

  // A tall sliver is almost never the thing asked for â€” it is the model boxing
  // a whole column of a grid (a desktop icon column, a file list) rather than
  // one cell. Clicking its centre hits the wrong row.
  const w = right - left;
  const h = bottom - top;
  // The guard applies only where it was earned. A tall thin box means a grid
  // column when a *control* was asked for; it means an ordinary standing
  // person when content was. Applying it to content rejected a perfectly good
  // box and reported the person as absent.
  if (
    category === "ui-control" &&
    h > normalizedMax * 0.32 &&
    w < normalizedMax * 0.16
  ) {
    return null;
  }

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    normalizedMax,
    box: { x: left, y: top, width: w, height: h },
  };
}

/**
 * DIAGNOSTIC ONLY â€” absolute screen point from image-local pixel + an origin.
 *
 * Production must not use this. An origin passed in from TypeScript is an
 * origin that was inferred somewhere, and inferring which display a screenshot
 * came from is exactly what put clicks on the wrong monitor. The runtime path
 * is `services/visualTarget.ts`, which sends model geometry plus a frame id to
 * Rust and lets Rust do the conversion against the display the frame recorded.
 *
 * This survives because the arithmetic is worth regression-testing on known
 * numbers, including negative origins.
 */
export function diagnosticImagePointToScreen(
  localX: number,
  localY: number,
  originX: number,
  originY: number,
): { x: number; y: number } {
  return {
    x: Math.round(originX + localX),
    y: Math.round(originY + localY),
  };
}

export interface DetectedTarget {
  found: boolean;
  label: string;
  box_2d?: Box2d;
  confidence?: number;
}

/**
 * Parse Gemini JSON for a single click target.
 * Tolerates markdown fences and trailing prose.
 */
export function parseDetectedTarget(raw: string): DetectedTarget | null {
  const text = raw.trim();
  if (!text) return null;

  // Prefer fenced or bare JSON object
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    const found = Boolean(obj.found ?? true);
    const label = String(obj.label ?? obj.name ?? "").trim() || "target";
    let box: Box2d | undefined;
    const rawBox = obj.box_2d ?? obj.box2d ?? obj.bbox;
    if (Array.isArray(rawBox) && rawBox.length >= 4) {
      box = [
        Number(rawBox[0]),
        Number(rawBox[1]),
        Number(rawBox[2]),
        Number(rawBox[3]),
      ];
    }
    const confidence =
      typeof obj.confidence === "number" ? obj.confidence : undefined;
    return { found, label, box_2d: box, confidence };
  } catch {
    return null;
  }
}

/** DIAGNOSTIC ONLY. See `diagnosticImagePointToScreen`. */
export function diagnosticClickPointFromDetection(
  detection: DetectedTarget,
  imageWidth: number,
  imageHeight: number,
  originX = 0,
  originY = 0,
): {
  x: number;
  y: number;
  label: string;
  box: { left: number; top: number; width: number; height: number };
} | null {
  if (!detection.found || !detection.box_2d) return null;
  const px = box2dToPixels(detection.box_2d, imageWidth, imageHeight);
  if (!px) return null;
  const screen = diagnosticImagePointToScreen(px.centerX, px.centerY, originX, originY);
  // The box travels with the point so the highlight can outline what was
  // actually matched â€” a click with no outline gives the user no way to tell
  // "it found the right thing" from "it guessed and got lucky".
  return {
    ...screen,
    label: detection.label,
    box: {
      left: px.left + originX,
      top: px.top + originY,
      width: px.width,
      height: px.height,
    },
  };
}

