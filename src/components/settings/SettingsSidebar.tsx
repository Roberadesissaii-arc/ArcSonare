import type { ReactNode } from "react";
import {
  BellIcon,
  CpuIcon,
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
import { PlanCard } from "./PlanCard";

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "account", label: "Account", icon: <UserIcon size={18} /> },
  { id: "general", label: "General", icon: <SlidersIcon size={18} /> },
  { id: "voice", label: "Voice", icon: <WaveIcon size={18} /> },
  { id: "models", label: "Models", icon: <CpuIcon size={18} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <KeyboardIcon size={18} /> },
  { id: "screen-context", label: "Screen Context", icon: <MonitorIcon size={18} /> },
  { id: "appearance", label: "Appearance", icon: <PaletteIcon size={18} /> },
  { id: "sounds", label: "Sounds", icon: <VolumeIcon size={18} /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon size={18} /> },
  { id: "data-privacy", label: "Data & Privacy", icon: <ShieldIcon size={18} /> },
  { id: "integrations", label: "Integrations", icon: <PlugIcon size={18} /> },
  { id: "about", label: "About", icon: <InfoIcon size={18} /> },
];

interface SettingsSidebarProps {
  active: SettingsSection;
}

/** Compact Settings section navigation with honest plan card. */
export function SettingsSidebar({ active }: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar" aria-label="Settings sections">
      <nav className="settings-sidebar-nav">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item${item.id === active ? " active" : ""}`}
            aria-current={item.id === active ? "page" : undefined}
            onClick={() => navigateSettings(item.id)}
          >
            <span className="settings-nav-icon">{item.icon}</span>
            <span className="settings-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-sidebar-footer">
        <PlanCard kind="local" />
      </div>
    </aside>
  );
}
