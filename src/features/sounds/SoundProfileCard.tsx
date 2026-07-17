import { VolumeIcon, WaveIcon } from "../../components/Icons";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import type { Prefs, SoundOutputMode, SoundProfileId } from "../../config/prefs";
import { profileById, SOUND_PROFILES } from "./soundProfiles";
import { SoundProfileVisualizer } from "./SoundProfileVisualizer";
import { SoundSettingsCard } from "./SoundSettingsCard";

type SoundsPrefs = Prefs["sounds"];

interface SoundProfileCardProps {
  sounds: SoundsPrefs;
  amplitude: number;
  previewing: boolean;
  outputOptions: { value: string; label: string }[];
  onChange: (patch: Partial<SoundsPrefs>) => void;
}

function CharacteristicMeter({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="sound-char-meter">
      <span className="sound-char-label">{label}</span>
      <span className="sound-char-dots" aria-label={`${label}: ${value} of 8`}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={i < value ? "is-on" : undefined} />
        ))}
      </span>
    </div>
  );
}

export function SoundProfileCard({
  sounds,
  amplitude,
  previewing,
  outputOptions,
  onChange,
}: SoundProfileCardProps) {
  const meta = profileById(sounds.profile);

  return (
    <SoundSettingsCard
      icon={<WaveIcon size={15} />}
      title="Sound profile"
      description="Shape the character of ArcSonare’s interface sounds."
      className="sound-card-profile"
    >
      <SegmentedControl<SoundProfileId>
        options={SOUND_PROFILES.map((p) => ({ value: p.id, label: p.label }))}
        value={sounds.profile}
        onChange={(profile) => onChange({ profile })}
        ariaLabel="Sound profile"
      />

      <div className="sound-profile-main">
        <SoundProfileVisualizer
          profile={sounds.profile}
          amplitude={amplitude}
          active={previewing}
          disabled={!sounds.enabled}
        />
        <div className="sound-profile-detail">
          <h3 className="sound-profile-name">{meta.title}</h3>
          <p className="sound-profile-copy">{meta.description}</p>
          <div className="sound-char-list">
            <CharacteristicMeter label="Warmth" value={meta.warmthDots} />
            <CharacteristicMeter label="Clarity" value={meta.clarityDots} />
            <CharacteristicMeter label="Presence" value={meta.presenceDots} />
          </div>
        </div>
      </div>

      <div className="sound-output-section">
        <div className="sound-output-head">
          <span className="sound-settings-icon-tile sm" aria-hidden="true">
            <VolumeIcon size={13} />
          </span>
          <div>
            <span className="sound-master-label">Output behavior</span>
            <span className="sound-master-desc">
              Control how and where interface sounds are played.
            </span>
          </div>
        </div>
        <label className="sound-output-field">
          <span className="sound-field-label">Default output</span>
          <select
            className="sound-select"
            value={
              sounds.outputMode === "specific-device" && sounds.outputDeviceId
                ? `device:${sounds.outputDeviceId}`
                : sounds.outputMode
            }
            disabled={!sounds.enabled}
            aria-label="Sound output device"
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("device:")) {
                onChange({
                  outputMode: "specific-device",
                  outputDeviceId: v.slice(7),
                });
              } else {
                onChange({
                  outputMode: v as SoundOutputMode,
                  outputDeviceId: null,
                });
              }
            }}
          >
            {outputOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="sound-master-desc">
            Web Audio uses the system default output in this build. Device choice is saved for when routing is available.
          </span>
        </label>
      </div>
    </SoundSettingsCard>
  );
}
