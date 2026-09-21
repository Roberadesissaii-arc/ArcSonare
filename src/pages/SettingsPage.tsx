import { SettingsSidebar } from "../components/settings/SettingsSidebar";
import { useAppState } from "../stores/appStore";
import { AccountSettingsPage } from "./settings/AccountSettingsPage";
import { GeneralSettingsPage } from "./settings/GeneralSettingsPage";
import { VoiceSettingsPage } from "./settings/VoiceSettingsPage";
import { ShortcutsSettingsPage } from "./settings/ShortcutsSettingsPage";
import { AppearanceSettingsPage } from "./settings/AppearanceSettingsPage";
import { SoundsSettingsPage } from "./settings/SoundsSettingsPage";
import { NotificationsSettingsPage } from "./settings/NotificationsSettingsPage";
import { DisplayMappingSettingsPage } from "./settings/DisplayMappingSettingsPage";
import { DataPrivacySettingsPage } from "./settings/DataPrivacySettingsPage";
import { ConversationLogsPage } from "./settings/ConversationLogsPage";
import { UpdatesSettingsPage } from "./settings/UpdatesSettingsPage";
import { AboutSettingsPage } from "./settings/AboutSettingsPage";

/**
 * Settings — same glass surfaces as Connect/Dashboard:
 * left rail + center workspace both use `.card.sonare-card`.
 */
export function SettingsPage() {
  const { settingsSection } = useAppState();

  return (
    <div className="settings-page">
      <header className="settings-shell-header">
        <div>
          <span className="settings-shell-kicker">Workspace</span>
          <h1 className="settings-shell-title">Settings</h1>
          <p className="settings-shell-subtitle">
            Configure ArcSonare — same glass panels as Connect and Dashboard
          </p>
        </div>
      </header>

      <div className="settings-page-body">
        {/* Left rail: identical card chrome to Connect left column */}
        <aside
          className="card sonare-card settings-sidebar"
          aria-label="Settings sections"
        >
          <SettingsSidebar active={settingsSection} />
        </aside>

        {/* Center workspace: same card chrome as Connect directory */}
        <section
          className="card sonare-card settings-content-card"
          data-settings-section={settingsSection}
        >
          <div className="settings-page-content">
            {settingsSection === "account" && <AccountSettingsPage />}
            {settingsSection === "general" && <GeneralSettingsPage />}
            {settingsSection === "voice" && <VoiceSettingsPage />}
            {settingsSection === "shortcuts" && <ShortcutsSettingsPage />}
            {settingsSection === "appearance" && <AppearanceSettingsPage />}
            {settingsSection === "sounds" && <SoundsSettingsPage />}
            {settingsSection === "notifications" && <NotificationsSettingsPage />}
            {settingsSection === "display-mapping" && <DisplayMappingSettingsPage />}
            {settingsSection === "data-privacy" && <DataPrivacySettingsPage />}
            {settingsSection === "conversation-logs" && <ConversationLogsPage />}
            {settingsSection === "updates" && <UpdatesSettingsPage />}
            {settingsSection === "about" && <AboutSettingsPage />}
          </div>
        </section>
      </div>
    </div>
  );
}
