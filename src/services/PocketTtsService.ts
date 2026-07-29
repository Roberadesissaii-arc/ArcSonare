/**
 * Client for Kyutai Pocket TTS.
 * Docs: https://github.com/kyutai-labs/pocket-tts
 *
 * ArcSonare manages install + `serve` via Tauri (`pocket_tts_ensure`):
 * a private pip venv under app data — users do not run uvx or terminal serve.
 * Audio is synthesized through Rust (`pocket_tts_synthesize`) to avoid
 * webview CORS / "Failed to fetch" against localhost:8000.
 */
import { invoke } from "@tauri-apps/api/core";

export type PocketTtsStatus = "unknown" | "online" | "offline" | "installing" | "starting";

export type PocketTtsRuntimeStatus = {
  phase: string;
  message: string;
  online: boolean;
  managed: boolean;
  baseUrl: string;
  pythonFound: boolean;
  packageInstalled: boolean;
};

/** Persisted Voice Lab selection — used by the voice overlay when speaking replies. */
export const POCKET_TTS_VOICE_KEY = "arcsonare.pocketTts.voice";

export function getPocketTtsVoicePreference(): string {
  try {
    return window.localStorage.getItem(POCKET_TTS_VOICE_KEY) || "jane";
  } catch {
    return "jane";
  }
}

export function setPocketTtsVoicePreference(voice: string) {
  try {
    window.localStorage.setItem(POCKET_TTS_VOICE_KEY, voice);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Built-in English voices from Pocket TTS (plus common multilingual ones). */
export const POCKET_TTS_VOICES: { id: string; label: string }[] = [
  { id: "jane", label: "Jane (f, conversation)" },
  { id: "anna", label: "Anna (f, conversation)" },
  { id: "alba", label: "Alba (m, reading)" },
  { id: "eve", label: "Eve (f, conversation)" },
  { id: "mary", label: "Mary (f, conversation)" },
  { id: "vera", label: "Vera (f, conversation)" },
  { id: "charles", label: "Charles (m, conversation)" },
  { id: "george", label: "George (m, conversation)" },
  { id: "jean", label: "Jean (m, conversation)" },
  { id: "michael", label: "Michael (m, conversation)" },
  { id: "paul", label: "Paul (m, conversation)" },
  { id: "bill_boerst", label: "Bill Boerst (m, reading)" },
  { id: "caro_davy", label: "Caro Davy (f, reading)" },
  { id: "peter_yearsley", label: "Peter Yearsley (m, reading)" },
  { id: "stuart_bell", label: "Stuart Bell (m, reading)" },
  { id: "azelma", label: "Azelma (f, reading)" },
  { id: "eponine", label: "Eponine (f, reading)" },
  { id: "fantine", label: "Fantine (f, reading)" },
  { id: "estelle", label: "Estelle (French, f)" },
  { id: "giovanni", label: "Giovanni (Italian, m)" },
];

let lastObjectUrl: string | null = null;
let activeAudio: HTMLAudioElement | null = null;
let ensureInFlight: Promise<PocketTtsRuntimeStatus> | null = null;

function base64ToBlob(base64: string, mime = "audio/wav"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function checkPocketTts(): Promise<boolean> {
  try {
    const runtime = await getPocketTtsRuntimeStatus();
    return runtime.online;
  } catch {
    return false;
  }
}

export async function getPocketTtsRuntimeStatus(): Promise<PocketTtsRuntimeStatus> {
  return invoke<PocketTtsRuntimeStatus>("pocket_tts_status");
}

/**
 * Install Pocket TTS with pip into ArcSonare’s private venv (if needed) and
 * start the local serve process. Idempotent; first run can take several minutes.
 */
export async function ensurePocketTtsRuntime(): Promise<PocketTtsRuntimeStatus> {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = invoke<PocketTtsRuntimeStatus>("pocket_tts_ensure").finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

export function mapRuntimePhase(phase: string, online: boolean): PocketTtsStatus {
  if (online || phase === "ready") return "online";
  if (phase === "installing") return "installing";
  if (phase === "starting") return "starting";
  if (phase === "idle" || phase === "error") return "offline";
  return "unknown";
}

let playbackResolve: (() => void) | null = null;

export function stopPocketTtsPlayback(): void {
  if (activeAudio) {
    const audio = activeAudio;
    activeAudio = null;
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
      audio.src = "";
    } catch {
      // ignore
    }
    // Resolve any in-flight speakWithPocketTts waiter.
    if (playbackResolve) {
      const resolve = playbackResolve;
      playbackResolve = null;
      resolve();
    }
  }
  if (lastObjectUrl) {
    URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = null;
  }
}

/**
 * Synthesize `text` with Pocket TTS and play it.
 * Goes through Tauri (not browser fetch) so CORS cannot break Speak.
 * stopPocketTtsPlayback() aborts playback cleanly (barge-in).
 */
export async function speakWithPocketTts(
  text: string,
  options?: { voice?: string; shouldAbort?: () => boolean },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const voice = options?.voice || "jane";
  const base64 = await invoke<string>("pocket_tts_synthesize", {
    text: trimmed,
    voice,
  });

  if (options?.shouldAbort?.()) return;

  stopPocketTtsPlayback();
  if (options?.shouldAbort?.()) return;

  const blob = base64ToBlob(base64);
  lastObjectUrl = URL.createObjectURL(blob);
  const audio = new Audio(lastObjectUrl);
  activeAudio = audio;
  await new Promise<void>((resolve, reject) => {
    playbackResolve = resolve;
    audio.onended = () => {
      playbackResolve = null;
      resolve();
    };
    audio.onerror = () => {
      playbackResolve = null;
      // Aborted via stopPocketTtsPlayback — treat as success.
      if (!activeAudio || activeAudio !== audio) {
        resolve();
        return;
      }
      reject(new Error("Could not play Pocket TTS audio."));
    };
    void audio.play().catch((err) => {
      playbackResolve = null;
      if (!activeAudio || activeAudio !== audio) {
        resolve();
        return;
      }
      reject(err);
    });
  });
}
