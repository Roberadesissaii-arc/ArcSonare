import type { ReactNode } from "react";
import { PlayIcon, StopIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import type { SoundEvent } from "../../config/prefs";
import { SoundVolumeSlider } from "./SoundVolumeSlider";

interface EventSoundRowProps {
  id: SoundEvent;
  name: string;
  icon: ReactNode;
  enabled: boolean;
  volume: number;
  masterEnabled: boolean;
  previewing: boolean;
  onToggle: (enabled: boolean) => void;
  onVolume: (volume: number) => void;
  onPreview: () => void;
}

export function EventSoundRow({
  id,
  name,
  icon,
  enabled,
  volume,
  masterEnabled,
  previewing,
  onToggle,
  onVolume,
  onPreview,
}: EventSoundRowProps) {
  return (
    <div
      className={`sound-event-row-card${previewing ? " is-previewing" : ""}${!enabled || !masterEnabled ? " is-dim" : ""}`}
    >
      <span className="sound-event-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sound-event-name">{name}</span>
      <Toggle
        checked={enabled}
        onChange={onToggle}
        label={`Enable sound: ${name}`}
        disabled={!masterEnabled}
      />
      <SoundVolumeSlider
        value={volume}
        onChange={onVolume}
        label={`Volume for ${name}`}
        disabled={!masterEnabled || !enabled}
        className="is-event"
      />
      <button
        type="button"
        className={`sound-preview-btn${previewing ? " is-active" : ""}`}
        aria-label={previewing ? `Stop ${name} preview` : `Preview “${name}” sound`}
        title={previewing ? "Stop" : "Preview"}
        onClick={onPreview}
        disabled={!masterEnabled}
      >
        {previewing ? <StopIcon size={12} /> : <PlayIcon size={12} />}
      </button>
      <span className="sound-event-id" hidden>
        {id}
      </span>
    </div>
  );
}
