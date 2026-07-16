import type { WaveState } from "../../types";

/**
 * The seven-bar Sonare waveform: symmetrical, sculptural, hand-built (no
 * waveform library). Only the "idle" state — a slow, staggered breathing
 * motion — is active in this phase; the other states exist as class hooks
 * for future phases.
 */

const BAR_HEIGHTS = [20, 34, 48, 62, 48, 34, 20];
const BAR_OPACITIES = [0.5, 0.65, 0.82, 1, 0.82, 0.65, 0.5];

interface SonareWaveProps {
  state?: WaveState;
}

export function SonareWave({ state = "idle" }: SonareWaveProps) {
  return (
    <div className={`sonare-wave wave-${state}`} aria-hidden="true">
      {BAR_HEIGHTS.map((height, index) => (
        <span
          key={index}
          className="wave-bar"
          style={{
            height: `${height}px`,
            opacity: BAR_OPACITIES[index],
            animationDelay: `${index * 0.13}s`,
          }}
        />
      ))}
    </div>
  );
}
