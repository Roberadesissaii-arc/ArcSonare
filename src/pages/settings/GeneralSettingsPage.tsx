import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { useSettings } from "../../hooks/useSettings";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";
import type { StartPage, TimeFormat } from "../../config/prefs";

export function GeneralSettingsPage() {
  const { settings } = useSettings();
  const prefs = usePrefs();
  const general = prefs.general;
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);

  const setAutostart = (enabled: boolean) => {
    setStartupBusy(true);
    setStartupError(null);
    invoke("set_autostart", { enabled })
      .catch((err) =>
        setStartupError(
          typeof err === "string" ? err : "The startup setting could not be changed.",
        ),
      )
      .finally(() => setStartupBusy(false));
  };

  const set = (patch: Partial<typeof general>) => patchPrefs("general", patch);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">General</h1>
        <p className="page-subtitle">
          Application behavior, language and startup.
        </p>
      </header>

      <SettingsGroup title="Application">
        <SettingRow
          label="Launch ArcSonare when Windows starts"
          description="Registers ArcSonare with Windows startup."
        >
          <Toggle
            checked={settings?.launchAtStartup ?? false}
            onChange={setAutostart}
            label="Launch ArcSonare when Windows starts"
            disabled={startupBusy}
          />
        </SettingRow>
        {startupError ? (
          <p className="field-error" role="alert">
            {startupError}
          </p>
        ) : null}
        <SettingRow
          label="Start minimized to tray"
          description="Skip showing the main window at launch."
        >
          <Toggle
            checked={general.startMinimized}
            onChange={(startMinimized) => set({ startMinimized })}
            label="Start minimized to tray"
          />
        </SettingRow>
        <SettingRow
          label="Keep ArcSonare running when the main window closes"
          description="Closing the window hides ArcSonare to the tray instead of quitting."
        >
          <Toggle
            checked={general.keepRunningOnClose}
            onChange={(keepRunningOnClose) => set({ keepRunningOnClose })}
            label="Keep running when the window closes"
          />
        </SettingRow>
        <SettingRow label="Open ArcSonare on" description="The page shown when the window opens.">
          <Dropdown<StartPage>
            options={[
              { value: "dashboard", label: "Dashboard" },
              { value: "tasks", label: "Tasks" },
              { value: "agent", label: "Agent" },
              { value: "connect", label: "Connect" },
              { value: "last", label: "Last opened page" },
            ]}
            value={general.openOnPage}
            onChange={(openOnPage) => set({ openOnPage })}
            ariaLabel="Open ArcSonare on"
          />
        </SettingRow>
        <SettingRow
          label="Restore previous window size and position"
          description="Reopen where you left off."
        >
          <Toggle
            checked={general.restoreWindow}
            onChange={(restoreWindow) => set({ restoreWindow })}
            label="Restore previous window size and position"
          />
        </SettingRow>
        <SettingRow
          label="Remember selected monitor"
          description="Reopen on the monitor ArcSonare last used."
        >
          <Toggle
            checked={general.rememberMonitor}
            onChange={(rememberMonitor) => set({ rememberMonitor })}
            label="Remember selected monitor"
          />
        </SettingRow>
        <SettingRow
          label="Check for updates automatically"
          description="Automatic updates are not wired to a release channel yet; this preference applies once they are."
        >
          <Toggle
            checked={general.autoUpdateCheck}
            onChange={(autoUpdateCheck) => set({ autoUpdateCheck })}
            label="Check for updates automatically"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Language and region">
        <SettingRow label="Interface language" description="Language of the ArcSonare interface.">
          <Dropdown
            options={[{ value: "en-US", label: "English (United States)" }]}
            value={general.interfaceLanguage}
            onChange={(interfaceLanguage) => set({ interfaceLanguage })}
            ariaLabel="Interface language"
          />
        </SettingRow>
        <SettingRow
          label="Voice-input language"
          description="Preferred language for speech recognition."
        >
          <Dropdown
            options={[
              { value: "en-US", label: "English (United States)" },
              { value: "en-GB", label: "English (United Kingdom)" },
            ]}
            value={general.voiceLanguage}
            onChange={(voiceLanguage) => set({ voiceLanguage })}
            ariaLabel="Voice-input language"
          />
        </SettingRow>
        <SettingRow
          label="Automatic language detection"
          description="Let the speech model detect the spoken language."
        >
          <Toggle
            checked={general.autoDetectLanguage}
            onChange={(autoDetectLanguage) => set({ autoDetectLanguage })}
            label="Automatic language detection"
          />
        </SettingRow>
        <SettingRow label="Time format">
          <SegmentedControl<TimeFormat>
            options={[
              { value: "system", label: "System" },
              { value: "12h", label: "12 hour" },
              { value: "24h", label: "24 hour" },
            ]}
            value={general.timeFormat}
            onChange={(timeFormat) => set({ timeFormat })}
            ariaLabel="Time format"
          />
        </SettingRow>
        <SettingRow label="First day of week">
          <SegmentedControl
            options={[
              { value: "system", label: "System" },
              { value: "monday", label: "Monday" },
              { value: "sunday", label: "Sunday" },
            ]}
            value={general.firstDayOfWeek}
            onChange={(firstDayOfWeek) =>
              set({ firstDayOfWeek: firstDayOfWeek as typeof general.firstDayOfWeek })
            }
            ariaLabel="First day of week"
          />
        </SettingRow>
        <SettingRow label="Regional date format">
          <Dropdown
            options={[
              { value: "system", label: "System" },
              { value: "dmy", label: "31/12/2026" },
              { value: "mdy", label: "12/31/2026" },
              { value: "ymd", label: "2026-12-31" },
            ]}
            value={general.dateFormat}
            onChange={(dateFormat) =>
              set({ dateFormat: dateFormat as typeof general.dateFormat })
            }
            ariaLabel="Regional date format"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Behavior">
        <SettingRow label="Show welcome greeting" description="The dashboard greeting line.">
          <Toggle
            checked={general.showGreeting}
            onChange={(showGreeting) => set({ showGreeting })}
            label="Show welcome greeting"
          />
        </SettingRow>
        <SettingRow label="Show system status footer">
          <Toggle
            checked={general.showStatusFooter}
            onChange={(showStatusFooter) => set({ showStatusFooter })}
            label="Show system status footer"
          />
        </SettingRow>
        <SettingRow
          label="Enable orbital background movement"
          description="Orbit paths, travelers and task cards on the dashboard."
        >
          <Toggle
            checked={general.orbitalMotion}
            onChange={(orbitalMotion) => set({ orbitalMotion })}
            label="Enable orbital background movement"
          />
        </SettingRow>
        <SettingRow
          label="Pause animations while ArcSonare is unfocused"
          description="Saves power when the window is hidden or minimized."
        >
          <Toggle
            checked={general.pauseWhenUnfocused}
            onChange={(pauseWhenUnfocused) => set({ pauseWhenUnfocused })}
            label="Pause animations while unfocused"
          />
        </SettingRow>
        <SettingRow label="Confirm before quitting ArcSonare">
          <Toggle
            checked={general.confirmQuit}
            onChange={(confirmQuit) => set({ confirmQuit })}
            label="Confirm before quitting"
          />
        </SettingRow>
        <SettingRow
          label="Reset onboarding"
          description="Show first-run hints again the next time ArcSonare starts."
        >
          <button
            type="button"
            className="btn"
            onClick={() => {
              set({ onboardingDone: false });
              setOnboardingStatus("Onboarding will run again on the next start.");
            }}
          >
            Reset
          </button>
        </SettingRow>
        {onboardingStatus ? (
          <p className="field-help" role="status">
            {onboardingStatus}
          </p>
        ) : null}
      </SettingsGroup>
    </div>
  );
}
