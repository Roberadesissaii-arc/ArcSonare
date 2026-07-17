/**
 * Local Ollama bridge (via Rust → http://127.0.0.1:11434).
 */
import { invoke } from "@tauri-apps/api/core";
import { getPrefs, updatePrefs } from "../stores/settingsStore";
import { modelById } from "../config/modelRegistry";

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

/**
 * Ensure a model name is chosen. Probes Ollama and persists the first
 * installed model when prefs are empty.
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
    // Persist selection + prefer Ollama as the everyday assistant.
    if (
      prefs.models.ollamaModel !== model ||
      prefs.models.roles.assistant !== "ollama-local"
    ) {
      updatePrefs((p) => ({
        ...p,
        models: {
          ...p.models,
          ollamaModel: model,
          roles: { ...p.models.roles, assistant: "ollama-local" },
        },
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

/** True when prefs point at Ollama with a model name (may still be offline). */
export function isOllamaAssistantConfigured(): boolean {
  const prefs = getPrefs();
  const role = modelById(prefs.models.roles.assistant);
  // Prefer Ollama when selected, or when a model name is already saved.
  if (role?.provider === "ollama") return Boolean(prefs.models.ollamaModel?.trim());
  return Boolean(prefs.models.ollamaModel?.trim());
}

/** Short chat reply for the dashboard composer / overlay. */
export async function ollamaReply(userText: string): Promise<string> {
  return ollamaChat([
    {
      role: "system",
      content:
        "You are ArcSonare, a helpful desktop assistant. Keep replies concise (1–4 sentences) unless the user asks for more.",
    },
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
