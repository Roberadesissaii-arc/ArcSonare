/**
 * Play a short spoken preview for a voice character.
 * Used from Settings → Voice (character tiles + preview card).
 */
import { speak, stopSpeaking } from "../../services/SpeechService";
import type { VoiceCharacter } from "./voiceCharacters";

let previewEpoch = 0;

export async function previewVoiceCharacter(
  character: VoiceCharacter,
  text?: string,
): Promise<void> {
  const epoch = ++previewEpoch;
  const phrase = (text ?? character.sampleGreeting).trim();
  if (!phrase) return;

  stopSpeaking();

  await speak(phrase, {
    voice: character.preferredProviderVoiceId,
    shouldAbort: () => epoch !== previewEpoch,
  });
}

export function stopVoiceCharacterPreview(): void {
  previewEpoch += 1;
  stopSpeaking();
}
