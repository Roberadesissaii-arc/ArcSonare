/**
 * Google Gemini cloud bridge (via Rust â†’ generativelanguage.googleapis.com).
 * API key stays in Windows Credential Manager under provider "google".
 * Supports text chat and multimodal vision (screenshots â†’ describe / locate click targets).
 */
import { invoke } from "@tauri-apps/api/core";
import { getPrefs } from "../stores/settingsStore";
import { modelById } from "../config/modelRegistry";
import type { ChatMessage } from "./chatTypes";
import { assistantSystemContext } from "./assistantTools";
import {
  parseDetectedTarget,
  type DetectedTarget,
} from "./visionCoords";
import { LOCATOR_SYSTEM_PROMPT, locatorPrompt } from "./visionPrompts";

export async function geminiChat(
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<string> {
  const prefs = getPrefs();
  const role = modelById(prefs.models.roles.assistant);
  const model =
    modelOverride?.trim() ||
    prefs.models.googleModel?.trim() ||
    (role?.provider === "google" ? role.modelName : "") ||
    "gemini-3.5-flash";

  return invoke<string>("gemini_chat", {
    model,
    messages,
  });
}

export async function geminiReply(
  userText: string,
  modelOverride?: string,
): Promise<string> {
  return geminiChat(
    [
      { role: "system", content: await assistantSystemContext() },
      { role: "user", content: userText },
    ],
    modelOverride,
  );
}

export function isGeminiAssistantConfigured(): boolean {
  const role = modelById(getPrefs().models.roles.assistant);
  return role?.provider === "google";
}

function resolveGeminiModel(modelOverride?: string): string {
  const prefs = getPrefs();
  const role = modelById(prefs.models.roles.assistant);
  return (
    modelOverride?.trim() ||
    prefs.models.googleModel?.trim() ||
    (role?.provider === "google" ? role.modelName : "") ||
    "gemini-3.5-flash"
  );
}

export interface VisionImageInput {
  mimeType?: string;
  /** Raw base64 or full data URL (data:image/png;base64,...). */
  data: string;
}

/**
 * Multimodal vision call â€” prompt + images.
 * Uses generateContent with inline_data parts (base64).
 */
export async function geminiVision(
  prompt: string,
  images: VisionImageInput[],
  options?: { model?: string; system?: string },
): Promise<string> {
  const model = resolveGeminiModel(options?.model);
  return invoke<string>("gemini_vision", {
    model,
    prompt,
    images: images.map((img) => ({
      mime_type: img.mimeType ?? "image/png",
      data: img.data,
    })),
    system: options?.system ?? null,
  });
}

/** Describe a screenshot (data URL or base64). */
export async function geminiDescribeImage(
  imageDataUrl: string,
  userQuestion = "Describe what is on this screen. Be concise and practical.",
): Promise<string> {
  return geminiVision(
    userQuestion,
    [{ data: imageDataUrl, mimeType: "image/png" }],
    {
      system:
        "You help the user understand their computer screen. Be accurate, brief, and never invent UI that is not visible.",
    },
  );
}

/**
 * Ask Gemini to locate a UI element for clicking.
 * Returns structured detection with box_2d in 0â€“1000 coords.
 */
/**
 * Locate something depicted on screen — a person, a face, an object.
 *
 * Separate from `geminiLocateClickTarget` because the two want opposite things
 * from the model: that one is told to prefer the most clickable control, which
 * is why asking it for "the person on the left" returned nothing at all.
 * `within` constrains the search to a region already resolved, so a face is
 * looked for inside its own person rather than across the whole screen.
 */
export async function geminiLocateContent(
  imageDataUrl: string,
  targetDescription: string,
  within?: { x: number; y: number; width: number; height: number },
): Promise<DetectedTarget> {
  const { CONTENT_LOCATOR_SYSTEM_PROMPT, contentLocatorPrompt } = await import(
    "./visionPrompts"
  );
  const raw = await geminiVision(
    contentLocatorPrompt(targetDescription, within),
    [{ data: imageDataUrl, mimeType: "image/png" }],
    { system: CONTENT_LOCATOR_SYSTEM_PROMPT },
  );
  const parsed = parseDetectedTarget(raw);
  if (!parsed) return { found: false } as DetectedTarget;
  // Already `[ymin, xmin, ymax, xmax]` — Gemini's documented order, which is
  // the canonical one. Stated rather than assumed, because the OpenAI sibling
  // has to convert and the difference must be visible in both places.
  return parsed;
}

export async function geminiLocateClickTarget(
  imageDataUrl: string,
  targetDescription: string,
): Promise<DetectedTarget> {
  const prompt = locatorPrompt(targetDescription);

  const raw = await geminiVision(
    prompt,
    [{ data: imageDataUrl, mimeType: "image/png" }],
    {
      system: LOCATOR_SYSTEM_PROMPT,
    },
  );

  const parsed = parseDetectedTarget(raw);
  if (!parsed) {
    return { found: false, label: targetDescription };
  }
  return parsed;
}

// `geminiClickPointFromImage` was here: locate a target, then turn it into an
// absolute screen point using an origin the caller supplied. Callers do not
// have a trustworthy origin â€” that is a property of the frame, held in Rust â€”
// so the runtime path is now `geminiLocateClickTarget` for the geometry plus
// `services/visualTarget.ts` to bind it to the frame it came from.

