import { CloseIcon, MicIcon, SparkleIcon } from "../../components/Icons";
import { SonareLiveWaveform } from "../../components/voice/SonareLiveWaveform";
import { SonareMarbleOrb, type MarbleTint } from "../../components/voice/SonareMarbleOrb";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

interface LiveAssistantPreviewCardProps {
  onCustomize: () => void;
  marbleTint: MarbleTint;
}

/** Non-live visual preview of the global top overlay (does not open the mic). */
export function LiveAssistantPreviewCard({ onCustomize, marbleTint }: LiveAssistantPreviewCardProps) {
  return (
    <VoiceSettingsCard
      icon={<MicIcon size={15} />}
      title="Live voice assistant preview"
      action={<span className="voice-always-badge">Always available</span>}
      className="voice-preview-overlay-card"
    >
      <div
        className="voice-overlay-preview"
        role="img"
        aria-label="ArcSonare voice overlay preview"
      >
        <span className="voice-overlay-preview-marble">
          <SonareMarbleOrb status="idle" size={50} tint={marbleTint} />
        </span>
        <span className="voice-overlay-preview-status">
          <span className="voice-overlay-preview-name">ArcSonare</span>
          <span className="voice-overlay-preview-line">
            Tap to speak or type a command...
          </span>
        </span>
        <span className="voice-overlay-preview-divider" aria-hidden="true" />
        <span className="voice-overlay-preview-wave">
          <SonareLiveWaveform variant="idle" width={200} height={36} bars={48} />
        </span>
        <span className="voice-overlay-preview-close" aria-hidden="true">
          <CloseIcon size={14} />
        </span>
      </div>

      <div className="voice-overlay-preview-foot">
        <p>
          <SparkleIcon size={13} />
          Use this floating assistant anywhere in ArcSonare.
        </p>
        <button type="button" className="voice-solid-btn is-secondary" onClick={onCustomize}>
          Customize overlay
        </button>
      </div>
    </VoiceSettingsCard>
  );
}
