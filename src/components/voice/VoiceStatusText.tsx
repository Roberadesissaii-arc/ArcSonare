import { VOICE_STATUS_TEXT, type VoiceStatus } from "../../stores/voiceStore";

interface VoiceStatusTextProps {
  status: VoiceStatus;
  resultMessage?: string;
}

/** Product name over the live status line ("ArcSonare / Listening..."). */
export function VoiceStatusText({ status, resultMessage }: VoiceStatusTextProps) {
  const text =
    status === "success" && resultMessage
      ? resultMessage
      : VOICE_STATUS_TEXT[status];
  return (
    <span className="voice-status-text">
      <span className="vst-name">ArcSonare</span>
      <span className={`vst-status vst-${status}`} role="status">
        {text}
      </span>
    </span>
  );
}
