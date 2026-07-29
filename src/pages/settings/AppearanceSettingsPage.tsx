import { useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { ColorPicker } from "../../components/settings/ColorPicker";
import { Slider } from "../../components/settings/Slider";
import { useSettings } from "../../hooks/useSettings";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";
import type { OverlayPosition, ThemePreference } from "../../types";
import type { AccentMode, Density } from "../../config/prefs";

export function AppearanceSettingsPage() {
  const { settings, update } = useSettings();
  const prefs = usePrefs();
  const appearance = prefs.appearance;
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  const set = (patch: Partial<typeof appearance>) => patchPrefs("appearance", patch);

  const chooseBackground = async () => {
    setBackgroundBusy(true);
    try {
      const path = await invoke<string | null>("pick_background_image");
      if (path) set({ customBackgroundPath: path });
    } catch (err) {
      console.error("[ArcSonare] failed to pick background image:", err);
    } finally {
      setBackgroundBusy(false);
    }
  };

  const resetBackground = async () => {
    setBackgroundBusy(true);
    try {
      await invoke("clear_background_image");
      set({ customBackgroundPath: "" });
    } catch (err) {
      console.error("[ArcSonare] failed to reset background image:", err);
    } finally {
      setBackgroundBusy(false);
    }
  };

  return (
    <div className="page">
      <SettingsPageHeader
        title="Appearance"
        description="Theme, density and motion. Changes apply immediately."
      />

      <SettingsGroup title="Theme">
        <SettingRow label="Theme" description="Dark is the primary experience.">
          <SegmentedControl<ThemePreference>
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
            value={settings?.theme ?? "dark"}
            onChange={(theme) => update({ theme })}
            ariaLabel="Theme"
          />
        </SettingRow>
        <SettingRow
          label="Accent color"
          description="Used for selected controls, focus rings, and intelligence highlights."
        >
          <ColorPicker
            value={appearance.accentColor || "violet"}
            onChange={(accentColor) => set({ accent: "violet", accentColor })}
          />
        </SettingRow>
        <SettingRow
          label="Accent mode"
          description="Monochrome removes violet intelligence accents."
        >
          <SegmentedControl<AccentMode>
            options={[
              { value: "violet", label: "Colored" },
              { value: "monochrome", label: "Monochrome" },
            ]}
            value={appearance.accent}
            onChange={(accent) => set({ accent })}
            ariaLabel="Accent mode"
          />
        </SettingRow>
        <SettingRow label="Interface density">
          <SegmentedControl<Density>
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
              { value: "spacious", label: "Spacious" },
            ]}
            value={appearance.density}
            onChange={(density) => set({ density })}
            ariaLabel="Interface density"
          />
        </SettingRow>
        <SettingRow label="Text scale">
          <Slider
            value={appearance.textScale}
            min={85}
            max={125}
            step={5}
            onChange={(textScale) => set({ textScale })}
            label="Text scale"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Card contrast" description="How strongly cards separate from the page.">
          <Slider
            value={appearance.cardContrast}
            min={0}
            max={100}
            onChange={(cardContrast) => set({ cardContrast })}
            label="Card contrast"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Transparency strength">
          <Slider
            value={appearance.transparency}
            min={0}
            max={100}
            onChange={(transparency) => set({ transparency })}
            label="Transparency strength"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Background blur" description="Blur behind popovers and the composer.">
          <Toggle
            checked={appearance.backgroundBlur}
            onChange={(backgroundBlur) => set({ backgroundBlur })}
            label="Background blur"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Background"
        description="Replaces the page background behind Dashboard, Tasks and Agent. The orbital animation is unaffected."
      >
        <SettingRow
          label="Background image"
          description={
            appearance.customBackgroundPath
              ? "A custom background is active."
              : "Using the default background."
          }
        >
          <div className="background-picker-actions">
            {appearance.customBackgroundPath ? (
              <img
                className="background-picker-thumb"
                src={convertFileSrc(appearance.customBackgroundPath)}
                alt="Current background"
              />
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => void chooseBackground()}
              disabled={backgroundBusy}
            >
              Choose image…
            </button>
            {appearance.customBackgroundPath ? (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void resetBackground()}
                disabled={backgroundBusy}
              >
                Reset to default
              </button>
            ) : null}
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Motion and effects">
        <SettingRow
          label="Reduced motion"
          description="Disables continuous animation everywhere."
        >
          <Toggle
            checked={settings?.reducedMotion ?? false}
            onChange={(reducedMotion) => update({ reducedMotion })}
            label="Reduced motion"
          />
        </SettingRow>
        <SettingRow label="Disable orbital animation">
          <Toggle
            checked={appearance.disableOrbital}
            onChange={(disableOrbital) => set({ disableOrbital })}
            label="Disable orbital animation"
          />
        </SettingRow>
        <SettingRow label="Disable waveform animation">
          <Toggle
            checked={appearance.disableWaveform}
            onChange={(disableWaveform) => set({ disableWaveform })}
            label="Disable waveform animation"
          />
        </SettingRow>
        <SettingRow label="Disable glowing effects">
          <Toggle
            checked={appearance.disableGlow}
            onChange={(disableGlow) => set({ disableGlow })}
            label="Disable glowing effects"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Global voice overlay">
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
            value={settings?.overlayPosition ?? "top-center"}
            onChange={(overlayPosition) => update({ overlayPosition })}
            ariaLabel="Overlay position"
          />
        </SettingRow>
        <SettingRow label="Distance from top">
          <Slider
            value={appearance.overlayOffset}
            min={0}
            max={64}
            step={2}
            onChange={(overlayOffset) => set({ overlayOffset })}
            label="Overlay distance from top"
            format={(v) => `${v}px`}
          />
        </SettingRow>
        <SettingRow label="Overlay scale">
          <Slider
            value={appearance.overlayScale}
            min={85}
            max={115}
            step={5}
            onChange={(overlayScale) => set({ overlayScale })}
            label="Overlay scale"
            format={(v) => `${v}%`}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
