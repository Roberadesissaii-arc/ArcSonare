import { agentAvatarSrc } from "./agentAvatars";
import type { CSSProperties } from "react";
import type { AgentConfig } from "./agentStore";
import { deriveAgentStatus, statusLabel } from "./agentSelectors";

interface AgentConstellationProps {
  agents: AgentConfig[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  centerStage?: boolean;
}

export function AgentConstellation({ agents, onOpen, onCreate, centerStage = false }: AgentConstellationProps) {
  const prime = agents.find((agent) => agent.isPrime) ?? agents[0];
  const satellites = agents.filter((agent) => agent.id !== prime?.id).slice(0, 7);

  return (
    <section className={`agent-constellation${centerStage ? " is-center-stage" : ""}`} aria-label="Agent constellation">
      {!centerStage ? <div className="agent-constellation-copy">
        <span className="agent-constellation-eyebrow">Live orchestration map</span>
        <strong>{prime ? `${prime.name} leads your agent team` : "Build your agent team"}</strong>
        <span>
          {prime
            ? "Your Prime Agent receives work, delegates it to specialists, and keeps every handoff visible."
            : "Create a Prime Agent, then surround it with specialists."}
        </span>
      </div> : null}

      <div className="agent-orbit-stage">
        <svg className="agent-orbit-lines" viewBox="0 0 760 560" aria-hidden="true">
          <g className="agent-orbit-planes">
            <ellipse className="agent-orbit-plane plane-1" cx="380" cy="280" rx="310" ry="126" transform="rotate(-12 380 280)" />
            <ellipse className="agent-orbit-plane plane-2" cx="380" cy="280" rx="278" ry="182" transform="rotate(17 380 280)" />
            <ellipse className="agent-orbit-plane plane-3" cx="380" cy="280" rx="230" ry="224" transform="rotate(52 380 280)" />
            <ellipse className="agent-orbit-plane plane-4" cx="380" cy="280" rx="186" ry="292" transform="rotate(78 380 280)" />
            <ellipse className="agent-orbit-plane plane-5" cx="380" cy="280" rx="142" ry="332" transform="rotate(104 380 280)" />
          </g>
          <g className="agent-orbit-stars">
            {[[82,186],[146,410],[218,72],[292,462],[465,74],[552,448],[672,206],[620,338],[111,302],[708,392],[520,160],[246,242]].map(([cx,cy], i) => <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 2.2 : 1.3} />)}
          </g>
          {satellites.map((_, index) => {
            const points = [[190,130],[380,72],[570,132],[652,280],[548,430],[220,440],[104,292]];
            const [x, y] = points[index];
            return <line key={index} x1="380" y1="280" x2={x} y2={y} />;
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

      {!centerStage ? <div className="agent-constellation-stats">
        <span><strong>{agents.length}</strong> agents</span>
        <span><strong>{agents.filter((a) => a.enabled).length}</strong> online</span>
        <span><strong>{agents.reduce((sum, a) => sum + (a.metrics?.tasksCompleted ?? 0), 0)}</strong> completed</span>
      </div> : null}
    </section>
  );
}
