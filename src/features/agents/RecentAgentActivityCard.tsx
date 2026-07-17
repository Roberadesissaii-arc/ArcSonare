import { relativeTime } from "./agentHealth";
import type { AgentActivity } from "./agentTypes";
import type { AgentConfig } from "./agentStore";

interface RecentAgentActivityCardProps {
  agents: AgentConfig[];
  onViewAll?: () => void;
}

export function RecentAgentActivityCard({
  agents,
  onViewAll,
}: RecentAgentActivityCardProps) {
  const events: (AgentActivity & { agentName: string })[] = agents
    .flatMap((a) =>
      a.activity.map((ev) => ({ ...ev, agentName: a.name })),
    )
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    .slice(0, 7);

  return (
    <section className="agent-rail-card agent-surface" aria-label="Recent activity">
      <div className="agent-rail-head">
        <span className="agent-rail-label">Recent activity</span>
        {onViewAll ? (
          <button type="button" className="agent-rail-link" onClick={onViewAll}>
            View all
          </button>
        ) : null}
      </div>
      {events.length === 0 ? (
        <p className="agent-rail-empty">
          Agent activity will appear here after agents begin working.
        </p>
      ) : (
        <ul className="agent-activity-list">
          {events.map((ev) => (
            <li key={ev.id} className={`is-${ev.status}`}>
              <span className="agent-activity-dot" aria-hidden="true" />
              <div className="agent-activity-body">
                <strong>{ev.agentName}</strong>
                <span>{ev.summary || ev.title}</span>
              </div>
              <time dateTime={ev.createdAt}>
                {relativeTime(Date.parse(ev.createdAt))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
