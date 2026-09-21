import { useMemo } from "react";
import { navigate } from "../../stores/appStore";
import { ClockIcon } from "../Icons";
import { EmptyState } from "../EmptyState";
import {
  integrationIcons,
  type IntegrationId,
} from "../../config/iconRegistry";
import { filterTasks, useTasks, type Task } from "../../stores/taskStore";

/** Match place / agent / title text → brand icon (only when we know the app). */
const PLACE_MATCHES: { id: IntegrationId; label: string; pattern: RegExp }[] = [
  { id: "zoom", label: "Zoom", pattern: /\bzoom\b/i },
  { id: "teams", label: "Teams", pattern: /\b(?:microsoft\s+)?teams\b/i },
  { id: "slack", label: "Slack", pattern: /\bslack\b/i },
  { id: "googleMeet", label: "Google Meet", pattern: /\b(?:google\s+)?meet\b/i },
  { id: "googleCalendar", label: "Calendar", pattern: /\b(?:google\s+)?calendar\b|\bgcal\b/i },
  { id: "gmail", label: "Gmail", pattern: /\bgmail\b|\bemail\b/i },
  { id: "outlook", label: "Outlook", pattern: /\boutlook\b/i },
  { id: "figma", label: "Figma", pattern: /\bfigma\b/i },
  { id: "notion", label: "Notion", pattern: /\bnotion\b/i },
  { id: "github", label: "GitHub", pattern: /\bgithub\b/i },
  { id: "discord", label: "Discord", pattern: /\bdiscord\b/i },
  { id: "linear", label: "Linear", pattern: /\blinear\b/i },
  { id: "trello", label: "Trello", pattern: /\btrello\b/i },
  { id: "clickup", label: "ClickUp", pattern: /\bclick\s*up\b/i },
  { id: "todoist", label: "Todoist", pattern: /\btodoist\b/i },
  { id: "spotify", label: "Spotify", pattern: /\bspotify\b/i },
  { id: "loom", label: "Loom", pattern: /\bloom\b/i },
  { id: "onenote", label: "OneNote", pattern: /\bonenote\b|\bone\s+note\b/i },
  { id: "googleDrive", label: "Drive", pattern: /\b(?:google\s+)?drive\b/i },
  { id: "onedrive", label: "OneDrive", pattern: /\bonedrive\b|\bone\s+drive\b/i },
  { id: "dropbox", label: "Dropbox", pattern: /\bdropbox\b/i },
];

function placeForTask(task: Task): { label: string; iconSrc?: string } {
  const haystack = [task.agent, task.title, ...(task.tags ?? [])]
    .filter(Boolean)
    .join(" · ");

  for (const entry of PLACE_MATCHES) {
    if (entry.pattern.test(haystack)) {
      return {
        label: task.agent?.trim() || entry.label,
        iconSrc: integrationIcons[entry.id],
      };
    }
  }

  if (task.agent?.trim()) {
    return { label: task.agent.trim() };
  }
  if (task.urgent) {
    return { label: "Urgent" };
  }
  return { label: "Task" };
}

/**
 * Upcoming schedule from real tasks (today / upcoming). Empty when none.
 * Shows a brand icon next to the place when we can resolve one (e.g. Zoom).
 */
export function UpNextCard() {
  const tasks = useTasks();
  const events = useMemo(() => {
    const today = filterTasks(tasks, "today");
    const upcoming = filterTasks(tasks, "upcoming");
    const open = filterTasks(tasks, "open");
    const merged = [
      ...today,
      ...upcoming,
      ...open.filter(
        (t) =>
          !today.some((x) => x.id === t.id) &&
          !upcoming.some((x) => x.id === t.id),
      ),
    ];
    return merged.slice(0, 3);
  }, [tasks]);

  return (
    <section className="card sonare-card upnext-card">
      <div className="card-head">
        <span className="card-label">Up Next</span>
      </div>
      <p className="card-lede">What’s coming up next on your schedule.</p>
      {events.length === 0 ? (
        <EmptyState
          icon={<ClockIcon size={23} />}
          title="No upcoming tasks"
          description="Create a task and it will appear here."
          compact
        />
      ) : (
        <ul className="upnext-list">
          {events.map((task) => {
            const place = placeForTask(task);
            const due = dueDisplay(task);
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className="upnext-row"
                  onClick={() => navigate("tasks")}
                  aria-label={`Open task: ${task.title}`}
                >
                  <span className="upnext-time" title={task.due?.trim() || due.primary}>
                    <span className="upnext-time-primary">{due.primary}</span>
                    {due.secondary ? (
                      <span className="upnext-time-secondary">{due.secondary}</span>
                    ) : null}
                  </span>
                  <span className="upnext-meta">
                    <span className="upnext-title">{task.title}</span>
                    <span className="upnext-place">
                      {place.iconSrc ? (
                        <img
                          src={place.iconSrc}
                          alt=""
                          width={14}
                          height={14}
                          draggable={false}
                        />
                      ) : null}
                      <span className="upnext-place-text">{place.label}</span>
                    </span>
                  </span>
                  <span className="upnext-dot" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

type DueDisplay = { primary: string; secondary?: string };

function calendarDayOffset(date: Date): number {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function dueDisplay(task: Task): DueDisplay {
  const raw = task.due?.trim();
  if (!raw) {
    if (task.dueBucket === "today") return { primary: "Today" };
    if (task.dueBucket === "upcoming") return { primary: "Soon" };
    return { primary: "Open" };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const offset = calendarDayOffset(parsed);
    const primary =
      offset === 0
        ? "Today"
        : offset === 1
          ? "Tomorrow"
          : offset > 1 && offset < 7
            ? parsed.toLocaleDateString([], { weekday: "short" })
            : parsed.toLocaleDateString([], { month: "short", day: "numeric" });
    const hasExplicitTime = /T\d{1,2}:\d{2}|\d{1,2}:\d{2}/.test(raw);
    return {
      primary,
      secondary: hasExplicitTime
        ? parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : undefined,
    };
  }

  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    return { primary: parts[0], secondary: parts.slice(1).join(", ") };
  }
  const commonLabel = ["today", "tomorrow", "soon", "open"].find(
    (label) => label === raw.toLowerCase(),
  );
  if (commonLabel) {
    return { primary: commonLabel[0].toUpperCase() + commonLabel.slice(1) };
  }
  return { primary: raw };
}
