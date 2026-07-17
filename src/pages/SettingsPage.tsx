import { SettingsSidebar } from "../components/settings/SettingsSidebar";
import { useAppState } from "../stores/appStore";
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

/**
 * Settings inside the main Command Center window.
 * Sidebar + content; last visited section is remembered for the header gear.
 */
export function SettingsPage() {
  const { settingsSection } = useAppState();

  return (
    <div className="settings-page">
      <SettingsSidebar active={settingsSection} />
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
