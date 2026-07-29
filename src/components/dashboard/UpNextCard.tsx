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
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className="upnext-row"
                  onClick={() => navigate("tasks")}
                  aria-label={`Open task: ${task.title}`}
                >
                  <span className="upnext-time">{dueLabel(task)}</span>
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

function dueLabel(task: Task): string {
  if (task.due?.trim()) return task.due.trim();
  if (task.dueBucket === "today") return "Today";
  if (task.dueBucket === "upcoming") return "Soon";
  return "Open";
}
