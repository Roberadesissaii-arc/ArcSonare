import { Dropdown } from "../../components/settings/Dropdown";
import { PlayIcon, VolumeIcon } from "../../components/Icons";
import { VoiceSettingsCard } from "./VoiceSettingsCard";
import { previewVoiceCharacter } from "./previewVoiceCharacter";
import { PREVIEW_SAMPLES, type VoiceCharacter } from "./voiceCharacters";
import { useState } from "react";

interface VoicePreviewCardProps {
  character: VoiceCharacter;
  speechConfigured: boolean;
}

export function VoicePreviewCard({
  character,
  speechConfigured,
}: VoicePreviewCardProps) {
  const [sampleId, setSampleId] = useState("greeting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample =
    PREVIEW_SAMPLES.find((s) => s.id === sampleId) ?? PREVIEW_SAMPLES[0];
  const phrase =
    sampleId === "greeting"
      ? character.sampleGreeting
      : sample.text(character.displayName);

  const play = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await previewVoiceCharacter(character, phrase);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not play preview.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <VoiceSettingsCard
      icon={<VolumeIcon size={15} />}
      title="Voice preview"
      description="Hear how ArcSonare speaks with the selected character."
      className="voice-speak-preview-card"
    >
      <div className="voice-speak-preview-row">
        <button
          type="button"
          className="voice-play-btn"
          disabled={busy}
          aria-label={busy ? "Playing preview" : "Play voice preview"}
          title="Play preview"
          onClick={() => void play()}
        >
          <PlayIcon size={18} />
        </button>
        <div className="voice-speak-preview-copy">
          <strong>{phrase}</strong>
          <span>
            {busy
              ? "Playing…"
              : `Voice: ${character.preferredProviderVoiceId} · This is how I will sound.`}
          </span>
          {error ? (
            <span className="voice-help" role="alert">
              {error}
            </span>
          ) : null}
          {!speechConfigured ? (
            <span className="voice-help">
              Save an OpenAI key above to enable Realtime voice.
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
