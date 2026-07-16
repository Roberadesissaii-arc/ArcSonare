import type { VoiceStatus } from "../../stores/voiceStore";

/**
 * The refined violet live waveform: many thin bars, symmetric center-weighted
 * envelope, lavender→violet color progression, edge fade mask and a soft
 * central glow. Real audio amplitudes plug in later via `levels`; until then
 * a deterministic per-bar animation stands in (seeded, no randomness between
 * renders). Variants map to voice states; "idle" barely breathes.
 */

interface SonareLiveWaveformProps {
  variant?: VoiceStatus;
  width?: number;
  height?: number;
  bars?: number;
  /** Optional real amplitude samples (0..1) once microphone data exists. */
  levels?: number[];
}

/** Deterministic pseudo-random in [0, 1) — stable across renders. */
function seeded(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function SonareLiveWaveform({
  variant = "idle",
  width = 210,
  height = 38,
  bars = 44,
  levels,
}: SonareLiveWaveformProps) {
  const center = (bars - 1) / 2;
  return (
    <span
      className={`slw slw-${variant}`}
      style={{ width, height }}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, i) => {
        const d = Math.abs(i - center) / center; // 0 center → 1 edge
        // Center-weighted gaussian envelope with deterministic jitter.
        const envelope = Math.exp(-((d * 1.9) ** 2));
        const jitter = 0.62 + 0.38 * seeded(i);
        const real = levels?.[i % (levels.length || 1)];
        const h = Math.max(
          3,
          Math.round((real ?? envelope * jitter) * (height * 0.82)),
        );
        const tone = d > 0.66 ? "outer" : d > 0.3 ? "mid" : "core";
        return (
          <span
            key={i}
            className={`slw-bar slw-${tone}`}
            style={
              {
                height: `${h}px`,
                "--slw-dur": `${820 + Math.round(seeded(i + 97) * 620)}ms`,
                "--slw-delay": `${Math.round(seeded(i + 31) * -1400)}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
