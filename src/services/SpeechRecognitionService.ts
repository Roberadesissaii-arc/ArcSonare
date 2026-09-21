/**
 * Speech-to-text listener used while the voice overlay is active.
 * Prefs select Local (Whisper) vs Cloud. Until the Whisper sidecar ships,
 * local capture uses the system SpeechRecognition API so “open Spotify”
 * style commands work today; transcripts still go through the overlay
 * intent runner.
 */

type FinalHandler = (transcript: string) => void;
type PartialHandler = (transcript: string) => void;

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

import {
  considerTranscript,
  type TranscriptDisposition,
} from "./voiceSession";

let active: SpeechRecognitionLike | null = null;
let shouldRestart = false;

export function speechRecognitionAvailable(): boolean {
  return Boolean(getRecognitionCtor());
}

export function stopSpeechListening() {
  shouldRestart = false;
  if (!active) return;
  try {
    active.onresult = null;
    active.onerror = null;
    active.onend = null;
    active.stop();
  } catch {
    /* already stopped */
  }
  active = null;
}

/**
 * Start continuous listening. Final phrases call `onFinal` (trimmed).
 * Returns false if the browser/WebView has no speech recognizer.
 *
 * `onFinal` fires only for speech the shared voice session accepts as the
 * user's. Anything it rejects — ArcSonare's own voice, the echo tail after it,
 * a repeated transcript — goes to `onSuppressed` instead, so a caller can say
 * why nothing happened rather than appearing deaf.
 */
export function startSpeechListening(opts: {
  lang?: string;
  onFinal: FinalHandler;
  onPartial?: PartialHandler;
  onError?: (message: string) => void;
  onSuppressed?: (text: string, disposition: TranscriptDisposition) => void;
}): boolean {
  stopSpeechListening();
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    opts.onError?.(
      "Speech recognition is not available in this WebView. Whisper offline capture arrives with the local runtime.",
    );
    return false;
  }

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = opts.lang ?? "en-US";
  shouldRestart = true;

  import("../features/overlay-log/overlayLogService").then((m) => {
    m.logListeningStarted();
  });

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript ?? "";
      if (event.results[i].isFinal) {
        const text = piece.trim();
        // The one gate every transcript passes. ArcSonare speaks through the
        // speakers, the microphone hears it, and without this the recogniser
        // hands ArcSonare's own sentence back as a user request — and it
        // answers itself, forever. The session state lives in Rust because the
        // overlay is a separate webview and would otherwise have its own idea
        // of whether anyone is speaking.
        if (text) {
          void considerTranscript(text)
            .then((disposition) => {
              if (disposition === "accepted") {
                opts.onFinal(text);
                return;
              }
              import("../features/overlay-log/overlayLogService").then((m) => {
                m.logTranscriptRejected(disposition);
              });
              opts.onSuppressed?.(text, disposition);
            })
            .catch(() => {
              // The gate is unreachable. Delivering the transcript anyway is
              // the pre-existing behaviour and keeps voice usable; the echo
              // risk returns, which is better than a mute assistant.
              opts.onFinal(text);
            });
        }
      } else {
        interim += piece;
      }
    }
    if (interim.trim()) opts.onPartial?.(interim.trim());
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted" || event.error === "no-speech") return;
    opts.onError?.(event.error);
  };

  recognition.onend = () => {
    if (!shouldRestart) return;
    try {
      recognition.start();
    } catch {
      /* ignore re-start races */
    }
  };

  try {
    recognition.start();
    active = recognition;
    return true;
  } catch (err) {
    opts.onError?.(err instanceof Error ? err.message : "Could not start listening");
    return false;
  }
}
