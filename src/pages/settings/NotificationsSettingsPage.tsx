import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { Toggle } from "../../components/settings/Toggle";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationDelivery,
} from "../../config/prefs";

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  "task-created": "Task created",
  "task-completed": "Task completed",
  "task-overdue": "Task overdue",
  deadline: "Upcoming deadline",
  "agent-started": "Agent started",
  "agent-completed": "Agent completed",
  "agent-confirmation": "Agent needs confirmation",
  "agent-failed": "Agent failed",
  "connection-lost": "Connection lost",
  "connection-restored": "Connection restored",
  "screen-context-started": "Screen Context started",
  "screen-context-stopped": "Screen Context stopped",
  "model-unavailable": "Model unavailable",
  "app-update": "Application update",
  "system-error": "System error",
};

export function NotificationsSettingsPage() {
  const prefs = usePrefs();
  const n = prefs.notifications;
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const set = (patch: Partial<typeof n>) => patchPrefs("notifications", patch);
  const setQuiet = (patch: Partial<typeof n.quietHours>) =>
    updatePrefs((p) => ({
      ...p,
      notifications: {
        ...p.notifications,
        quietHours: { ...p.notifications.quietHours, ...patch },
      },
    }));
  const setPrivacy = (patch: Partial<typeof n.privacy>) =>
    updatePrefs((p) => ({
      ...p,
      notifications: {
        ...p.notifications,
        privacy: { ...p.notifications.privacy, ...patch },
      },
    }));
  const setCategory = (id: NotificationCategory, enabled: boolean) =>
    updatePrefs((p) => ({
      ...p,
      notifications: {
        ...p.notifications,
        categories: { ...p.notifications.categories, [id]: enabled },
      },
    }));

  const sendTest = () => {
    setTestStatus(null);
    invoke("send_test_notification", {
      title: n.privacy.genericOnly ? "ArcSonare notification" : "ArcSonare",
      body: n.privacy.genericOnly
        ? ""
        : "This is a test notification from ArcSonare.",
    })
      .then(() => setTestStatus("Test notification sent to Windows."))
      .catch((err) =>
        setTestStatus(
          typeof err === "string" ? err : "The test notification could not be sent.",
        ),
      );
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Notifications</h1>
        <p className="page-subtitle">
          What ArcSonare tells you, where and when.
        </p>
      </header>

      <SettingsGroup title="General">
        <SettingRow label="Enable desktop notifications">
          <Toggle checked={n.desktop} onChange={(desktop) => set({ desktop })} label="Enable desktop notifications" />
        </SettingRow>
        <SettingRow label="Show in-app notifications" description="The bell popover in the header.">
          <Toggle checked={n.inApp} onChange={(inApp) => set({ inApp })} label="Show in-app notifications" disabled={!n.desktop} />
        </SettingRow>
        <SettingRow label="Show Windows notifications" description="Native Windows notification banners.">
          <Toggle checked={n.windows} onChange={(windows) => set({ windows })} label="Show Windows notifications" disabled={!n.desktop} />
        </SettingRow>
        <SettingRow label="Play notification sounds">
          <Toggle checked={n.sounds} onChange={(sounds) => set({ sounds })} label="Play notification sounds" disabled={!n.desktop} />
        </SettingRow>
        <SettingRow label="Show notification badge" description="The unread dot on the bell.">
          <Toggle checked={n.badge} onChange={(badge) => set({ badge })} label="Show notification badge" />
        </SettingRow>
        <SettingRow label="Mark notifications read when opened">
          <Toggle checked={n.markReadOnOpen} onChange={(markReadOnOpen) => set({ markReadOnOpen })} label="Mark notifications read when opened" />
        </SettingRow>
        <SettingRow label="Group related notifications">
          <Toggle checked={n.group} onChange={(group) => set({ group })} label="Group related notifications" />
        </SettingRow>
        <SettingRow label="Default delivery">
          <SegmentedControl<NotificationDelivery>
            options={[
              { value: "banner", label: "Banner" },
              { value: "center", label: "Center only" },
              { value: "windows", label: "Windows" },
            ]}
            value={n.delivery}
            onChange={(delivery) => set({ delivery })}
            ariaLabel="Default delivery"
          />
        </SettingRow>
        <SettingRow label="Send test notification" description="Sends a real Windows notification.">
          <button type="button" className="btn" onClick={sendTest}>
            Send test
          </button>
        </SettingRow>
        {testStatus ? (
          <p className="field-help" role="status">
            {testStatus}
          </p>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Categories" description="Which events produce a notification.">
        {NOTIFICATION_CATEGORIES.map((id) => (
          <SettingRow key={id} label={CATEGORY_LABELS[id]}>
            <Toggle
              checked={n.categories[id]}
              onChange={(enabled) => setCategory(id, enabled)}
              label={CATEGORY_LABELS[id]}
              disabled={!n.desktop}
            />
          </SettingRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Quiet hours">
        <SettingRow label="Enable quiet hours">
          <Toggle
            checked={n.quietHours.enabled}
            onChange={(enabled) => setQuiet({ enabled })}
            label="Enable quiet hours"
          />
        </SettingRow>
        <SettingRow label="Start time">
          <input
            type="time"
            className="time-input"
            value={n.quietHours.start}
            aria-label="Quiet hours start"
            disabled={!n.quietHours.enabled}
            onChange={(e) => setQuiet({ start: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="End time">
          <input
            type="time"
            className="time-input"
            value={n.quietHours.end}
            aria-label="Quiet hours end"
            disabled={!n.quietHours.enabled}
            onChange={(e) => setQuiet({ end: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Allow urgent notifications">
          <Toggle
            checked={n.quietHours.allowUrgent}
            onChange={(allowUrgent) => setQuiet({ allowUrgent })}
            label="Allow urgent notifications"
            disabled={!n.quietHours.enabled}
          />
        </SettingRow>
        <SettingRow label="Allow task deadlines">
          <Toggle
            checked={n.quietHours.allowDeadlines}
            onChange={(allowDeadlines) => setQuiet({ allowDeadlines })}
            label="Allow task deadlines"
            disabled={!n.quietHours.enabled}
          />
        </SettingRow>
        <SettingRow label="Allow agent failures">
          <Toggle
            checked={n.quietHours.allowAgentFailures}
            onChange={(allowAgentFailures) => setQuiet({ allowAgentFailures })}
            label="Allow agent failures"
            disabled={!n.quietHours.enabled}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <SettingRow label="Hide message content on lock screen" description="Applies to Windows notifications.">
          <Toggle
            checked={n.privacy.hideContent}
            onChange={(hideContent) => setPrivacy({ hideContent })}
            label="Hide message content on lock screen"
          />
        </SettingRow>
        <SettingRow label="Hide task names">
          <Toggle
            checked={n.privacy.hideTaskNames}
            onChange={(hideTaskNames) => setPrivacy({ hideTaskNames })}
            label="Hide task names"
          />
        </SettingRow>
        <SettingRow label="Hide contact names">
          <Toggle
            checked={n.privacy.hideContactNames}
            onChange={(hideContactNames) => setPrivacy({ hideContactNames })}
            label="Hide contact names"
          />
        </SettingRow>
        <SettingRow label="Show only “ArcSonare notification”">
          <Toggle
            checked={n.privacy.genericOnly}
            onChange={(genericOnly) => setPrivacy({ genericOnly })}
            label="Show only ArcSonare notification"
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
