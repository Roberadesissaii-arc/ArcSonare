/**
 * Minimal UI feedback sound, synthesized locally with WebAudio — no remote
 * or bundled audio assets. Deliberately very quiet and short.
 */

let context: AudioContext | null = null;

export function playOpenSound(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") {
      // May be blocked by autoplay policy; fail silently if so.
      void context.resume();
    }
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(830, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    // Audio output unavailable — sounds are strictly optional.
  }
}
