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
 */
export function startSpeechListening(opts: {
  lang?: string;
  onFinal: FinalHandler;
  onPartial?: PartialHandler;
  onError?: (message: string) => void;
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

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript ?? "";
      if (event.results[i].isFinal) {
        const text = piece.trim();
        if (text) opts.onFinal(text);
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
