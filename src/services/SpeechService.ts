/**
 * Spoken output for ArcSonare.
 *
 * Pocket TTS (Kyutai, local Python venv) was removed — voice output is moving
 * to the OpenAI Realtime API. Until that backend is wired, there is no speech
 * engine: `speak()` resolves without producing audio.
 *
 * Every caller already shows its text before speaking, so a silent `speak()`
 * degrades to a text-only reply rather than a broken one. This module is the
 * single seam the Realtime backend plugs into.
 */

export interface SpeakOptions {
  /** Provider voice id for the selected character. */
  voice?: string;
  /** Lets a caller abandon playback when the user barges in. */
  shouldAbort?: () => boolean;
}

/** True once a speech backend is configured. */
export function speechAvailable(): boolean {
  return false;
}

/** Speak `text`. No-op while no backend is configured. */
export async function speak(_text: string, _opts?: SpeakOptions): Promise<void> {
  // Intentionally silent — see module comment.
}

/** Stop any in-flight playback. */
export function stopSpeaking(): void {
  // Nothing to stop while no backend is configured.
}
