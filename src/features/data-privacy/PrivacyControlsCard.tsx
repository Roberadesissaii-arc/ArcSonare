import { Toggle } from "../../components/settings/Toggle";
import type { Prefs } from "../../config/prefs";
import { DataPrivacyCard } from "./DataPrivacyCard";

interface PrivacyControlsCardProps {
  dataPrivacy: Prefs["dataPrivacy"];
  onChange: (patch: Partial<Prefs["dataPrivacy"]>) => void;
  locationAllowed: boolean;
  onLocationAllowedChange: (allowed: boolean) => void;
}

export function PrivacyControlsCard({
  dataPrivacy: dp,
  onChange,
  locationAllowed,
  onLocationAllowedChange,
}: PrivacyControlsCardProps) {
  return (
    <DataPrivacyCard
      title="Privacy controls"
      description="Local storage, cloud processing, and diagnostics preferences."
    >
      <div className="data-privacy-controls-grid">
        <section>
          <h3 className="data-controls-group">Local storage</h3>
          <Control
            label="Store voice transcripts locally"
            description="Save transcripts on this device for later review."
            checked={dp.storeTranscripts}
            onChange={(storeTranscripts) => onChange({ storeTranscripts })}
          />
          <Control
            label="Store raw audio"
            description="Keep microphone recordings after transcription. Off by default."
            checked={dp.storeRawAudio}
            onChange={(storeRawAudio) => onChange({ storeRawAudio })}
          />
          <Control
            label="Store Screen Context captures"
            description="Save confirmed screenshots and annotations to history."
            checked={dp.storeCaptures}
            onChange={(storeCaptures) => onChange({ storeCaptures })}
          />
          <Control
            label="Allow device location"
            description="Used for weather, nearby places, and travel-time answers when you ask."
            checked={locationAllowed}
            onChange={onLocationAllowedChange}
          />
        </section>

        <section>
          <h3 className="data-controls-group">Cloud processing</h3>
          <Control
            label="Allow cloud processing"
            description="Permit approved requests to configured cloud model providers."
            checked={dp.allowCloud}
            onChange={(allowCloud) => onChange({ allowCloud })}
          />
          <Control
            label="Ask before cloud processing"
            description="Confirm before sending new content to an external provider."
            checked={dp.askBeforeCloud}
            onChange={(askBeforeCloud) => onChange({ askBeforeCloud })}
            disabled={!dp.allowCloud}
          />
        </section>

        <section className="data-controls-span">
          <h3 className="data-controls-group">Diagnostics</h3>
          <p className="data-controls-note">
            Diagnostics are not collected in this build. Toggles are saved for
            future versions and send nothing today.
          </p>
          <Control
            label="Allow anonymous diagnostics"
            description="Not collected in this build."
            checked={dp.diagnostics}
            onChange={(diagnostics) => onChange({ diagnostics })}
          />
          <Control
            label="Allow crash reports"
            description="Not collected in this build."
            checked={dp.crashReports}
            onChange={(crashReports) => onChange({ crashReports })}
          />
          <Control
            label="Allow performance metrics"
            description="Not collected in this build."
            checked={dp.perfMetrics}
            onChange={(perfMetrics) => onChange({ perfMetrics })}
          />
        </section>
      </div>
    </DataPrivacyCard>
  );
}

function Control({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`data-control-row${disabled ? " is-disabled" : ""}`}>
      <div>
        <span className="data-control-label">{label}</span>
        <span className="data-control-desc">{description}</span>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={disabled}
      />
    </div>
  );
}
