import type { AgentConfig } from "./agentStore";
import { deriveAgentHealth, healthLabel } from "./agentHealth";
import type { Task } from "../../stores/taskStore";
import { tasksForAgent } from "./agentSelectors";
import { BotIcon, ChartIcon, ListIcon } from "../../components/Icons";
import { EmptyState } from "../../components/EmptyState";

interface AgentAnalyticsRowProps {
  agents: AgentConfig[];
  tasks: Task[];
}

export function AgentAnalyticsRow({ agents, tasks }: AgentAnalyticsRowProps) {
  const assigned = tasks.filter((t) => Boolean(t.agent));
  const byAgent = agents
    .map((a) => ({
      agent: a,
      count: tasksForAgent(tasks, a).length,
    }))
    .filter((x) => x.count > 0);
  const unassigned = tasks.length - assigned.length;
  const total = tasks.length;
  const hasHistory = agents.some((a) =>
    a.metrics.lastSevenDays.some((d) => d.tasksCompleted > 0 || (d.utilizationPercent ?? 0) > 0),
  );

  const colors = ["#9565FF", "#5995F2", "#43BCD3", "#737C83"];

  return (
    <div className="agent-analytics-grid">
      <section className="agent-analytics-card agent-surface">
        <header>
          <h3>Agent utilization</h3>
          <p>Last 7 days</p>
        </header>
        {hasHistory ? (
          <p className="agent-analytics-note">
            Utilization is derived from stored execution time when the runtime
            reports it.
          </p>
        ) : (
          <EmptyState
            icon={<ChartIcon size={21} />}
            title="No activity yet"
            description="Utilization appears after agents complete work."
            compact
          />
        )}
      </section>

      <section className="agent-analytics-card agent-surface">
        <header>
          <h3>Tasks by agent</h3>
          <p>Current distribution</p>
        </header>
        {total === 0 ? (
          <EmptyState
            icon={<ListIcon size={21} />}
            title="No tasks yet"
            description="Assigned work will appear here."
            compact
          />
        ) : (
          <div className="agent-donut-layout">
            <div
              className="agent-donut"
              style={{
                background: donutGradient(byAgent, unassigned, colors, total),
              }}
              role="img"
              aria-label={`${total} total tasks`}
            >
              <div className="agent-donut-center">
                <strong>{total}</strong>
                <span>Total tasks</span>
              </div>
            </div>
            <ul className="agent-donut-legend">
              {byAgent.map((row, i) => (
                <li key={row.agent.id}>
                  <span
                    className="agent-legend-swatch"
                    style={{ background: colors[i % colors.length] }}
                  />
                  <span className="agent-legend-name">{row.agent.name}</span>
                  <span className="agent-legend-count">
                    {row.count} ({Math.round((row.count / total) * 100)}%)
                  </span>
                </li>
              ))}
              {unassigned > 0 ? (
                <li>
                  <span
                    className="agent-legend-swatch"
                    style={{ background: "#737C83" }}
                  />
                  <span className="agent-legend-name">Unassigned</span>
                  <span className="agent-legend-count">
                    {unassigned} ({Math.round((unassigned / total) * 100)}%)
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </section>

      <section className="agent-analytics-card agent-surface">
        <header>
          <h3>Agent health</h3>
          <p>System status</p>
        </header>
        {agents.length === 0 ? (
          <EmptyState
            icon={<BotIcon size={21} />}
            title="No agents yet"
            description="Create an agent to begin monitoring health."
            compact
          />
        ) : (
          <ul className="agent-health-list">
            {agents.map((agent) => {
              const health = deriveAgentHealth(agent);
              return (
                <li key={agent.id}>
                  <span className="agent-health-name">{agent.name}</span>
                  <span className={`agent-health-pill health-${health}`}>
                    {healthLabel(health)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function donutGradient(
  byAgent: { count: number }[],
  unassigned: number,
  colors: string[],
  total: number,
): string {
  if (total === 0) return "conic-gradient(#2a323a 0 100%)";
  let cursor = 0;
  const stops: string[] = [];
  byAgent.forEach((row, i) => {
    const next = cursor + (row.count / total) * 100;
    stops.push(`${colors[i % colors.length]} ${cursor}% ${next}%`);
    cursor = next;
  });
  if (unassigned > 0) {
    stops.push(`#737C83 ${cursor}% 100%`);
  }
  return `conic-gradient(${stops.join(", ")})`;
}
