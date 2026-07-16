import { useState, type ReactNode } from "react";
import { useSettings } from "../hooks/useSettings";
import {
  BellIcon,
  InfoIcon,
  KeyboardIcon,
  PaletteIcon,
  PlugIcon,
  ShieldIcon,
  SlidersIcon,
} from "../components/Icons";
import { GeneralPage } from "../components/settings/pages/GeneralPage";
import { ShortcutsPage } from "../components/settings/pages/ShortcutsPage";
import { AppearancePage } from "../components/settings/pages/AppearancePage";
import { NotificationsPage } from "../components/settings/pages/NotificationsPage";
import { PrivacyPage } from "../components/settings/pages/PrivacyPage";
import { ConnectPage } from "../components/settings/pages/ConnectPage";
import { AboutPage } from "../components/settings/pages/AboutPage";

type SectionId =
  | "general"
  | "shortcuts"
  | "appearance"
  | "notifications"
  | "privacy"
  | "connect"
  | "about";

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <SlidersIcon size={17} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <KeyboardIcon size={17} /> },
  { id: "appearance", label: "Appearance", icon: <PaletteIcon size={17} /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon size={17} /> },
  { id: "privacy", label: "Privacy", icon: <ShieldIcon size={17} /> },
  { id: "connect", label: "Connect", icon: <PlugIcon size={17} /> },
  { id: "about", label: "About", icon: <InfoIcon size={17} /> },
];

/**
 * Settings as a page inside the main Command Center window (opened by the
 * header gear, tray and quick menu — never a separate native window). The
 * internal left navigation switches sections; each section reuses the
 * shared setting-row components and design tokens.
 */
export function SettingsPage() {
  const { settings, update } = useSettings();
  const [section, setSection] = useState<SectionId>("general");

  return (
    <div className="settings-page">
      <nav className="settings-page-nav" aria-label="Settings sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${item.id === section ? " active" : ""}`}
            aria-current={item.id === section ? "page" : undefined}
            onClick={() => setSection(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings-page-content">
        {settings ? (
          <>
            {section === "general" && (
              <GeneralPage settings={settings} update={update} />
            )}
            {section === "shortcuts" && <ShortcutsPage settings={settings} />}
            {section === "appearance" && (
              <AppearancePage settings={settings} update={update} />
            )}
            {section === "notifications" && (
              <NotificationsPage settings={settings} update={update} />
            )}
            {section === "privacy" && <PrivacyPage />}
            {section === "connect" && <ConnectPage />}
            {section === "about" && <AboutPage />}
          </>
        ) : null}
      </div>
    </div>
  );
}
