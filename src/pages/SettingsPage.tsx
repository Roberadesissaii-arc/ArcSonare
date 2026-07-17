import type { ReactNode } from "react";
import {
  BellIcon,
  ChartIcon,
  ChevronRightIcon,
  DatabaseIcon,
  InfoIcon,
  KeyboardIcon,
  MonitorIcon,
  PaletteIcon,
  PlugIcon,
  SlidersIcon,
  UserIcon,
  VolumeIcon,
  WaveIcon,
} from "../components/Icons";
import {
  leaveSettings,
  navigateSettings,
  useAppState,
  type SettingsSection,
} from "../stores/appStore";
import { AccountSettingsPage } from "./settings/AccountSettingsPage";
import { GeneralSettingsPage } from "./settings/GeneralSettingsPage";
import { VoiceSettingsPage } from "./settings/VoiceSettingsPage";
import { ModelsSettingsPage } from "./settings/ModelsSettingsPage";
import { ShortcutsSettingsPage } from "./settings/ShortcutsSettingsPage";
import { ScreenContextSettingsPage } from "./settings/ScreenContextSettingsPage";
import { AppearanceSettingsPage } from "./settings/AppearanceSettingsPage";
import { SoundsSettingsPage } from "./settings/SoundsSettingsPage";
import { NotificationsSettingsPage } from "./settings/NotificationsSettingsPage";
import { DataPrivacySettingsPage } from "./settings/DataPrivacySettingsPage";
import { IntegrationsSettingsPage } from "./settings/IntegrationsSettingsPage";
import { AboutSettingsPage } from "./settings/AboutSettingsPage";

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "account", label: "Account", icon: <UserIcon size={17} /> },
  { id: "general", label: "General", icon: <SlidersIcon size={17} /> },
  { id: "voice", label: "Voice", icon: <WaveIcon size={17} /> },
  { id: "models", label: "Models", icon: <ChartIcon size={17} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <KeyboardIcon size={17} /> },
  { id: "screen-context", label: "Screen Context", icon: <MonitorIcon size={17} /> },
  { id: "appearance", label: "Appearance", icon: <PaletteIcon size={17} /> },
  { id: "sounds", label: "Sounds", icon: <VolumeIcon size={17} /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon size={17} /> },
  { id: "data-privacy", label: "Data & Privacy", icon: <DatabaseIcon size={17} /> },
  { id: "integrations", label: "Integrations", icon: <PlugIcon size={17} /> },
  { id: "about", label: "About", icon: <InfoIcon size={17} /> },
];

/**
 * Settings inside the main Command Center window. The internal left
 * navigation switches sections; the last visited section is remembered so
 * the header gear returns to it. Back returns to the previous main page.
 */
export function SettingsPage() {
  const { settingsSection, pageBeforeSettings } = useAppState();

  return (
    <div className="settings-page">
      <nav className="settings-page-nav" aria-label="Settings sections">
        <button
          type="button"
          className="settings-back"
          onClick={leaveSettings}
          aria-label={`Back to ${pageBeforeSettings}`}
        >
          <span className="settings-back-chevron" aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
          Back
        </button>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${item.id === settingsSection ? " active" : ""}`}
            aria-current={item.id === settingsSection ? "page" : undefined}
            onClick={() => navigateSettings(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings-page-content">
        {settingsSection === "account" && <AccountSettingsPage />}
        {settingsSection === "general" && <GeneralSettingsPage />}
        {settingsSection === "voice" && <VoiceSettingsPage />}
        {settingsSection === "models" && <ModelsSettingsPage />}
        {settingsSection === "shortcuts" && <ShortcutsSettingsPage />}
        {settingsSection === "screen-context" && <ScreenContextSettingsPage />}
        {settingsSection === "appearance" && <AppearanceSettingsPage />}
        {settingsSection === "sounds" && <SoundsSettingsPage />}
        {settingsSection === "notifications" && <NotificationsSettingsPage />}
        {settingsSection === "data-privacy" && <DataPrivacySettingsPage />}
        {settingsSection === "integrations" && <IntegrationsSettingsPage />}
        {settingsSection === "about" && <AboutSettingsPage />}
      </div>
    </div>
  );
}
