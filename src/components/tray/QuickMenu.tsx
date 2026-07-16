import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { useAppearance } from "../../hooks/useTheme";
import { shortcutKeys } from "../../services/shortcutFormat";
import { ArcSonareLogo } from "../brand/ArcSonareLogo";
import {
  ArrowUpIcon,
  GearIcon,
  HelpIcon,
  LayoutIcon,
  MessageIcon,
  PowerIcon,
  RefreshIcon,
} from "../Icons";

function command(name: string) {
  invoke(name).catch((err) =>
    console.error(`[ArcSonare] quick menu command '${name}' failed:`, err),
  );
}

interface ItemProps {
  icon: ReactNode;
  label: string;
  hint?: string;
  onSelect: () => void;
}

function MenuItem({ icon, label, hint, onSelect }: ItemProps) {
  return (
    <button type="button" className="qm-item" onClick={onSelect}>
      <span className="qm-item-icon">{icon}</span>
      <span className="qm-item-label">{label}</span>
      {hint ? <span className="qm-item-hint">{hint}</span> : null}
    </button>
  );
}

/** The custom ArcSonare quick menu opened by left-clicking the tray icon. */
export function QuickMenu() {
  const { settings } = useSettings();
  useAppearance(settings, { applyTheme: true });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") command("hide_quick_menu");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const shortcutHint = shortcutKeys(
    settings?.globalShortcut ?? "Ctrl+Shift+Space",
  ).join("+");

  return (
    <div className="qm-shell">
      <div className="qm-panel">
        <div className="qm-header">
          <span className="qm-logo">
            <ArcSonareLogo size={34} />
          </span>
          <div className="qm-titles">
            <span className="qm-name">ArcSonare</span>
            <span className="qm-status">
              <span className="qm-status-dot" aria-hidden="true" />
              Ready
            </span>
          </div>
        </div>

        <div className="qm-items">
          <MenuItem
            icon={<LayoutIcon size={16} />}
            label="Open Command Center"
            onSelect={() => command("show_main_window")}
          />
          <MenuItem
            icon={<ArrowUpIcon size={16} />}
            label="Show ArcSonare"
            hint={shortcutHint}
            onSelect={() => command("show_overlay")}
          />
          <MenuItem
            icon={<GearIcon size={16} />}
            label="Settings"
            onSelect={() => command("open_settings")}
          />
          <MenuItem
            icon={<RefreshIcon size={16} />}
            label="Check for updates"
            onSelect={() =>
              setToast("Updates are installed manually in this phase.")
            }
          />
          <MenuItem
            icon={<MessageIcon size={16} />}
            label="Send feedback"
            onSelect={() => setToast("Feedback arrives in a later phase.")}
          />
          <MenuItem
            icon={<HelpIcon size={16} />}
            label="Help"
            onSelect={() => setToast("Help arrives in a later phase.")}
          />

          <div className="qm-divider" role="separator" />

          <MenuItem
            icon={<PowerIcon size={16} />}
            label="Quit ArcSonare"
            onSelect={() => command("quit_app")}
          />
        </div>

        {toast ? (
          <div className="qm-toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}
