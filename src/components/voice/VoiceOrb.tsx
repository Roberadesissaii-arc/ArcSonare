import type { VoiceState } from "../../stores/voiceStore";

interface VoiceOrbProps {
  state: VoiceState;
  size?: number;
}

/**
 * The AI orb: a dark core with a violet halo that breathes slowly. Purely
 * abstract — no eye, no face, no rainbow.
 */
export function VoiceOrb({ state, size = 46 }: VoiceOrbProps) {
  return (
    <span
      className={`voice-orb orb-${state}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="voice-orb-core" />
    </span>
  );
}
