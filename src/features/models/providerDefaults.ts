/**
 * After connecting a company key, pick the right model roles automatically.
 * One API key unlocks the company — the app chooses chat vs voice vs specialty.
 * Only assigns chat default for providers that actually power Settings → Models chat.
 */
import {
  MODELS,
  modelById,
  type ModelInfo,
  type ProviderId,
} from "../../config/modelRegistry";
import type { ModelRole, Prefs } from "../../config/prefs";

/** Providers whose models can drive dashboard/chat + capability tools today. */
export const CHAT_WIRED_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  "deepseek",
  "google",
]);

export function isChatDefaultCandidate(m: ModelInfo): boolean {
  if (!m.supportsText) return false;
  if (m.contextType === "realtime") return false;
  // Pure transcription / audio-out specialties are not everyday chat.
  if (m.supportsAudioInput && !m.supportsImage && !m.supportsTools) return false;
  return true;
}

export function isVoiceSpecialty(m: ModelInfo): boolean {
  return (
    m.contextType === "realtime" ||
    (m.supportsAudioInput && m.supportsAudioOutput)
  );
}

export function isTranscriptionSpecialty(m: ModelInfo): boolean {
  return m.supportsAudioInput && !m.supportsAudioOutput && !m.supportsText;
}

export function preferredChatModel(providerId: ProviderId): ModelInfo | undefined {
  const list = MODELS.filter((m) => m.provider === providerId && isChatDefaultCandidate(m));
  // Prefer tool-capable, then longer context, then first listed.
  return (
    list.find((m) => m.supportsTools && m.contextType === "long") ??
    list.find((m) => m.supportsTools) ??
    list[0]
  );
}

export function preferredVoiceModel(providerId: ProviderId): ModelInfo | undefined {
  return MODELS.find((m) => m.provider === providerId && isVoiceSpecialty(m));
}

export function preferredTranscriptionModel(providerId: ProviderId): ModelInfo | undefined {
  return MODELS.find((m) => m.provider === providerId && isTranscriptionSpecialty(m));
}

/** True when this model must never be the everyday assistant (causes tool/chat failures). */
export function isInvalidAssistantDefault(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const m = modelById(modelId);
  if (!m) return true;
  if (isVoiceSpecialty(m) || isTranscriptionSpecialty(m)) return true;
  if (!isChatDefaultCandidate(m)) return true;
  // OpenAI / Anthropic / xAI chat completions are not wired — do not keep them as default.
  if (!CHAT_WIRED_PROVIDERS.has(m.provider)) return true;
  return false;
}

export type RolePatch = Partial<Record<ModelRole, string | null>>;

/**
 * Build role updates after a successful connect.
 * Does not invent chat for providers that cannot chat yet.
 */
export function rolesAfterProviderConnect(
  providerId: ProviderId,
  current: Prefs["models"]["roles"],
  _opts?: { ollamaMode?: "local" | "cloud" },
): RolePatch {
  const patch: RolePatch = {};

  if (CHAT_WIRED_PROVIDERS.has(providerId)) {
    const chat = preferredChatModel(providerId);
    if (chat && (!current.assistant || isInvalidAssistantDefault(current.assistant))) {
      patch.assistant = chat.id;
    }
  } else if (current.assistant) {
    // Disconnect chat default if it was this company's non-wired model (e.g. GPT Realtime).
    const cur = modelById(current.assistant);
    if (cur?.provider === providerId && isInvalidAssistantDefault(current.assistant)) {
      patch.assistant = null;
    }
  }

  const voice = preferredVoiceModel(providerId);
  if (voice && !current.speech) {
    patch.speech = voice.id;
  }

  const transcription = preferredTranscriptionModel(providerId);
  if (transcription && !current.transcription) {
    patch.transcription = transcription.id;
  }

  return patch;
}

export function modelRoleLabel(m: ModelInfo): string {
  if (isVoiceSpecialty(m)) return "Voice · realtime";
  if (isTranscriptionSpecialty(m)) return "Transcription";
  if (isChatDefaultCandidate(m) && CHAT_WIRED_PROVIDERS.has(m.provider)) {
    return "Chat & tools";
  }
  if (isChatDefaultCandidate(m)) return "Listed · chat not wired yet";
  return "Specialty";
}
