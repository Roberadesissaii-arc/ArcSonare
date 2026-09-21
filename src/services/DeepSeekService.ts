/**
 * DeepSeek cloud bridge (via Rust → https://api.deepseek.com).
 * API key stays in the OS credential store; never returned to the UI.
 */
import { invoke } from "@tauri-apps/api/core";
import { getPrefs } from "../stores/settingsStore";
import { modelById } from "../config/modelRegistry";
import type { ChatMessage } from "./chatTypes";
import { assistantSystemContext } from "./assistantTools";

export async function deepseekChat(
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<string> {
  const prefs = getPrefs();
  const role = modelById(prefs.models.roles.assistant);
  const model =
    modelOverride?.trim() ||
    (role?.provider === "deepseek" ? role.modelName : "") ||
    "deepseek-v4-flash";

  return invoke<string>("deepseek_chat", {
    model,
    messages,
  });
}

/** Short chat reply for settings tests / direct calls. */
export async function deepseekReply(
  userText: string,
  modelOverride?: string,
): Promise<string> {
  return deepseekChat(
    [
      { role: "system", content: await assistantSystemContext() },
      { role: "user", content: userText },
    ],
    modelOverride,
  );
}

export function isDeepSeekAssistantConfigured(): boolean {
  const role = modelById(getPrefs().models.roles.assistant);
  return role?.provider === "deepseek";
}
