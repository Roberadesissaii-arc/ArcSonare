import type { Bounds, ScreenAnnotation } from "./types";

/** Derive spatial focus regions from structured annotations (hints, not certainty). */
export function focusRegionsFromAnnotations(
  annotations: ScreenAnnotation[],
  imageWidth: number,
  imageHeight: number,
): Bounds[] {
  const regions: Bounds[] = [];
  for (const a of annotations) {
    const bounds = annotationBounds(a);
    if (!bounds) continue;
    regions.push(clampBounds(bounds, imageWidth, imageHeight));
  }
  return regions;
}

export function annotationBounds(a: ScreenAnnotation): Bounds | null {
  switch (a.type) {
    case "rectangle":
    case "ellipse":
    case "blur":
    case "redact":
      return { ...a.bounds };
    case "arrow": {
      const size = 48;
      return {
        x: a.end.x - size / 2,
        y: a.end.y - size / 2,
        width: size,
        height: size,
      };
    }
    case "freehand":
    case "highlighter": {
      if (a.points.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of a.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
    }
    case "focus-point": {
      const r = a.radius;
      return { x: a.point.x - r, y: a.point.y - r, width: r * 2, height: r * 2 };
    }
    default:
      return null;
  }
}

function clampBounds(b: Bounds, w: number, h: number): Bounds {
  const x = Math.max(0, Math.min(b.x, w - 1));
  const y = Math.max(0, Math.min(b.y, h - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(b.width, w - x)),
    height: Math.max(1, Math.min(b.height, h - y)),
  };
}

export function normalizeBounds(b: Bounds, w: number, h: number): Bounds {
  if (w <= 0 || h <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: b.x / w,
    y: b.y / h,
    width: b.width / w,
    height: b.height / h,
  };
}
