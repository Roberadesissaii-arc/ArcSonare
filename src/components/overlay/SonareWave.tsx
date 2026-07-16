import type { WaveState } from "../../types";

/**
 * The seven-bar Sonare waveform: symmetrical, sculptural, hand-built (no
 * waveform library). Only the "idle" state — a slow, staggered breathing
 * motion — is active in this phase; the other states exist as class hooks
 * for future phases.
 */

const BAR_HEIGHTS = [20, 36, 52, 64, 52, 36, 20];
const BAR_OPACITIES = [0.48, 0.68, 0.84, 1, 0.84, 0.68, 0.48];

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
