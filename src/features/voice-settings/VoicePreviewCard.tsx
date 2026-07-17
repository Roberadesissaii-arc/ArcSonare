import { Dropdown } from "../../components/settings/Dropdown";
import { PlayIcon, VolumeIcon } from "../../components/Icons";
import { VoiceSettingsCard } from "./VoiceSettingsCard";
import { PREVIEW_SAMPLES, type VoiceCharacter } from "./voiceCharacters";
import { useState } from "react";

interface VoicePreviewCardProps {
  character: VoiceCharacter;
  speechConfigured: boolean;
  onOpenModels: () => void;
}

export function VoicePreviewCard({
  character,
  speechConfigured,
  onOpenModels,
}: VoicePreviewCardProps) {
  const [sampleId, setSampleId] = useState("greeting");
  const sample =
    PREVIEW_SAMPLES.find((s) => s.id === sampleId) ?? PREVIEW_SAMPLES[0];
  const phrase = sample.text(character.displayName);

  return (
    <VoiceSettingsCard
      icon={<VolumeIcon size={15} />}
      title="Voice preview"
      description="Preview how ArcSonare speaks with the selected character."
      className="voice-speak-preview-card"
    >
      <div className="voice-speak-preview-row">
        <button
          type="button"
          className="voice-play-btn"
          disabled={!speechConfigured}
          aria-label={speechConfigured ? "Play voice preview" : "Voice preview unavailable"}
          title={
            speechConfigured
              ? "Play preview"
              : "Requires a configured speech model"
          }
          onClick={() => undefined}
        >
          <PlayIcon size={18} />
        </button>
        <div className="voice-speak-preview-copy">
          <strong>{phrase}</strong>
          <span>This is how I will sound in conversations.</span>
          {!speechConfigured ? (
            <span className="voice-help">
              Voice preview requires a configured speech model.{" "}
              <button type="button" className="text-action" onClick={onOpenModels}>
                Open Models
              </button>
            </span>
          ) : null}
        </div>
        <div className="voice-sample-wrap">
          <Dropdown
            options={PREVIEW_SAMPLES.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={sampleId}
            onChange={setSampleId}
            ariaLabel="Preview different text"
            className="voice-sample-dropdown"
            matchTriggerWidth={false}
          />
        </div>
      </div>
    </VoiceSettingsCard>
  );
}
