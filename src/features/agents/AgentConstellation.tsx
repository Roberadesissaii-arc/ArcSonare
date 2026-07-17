import { agentAvatarSrc } from "./agentAvatars";
import type { CSSProperties } from "react";
import type { AgentConfig } from "./agentStore";
import { deriveAgentStatus, statusLabel } from "./agentSelectors";

interface AgentConstellationProps {
  agents: AgentConfig[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}

export function AgentConstellation({ agents, onOpen, onCreate }: AgentConstellationProps) {
  const prime = agents.find((agent) => agent.isPrime) ?? agents[0];
  const satellites = agents.filter((agent) => agent.id !== prime?.id).slice(0, 7);

  return (
    <section className="agent-constellation" aria-label="Agent constellation">
      <div className="agent-constellation-copy">
        <span className="agent-constellation-eyebrow">Live orchestration map</span>
        <strong>{prime ? `${prime.name} leads your agent team` : "Build your agent team"}</strong>
        <span>
          {prime
            ? "Your Prime Agent receives work, delegates it to specialists, and keeps every handoff visible."
            : "Create a Prime Agent, then surround it with specialists."}
        </span>
      </div>

      <div className="agent-orbit-stage">
        <svg className="agent-orbit-lines" viewBox="0 0 760 360" aria-hidden="true">
          <ellipse cx="380" cy="180" rx="245" ry="116" />
          <ellipse className="orbit-secondary" cx="380" cy="180" rx="315" ry="152" />
          {satellites.map((_, index) => {
            const points = [[214,92],[380,42],[548,92],[646,190],[522,286],[264,290],[112,194]];
            const [x, y] = points[index];
            return <line key={index} x1="380" y1="180" x2={x} y2={y} />;
          })}
        </svg>

        {prime ? (
          <button className="agent-prime-core" type="button" onClick={() => onOpen(prime.id)}>
            <span className="agent-prime-rings" aria-hidden="true" />
            <span className="agent-prime-avatar">
              {agentAvatarSrc(prime.avatarId) ? <img src={agentAvatarSrc(prime.avatarId)} alt="" /> : prime.initials}
            </span>
            <span className="agent-prime-crown">Prime agent</span>
            <strong>{prime.name}</strong>
            <small>Coordinates {satellites.length} specialists</small>
          </button>
        ) : (
          <button type="button" className="agent-prime-core is-empty" onClick={onCreate}>Create prime agent</button>
        )}

        {satellites.map((agent, index) => {
          const status = deriveAgentStatus(agent);
          return (
            <button
              key={agent.id}
              type="button"
              className={`agent-satellite satellite-${index + 1}`}
              style={{ "--agent-accent": agent.accentColor } as CSSProperties}
              onClick={() => onOpen(agent.id)}
            >
              <span className="agent-satellite-avatar">
                {agentAvatarSrc(agent.avatarId) ? <img src={agentAvatarSrc(agent.avatarId)} alt="" /> : agent.initials}
              </span>
              <span className="agent-satellite-copy">
                <strong>{agent.name}</strong>
                <small>{agent.role} · {statusLabel(status)}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="agent-constellation-stats">
        <span><strong>{agents.length}</strong> agents</span>
        <span><strong>{agents.filter((a) => a.enabled).length}</strong> online</span>
        <span><strong>{agents.reduce((sum, a) => sum + (a.metrics?.tasksCompleted ?? 0), 0)}</strong> completed</span>
      </div>
    </section>
  );
}
