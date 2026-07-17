/**
 * ArcSonare interface sounds — short, soft, procedurally generated with
 * WebAudio. No bundled or downloaded audio assets. Respects the master
 * enable, master volume and per-event settings from prefs, plus quiet hours
 * from the notification settings. Never blocks the UI; playback errors are
 * swallowed (sounds are strictly optional).
 */
import { getPrefs } from "../stores/settingsStore";
import type { SoundEvent } from "../config/prefs";

let context: AudioContext | null = null;
const lastPlayed = new Map<SoundEvent, number>();
/** Repeat suppression: the same event can play at most every 150ms. */
const MIN_REPEAT_MS = 150;

function ctx(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

interface ToneStep {
  /** Start frequency in Hz. */
  freq: number;
  /** Optional glide target frequency. */
  glideTo?: number;
  /** Offset from sound start, seconds. */
  at: number;
  /** Note duration, seconds. */
  dur: number;
  /** Peak gain 0..1 (before volume scaling). */
  peak: number;
  type?: OscillatorType;
}

/** Sound design per event: restrained, glassy, futuristic, never harsh. */
const DESIGNS: Record<SoundEvent, ToneStep[]> = {
  // Soft rising two-note glass tone.
  "overlay-open": [
    { freq: 620, glideTo: 830, at: 0, dur: 0.16, peak: 0.05 },
    { freq: 930, at: 0.1, dur: 0.14, peak: 0.035 },
  ],
  // Reverse of activation.
  "overlay-close": [
    { freq: 830, glideTo: 610, at: 0, dur: 0.15, peak: 0.045 },
    { freq: 520, at: 0.09, dur: 0.12, peak: 0.028 },
  ],
  // Very short violet-like shimmer.
  listening: [
    { freq: 1040, at: 0, dur: 0.07, peak: 0.03, type: "triangle" },
    { freq: 1320, at: 0.05, dur: 0.08, peak: 0.024, type: "triangle" },
  ],
  // Quiet low pulse.
  thinking: [{ freq: 240, at: 0, dur: 0.16, peak: 0.03, type: "sine" }],
  responding: [
    { freq: 720, at: 0, dur: 0.09, peak: 0.03 },
    { freq: 910, at: 0.06, dur: 0.1, peak: 0.026 },
  ],
  // Soft major-third confirmation.
  "task-completed": [
    { freq: 660, at: 0, dur: 0.12, peak: 0.045 },
    { freq: 830, at: 0.09, dur: 0.16, peak: 0.04 },
  ],
  confirmation: [
    { freq: 560, at: 0, dur: 0.1, peak: 0.04 },
    { freq: 560, at: 0.14, dur: 0.1, peak: 0.04 },
  ],
  // Muted descending tone.
  error: [
    { freq: 440, glideTo: 340, at: 0, dur: 0.18, peak: 0.045 },
    { freq: 280, at: 0.14, dur: 0.14, peak: 0.03 },
  ],
  notification: [
    { freq: 780, at: 0, dur: 0.09, peak: 0.04 },
    { freq: 980, at: 0.07, dur: 0.11, peak: 0.03 },
  ],
  "screen-context-start": [
    { freq: 500, glideTo: 700, at: 0, dur: 0.14, peak: 0.04 },
    { freq: 1050, at: 0.11, dur: 0.09, peak: 0.024, type: "triangle" },
  ],
  "screen-context-stop": [
    { freq: 700, glideTo: 480, at: 0, dur: 0.14, peak: 0.04 },
  ],
  "annotation-confirmed": [
    { freq: 620, at: 0, dur: 0.08, peak: 0.04 },
    { freq: 780, at: 0.06, dur: 0.09, peak: 0.034 },
    { freq: 990, at: 0.12, dur: 0.1, peak: 0.026 },
  ],
  "wake-word": [
    { freq: 880, at: 0, dur: 0.07, peak: 0.035, type: "triangle" },
    { freq: 1180, at: 0.05, dur: 0.09, peak: 0.028, type: "triangle" },
  ],
};

function inQuietHours(): boolean {
  const prefs = getPrefs();
  const quiet = prefs.notifications.quietHours;
  if (!quiet.enabled || !prefs.sounds.respectQuietHours) return false;
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Window may wrap past midnight.
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function playSteps(steps: ToneStep[], volume: number) {
  const audio = ctx();
  if (!audio) return;
  try {
    const now = audio.currentTime;
    for (const step of steps) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = step.type ?? "sine";
      const t0 = now + step.at;
      osc.frequency.setValueAtTime(step.freq, t0);
      if (step.glideTo) {
        osc.frequency.exponentialRampToValueAtTime(step.glideTo, t0 + step.dur);
      }
      const peak = Math.max(0.0002, step.peak * volume);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step.dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + step.dur + 0.05);
    }
  } catch {
    // Audio output unavailable — sounds are strictly optional.
  }
}

/**
 * Plays the configured sound for an event, honoring every setting.
 * `options.preview` bypasses the per-event enable (used by the Sounds page
 * preview buttons) but still uses the event's volume and the master volume.
 */
export function playEventSound(
  event: SoundEvent,
  options?: { preview?: boolean },
) {
  const prefs = getPrefs();
  const sounds = prefs.sounds;
  if (!sounds.enabled && !options?.preview) return;
  const eventPref = sounds.events[event] ?? { enabled: true, volume: 70 };
  if (!eventPref.enabled && !options?.preview) return;
  if (!options?.preview && inQuietHours()) return;

  const last = lastPlayed.get(event) ?? 0;
  const nowMs = Date.now();
  if (nowMs - last < MIN_REPEAT_MS) return;
  lastPlayed.set(event, nowMs);

  const volume = (sounds.masterVolume / 100) * (eventPref.volume / 100);
  if (volume <= 0) return;
  playSteps(DESIGNS[event], volume);
}

/** Sequential preview of every enabled sound (Sounds page "Preview all"). */
export function previewAllSounds() {
  let delay = 0;
  for (const event of Object.keys(DESIGNS) as SoundEvent[]) {
    window.setTimeout(() => playEventSound(event, { preview: true }), delay);
    delay += 420;
  }
}

/** Plays a short test tone on the default output (Voice page "Test output"). */
export function playOutputTestTone(volume: number) {
  playSteps(
    [
      { freq: 520, at: 0, dur: 0.16, peak: 0.06 },
      { freq: 660, at: 0.14, dur: 0.18, peak: 0.06 },
    ],
    Math.max(0.05, volume / 100),
  );
}
