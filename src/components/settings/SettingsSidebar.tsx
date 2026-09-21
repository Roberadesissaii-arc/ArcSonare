import type { ReactNode } from "react";
import {
  BellIcon,
  InfoIcon,
  KeyboardIcon,
  MonitorIcon,
  PaletteIcon,
  PlugIcon,
  ShieldIcon,
  SlidersIcon,
  UserIcon,
  VolumeIcon,
  WaveIcon,
} from "../Icons";
import {
  navigateSettings,
  type SettingsSection,
} from "../../stores/appStore";

import { ScrollText } from "lucide-react";

const SETTINGS_SECTIONS: {
  label: string;
  items: { id: SettingsSection; label: string; icon: ReactNode }[];
}[] = [
  {
    label: "Account",
    items: [{ id: "account", label: "Account", icon: <UserIcon size={15} /> }],
  },
  {
    label: "Chat & AI",
    items: [
      { id: "voice", label: "Voice & AI keys", icon: <WaveIcon size={15} /> },
    ],
  },
  {
    label: "Personalization",
    items: [
      { id: "general", label: "General", icon: <SlidersIcon size={15} /> },
      { id: "appearance", label: "Appearance", icon: <PaletteIcon size={15} /> },
      { id: "shortcuts", label: "Shortcuts", icon: <KeyboardIcon size={15} /> },
      { id: "sounds", label: "Sounds", icon: <VolumeIcon size={15} /> },
    ],
  },
  {
    label: "Desktop Interaction",
    items: [
      {
        id: "display-mapping",
        label: "Display Mapping",
        icon: <MonitorIcon size={15} />,
      },
    ],
  },
  {
    label: "System",
    items: [
      { id: "notifications", label: "Notifications", icon: <BellIcon size={15} /> },
      { id: "data-privacy", label: "Data & Privacy", icon: <ShieldIcon size={15} /> },
      { id: "conversation-logs", label: "Conversation Logs", icon: <ScrollText size={15} /> },
      { id: "updates", label: "Updates", icon: <PlugIcon size={15} /> },
      { id: "about", label: "About", icon: <InfoIcon size={15} /> },
    ],
  },
];

interface SettingsSidebarProps {
  active: SettingsSection;
}

/**
 * Left rail nav — same interaction language as Connect rail filters
 * (heading + pill rows). Parent provides `.card.sonare-card` chrome.
 */
export function SettingsSidebar({ active }: SettingsSidebarProps) {
  return (
    <nav className="settings-sidebar-nav" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map((section, si) => (
        <div key={section.label} className="settings-nav-group">
          <span
            className={`settings-nav-group-label${si === 0 ? " is-first" : ""}`}
          >
            {section.label}
          </span>
          <div className="settings-nav-group-items">
            {section.items.map((item) => {
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => navigateSettings(item.id)}
                >
                  <span className="settings-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="settings-nav-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
