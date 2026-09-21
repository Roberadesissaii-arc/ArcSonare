/**
 * The one place any surface asks whose turn it is to talk.
 *
 * Every recogniser — main window, voice console, `sonare-overlay` — must run a
 * transcript past `considerTranscript` before it becomes a request, and every
 * TTS playback must bracket itself with `beginPlayback` / `endPlayback`.
 *
 * The state itself lives in Rust. That is not architectural taste: the overlay
 * is a separate WebView2 heap, so a `let speaking = false` in this file would be
 * two independent booleans and the overlay would happily transcribe what the
 * main window is saying.
 */
import { invoke } from "@tauri-apps/api/core";

export type VoiceSessionState =
  | "idle"
  | "listening"
  | "user-speaking"
  | "processing"
  | "speaking"
  | "cooldown"
  | "interrupted"
  | "error";

export type TranscriptDisposition =
  | "accepted"
  | "rejected-speaking"
  | "rejected-cooldown"
  | "self-speech-suppressed"
  | "duplicate-suppressed"
  | "rejected-empty";

export interface SpeechPlayback {
  playbackId: string;
  textHash: string;
  startedAtMs: number;
  finishedAtMs?: number;
  state: "queued" | "playing" | "completed" | "cancelled" | "failed";
}

export interface VoiceStatus {
  state: VoiceSessionState;
  acceptsTranscripts: boolean;
  cooldownMs: number;
  cooldownRemainingMs: number;
  playback?: SpeechPlayback;
  selfSpeechSuppressed: number;
  duplicateSuppressed: number;
}

export function voiceStatus(): Promise<VoiceStatus> {
  return invoke<VoiceStatus>("voice_status");
}

export function setVoiceState(state: VoiceSessionState): Promise<void> {
  return invoke("voice_set_state", { state });
}

export function setVoiceCooldownMs(ms: number): Promise<void> {
  return invoke("voice_set_cooldown_ms", { ms });
}

let playbackCounter = 0;

export function newPlaybackId(): string {
  playbackCounter += 1;
  return `pb-${Date.now().toString(36)}-${playbackCounter}`;
}

/**
 * Bracket a spoken response.
 *
 * Recognition closes *before* the audio starts and reopens only after playback
 * genuinely ends — the gap between "we asked it to speak" and "sound came out"
 * is precisely where an echo gets in. `finally` rather than a happy path,
 * because a TTS failure that left the session in `speaking` would shut the
 * microphone for the rest of the conversation.
 */
export async function speakWithTurnTaking<T>(
  text: string,
  play: (playbackId: string) => Promise<T>,
): Promise<T> {
  const playbackId = newPlaybackId();
  await invoke("voice_begin_playback", { playbackId, text });
  let outcome: "completed" | "failed" | "cancelled" = "completed";
  try {
    return await play(playbackId);
  } catch (err) {
    outcome = isCancellation(err) ? "cancelled" : "failed";
    throw err;
  } finally {
    await invoke("voice_end_playback", { playbackId, outcome }).catch(() => undefined);
  }
}

function isCancellation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /abort|cancel/i.test(message);
}

/**
 * Should this transcript become a user request?
 *
 * Returns the disposition rather than a boolean so the caller can report *why*
 * nothing happened — "I ignored my own voice" and "I didn't hear you" are
 * different things and only one of them is a bug.
 */
export function considerTranscript(text: string): Promise<TranscriptDisposition> {
  return invoke<TranscriptDisposition>("voice_consider_transcript", { text });
}

/** Convenience for call sites that only need the yes/no. */
export async function transcriptIsUserSpeech(text: string): Promise<boolean> {
  return (await considerTranscript(text)) === "accepted";
}

/**
 * The capture constraints that let the audio stack cancel our own output.
 *
 * Requesting them is not the same as getting them: WebView2 may ignore any of
 * these. `describeAudioProcessing` reads back what the track actually settled
 * on, so a diagnostic can say what is really active rather than what was asked.
 */
export const ECHO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface AudioProcessingReport {
  requested: { echoCancellation: true; noiseSuppression: true; autoGainControl: true };
  active: Record<string, unknown>;
  /** True only when the track reports echo cancellation as genuinely on. */
  echoCancellationActive: boolean | "unknown";
}

export function describeAudioProcessing(stream: MediaStream): AudioProcessingReport {
  const track = stream.getAudioTracks()[0];
  const settings = (track?.getSettings?.() ?? {}) as Record<string, unknown>;
  const value = settings.echoCancellation;
  return {
    requested: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    active: settings,
    // A missing field means the platform does not report it — which is not the
    // same as off, and must not be claimed as on.
    echoCancellationActive: typeof value === "boolean" ? value : "unknown",
  };
}
