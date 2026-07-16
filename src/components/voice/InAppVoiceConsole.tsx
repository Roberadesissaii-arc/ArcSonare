import { toggleVoice, useVoiceState, VOICE_STATUS } from "../../stores/voiceStore";
import { SonareWaveform } from "./SonareWaveform";
import { VoiceOrb } from "./VoiceOrb";

/**
 * The floating in-app voice console at the top of the intelligence
 * workspace. Shares voice state with the global top overlay. Clicking it
 * toggles the (simulated) voice session.
 */
export function InAppVoiceConsole() {
  const state = useVoiceState();

  return (
    <button
      type="button"
      className={`voice-console vc-${state}`}
      onClick={toggleVoice}
      aria-label={`ArcSonare Assistant — ${VOICE_STATUS[state]}. Toggle voice mode`}
    >
      <VoiceOrb state={state} />
      <span className="voice-console-titles">
        <span className="voice-console-name">ArcSonare Assistant</span>
        <span className="voice-console-status">{VOICE_STATUS[state]}</span>
      </span>
      <SonareWaveform state={state} />
    </button>
  );
}
