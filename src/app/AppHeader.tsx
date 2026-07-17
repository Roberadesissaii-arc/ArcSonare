import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArcSonareLogo } from "../components/brand/ArcSonareLogo";
import {
  BellIcon,
  BotIcon,
  GearIcon,
  InfoIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  WaveIcon,
} from "../components/Icons";
import {
  markNotificationsRead,
  navigate,
  openPalette,
  useAppState,
  type ActivityEntry,
} from "../stores/appStore";
import { useVoiceState } from "../stores/voiceStore";
import { MainNavigation } from "./MainNavigation";

interface AppHeaderProps {
  onCreateTask: () => void;
}

type NotificationFilter = "all" | "tasks" | "agent" | "system";

const NOTIFICATION_FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tasks", label: "Tasks" },
  { id: "agent", label: "Agent" },
  { id: "system", label: "System" },
];

const SOURCE_LABELS: Record<ActivityEntry["source"], string> = {
  command: "Command",
  voice: "Voice",
  task: "Task update",
  agent: "Agent update",
  system: "System",
};

function matchesFilter(entry: ActivityEntry, filter: NotificationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tasks") return entry.source === "task";
  if (filter === "agent") return entry.source === "agent";
  return entry.source === "system";
}

function sourceIcon(source: ActivityEntry["source"]) {
  if (source === "task") return <ListIcon size={14} />;
  if (source === "agent") return <BotIcon size={14} />;
  if (source === "voice") return <WaveIcon size={14} />;
  if (source === "command") return <SearchIcon size={14} />;
  return <InfoIcon size={14} />;
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Brand · primary navigation · search + quick actions. */
export function AppHeader({ onCreateTask }: AppHeaderProps) {
  const { status, isOverlayVisible } = useVoiceState();
  const { activity, page, notificationsReadAt } = useAppState();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>("all");
  const notificationsRef = useRef<HTMLDivElement>(null);

  const hasUnread = activity.some((entry) => entry.at > notificationsReadAt);
  const visibleNotifications = activity
    .filter((entry) => matchesFilter(entry, notificationFilter))
    .slice(0, 12);

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

  // Settings is a route inside this window, not a separate native window.
  const openSettings = () => navigate("settings");

  // Voice activation lives in the global overlay window — press again to close.
  const toggleVoiceOverlay = () => {
    invoke("toggle_overlay_cmd").catch((err) =>
      console.error("[ArcSonare] failed to toggle voice overlay:", err),
    );
  };

  const voiceActive = status !== "idle" || isOverlayVisible;

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
          onClick={toggleVoiceOverlay}
          aria-label={voiceActive ? "Deactivate voice mode" : "Activate voice mode"}
          title={voiceActive ? "Stop voice" : "Voice"}
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
            {hasUnread ? <span className="header-unread-dot" aria-hidden="true" /> : null}
          </button>
          {notificationsOpen ? (
            <div className="notifications-popover" role="dialog" aria-label="Notifications">
              <div className="popover-head">
                <span className="popover-title">Notifications</span>
                <button
                  type="button"
                  className="popover-mark-read"
                  onClick={markNotificationsRead}
                  disabled={!hasUnread}
                >
                  Mark all as read
                </button>
              </div>

              <div className="popover-filters" role="tablist" aria-label="Filter notifications">
                {NOTIFICATION_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    role="tab"
                    aria-selected={notificationFilter === filter.id}
                    className={`popover-filter${notificationFilter === filter.id ? " active" : ""}`}
                    onClick={() => setNotificationFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {visibleNotifications.length === 0 ? (
                <p className="popover-empty">
                  Nothing here yet. ArcSonare activity will appear as it happens.
                </p>
              ) : (
                <ul className="popover-list">
                  {visibleNotifications.map((entry) => (
                    <li key={entry.id}>
                      <button type="button" className="popover-item">
                        <span className="popover-item-icon">{sourceIcon(entry.source)}</span>
                        <span className="popover-item-meta">
                          <span className="popover-item-title">
                            {SOURCE_LABELS[entry.source]}
                          </span>
                          <span className="popover-item-text">{entry.text}</span>
                        </span>
                        <span className="popover-item-side">
                          <span className="popover-item-time">{relativeTime(entry.at)}</span>
                          {entry.at > notificationsReadAt ? (
                            <span className="popover-item-unread" aria-label="Unread" />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={`header-action${page === "settings" ? " settings-active" : ""}`}
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
