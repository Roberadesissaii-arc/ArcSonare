/**
 * Refuse a vision answer that cannot be the single Desktop icon that was asked for.
 *
 * "Show me the books folder" came back with a box covering File, New folder,
 * ridetrip-devop and Trip, and ArcSonare drew a border round all four. Every
 * layer under that answer was correct — the capture, the frame ownership, the
 * coordinate mapping, the overlay — so none of them could have caught it. The
 * only thing wrong was the answer, and nothing was checking the answer.
 *
 * A border round the wrong thing looks exactly like a border round the right
 * thing, so the user cannot tell them apart either. That makes silence the worst
 * outcome available: saying "I'm not sure" is recoverable, and confidently
 * pointing at the wrong folder is not. Everything here therefore fails closed.
 *
 * The checks are exact rather than heuristic whenever the shell's own icon
 * rectangles are available — "does this box contain two icon centres" is a
 * question with a real answer, not a guess about plausible sizes.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Is the user talking about the Windows desktop rather than an application?
 *
 * Matters because the two need different screenshots, and getting it wrong is
 * silent: a desktop icon hunted for inside a Spotify window is simply not found,
 * and whatever the model settles on instead gets a border drawn round it.
 */
export function mentionsDesktop(text: string): boolean {
  return /\b(desktop|home ?screen)\b/i.test(text);
}

/** Strip the words around a name so "the books folder on my Desktop" → "books". */
export function desktopItemName(target: string): string {
  return target
    .replace(/\b(on|from|in)\s+(my|the)?\s*desktop\b/gi, " ")
    // "my desktop" has no preposition to match above, and leaving the word in
    // makes the name itself "desktop" — a hunt for an icon by that name rather
    // than the recognition that nothing was named at all.
    .replace(/\b(desktop|home ?screen)\b/gi, " ")
    .replace(/\b(the|my|a|an)\b/gi, " ")
    .replace(/\b(folder|directory|file|icon|shortcut)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DesktopIcon {
  name: string;
  bounds: Rect;
}

export type IconGuardReason =
  | "spans-multiple-icons"
  | "covers-no-icon"
  | "wider-than-one-icon"
  | "taller-than-one-icon"
  | "implausible-aspect"
  | "label-mismatch"
  | "empty-box";

export interface IconGuardVerdict {
  verified: boolean;
  /** The single icon the box resolves to, when it resolves to one. */
  matched?: DesktopIcon;
  reason?: IconGuardReason;
  detail?: string;
}

/** A single icon is roughly square. A boxed row or column is not. */
const MAX_ASPECT = 3;
/**
 * How much larger than a real icon a box may be before it stops being one icon.
 * Labels wrap to a second line and selection bounds run slightly wide, so this
 * is not 1.0; two icons plus the gap between them is well past it.
 */
const MAX_SIZE_FACTOR = 1.8;

function centre(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function contains(outer: Rect, x: number, y: number): boolean {
  return (
    x >= outer.x && y >= outer.y && x < outer.x + outer.width && y < outer.y + outer.height
  );
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Icons whose centre falls inside the box — the icons it is actually claiming. */
export function iconsCentredIn(box: Rect, icons: DesktopIcon[]): DesktopIcon[] {
  return icons.filter((i) => {
    const c = centre(i.bounds);
    return contains(box, c.x, c.y);
  });
}

/** Icons the box overlaps at all — its footprint across the grid. */
export function iconsTouchedBy(box: Rect, icons: DesktopIcon[]): DesktopIcon[] {
  return icons.filter((i) => intersects(box, i.bounds));
}

/**
 * Compare a requested name with a label, the way a person would.
 *
 * Deliberately generous: the point is to catch "asked for books, got Trip", not
 * to adjudicate near-misses. A strict comparison would reject the model for
 * saying "books folder" when it found exactly the right thing.
 */
export function labelsAgree(requested: string, label: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = norm(requested);
  const b = norm(label);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // "books" vs "books folder": share a significant word.
  const words = (s: string) => s.split(" ").filter((w) => w.length > 2);
  return words(a).some((w) => words(b).includes(w));
}

/**
 * Decide whether a resolved rectangle may be drawn.
 *
 * `icons` is the shell's list in the same coordinate space as `box`. Pass an
 * empty array when the Desktop is not the surface in question — the size checks
 * that need real icons are then skipped rather than invented, and only the
 * checks that stand on their own still apply.
 */
export function verifyDesktopIconTarget(input: {
  box: Rect;
  requested: string;
  modelLabel?: string;
  icons: DesktopIcon[];
}): IconGuardVerdict {
  const { box, requested, modelLabel, icons } = input;

  if (!(box.width > 0) || !(box.height > 0)) {
    return { verified: false, reason: "empty-box", detail: "the box has no area" };
  }

  // The model's own words, before any geometry is trusted. Asking for "books"
  // and being handed "Trip" is settled here and needs no rectangles at all.
  if (modelLabel && !labelsAgree(requested, modelLabel)) {
    return {
      verified: false,
      reason: "label-mismatch",
      detail: `asked for “${requested}”, the model reported “${modelLabel}”`,
    };
  }

  const aspect = box.width / box.height;
  if (aspect > MAX_ASPECT || 1 / aspect > MAX_ASPECT) {
    return {
      verified: false,
      reason: "implausible-aspect",
      detail: `${box.width}x${box.height} is a strip, not an icon`,
    };
  }

  if (icons.length === 0) {
    // Nothing to check against. Say so rather than implying the box was
    // confirmed: the caller decides whether an unverified box is worth drawing.
    return { verified: true, detail: "no Desktop icon list to check against" };
  }

  const cellWidth = median(icons.map((i) => i.bounds.width));
  const cellHeight = median(icons.map((i) => i.bounds.height));
  if (box.width > cellWidth * MAX_SIZE_FACTOR) {
    return {
      verified: false,
      reason: "wider-than-one-icon",
      detail: `${box.width}px across where an icon is about ${Math.round(cellWidth)}px`,
    };
  }
  if (box.height > cellHeight * MAX_SIZE_FACTOR) {
    return {
      verified: false,
      reason: "taller-than-one-icon",
      detail: `${box.height}px tall where an icon is about ${Math.round(cellHeight)}px`,
    };
  }

  // The decisive check, and the one the reported failure would not have
  // survived: a box that owns four icon centres is not pointing at one icon.
  const centred = iconsCentredIn(box, icons);
  if (centred.length > 1) {
    return {
      verified: false,
      reason: "spans-multiple-icons",
      detail: `covers ${centred.length} icons: ${centred.map((i) => i.name).join(", ")}`,
    };
  }
  const touched = iconsTouchedBy(box, icons);
  if (centred.length === 0) {
    return {
      verified: false,
      reason: "covers-no-icon",
      detail: touched.length
        ? `sits between ${touched.map((i) => i.name).join(", ")}`
        : "lands on empty desktop",
    };
  }
  if (touched.length > 1) {
    // Straddling two grid cells while centring on one is how an off-by-one-cell
    // answer looks. The neighbour it clips is the one it probably meant.
    return {
      verified: false,
      reason: "spans-multiple-icons",
      detail: `overlaps ${touched.map((i) => i.name).join(", ")}`,
    };
  }

  const matched = centred[0];
  if (!labelsAgree(requested, matched.name)) {
    return {
      verified: false,
      reason: "label-mismatch",
      detail: `the box lands on “${matched.name}”, not “${requested}”`,
      matched,
    };
  }
  return { verified: true, matched };
}
