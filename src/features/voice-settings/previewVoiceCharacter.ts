/**
 * Play a short Pocket TTS preview for a voice character.
 * Used from Settings → Voice (character tiles + preview card).
 */
import {
  ensurePocketTtsRuntime,
  setPocketTtsVoicePreference,
  speakWithPocketTts,
  stopPocketTtsPlayback,
} from "../../services/PocketTtsService";
import type { VoiceCharacter } from "./voiceCharacters";

let previewEpoch = 0;

export async function previewVoiceCharacter(
  character: VoiceCharacter,
  text?: string,
): Promise<void> {
  const epoch = ++previewEpoch;
  const phrase = (text ?? character.sampleGreeting).trim();
  if (!phrase) return;

  setPocketTtsVoicePreference(character.preferredProviderVoiceId);
  stopPocketTtsPlayback();

  await ensurePocketTtsRuntime();
  if (epoch !== previewEpoch) return;

  await speakWithPocketTts(phrase, {
    voice: character.preferredProviderVoiceId,
    shouldAbort: () => epoch !== previewEpoch,
  });
}

export function stopVoiceCharacterPreview(): void {
  previewEpoch += 1;
  stopPocketTtsPlayback();
}
