import { MoonIcon, ShieldIcon } from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import { Toggle } from "../../components/settings/Toggle";
import { navigateSettings } from "../../stores/appStore";
import { isWithinQuietHoursSchedule } from "../../services/SoundService";
import { SoundSettingsCard } from "./SoundSettingsCard";

type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  allowUrgent: boolean;
  allowDeadlines: boolean;
  allowAgentFailures: boolean;
};

type ScheduleMode = "off" | "everyday";

interface QuietHoursCardProps {
  quietHours: QuietHours;
  onChange: (patch: Partial<QuietHours>) => void;
}

function toInputTime(hhmm: string): string {
  // Already "HH:MM"
  return hhmm.length === 5 ? hhmm : "22:00";
}

export function QuietHoursCard({ quietHours, onChange }: QuietHoursCardProps) {
  const schedule: ScheduleMode = quietHours.enabled ? "everyday" : "off";
  const active = isWithinQuietHoursSchedule();

  return (
    <SoundSettingsCard
      icon={<MoonIcon size={15} />}
      title="Quiet hours"
      description="Sounds will be muted automatically during these hours."
      className="sound-card-quiet"
      action={
        active ? (
          <span className="sound-quiet-badge">Quiet Hours active</span>
        ) : null
      }
    >
      <label className="sound-quiet-field">
        <span className="sound-field-label">Schedule</span>
        <Dropdown<ScheduleMode>
          options={[
            { value: "off", label: "Off" },
            { value: "everyday", label: "Every day" },
          ]}
          value={schedule}
          onChange={(value) => onChange({ enabled: value === "everyday" })}
          ariaLabel="Quiet hours schedule"
        />
      </label>

      <div className="sound-quiet-times">
        <label className="sound-quiet-field">
          <span className="sound-field-label">From</span>
          <input
            type="time"
            className="sound-time-input"
            value={toInputTime(quietHours.start)}
            disabled={!quietHours.enabled}
            aria-label="Quiet hours start"
            onChange={(e) => onChange({ start: e.target.value })}
          />
        </label>
        <label className="sound-quiet-field">
          <span className="sound-field-label">To</span>
          <input
            type="time"
            className="sound-time-input"
            value={toInputTime(quietHours.end)}
            disabled={!quietHours.enabled}
            aria-label="Quiet hours end"
            onChange={(e) => onChange({ end: e.target.value })}
          />
        </label>
      </div>

      <div className="sound-quiet-toggles">
        <div className="sound-master-row is-compact">
          <div className="sound-master-copy">
            <span className="sound-master-label">Allow urgent</span>
          </div>
          <Toggle
            checked={quietHours.allowUrgent}
            onChange={(allowUrgent) => onChange({ allowUrgent })}
            label="Allow urgent during quiet hours"
            disabled={!quietHours.enabled}
          />
        </div>
      </div>

      <div className="sound-quiet-info">
        <ShieldIcon size={14} />
        <p>
          You can change these hours in{" "}
          <button
            type="button"
            className="sound-inline-link"
            onClick={() => navigateSettings("notifications")}
          >
            Notifications settings
          </button>
          . Previews on this page still play when you request them.
        </p>
      </div>
    </SoundSettingsCard>
  );
}
