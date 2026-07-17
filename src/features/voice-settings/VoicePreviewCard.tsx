import { useState } from "react";
import { ChevronDownIcon, PlayIcon, VolumeIcon } from "../../components/Icons";
import { VoiceSettingsCard } from "./VoiceSettingsCard";
import { PREVIEW_SAMPLES, type VoiceCharacter } from "./voiceCharacters";

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
  const [menuOpen, setMenuOpen] = useState(false);
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
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
          >
            Preview different text
            <ChevronDownIcon size={13} />
          </button>
          {menuOpen ? (
            <ul className="voice-sample-menu" role="listbox" aria-label="Preview samples">
              {PREVIEW_SAMPLES.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.id === sampleId}
                    onClick={() => {
                      setSampleId(item.id);
                      setMenuOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </VoiceSettingsCard>
  );
}
