import { PlayIcon, StopIcon, VolumeIcon } from "../../components/Icons";
import { Slider } from "../../components/settings/Slider";
import { Toggle } from "../../components/settings/Toggle";
import type { AudioDevice } from "../../services/DeviceService";
import { VoiceDevicePicker } from "./VoiceDevicePicker";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

interface OutputDeviceCardProps {
  devices: AudioDevice[];
  value: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
  volume: number;
  onVolume: (v: number) => void;
  tonePlaying: boolean;
  onToggleTone: () => void;
  muteResponses: boolean;
  duckOtherAudio: boolean;
  stopOnInterrupt: boolean;
  systemOutputFallback: boolean;
  onToggle: (patch: {
    muteResponses?: boolean;
    duckOtherAudio?: boolean;
    stopOnInterrupt?: boolean;
    systemOutputFallback?: boolean;
  }) => void;
}

export function OutputDeviceCard({
  devices,
  value,
  onChange,
  onRefresh,
  volume,
  onVolume,
  tonePlaying,
  onToggleTone,
  muteResponses,
  duckOtherAudio,
  stopOnInterrupt,
  systemOutputFallback,
  onToggle,
}: OutputDeviceCardProps) {
  const options =
    devices.length > 0
      ? devices.map((d) => ({
          value: d.deviceId,
          label: d.isDefault ? `Default – ${d.label}` : d.label,
        }))
      : [{ value: "default", label: "No speakers found" }];
  const selected = devices.some((d) => d.deviceId === value) ? value : options[0].value;

  return (
    <VoiceSettingsCard icon={<VolumeIcon size={15} />} title="Output" className="voice-output-card">
      <VoiceDevicePicker
        label="Speaker"
        icon={<VolumeIcon size={15} />}
        options={options}
        value={selected}
        onChange={onChange}
        onRefresh={onRefresh}
        ariaLabel="Speaker"
        refreshLabel="Refresh speakers"
      />

      <div className="voice-field voice-output-volume-field">
        <div className="voice-field-label-row">
          <span className="voice-field-label">Output volume</span>
          <span className="voice-volume-value">{volume}%</span>
        </div>
        <div className="voice-output-controls">
          <button
            type="button"
            className={`voice-play-btn voice-output-play${tonePlaying ? " is-playing" : ""}`}
            onClick={onToggleTone}
            aria-label={tonePlaying ? "Stop test tone" : "Play test tone"}
            title={tonePlaying ? "Stop test tone" : "Play test tone"}
          >
            {tonePlaying ? <StopIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <div className="voice-volume-row">
            <VolumeIcon size={14} />
            <Slider
              value={volume}
              min={0}
              max={100}
              onChange={onVolume}
              label="Output volume"
              format={(v) => `${v}%`}
            />
          </div>
        </div>
        <p className="voice-help">Play a short tone on your selected output device.</p>
      </div>

      <div className="voice-toggle-list">
        <div className="voice-toggle-row">
          <div className="voice-toggle-copy">
            <span className="voice-toggle-label">Mute spoken responses</span>
            <span className="voice-toggle-desc">Turn off voice replies.</span>
          </div>
          <Toggle
            checked={muteResponses}
            onChange={(muteResponses) => onToggle({ muteResponses })}
            label="Mute spoken responses"
          />
        </div>
        <div className="voice-toggle-row">
          <div className="voice-toggle-copy">
            <span className="voice-toggle-label">Duck other application audio</span>
            <span className="voice-toggle-desc">
              Preference saved. System-wide ducking depends on Windows audio support.
            </span>
          </div>
          <Toggle
            checked={duckOtherAudio}
            onChange={(duckOtherAudio) => onToggle({ duckOtherAudio })}
            label="Duck other application audio"
          />
        </div>
        <div className="voice-toggle-row">
          <div className="voice-toggle-copy">
            <span className="voice-toggle-label">Stop speaking when you interrupt</span>
            <span className="voice-toggle-desc">
              Immediately stop ArcSonare when your voice is detected.
            </span>
          </div>
          <Toggle
            checked={stopOnInterrupt}
            onChange={(stopOnInterrupt) => onToggle({ stopOnInterrupt })}
            label="Stop speaking when interrupted"
          />
        </div>
        <div className="voice-toggle-row">
          <div className="voice-toggle-copy">
            <span className="voice-toggle-label">Use system output as fallback</span>
            <span className="voice-toggle-desc">
              Fall back to the default device if the selected speaker disconnects.
            </span>
          </div>
          <Toggle
            checked={systemOutputFallback}
            onChange={(systemOutputFallback) => onToggle({ systemOutputFallback })}
            label="Use system output as fallback"
          />
        </div>
      </div>
    </VoiceSettingsCard>
  );
}
