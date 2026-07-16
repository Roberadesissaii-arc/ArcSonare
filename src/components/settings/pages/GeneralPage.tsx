import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayPosition, Settings, ThemePreference } from "../../../types";
import { SettingRow } from "../SettingRow";
import { Toggle } from "../Toggle";
import { SegmentedControl } from "../SegmentedControl";
import { Dropdown } from "../Dropdown";
import { ShortcutRecorder } from "../ShortcutRecorder";

interface GeneralPageProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function GeneralPage({ settings, update }: GeneralPageProps) {
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);

  const setAutostart = (enabled: boolean) => {
    setStartupBusy(true);
    setStartupError(null);
    invoke("set_autostart", { enabled })
      .catch((err) => {
        setStartupError(
          typeof err === "string" ? err : "The startup setting could not be changed.",
        );
      })
      .finally(() => setStartupBusy(false));
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">General</h1>
        <p className="page-subtitle">Control ArcSonare the way you like.</p>
      </header>

      <SettingRow
        label="Global Shortcut"
        description="Summons ArcSonare from anywhere in Windows."
      >
        <ShortcutRecorder shortcut={settings.globalShortcut} />
      </SettingRow>

      <SettingRow
        label="Startup"
        description="Launch ArcSonare when Windows starts."
      >
        <Toggle
          checked={settings.launchAtStartup}
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

      <SettingRow label="Theme" description="Dark is the primary experience.">
        <SegmentedControl<ThemePreference>
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          ariaLabel="Theme"
        />
      </SettingRow>

      <SettingRow
        label="Position"
        description="Where the overlay appears on the active monitor."
      >
        <Dropdown<OverlayPosition>
          options={[
            { value: "top-center", label: "Top center" },
            { value: "top-left", label: "Top left" },
            { value: "top-right", label: "Top right" },
          ]}
          value={settings.overlayPosition}
          onChange={(overlayPosition) => update({ overlayPosition })}
          ariaLabel="Overlay position"
        />
      </SettingRow>

      <SettingRow label="Sound" description="Enable subtle UI sounds.">
        <Toggle
          checked={settings.uiSounds}
          onChange={(uiSounds) => update({ uiSounds })}
          label="Enable subtle UI sounds"
        />
      </SettingRow>
    </div>
  );
}
