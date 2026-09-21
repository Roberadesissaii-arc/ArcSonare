/**
 * The wording used to ask a vision model where something is on screen.
 *
 * Kept in its own leaf module, with no imports, so the exact prompt the app
 * ships can be exercised by scripts/check-youtube-controls.mts. The service
 * that normally sends it reaches the network through Tauri IPC, which does not
 * exist outside the app — so without this split, a test could only check a
 * copy of the prompt, and a copy drifts.
 */

/**
 * Locating things *in* the picture, rather than controls to click.
 *
 * The click locator is told to "prefer the most clickable control", which is
 * right for a button and fatal for a person in a photo: asked to find "the
 * person on the left" it returned nothing at all, because a person is not a
 * control. Annotation needs the opposite instruction — look at the content, and
 * ignore the application chrome around it.
 */
export const CONTENT_LOCATOR_SYSTEM_PROMPT =
  "You are a precise visual locator. Coordinates are relative to the image and scale 0-1000, ordered [ymin, xmin, ymax, xmax]. Locate things depicted in the picture — people, faces, animals, objects, regions — not user-interface controls. Ignore window chrome, toolbars and menus unless they are what was asked for. Box the thing itself as tightly as you can, without including its neighbours. When the description names a position, use it to pick one of several matches rather than declining.";

/** Ask for something depicted on screen, optionally only within a region. */
export function contentLocatorPrompt(
  targetDescription: string,
  within?: { x: number; y: number; width: number; height: number },
): string {
  return [
    `Find this in the picture: "${targetDescription}".`,
    ``,
    // The first version said "if several things match, set found to false".
    // That is the wrong instruction for exactly this request: "the person on
    // the left" describes one of two people, so several things match the noun
    // and the qualifier is what picks between them. Gemini duly returned
    // found=false with confidence 1.0 — confidently reporting absence for
    // someone plainly on screen.
    `If the description includes a position — left, right, middle, top, bottom,`,
    `first, second — use it to choose between the matches. "The person on the`,
    `left" means the leftmost person, not "ambiguous".`,
    ``,
    within
      ? `Look ONLY inside the box [ymin=${Math.round(within.y)}, xmin=${Math.round(
          within.x,
        )}, ymax=${Math.round(within.y + within.height)}, xmax=${Math.round(
          within.x + within.width,
        )}] in the same 0-1000 space. Anything outside it is a different subject.`
      : `The picture may be shown inside an application window, with other`
        + ` windows and desktop around it. Look at the picture content, not at`
        + ` the surrounding interface.`,
    ``,
    `Box it tightly around the thing itself. Do not return the whole screen,`,
    `the whole window, or a box that also contains a neighbouring subject.`,
    `Only set found=false if nothing of that kind is visible anywhere.`,
    ``,
    `Reply with JSON only:`,
    `{"found": true|false, "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.0-1.0, "label": "what you found", "matches": <how many things of that kind you can see>}`,
  ].join(String.fromCharCode(10));
}

export const LOCATOR_SYSTEM_PROMPT =
  "You are a precise UI locator. Coordinates are relative to the image and scale 0-1000, ordered [ymin, xmin, ymax, xmax]. Prefer the most clickable control (button, link, icon, file). Accuracy matters more than always finding something.";

/**
 * Guidance ported from a working locator. The terse version missed grid
 * layouts badly — desktop icons and file lists are grids, and without being
 * told so the model returned a tall strip covering a whole column instead of
 * one icon.
 */
export function locatorPrompt(targetDescription: string): string {
  return [
    `Locate exactly one thing on this screen: "${targetDescription}".`,
    ``,
    `Return ONLY JSON, no markdown fences, with these keys:`,
    `  found      boolean`,
    `  label      string  — what you actually matched`,
    `  box_2d     [ymin, xmin, ymax, xmax], integers 0-1000, normalized to the image`,
    `  confidence 0-1`,
    ``,
    `Rules:`,
    `- The box must TIGHTLY wrap the thing itself. Not the empty space above it,`,
    `  not the row or column it sits in.`,
    `- GRIDS (desktop icons, file lists, tool palettes): box the single cell —`,
    `  its icon plus its label. Never a full-height vertical strip.`,
    `- A file or app icon includes its text caption; box both together.`,
    `- If several things match, pick the one whose visible text matches best.`,
    `- If it is genuinely not visible on this screen, set found=false and omit`,
    `  box_2d. Do not guess a location — a wrong box is worse than "not found".`,
  ].join("\n");
}
