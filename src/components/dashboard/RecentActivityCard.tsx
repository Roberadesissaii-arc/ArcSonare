import { BotIcon, ListIcon, MicIcon, PlugIcon, ZapIcon } from "../Icons";
import { navigate, useAppState, type ActivityEntry } from "../../stores/appStore";

function relativeTime(at: number): string {
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

function activityIcon(source: ActivityEntry["source"]) {
  if (source === "task") return <ListIcon size={13} />;
  if (source === "agent") return <BotIcon size={13} />;
  if (source === "command") return <ZapIcon size={13} />;
  if (source === "voice") return <MicIcon size={13} />;
  return <PlugIcon size={13} />;
}

function titleFor(entry: ActivityEntry): string {
  if (entry.source === "task") return "Task update";
  if (entry.source === "agent") return "Agent update";
  if (entry.source === "voice") return "Voice action";
  if (entry.source === "command") return "Command";
  return "System";
}

function openActivity(entry: ActivityEntry) {
  if (entry.source === "task") navigate("tasks");
  else if (entry.source === "agent") navigate("agent");
  else navigate("connect");
}

const DEMO_FALLBACK: ActivityEntry[] = [
  {
    id: "demo-1",
    text: "Launch briefing preparation",
    source: "task",
    at: Date.now() - 4 * 60_000,
  },
  {
    id: "demo-2",
    text: "Research summary ready",
    source: "agent",
    at: Date.now() - 12 * 60_000,
  },
  {
    id: "demo-3",
    text: "Google Calendar",
    source: "system",
    at: Date.now() - 28 * 60_000,
  },
];

/** Third right-column card — local activity feed. */
export function RecentActivityCard() {
  const { activity } = useAppState();
  // Fits the bottom side-column card with footer visible.
  const items = (activity.length ? activity : DEMO_FALLBACK).slice(0, 2);

  return (
    <section className="card sonare-card activity-card">
      <div className="card-head">
        <span className="card-label">Recent Activity</span>
      </div>
      <ul className="activity-list">
        {items.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="activity-row"
              onClick={() => openActivity(entry)}
              aria-label={`${titleFor(entry)}: ${entry.text}`}
            >
              <span className="activity-icon" aria-hidden="true">
                {activityIcon(entry.source)}
              </span>
              <span className="activity-meta">
                <span className="activity-title">{titleFor(entry)}</span>
                <span className="activity-sub">{entry.text}</span>
              </span>
              <span className="activity-time">{relativeTime(entry.at)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="card-footer-link"
        onClick={() => navigate("agent")}
      >
        View activity →
      </button>
    </section>
  );
}
