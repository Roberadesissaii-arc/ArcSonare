/**
 * Google Gemini cloud bridge (via Rust → generativelanguage.googleapis.com).
 * API key stays in Windows Credential Manager under provider "google".
 */
import { invoke } from "@tauri-apps/api/core";
import { getPrefs } from "../stores/settingsStore";
import { modelById } from "../config/modelRegistry";
import type { ChatMessage } from "./OllamaService";
import { assistantSystemContext } from "./assistantTools";

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
