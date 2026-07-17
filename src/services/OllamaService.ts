/**
 * Local Ollama + Ollama Cloud bridges (via Rust).
 * Never silently overwrite the user's selected default assistant model.
 */
import { invoke } from "@tauri-apps/api/core";
import { getPrefs, updatePrefs } from "../stores/settingsStore";
import { modelById } from "../config/modelRegistry";
import { assistantSystemContext } from "./assistantTools";

export interface OllamaStatus {
  available: boolean;
  models: string[];
  message: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export async function probeOllama(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>("ollama_status");
}

export async function probeOllamaCloud(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>("ollama_cloud_status");
}

/**
 * Ensure a local Ollama model name is chosen.
 * Only updates `models.ollamaModel` — never changes `roles.assistant`.
 */
export async function ensureOllamaModel(): Promise<
  { ok: true; model: string } | { ok: false; message: string }
> {
  const prefs = getPrefs();
  let model = prefs.models.ollamaModel?.trim() ?? "";

  try {
    const status = await probeOllama();
    if (!status.available) {
      return {
        ok: false,
        message:
          status.message ||
          "Ollama is not running. Start it with `ollama serve`, then try again.",
      };
    }
    if (!status.models.length) {
      return {
        ok: false,
        message:
          "Ollama is running but has no models. Run `ollama pull llama3.2` (or another model).",
      };
    }
    if (!model || !status.models.includes(model)) {
      model = status.models[0];
    }
    if (prefs.models.ollamaModel !== model) {
      updatePrefs((p) => ({
        ...p,
        models: { ...p.models, ollamaModel: model },
      }));
    }
    return { ok: true, model };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Could not reach Ollama at http://127.0.0.1:11434.",
    };
  }
}

/**
 * Ensure an Ollama Cloud model name is set (does not change assistant role).
 */
export async function ensureOllamaCloudModel(): Promise<
  { ok: true; model: string } | { ok: false; message: string }
> {
  const prefs = getPrefs();
  let model = prefs.models.ollamaCloudModel?.trim() ?? "";

  try {
    const status = await probeOllamaCloud();
    if (!status.available) {
      return {
        ok: false,
        message:
          status.message ||
          "Ollama Cloud is not available. Save an API key in Settings → Models.",
      };
    }
    if (!model) {
      if (status.models.length) {
        model = status.models[0];
      } else {
        return {
          ok: false,
          message:
            "Enter an Ollama Cloud model name (for example gpt-oss:120b) in Settings → Models.",
        };
      }
    }
    if (prefs.models.ollamaCloudModel !== model) {
      updatePrefs((p) => ({
        ...p,
        models: { ...p.models, ollamaCloudModel: model },
      }));
    }
    return { ok: true, model };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Could not reach Ollama Cloud. Save an API key from ollama.com.",
    };
  }
}

export async function ollamaChat(
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<string> {
  const ensured = modelOverride?.trim()
    ? { ok: true as const, model: modelOverride.trim() }
    : await ensureOllamaModel();
  if (!ensured.ok) {
    throw new Error(ensured.message);
  }
  return invoke<string>("ollama_chat", {
    model: ensured.model,
    messages,
  });
}

export async function ollamaCloudChat(
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<string> {
  const ensured = modelOverride?.trim()
    ? { ok: true as const, model: modelOverride.trim() }
    : await ensureOllamaCloudModel();
  if (!ensured.ok) {
    throw new Error(ensured.message);
  }
  return invoke<string>("ollama_cloud_chat", {
    model: ensured.model,
    messages,
  });
}

/** True when prefs point at local Ollama with a model name. */
export function isOllamaAssistantConfigured(): boolean {
  const prefs = getPrefs();
  const role = modelById(prefs.models.roles.assistant);
  if (role?.id === "ollama-local") {
    return Boolean(prefs.models.ollamaModel?.trim());
  }
  return false;
}

export function isOllamaCloudAssistantConfigured(): boolean {
  const prefs = getPrefs();
  const role = modelById(prefs.models.roles.assistant);
  return role?.id === "ollama-cloud";
}

/** Short chat reply for local Ollama. Prefer AssistantService for routing. */
export async function ollamaReply(userText: string): Promise<string> {
  return ollamaChat([
    { role: "system", content: assistantSystemContext() },
    { role: "user", content: userText },
  ]);
}

/** Draft an email body with the local model when available. */
export async function ollamaDraftEmail(input: {
  toName: string;
  toEmail: string;
  subject: string;
  spokenBody?: string;
}): Promise<{ subject: string; body: string } | null> {
  const ready = await ensureOllamaModel();
  if (!ready.ok) return null;
  const spoken = input.spokenBody?.trim() || "a short polite check-in";
  const prompt = [
    "You draft concise professional emails.",
    "Return ONLY valid JSON with keys subject and body. No markdown.",
    `Recipient name: ${input.toName}`,
    `Recipient email: ${input.toEmail}`,
    `Preferred subject (may refine): ${input.subject}`,
    `What the user wants to say: ${spoken}`,
  ].join("\n");

  try {
    const raw = await ollamaChat(
      [
        {
          role: "system",
          content:
            'You are ArcSonare’s local writing assistant. Reply with JSON only: {"subject":"...","body":"..."}.',
        },
        { role: "user", content: prompt },
      ],
      ready.model,
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { subject?: string; body?: string };
    if (!parsed.body?.trim()) return null;
    return {
      subject: (parsed.subject || input.subject).trim(),
      body: parsed.body.trim(),
    };
  } catch (err) {
    console.error("[ArcSonare] Ollama email draft failed:", err);
    return null;
  }
}
