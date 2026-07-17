import { KeyboardIcon, MicIcon, WaveIcon } from "../../components/Icons";
import type { VoiceActivationMode } from "../../config/prefs";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

interface VoiceModeCardProps {
  value: VoiceActivationMode;
  onChange: (mode: VoiceActivationMode) => void;
  wakeWordReady: boolean;
  onConfigureWakeWord: () => void;
}

const MODES: {
  id: VoiceActivationMode;
  label: string;
  description: string;
  icon: typeof MicIcon;
}[] = [
  {
    id: "push-to-talk",
    label: "Push to talk",
    description: "Hold a key to speak.",
    icon: KeyboardIcon,
  },
  {
    id: "toggle",
    label: "Toggle",
    description: "Press to start/stop.",
    icon: MicIcon,
  },
  {
    id: "hands-free",
    label: "Hands-free",
    description: "Speak naturally.",
    icon: WaveIcon,
  },
];

export function VoiceModeCard({
  value,
  onChange,
  wakeWordReady,
  onConfigureWakeWord,
}: VoiceModeCardProps) {
  return (
    <VoiceSettingsCard
      icon={<KeyboardIcon size={15} />}
      title="Voice mode"
      className="voice-mode-card"
    >
      <div className="voice-mode-grid" role="radiogroup" aria-label="Voice activation mode">
        {MODES.map((mode) => {
          const selected = value === mode.id;
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`voice-mode-tile${selected ? " is-selected" : ""}`}
              onClick={() => onChange(mode.id)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onChange(mode.id);
                }
              }}
            >
              <Icon size={16} />
              <span className="voice-mode-label">{mode.label}</span>
              <span className="voice-mode-desc">{mode.description}</span>
            </button>
          );
        })}
      </div>
      {value === "hands-free" && !wakeWordReady ? (
        <div className="voice-handsfree-note" role="status">
          <p>Hands-free requires a configured wake-word engine.</p>
          <button type="button" className="btn btn-small" onClick={onConfigureWakeWord}>
            Configure wake word
          </button>
        </div>
      ) : null}
    </VoiceSettingsCard>
  );
}
