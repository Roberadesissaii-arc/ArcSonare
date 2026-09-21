/**
 * Meeting transcription provider abstraction.
 *
 * Supports:
 *   - "none": No transcription. Notes are AI-generated from the meeting name/metadata.
 *   - "openai-whisper": Cloud transcription via OpenAI Whisper API.
 *   - "local-whisper": Reserved for future Whisper.cpp local runtime.
 *
 * The provider is selected from user preferences and requires explicit
 * configuration of the transcription API key.
 *
 * Privacy note:
 * - "openai-whisper" sends audio data to OpenAI's servers.
 * - The user must consent to cloud processing before this is used.
 * - "none" never sends audio anywhere.
 *
 * Owned by Agent 3.
 */

import { invoke } from "@tauri-apps/api/core";
import type { MeetingTranscriptSegment, TranscriptionMode } from "./meetingTypes";
import { newSegmentId } from "./meetingUtils";

export interface TranscriptionResult {
  segments: MeetingTranscriptSegment[];
  language?: string;
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface TranscriptionProvider {
  transcribe(
    chunk: Blob,
    meetingId: string,
    startOffsetMs: number,
    language?: string,
  ): Promise<TranscriptionResult>;
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Null provider (no transcription)
// ---------------------------------------------------------------------------

class NullTranscriptionProvider implements TranscriptionProvider {
  async transcribe(): Promise<TranscriptionResult> {
    return { segments: [], ok: true };
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------------------
// OpenAI Whisper provider
// ---------------------------------------------------------------------------

class OpenAIWhisperProvider implements TranscriptionProvider {
  async isAvailable(): Promise<boolean> {
    try {
      const has = await invoke<boolean>("has_provider_key", { provider: "openai" });
      return has;
    } catch {
      return false;
    }
  }

  async transcribe(
    chunk: Blob,
    meetingId: string,
    startOffsetMs: number,
    language = "auto",
  ): Promise<TranscriptionResult> {
    try {
      // Convert Blob to base64 for IPC transport.
      const arrayBuffer = await chunk.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const base64 = btoa(String.fromCharCode(...bytes));
      const mimeType = chunk.type || "audio/webm";

      const response = await invoke<{
        text: string;
        segments?: Array<{ start: number; end: number; text: string }>;
        language?: string;
      }>("meeting_transcribe_chunk", {
        meetingId,
        audioBase64: base64,
        audioMimeType: mimeType,
        startOffsetMs,
        language: language === "auto" ? null : language,
      });

      const segments: MeetingTranscriptSegment[] = response.segments
        ? response.segments.map((s) => ({
            id: newSegmentId(),
            meetingId,
            startedAtMs: startOffsetMs + Math.round(s.start * 1000),
            endedAtMs: startOffsetMs + Math.round(s.end * 1000),
            text: s.text.trim(),
            isFinal: true,
          }))
        : [
            {
              id: newSegmentId(),
              meetingId,
              startedAtMs: startOffsetMs,
              endedAtMs: startOffsetMs + 5000,
              text: response.text.trim(),
              isFinal: true,
            },
          ];

      return { segments, language: response.language, ok: true };
    } catch (err) {
      console.error("[ArcSonare] Whisper transcription failed:", err);
      return {
        segments: [],
        ok: false,
        error: String(err),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Local Whisper provider (stub — not yet implemented)
// ---------------------------------------------------------------------------

class LocalWhisperProvider implements TranscriptionProvider {
  async isAvailable(): Promise<boolean> {
    // Will be implemented when the Whisper.cpp sidecar is bundled.
    return false;
  }

  async transcribe(): Promise<TranscriptionResult> {
    return {
      segments: [],
      ok: false,
      error: "Local Whisper is not yet available in this version of ArcSonare.",
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const providers: Record<TranscriptionMode, TranscriptionProvider> = {
  none: new NullTranscriptionProvider(),
  "openai-whisper": new OpenAIWhisperProvider(),
  "local-whisper": new LocalWhisperProvider(),
  manual: new NullTranscriptionProvider(),
};

let activeProvider: TranscriptionProvider = providers.none;
let activeMode: TranscriptionMode = "none";

export function setTranscriptionProvider(mode: TranscriptionMode): void {
  activeMode = mode;
  activeProvider = providers[mode] ?? providers.none;
}

export function getActiveTranscriptionMode(): TranscriptionMode {
  return activeMode;
}

export async function isTranscriptionAvailable(mode: TranscriptionMode): Promise<boolean> {
  return providers[mode]?.isAvailable() ?? false;
}

export async function transcribeChunk(
  chunk: Blob,
  meetingId: string,
  startOffsetMs: number,
  language?: string,
): Promise<TranscriptionResult> {
  return activeProvider.transcribe(chunk, meetingId, startOffsetMs, language);
}
