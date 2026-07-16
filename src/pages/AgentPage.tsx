import { useState } from "react";
import { AGENTS, type AgentInfo, type AgentStatus } from "../data/demoData";
import { addActivity, useAppState } from "../stores/appStore";

function statusFor(agent: AgentInfo, enabled: boolean): AgentStatus {
  if (!enabled) return "Paused";
  return agent.status === "Paused" ? "Ready" : agent.status;
}

const STATUS_TONE: Record<AgentStatus, string> = {
  Ready: "green",
  "Running locally": "violet",
  Waiting: "yellow",
  Paused: "muted",
  "Not configured": "muted",
};

/** Specialized-agent management. Agents run locally only in this phase. */
export function AgentPage() {
  const { activity } = useAppState();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(AGENTS.map((a) => [a.id, a.enabled])),
  );
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  const toggleAgent = (agent: AgentInfo) => {
    const next = !enabled[agent.id];
    setEnabled((prev) => ({ ...prev, [agent.id]: next }));
    addActivity(`${next ? "Enabled" : "Paused"} agent ${agent.name}`, "agent");
  };

  return (
    <div className="agent-page">
      <div className="page-top">
        <h1 className="page-heading">Agent</h1>
      </div>
      <p className="page-lede">
        Specialized ArcSonare agents. Everything here runs locally — no
        external actions are executed in this phase.
      </p>

      <div className="agent-grid">
        {AGENTS.map((agent) => {
          const isOn = enabled[agent.id];
          const status = statusFor(agent, isOn);
          const isOpen = openAgent === agent.id;
          return (
            <section key={agent.id} className={`card agent-card${isOpen ? " open" : ""}`}>
              <div className="agent-card-head">
                <span className="agent-avatar" aria-hidden="true">
                  {agent.initials}
                </span>
                <span className="agent-names">
                  <span className="card-title">{agent.name}</span>
                  <span className={`agent-status tone-${STATUS_TONE[status]}`}>
                    {status}
                  </span>
                </span>
                <button
                  type="button"
                  className={`toggle${isOn ? " on" : ""}`}
                  role="switch"
                  aria-checked={isOn}
                  aria-label={`${agent.name} enabled`}
                  onClick={() => toggleAgent(agent)}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
              <p className="card-text">{agent.purpose}</p>
              <p className="agent-recent">{agent.recentAction}</p>
              <div className="card-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setOpenAgent(isOpen ? null : agent.id)}
                >
                  {isOpen ? "Close" : "Open"}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <section className="agent-timeline">
        <h2 className="card-label">Activity timeline</h2>
        {activity.length === 0 ? (
          <p className="card-text">
            No activity yet. Commands, tasks and agent changes will appear
            here.
          </p>
        ) : (
          <ul className="timeline-list">
            {activity.slice(0, 12).map((entry) => (
              <li key={entry.id} className="timeline-row">
                <span className={`timeline-dot src-${entry.source}`} aria-hidden="true" />
                <span className="timeline-text">{entry.text}</span>
                <span className="timeline-time">
                  {new Date(entry.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
