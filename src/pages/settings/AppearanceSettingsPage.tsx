import { useMemo, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { Toggle } from "../../components/settings/Toggle";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { ColorPicker } from "../../components/settings/ColorPicker";
import { Slider } from "../../components/settings/Slider";
import { useSettings } from "../../hooks/useSettings";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";
import type { ThemePreference } from "../../types";
import type { AccentMode, Density } from "../../config/prefs";
import {
  BACKGROUND_LIBRARY,
  BUILTIN_BACKGROUND_PREFIX,
  type BackgroundOption,
} from "../../config/backgroundLibrary";
import { CheckIcon } from "../../components/Icons";

function groupBackgrounds(options: BackgroundOption[]) {
  const map = new Map<string, BackgroundOption[]>();
  for (const option of options) {
    const key = option.group ?? "Gallery";
    const list = map.get(key) ?? [];
    list.push(option);
    map.set(key, list);
  }
  // Signature first, then gallery
  const order = ["Signature", "Gallery"];
  return order
    .filter((k) => map.has(k))
    .map((k) => [k, map.get(k)!] as const)
    .concat(
      [...map.entries()].filter(([k]) => !order.includes(k)) as [
        string,
        BackgroundOption[],
      ][],
    );
}

export function AppearanceSettingsPage() {
  const { settings, update } = useSettings();
  const prefs = usePrefs();
  const appearance = prefs.appearance;
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  const set = (patch: Partial<typeof appearance>) => patchPrefs("appearance", patch);

  const selectedBuiltinId = appearance.customBackgroundPath.startsWith(
    BUILTIN_BACKGROUND_PREFIX,
  )
    ? appearance.customBackgroundPath.slice(BUILTIN_BACKGROUND_PREFIX.length)
    : null;
  const customFilePath =
    appearance.customBackgroundPath &&
    !appearance.customBackgroundPath.startsWith(BUILTIN_BACKGROUND_PREFIX)
      ? appearance.customBackgroundPath
      : null;

  const groups = useMemo(() => groupBackgrounds(BACKGROUND_LIBRARY), []);

  const chooseBuiltin = async (id: string) => {
    setBackgroundBusy(true);
    try {
      if (customFilePath) await invoke("clear_background_image");
      set({ customBackgroundPath: `${BUILTIN_BACKGROUND_PREFIX}${id}` });
    } catch (err) {
      console.error("[ArcSonare] failed to select background image:", err);
    } finally {
      setBackgroundBusy(false);
    }
  };

  const chooseFromComputer = async () => {
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
      if (customFilePath) await invoke("clear_background_image");
      set({ customBackgroundPath: "" });
    } catch (err) {
      console.error("[ArcSonare] failed to reset background image:", err);
    } finally {
      setBackgroundBusy(false);
    }
  };

  return (
    <div className="page appearance-settings-page">
      <SettingsPageHeader
        title="Appearance"
        description="Theme, wallpapers, density, and motion — changes apply immediately."
      />

      <SettingsGroup
        title="Background"
        description={`${BACKGROUND_LIBRARY.length} wallpapers · compact tiles · scroll smoothly`}
        className="is-background-gallery"
      >
        <div className="background-picker-section">
          {groups.map(([groupName, options]) => (
            <div key={groupName} className="background-picker-group">
              <p className="background-picker-group-label">{groupName}</p>
              <div className="background-picker-gallery">
                {options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`background-picker-option${
                      selectedBuiltinId === option.id ? " is-selected" : ""
                    }`}
                    onClick={() => void chooseBuiltin(option.id)}
                    disabled={backgroundBusy}
                    aria-pressed={selectedBuiltinId === option.id}
                    title={option.label}
                  >
                    <img
                      src={option.src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    {selectedBuiltinId === option.id ? (
                      <span className="background-picker-option-check">
                        <CheckIcon size={11} />
                      </span>
                    ) : null}
                    <span className="background-picker-option-label">
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="background-picker-actions">
            {customFilePath ? (
              <img
                className="background-picker-thumb"
                src={convertFileSrc(customFilePath)}
                alt="Current custom background"
              />
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => void chooseFromComputer()}
              disabled={backgroundBusy}
            >
              Choose from computer…
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
            <span className="background-picker-meta">
              {selectedBuiltinId
                ? "Built-in wallpaper active"
                : customFilePath
                  ? "Custom wallpaper active"
                  : "Using default atmosphere"}
            </span>
          </div>
        </div>
      </SettingsGroup>

      <div className="settings-card-grid">
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
          <SettingRow label="Accent color">
            <ColorPicker
              value={appearance.accentColor || "violet"}
              onChange={(accentColor) => set({ accent: "violet", accentColor })}
            />
          </SettingRow>
          <SettingRow label="Accent mode">
            <SegmentedControl<AccentMode>
              options={[
                { value: "violet", label: "Colored" },
                { value: "monochrome", label: "Mono" },
              ]}
              value={appearance.accent}
              onChange={(accent) => set({ accent })}
              ariaLabel="Accent mode"
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Density">
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
          <SettingRow label="Card contrast">
            <Slider
              value={appearance.cardContrast}
              min={0}
              max={100}
              onChange={(cardContrast) => set({ cardContrast })}
              label="Card contrast"
              format={(v) => `${v}%`}
            />
          </SettingRow>
          <SettingRow label="Transparency">
            <Slider
              value={appearance.transparency}
              min={0}
              max={100}
              onChange={(transparency) => set({ transparency })}
              label="Transparency strength"
              format={(v) => `${v}%`}
            />
          </SettingRow>
          <SettingRow label="Background blur">
            <Toggle
              checked={appearance.backgroundBlur}
              onChange={(backgroundBlur) => set({ backgroundBlur })}
              label="Background blur"
            />
          </SettingRow>
        </SettingsGroup>
      </div>

      <SettingsGroup title="Motion and effects">
        <SettingRow label="Reduced motion">
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
        <SettingRow label="Disable glow effects">
          <Toggle
            checked={appearance.disableGlow}
            onChange={(disableGlow) => set({ disableGlow })}
            label="Disable glow effects"
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
