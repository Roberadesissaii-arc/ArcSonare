/**
 * ArcSonare interface sounds — short, soft, procedurally generated with
 * WebAudio. No bundled or downloaded audio assets. Respects master enable,
 * master volume, sound profile, per-event settings, and Quiet Hours.
 */
import { getPrefs } from "../stores/settingsStore";
import type { SoundEvent, SoundProfileId } from "../config/prefs";
import { profileById } from "../features/sounds/soundProfiles";
import type { SoundPlaybackState } from "../features/sounds/soundTypes";

let context: AudioContext | null = null;
const lastPlayed = new Map<SoundEvent, number>();
const MIN_REPEAT_MS = 150;
const ERROR_RATE_MS = 2000;

let playback: SoundPlaybackState = {
  currentlyPreviewing: null,
  previewAllActive: false,
  amplitude: 0,
};
const listeners = new Set<() => void>();
let previewAllTimers: number[] = [];
let amplitudeTimer: number | null = null;
let activeNodes: AudioNode[] = [];

function publish(next: Partial<SoundPlaybackState>) {
  playback = { ...playback, ...next };
  listeners.forEach((l) => l());
}

export function getSoundPlaybackState(): SoundPlaybackState {
  return playback;
}

export function subscribeSoundPlayback(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

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
  freq: number;
  glideTo?: number;
  at: number;
  dur: number;
  peak: number;
  type?: OscillatorType;
}

const DESIGNS: Record<SoundEvent, ToneStep[]> = {
  "overlay-open": [
    { freq: 620, glideTo: 830, at: 0, dur: 0.16, peak: 0.05 },
    { freq: 930, at: 0.1, dur: 0.14, peak: 0.035 },
  ],
  "overlay-close": [
    { freq: 830, glideTo: 610, at: 0, dur: 0.15, peak: 0.045 },
    { freq: 520, at: 0.09, dur: 0.12, peak: 0.028 },
  ],
  listening: [
    { freq: 1040, at: 0, dur: 0.07, peak: 0.03, type: "triangle" },
    { freq: 1320, at: 0.05, dur: 0.08, peak: 0.024, type: "triangle" },
  ],
  thinking: [{ freq: 240, at: 0, dur: 0.16, peak: 0.03, type: "sine" }],
  responding: [
    { freq: 720, at: 0, dur: 0.09, peak: 0.03 },
    { freq: 910, at: 0.06, dur: 0.1, peak: 0.026 },
  ],
  "task-completed": [
    { freq: 660, at: 0, dur: 0.12, peak: 0.045 },
    { freq: 830, at: 0.09, dur: 0.16, peak: 0.04 },
  ],
  confirmation: [
    { freq: 560, at: 0, dur: 0.1, peak: 0.04 },
    { freq: 560, at: 0.14, dur: 0.1, peak: 0.04 },
  ],
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

export function inQuietHours(): boolean {
  const prefs = getPrefs();
  if (!prefs.sounds.respectQuietHours) return false;
  return isWithinQuietHoursSchedule();
}

/** True when the Notifications Quiet Hours window is currently active. */
export function isWithinQuietHoursSchedule(): boolean {
  const quiet = getPrefs().notifications.quietHours;
  if (!quiet.enabled) return false;
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function clearAmplitudePulse() {
  if (amplitudeTimer != null) {
    window.clearInterval(amplitudeTimer);
    amplitudeTimer = null;
  }
  publish({ amplitude: 0 });
}

function pulseAmplitude(durationMs: number) {
  clearAmplitudePulse();
  const start = Date.now();
  amplitudeTimer = window.setInterval(() => {
    const t = (Date.now() - start) / durationMs;
    if (t >= 1) {
      clearAmplitudePulse();
      return;
    }
    const envelope = Math.sin(Math.PI * Math.min(1, t * 1.15));
    const shimmer = 0.55 + 0.45 * Math.sin(Date.now() / 40);
    publish({ amplitude: Math.max(0.08, envelope * shimmer) });
  }, 32);
}

function disconnectActive() {
  for (const node of activeNodes) {
    try {
      node.disconnect();
    } catch {
      // already disconnected
    }
  }
  activeNodes = [];
}

function playSteps(
  steps: ToneStep[],
  volume: number,
  profileId: SoundProfileId,
) {
  const audio = ctx();
  if (!audio) return 0;
  const profile = profileById(profileId).params;
  const brightnessBoost = 0.85 + profile.brightness * 0.35;
  const attack = 0.018 * profile.attackMultiplier;
  let endAt = 0;

  try {
    const now = audio.currentTime;
    const masterGain = audio.createGain();
    masterGain.gain.value = Math.max(0.0001, volume * profile.gainMultiplier);
    masterGain.connect(audio.destination);
    activeNodes.push(masterGain);

    // Subtle low-pass: brighter profiles open the filter.
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800 + profile.brightness * 4200;
    filter.Q.value = 0.7;
    filter.connect(masterGain);
    activeNodes.push(filter);

    for (const step of steps) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = step.type ?? (profile.warmth > 0.65 ? "sine" : "triangle");
      const t0 = now + step.at * profile.attackMultiplier;
      const dur = step.dur * profile.decayMultiplier;
      const freq = step.freq * brightnessBoost;
      osc.frequency.setValueAtTime(freq, t0);
      if (step.glideTo) {
        osc.frequency.exponentialRampToValueAtTime(
          step.glideTo * brightnessBoost,
          t0 + dur,
        );
      }
      const peak = Math.max(0.0002, step.peak * (0.85 + profile.presence * 0.3));
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(filter);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
      activeNodes.push(osc, gain);
      endAt = Math.max(endAt, (step.at * profile.attackMultiplier + dur) * 1000);
    }
  } catch {
    return 0;
  }
  return endAt + 80;
}

export function stopPreview() {
  for (const id of previewAllTimers) window.clearTimeout(id);
  previewAllTimers = [];
  disconnectActive();
  clearAmplitudePulse();
  publish({
    currentlyPreviewing: null,
    previewAllActive: false,
    amplitude: 0,
  });
}

export function stopAllSounds() {
  stopPreview();
}

/**
 * Plays the configured sound for an event.
 * `options.preview` bypasses enable + Quiet Hours (Settings deliberate preview).
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
  const minGap = event === "error" && !options?.preview ? ERROR_RATE_MS : MIN_REPEAT_MS;
  if (nowMs - last < minGap) return;
  lastPlayed.set(event, nowMs);

  if (options?.preview) {
    // One preview at a time (unless Preview All owns the sequence).
    if (!playback.previewAllActive) {
      disconnectActive();
      clearAmplitudePulse();
    }
    publish({ currentlyPreviewing: event });
  }

  const volume = (sounds.masterVolume / 100) * (eventPref.volume / 100);
  if (volume <= 0) {
    if (options?.preview && !playback.previewAllActive) {
      publish({ currentlyPreviewing: null });
    }
    return;
  }

  const duration = playSteps(DESIGNS[event], volume, sounds.profile);
  if (options?.preview && duration > 0) {
    pulseAmplitude(duration);
    if (!playback.previewAllActive) {
      window.setTimeout(() => {
        if (playback.currentlyPreviewing === event && !playback.previewAllActive) {
          publish({ currentlyPreviewing: null, amplitude: 0 });
        }
      }, duration + 40);
    }
  }
}

/** Sequential preview of enabled sounds (cancellable). */
export function previewAllSounds() {
  if (playback.previewAllActive) {
    stopPreview();
    return;
  }
  stopPreview();
  const prefs = getPrefs();
  const sequence = (Object.keys(DESIGNS) as SoundEvent[]).filter(
    (id) => prefs.sounds.events[id]?.enabled !== false,
  );
  publish({ previewAllActive: true });
  let delay = 0;
  for (const event of sequence) {
    const timer = window.setTimeout(() => {
      playEventSound(event, { preview: true });
    }, delay);
    previewAllTimers.push(timer);
    delay += 420;
  }
  const done = window.setTimeout(() => {
    publish({ previewAllActive: false, currentlyPreviewing: null, amplitude: 0 });
    previewAllTimers = [];
  }, delay + 200);
  previewAllTimers.push(done);
}

/** Plays a short test tone on the default output (Voice page "Test output"). */
export function playOutputTestTone(volume: number) {
  playSteps(
    [
      { freq: 520, at: 0, dur: 0.16, peak: 0.06 },
      { freq: 660, at: 0.14, dur: 0.18, peak: 0.06 },
    ],
    Math.max(0.05, volume / 100),
    getPrefs().sounds.profile ?? "balanced",
  );
}
