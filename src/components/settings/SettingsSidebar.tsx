import type { ReactNode } from "react";
import { SonareLogo } from "../overlay/SonareLogo";
import {
  BellIcon,
  InfoIcon,
  KeyboardIcon,
  PaletteIcon,
  PlugIcon,
  ShieldIcon,
  SlidersIcon,
} from "../Icons";

export type PageId =
  | "general"
  | "shortcuts"
  | "appearance"
  | "notifications"
  | "privacy"
  | "connect"
  | "about";

const NAV_ITEMS: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <SlidersIcon size={17} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <KeyboardIcon size={17} /> },
  { id: "appearance", label: "Appearance", icon: <PaletteIcon size={17} /> },
  {
    id: "notifications",
    label: "Notifications",
    icon: <BellIcon size={17} />,
  },
  { id: "privacy", label: "Privacy", icon: <ShieldIcon size={17} /> },
  { id: "connect", label: "Connect", icon: <PlugIcon size={17} /> },
  { id: "about", label: "About", icon: <InfoIcon size={17} /> },
];

interface SettingsSidebarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
}

export function SettingsSidebar({ page, onNavigate }: SettingsSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand" data-tauri-drag-region>
        <span className="sidebar-logo" data-tauri-drag-region>
          <SonareLogo size={36} />
        </span>
        <div className="sidebar-titles" data-tauri-drag-region>
          <span className="sidebar-app-name">ArcSonare</span>
          <span className="sidebar-app-sub">Sonare Desktop</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Settings sections">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${item.id === page ? " active" : ""}`}
            aria-current={item.id === page ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="running-dot" aria-hidden="true" />
        Running
      </div>
    </aside>
  );
}
