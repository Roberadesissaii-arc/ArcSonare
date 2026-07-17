import { WaveIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

interface ListeningBehaviorCardProps {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  backgroundFilter: boolean;
  backgroundFilterAvailable: boolean;
  onChange: (patch: {
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
    autoGainControl?: boolean;
    backgroundFilter?: boolean;
  }) => void;
}

const ROWS: {
  key: "noiseSuppression" | "echoCancellation" | "autoGainControl" | "backgroundFilter";
  label: string;
  description: string;
}[] = [
  {
    key: "noiseSuppression",
    label: "Noise suppression",
    description: "Reduce background noise for clearer input.",
  },
  {
    key: "echoCancellation",
    label: "Echo cancellation",
    description: "Remove echo from your speakers.",
  },
  {
    key: "autoGainControl",
    label: "Automatic gain control",
    description: "Adjust microphone volume automatically.",
  },
  {
    key: "backgroundFilter",
    label: "Background noise filtering",
    description: "Uses model intelligence to filter remaining noise.",
  },
];

export function ListeningBehaviorCard({
  noiseSuppression,
  echoCancellation,
  autoGainControl,
  backgroundFilter,
  backgroundFilterAvailable,
  onChange,
}: ListeningBehaviorCardProps) {
  const values = {
    noiseSuppression,
    echoCancellation,
    autoGainControl,
    backgroundFilter,
  };

  return (
    <VoiceSettingsCard
      icon={<WaveIcon size={15} />}
      title="Listening behavior"
      className="voice-listening-card"
    >
      <div className="voice-toggle-list">
        {ROWS.map((row) => {
          const disabled = row.key === "backgroundFilter" && !backgroundFilterAvailable;
          return (
            <div key={row.key} className="voice-toggle-row">
              <div className="voice-toggle-copy">
                <span className="voice-toggle-label">{row.label}</span>
                <span className="voice-toggle-desc">
                  {disabled
                    ? "Unavailable until a compatible speech model is configured."
                    : row.description}
                </span>
              </div>
              <Toggle
                checked={values[row.key]}
                onChange={(checked) => onChange({ [row.key]: checked })}
                label={row.label}
                disabled={disabled}
              />
            </div>
          );
        })}
      </div>
    </VoiceSettingsCard>
  );
}
