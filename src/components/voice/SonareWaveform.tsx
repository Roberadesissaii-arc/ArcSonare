import type { VoiceState } from "../../stores/voiceStore";

const BAR_COUNT = 26;

interface SonareWaveformProps {
  state: VoiceState;
  width?: number;
}

/**
 * Fine horizontal waveform in muted violet/gray. Bars animate only while
 * the assistant is listening / processing / speaking; idle stays calm.
 */
export function SonareWaveform({ state, width = 210 }: SonareWaveformProps) {
  const active =
    state === "listening" || state === "processing" || state === "speaking";
  return (
    <span
      className={`sonare-waveform wf-${state}${active ? " wf-active" : ""}`}
      style={{ width }}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        // Symmetric envelope so the center bars carry the most energy.
        const envelope = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / (BAR_COUNT / 2);
        return (
          <span
            key={i}
            className="wf-bar"
            style={{
              height: `${5 + envelope * 13}px`,
              animationDelay: `${(i % 7) * 0.11}s`,
            }}
          />
        );
      })}
    </span>
  );
}
