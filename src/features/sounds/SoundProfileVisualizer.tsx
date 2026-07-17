import { useEffect, useMemo, useState } from "react";
import type { SoundProfileId } from "../../config/prefs";

interface SoundProfileVisualizerProps {
  profile: SoundProfileId;
  amplitude: number;
  active: boolean;
  disabled?: boolean;
}

/** Circular violet visualizer with continuously animated waveform bars. */
export function SoundProfileVisualizer({
  profile,
  amplitude,
  active,
  disabled,
}: SoundProfileVisualizerProps) {
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (disabled || reducedMotion) {
      setPhase(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setPhase((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [disabled, reducedMotion]);

  const bars = useMemo(() => {
    const count = 52;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const center = 1 - Math.abs(t - 0.5) * 2;
      const shape = Math.pow(center, 1.35);
      const profileBias =
        profile === "crisp"
          ? 0.15
          : profile === "calm"
            ? -0.08
            : profile === "cinematic"
              ? 0.1
              : 0;
      out.push(Math.max(0.08, shape * (0.55 + profileBias)));
    }
    return out;
  }, [profile]);

  const energy = disabled
    ? 0
    : active
      ? Math.max(0.35, amplitude)
      : reducedMotion
        ? 0.12
        : 0.22;

  return (
    <div
      className={`sound-profile-visualizer${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
      aria-hidden="true"
    >
      <span className="sound-viz-ring sound-viz-ring-a" />
      <span className="sound-viz-ring sound-viz-ring-b" />
      <span className="sound-viz-ring sound-viz-ring-c" />
      <span className="sound-viz-node sound-viz-node-tl" />
      <span className="sound-viz-node sound-viz-node-br" />
      <div className="sound-viz-core">
        <div className="sound-viz-wave">
          {bars.map((base, i) => {
            const wave =
              reducedMotion || disabled
                ? 0
                : Math.sin(phase * (active ? 5.2 : 2.4) + i * 0.38) * 0.5 +
                  Math.sin(phase * 1.7 + i * 0.17) * 0.25;
            const h = Math.min(
              1,
              Math.max(
                0.08,
                base * (0.5 + energy * 1.15) + energy * 0.35 * wave,
              ),
            );
            return (
              <span
                key={i}
                className="sound-viz-bar"
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
