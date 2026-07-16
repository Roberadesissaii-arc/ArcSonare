import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArcSonareLogo } from "../components/brand/ArcSonareLogo";
import {
  BellIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
  WaveIcon,
} from "../components/Icons";
import { openPalette, useAppState } from "../stores/appStore";
import { toggleVoice, useVoiceState } from "../stores/voiceStore";
import { MainNavigation } from "./MainNavigation";

interface AppHeaderProps {
  onCreateTask: () => void;
}

/** Brand · primary navigation · search + quick actions. */
export function AppHeader({ onCreateTask }: AppHeaderProps) {
  const voiceState = useVoiceState();
  const { activity } = useAppState();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Close the notifications popover on outside click or Escape.
  useEffect(() => {
    if (!notificationsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [notificationsOpen]);

  const openSettings = () => {
    invoke("open_settings").catch((err) =>
      console.error("[ArcSonare] failed to open settings:", err),
    );
  };

  const voiceActive = voiceState !== "ready";

  return (
    <div className="app-header">
      <div className="header-brand">
        <span className="header-logo">
          <ArcSonareLogo size={44} title="ArcSonare" />
        </span>
        <span className="header-wordmark">ArcSonare</span>
      </div>

      <MainNavigation />

      <div className="header-actions">
        <button
          type="button"
          className="header-search"
          onClick={openPalette}
          aria-label="Search or ask ArcSonare"
        >
          <SearchIcon size={15} />
          <span className="header-search-placeholder">
            Search or ask ArcSonare...
          </span>
          <span className="header-search-hint" aria-hidden="true">
            Ctrl K
          </span>
        </button>

        <button
          type="button"
          className="header-action"
          onClick={onCreateTask}
          aria-label="Create a task"
          title="Create task"
        >
          <PlusIcon size={18} />
        </button>
        <button
          type="button"
          className={`header-action${voiceActive ? " voice-active" : ""}`}
          onClick={toggleVoice}
          aria-label="Toggle voice mode"
          aria-pressed={voiceActive}
          title="Voice"
        >
          <WaveIcon size={18} />
        </button>

        <div className="header-notifications" ref={notificationsRef}>
          <button
            type="button"
            className="header-action"
            onClick={() => setNotificationsOpen((v) => !v)}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            title="Notifications"
          >
            <BellIcon size={18} />
          </button>
          {notificationsOpen ? (
            <div className="notifications-popover" role="dialog" aria-label="Notifications">
              <div className="popover-title">Notifications</div>
              {activity.length === 0 ? (
                <p className="popover-empty">
                  Nothing yet. ArcSonare activity will appear here.
                </p>
              ) : (
                <ul className="popover-list">
                  {activity.slice(0, 6).map((entry) => (
                    <li key={entry.id} className="popover-item">
                      <span className="popover-item-text">{entry.text}</span>
                      <span className="popover-item-time">
                        {new Date(entry.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="header-action"
          onClick={openSettings}
          aria-label="Open ArcSonare settings"
          title="Settings"
        >
          <GearIcon size={18} />
        </button>
      </div>
    </div>
  );
}
