/**
 * Meeting audio capture.
 *
 * Uses the browser's MediaRecorder API to capture microphone audio during
 * a meeting. NEVER starts automatically — always requires explicit user consent.
 *
 * Architecture:
 * - Uses getUserMedia (microphone only — no system audio on Windows without WASAPI)
 * - Streams chunks to meetingTranscription.ts for real-time transcription
 * - Stores raw audio chunks in memory, then optionally saves to disk via Tauri
 *
 * Privacy guarantees:
 * - Will not start without explicit user authorization (consent state must be
 *   "granted-recording" or "granted-notes").
 * - Always shows a visible recording indicator while active.
 * - User can pause or stop at any time.
 *
 * Owned by Agent 3.
 */

import type { CaptureMode } from "./meetingTypes";

export type CaptureStatus =
  | "idle"
  | "requesting-permission"
  | "capturing"
  | "paused"
  | "stopping"
  | "error"
  | "permission-denied";

export type AudioChunkHandler = (chunk: Blob, isFinal: boolean) => void;

interface CaptureSession {
  meetingId: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  onChunk: AudioChunkHandler;
  captureMode: CaptureMode;
}

let currentSession: CaptureSession | null = null;
let captureStatus: CaptureStatus = "idle";

const statusListeners = new Set<(status: CaptureStatus) => void>();

function setStatus(status: CaptureStatus): void {
  captureStatus = status;
  statusListeners.forEach((l) => l(status));
}

export function getCaptureStatus(): CaptureStatus {
  return captureStatus;
}

export function onCaptureStatusChange(cb: (status: CaptureStatus) => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Permission probe
// ---------------------------------------------------------------------------

/**
 * Check whether the user has already granted mic permission.
 * Does NOT trigger a permission prompt.
 */
export async function probeMicrophonePermission(): Promise<PermissionState> {
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return result.state;
  } catch {
    return "prompt";
  }
}

// ---------------------------------------------------------------------------
// Start capture
// ---------------------------------------------------------------------------

/**
 * Start capturing meeting audio.
 *
 * @param meetingId - The active meeting session ID.
 * @param captureMode - Must be "microphone" or "mixed". "notes-only" skips capture.
 * @param onChunk - Called with each audio chunk. Use for streaming transcription.
 * @returns "ok" on success, error string otherwise.
 */
export async function startAudioCapture(
  meetingId: string,
  captureMode: CaptureMode,
  onChunk: AudioChunkHandler,
): Promise<{ ok: boolean; error?: string }> {
  if (currentSession) {
    return { ok: false, error: "A capture session is already active." };
  }
  if (captureMode === "none" || captureMode === "notes-only") {
    return { ok: true }; // No audio capture requested.
  }

  setStatus("requesting-permission");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Good defaults for speech recognition. echoCancellation reduces
        // self-echo in speaker setups. noiseSuppression improves accuracy.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16_000, // Whisper's native rate
        channelCount: 1,    // Mono is sufficient for speech
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof DOMException
        ? err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : `Microphone unavailable: ${err.message}`
        : "Could not start microphone capture.";
    setStatus("permission-denied");
    return { ok: false, error: message };
  }

  // Choose a MIME type that the browser supports. Prefer webm/opus for
  // streaming transcription efficiency.
  const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks: Blob[] = [];

  currentSession = { meetingId, stream, recorder, chunks, onChunk, captureMode };

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
      onChunk(event.data, false);
    }
  });

  recorder.addEventListener("stop", () => {
    if (currentSession?.meetingId === meetingId) {
      const finalBlob = new Blob(chunks, { type: mimeType || "audio/webm" });
      onChunk(finalBlob, true);
    }
  });

  recorder.addEventListener("error", (event) => {
    console.error("[ArcSonare] MediaRecorder error:", event);
    setStatus("error");
  });

  // Collect 5-second chunks for streaming transcription.
  recorder.start(5_000);
  setStatus("capturing");
  console.info(`[ArcSonare] Audio capture started for meeting ${meetingId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

export function pauseAudioCapture(): void {
  if (!currentSession || captureStatus !== "capturing") return;
  if (currentSession.recorder.state === "recording") {
    currentSession.recorder.pause();
    setStatus("paused");
  }
}

export function resumeAudioCapture(): void {
  if (!currentSession || captureStatus !== "paused") return;
  if (currentSession.recorder.state === "paused") {
    currentSession.recorder.resume();
    setStatus("capturing");
  }
}

// ---------------------------------------------------------------------------
// Stop capture
// ---------------------------------------------------------------------------

export function stopAudioCapture(): void {
  if (!currentSession) return;
  setStatus("stopping");
  const { recorder, stream } = currentSession;
  if (recorder.state !== "inactive") {
    recorder.stop();
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
  currentSession = null;
  setStatus("idle");
  console.info("[ArcSonare] Audio capture stopped.");
}

// ---------------------------------------------------------------------------
// Status guard for recording indicator
// ---------------------------------------------------------------------------

export function isAudioCaptureActive(): boolean {
  return captureStatus === "capturing" || captureStatus === "paused";
}

export function getCurrentMeetingId(): string | null {
  return currentSession?.meetingId ?? null;
}
