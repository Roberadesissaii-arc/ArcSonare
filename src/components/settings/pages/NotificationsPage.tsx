import type { Settings } from "../../../types";
import { SettingRow } from "../SettingRow";
import { Toggle } from "../Toggle";

interface NotificationsPageProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function NotificationsPage({ settings, update }: NotificationsPageProps) {
  const master = settings.notificationsEnabled;
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Notifications</h1>
        <p className="page-subtitle">
          Choose what ArcSonare is allowed to tell you. These preferences apply
          to features arriving in later phases.
        </p>
      </header>

      <SettingRow
        label="Desktop notifications"
        description="Allow ArcSonare to show Windows notifications."
      >
        <Toggle
          checked={master}
          onChange={(notificationsEnabled) => update({ notificationsEnabled })}
          label="Desktop notifications"
        />
      </SettingRow>

      <SettingRow
        label="Completion notifications"
        description="Notify when a requested action finishes."
        disabled={!master}
      >
        <Toggle
          checked={settings.completionNotifications}
          onChange={(completionNotifications) =>
            update({ completionNotifications })
          }
          label="Completion notifications"
          disabled={!master}
        />
      </SettingRow>

      <SettingRow
        label="Error notifications"
        description="Notify when something goes wrong."
        disabled={!master}
      >
        <Toggle
          checked={settings.errorNotifications}
          onChange={(errorNotifications) => update({ errorNotifications })}
          label="Error notifications"
          disabled={!master}
        />
      </SettingRow>
    </div>
  );
}
