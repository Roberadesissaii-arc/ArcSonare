/**
 * OpenAI vision helpers for screen understand + click targeting.
 * Uses the same OpenAI key as Realtime voice (via Rust `openai_vision`).
 */
import { invoke } from "@tauri-apps/api/core";
import {
  parseDetectedTarget,
  type DetectedTarget,
} from "./visionCoords";

export async function openaiDescribeImage(
  imageDataUrl: string,
  userQuestion = "Describe what is on this screen. Be concise and practical.",
): Promise<string> {
  return invoke<string>("openai_vision", {
    prompt: userQuestion,
    images: [{ mime_type: "image/png", data: imageDataUrl }],
    system:
      "You help the user understand their computer screen. Be accurate, brief, and never invent UI that is not visible.",
  });
}

/**
 * Locate a UI element for clicking via OpenAI vision.
 * Returns structured detection with box_2d in 0â€“1000 coords (same as Gemini path).
 */
/**
 * Locate something depicted on screen, for annotation.
 *
 * The sibling above is told to "prefer the most clickable control", which is
 * correct for a button and fatal for a person in a photo — asked to find "the
 * person on the left" it returns nothing, because a person is not a control.
 * The annotation path must never fall back to it; this is the content-mode
 * equivalent, so every image-capable provider gets equivalent instructions.
 */
export async function openaiLocateContent(
  imageDataUrl: string,
  targetDescription: string,
  within?: { x: number; y: number; width: number; height: number },
): Promise<DetectedTarget> {
  const { CONTENT_LOCATOR_SYSTEM_PROMPT, contentLocatorPrompt } = await import(
    "./visionPrompts"
  );
  const raw = await invoke<string>("openai_vision", {
    prompt: contentLocatorPrompt(targetDescription, within),
    images: [{ mime_type: "image/png", data: imageDataUrl }],
    system: CONTENT_LOCATOR_SYSTEM_PROMPT,
  });
  const parsed = parseDetectedTarget(raw);
  if (!parsed) return { found: false, label: targetDescription };
  // OpenAI models emit `[xmin, ymin, xmax, ymax]` for this prompt even when
  // asked for Gemini's order, and a transposed box is indistinguishable from a
  // valid one whenever both readings are internally consistent. Converting here
  // — where the provider is known — is the only place the ambiguity can be
  // resolved rather than guessed at.
  if (Array.isArray(parsed.box_2d) && parsed.box_2d.length === 4) {
    const { canonicalBoxOrder } = await import("./visionCoords");
    return { ...parsed, box_2d: canonicalBoxOrder(parsed.box_2d, "xyxy") as typeof parsed.box_2d };
  }
  return parsed;
}

export async function openaiLocateClickTarget(
  imageDataUrl: string,
  targetDescription: string,
): Promise<DetectedTarget> {
  const prompt = [
    `Find the UI element to click that best matches: "${targetDescription}".`,
    `Return ONLY JSON (no markdown) with keys:`,
    `  found (boolean), label (string), box_2d ([ymin, xmin, ymax, xmax] integers 0-1000), confidence (0-1).`,
    `If the target is not visible, set found=false and omit box_2d.`,
    `Prefer the most clickable control (button, link, play/pause icon, menu item).`,
  ].join("\n");

  const raw = await invoke<string>("openai_vision", {
    prompt,
    images: [{ mime_type: "image/png", data: imageDataUrl }],
    system:
      "You are a precise UI locator on a computer screenshot. Coordinates are relative to the image and scale 0-1000. Prefer the most clickable control (button, link, icon).",
  });

  const parsed = parseDetectedTarget(raw);
  if (!parsed) {
    return { found: false, label: targetDescription };
  }
  return parsed;
}

// `openaiClickPointFromImage` was here â€” see the note in GeminiService.ts. The
// runtime path binds model geometry to its frame in Rust instead of composing a
// screen point from an origin passed in by the caller.

