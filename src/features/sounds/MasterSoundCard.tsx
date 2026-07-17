import { PlayIcon, RefreshIcon, StopIcon, VolumeIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import type { Prefs } from "../../config/prefs";
import { SoundSettingsCard } from "./SoundSettingsCard";
import { SoundVolumeSlider } from "./SoundVolumeSlider";

type SoundsPrefs = Prefs["sounds"];

interface MasterSoundCardProps {
  sounds: SoundsPrefs;
  previewAllActive: boolean;
  onChange: (patch: Partial<SoundsPrefs>) => void;
  onPreviewAll: () => void;
  onReset: () => void;
}

export function MasterSoundCard({
  sounds,
  previewAllActive,
  onChange,
  onPreviewAll,
  onReset,
}: MasterSoundCardProps) {
  return (
    <SoundSettingsCard
      icon={<VolumeIcon size={15} />}
      title="Master"
      description="Global interface sound controls."
      className="sound-card-master"
    >
      <div className="sound-master-rows">
        <div className="sound-master-row">
          <div className="sound-master-copy">
            <span className="sound-master-label">Enable interface sounds</span>
            <span className="sound-master-desc">
              Play subtle sounds for interface feedback.
            </span>
          </div>
          <Toggle
            checked={sounds.enabled}
            onChange={(enabled) => onChange({ enabled })}
            label="Enable interface sounds"
          />
        </div>

        <div className="sound-master-row">
          <div className="sound-master-copy">
            <span className="sound-master-label">Master sound volume</span>
            <span className="sound-master-desc">
              Control the overall volume for all interface sounds.
            </span>
          </div>
          <SoundVolumeSlider
            value={sounds.masterVolume}
            onChange={(masterVolume) => onChange({ masterVolume })}
            label="Master sound volume"
            disabled={!sounds.enabled}
            className="is-master"
          />
        </div>

        <div className="sound-master-row">
          <div className="sound-master-copy">
            <span className="sound-master-label">Mute during quiet hours</span>
            <span className="sound-master-desc">
              Uses the quiet hours configured under Notifications.
            </span>
          </div>
          <Toggle
            checked={sounds.respectQuietHours}
            onChange={(respectQuietHours) => onChange({ respectQuietHours })}
            label="Mute during quiet hours"
            disabled={!sounds.enabled}
          />
        </div>

        <div className="sound-master-row">
          <div
            className="sound-master-copy"
            title="Presentation detection is not available in this build."
          >
            <span className="sound-master-label">
              Mute while another application is presenting
            </span>
            <span className="sound-master-desc">
              Presentation detection is not available yet; the preference will apply when support is added.
            </span>
          </div>
          <Toggle
            checked={sounds.muteWhilePresenting}
            onChange={(muteWhilePresenting) => onChange({ muteWhilePresenting })}
            label="Mute while presenting"
            disabled
          />
        </div>

        <div className="sound-master-row is-action">
          <div className="sound-master-copy">
            <span className="sound-master-label">Preview all sounds</span>
            <span className="sound-master-desc">
              Play a preview of all enabled event sounds.
            </span>
          </div>
          <button
            type="button"
            className="sound-solid-btn is-secondary"
            onClick={onPreviewAll}
            disabled={!sounds.enabled && sounds.masterVolume === 0}
          >
            {previewAllActive ? <StopIcon size={14} /> : <PlayIcon size={14} />}
            {previewAllActive ? "Stop preview" : "Preview all"}
          </button>
        </div>

        <div className="sound-master-row is-action">
          <div className="sound-master-copy">
            <span className="sound-master-label">Reset sound defaults</span>
            <span className="sound-master-desc">
              Restore all sound settings to their original values.
            </span>
          </div>
          <button type="button" className="sound-solid-btn is-secondary" onClick={onReset}>
            <RefreshIcon size={14} />
            Reset
          </button>
        </div>
      </div>
    </SoundSettingsCard>
  );
}
