/**
 * Pick a default assistant when one provider is already configured.
 *
 * Keys can arrive without anyone visiting Settings — they may be compiled into
 * the build from `.env` and seeded into Credential Manager at startup. Having a
 * working key but no selected model meant a fresh install still answered
 * "No AI model is connected yet", which is confusing when the key is right
 * there.
 *
 * Only ever fills an empty selection. A model the user chose is never changed.
 */

import { invoke } from "@tauri-apps/api/core";
import { getPrefs, updatePrefs } from "../../stores/settingsStore";

/** First match wins — chat-capable providers, best default first. */
const CANDIDATES: { provider: string; modelId: string }[] = [
  { provider: "deepseek", modelId: "deepseek-v4-flash" },
  { provider: "google", modelId: "google-gemini" },
];

async function hasKey(provider: string): Promise<boolean> {
  try {
    return await invoke<boolean>("has_provider_key", { provider });
  } catch {
    return false;
  }
}

export async function autoSelectDefaultModel(): Promise<void> {
  if (getPrefs().models.roles.assistant) return; // user already chose

  for (const { provider, modelId } of CANDIDATES) {
    if (!(await hasKey(provider))) continue;
    // Re-check: an await gave the user time to pick one themselves.
    if (getPrefs().models.roles.assistant) return;
    updatePrefs((p) => ({
      ...p,
      models: { ...p.models, roles: { ...p.models.roles, assistant: modelId } },
    }));
    console.info(`[ArcSonare] default assistant set to ${modelId} (${provider} key present)`);
    return;
  }
}
