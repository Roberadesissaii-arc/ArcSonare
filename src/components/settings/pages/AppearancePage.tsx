import type { OverlayPosition, Settings, ThemePreference } from "../../../types";
import { SettingRow } from "../SettingRow";
import { Toggle } from "../Toggle";
import { SegmentedControl } from "../SegmentedControl";
import { Dropdown } from "../Dropdown";

interface AppearancePageProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function AppearancePage({ settings, update }: AppearancePageProps) {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Appearance</h1>
        <p className="page-subtitle">Theme, position and motion.</p>
      </header>

      <SettingRow
        label="Theme"
        description="System follows your Windows preference."
      >
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
        label="Overlay position"
        description="Where ArcSonare appears at the top of the screen."
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

      <SettingRow
        label="Reduced motion"
        description="Minimize animation throughout ArcSonare."
      >
        <Toggle
          checked={settings.reducedMotion}
          onChange={(reducedMotion) => update({ reducedMotion })}
          label="Reduced motion"
        />
      </SettingRow>
    </div>
  );
}
