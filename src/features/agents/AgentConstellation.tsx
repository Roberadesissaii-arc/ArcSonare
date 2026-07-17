import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { agentAvatarSrc } from "./agentAvatars";
import type { AgentConfig } from "./agentStore";
import { deriveAgentStatus, statusLabel } from "./agentSelectors";

interface AgentConstellationProps {
  agents: AgentConfig[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  centerStage?: boolean;
}

const CX = 360;
const CY = 240;

function orbitPath(rx: number, ry: number): string {
  return `M ${CX + rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX - rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX + rx} ${CY} Z`;
}

function seeded(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const STARS = Array.from({ length: 64 }, (_, i) => ({
  x: Math.round(seeded(i * 3 + 1) * 712) + 4,
  y: Math.round(seeded(i * 3 + 2) * 468) + 6,
  r: 0.6 + seeded(i * 3 + 3) * 1.4,
  o: 0.1 + seeded(i * 7 + 5) * 0.32,
  violet: seeded(i * 11 + 9) > 0.86,
}));

type AgentOrbitDef = {
  id: string;
  agent: AgentConfig;
  rx: number;
  ry: number;
  counter: number;
  duration: number;
  delay: number;
  restAt: number;
};

function buildOrbits(agents: AgentConfig[]): AgentOrbitDef[] {
  const templates = [
    { rx: 268, ry: 104, counter: 17, duration: 72, delay: -38, restAt: 53 },
    { rx: 238, ry: 92, counter: 17, duration: 88, delay: -11, restAt: 12 },
    { rx: 200, ry: 152, counter: -14, duration: 64, delay: -51, restAt: 80 },
    { rx: 220, ry: 132, counter: -14, duration: 78, delay: -28, restAt: 35 },
    { rx: 250, ry: 118, counter: 12, duration: 84, delay: -44, restAt: 68 },
    { rx: 210, ry: 160, counter: -10, duration: 70, delay: -19, restAt: 22 },
    { rx: 280, ry: 110, counter: 8, duration: 96, delay: -62, restAt: 41 },
  ];
  return agents.slice(0, 7).map((agent, i) => ({
    id: agent.id,
    agent,
    ...templates[i % templates.length],
    restAt: (templates[i % templates.length].restAt + i * 11) % 100,
  }));
}

function Traveler({
  rx,
  ry,
  r,
  duration,
  delay = 0,
  violet,
}: {
  rx: number;
  ry: number;
  r: number;
  duration: number;
  delay?: number;
  violet?: boolean;
}) {
  return (
    <circle
      className={`orbit-traveler${violet ? " violet" : ""}`}
      r={r}
      style={{
        offsetPath: `path('${orbitPath(rx, ry)}')`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      }}
    />
  );
}

/**
 * Agent team map using the Dashboard orbital visual language:
 * starfield, elliptical orbits, travelers, and chip satellites.
 */
export function AgentConstellation({
  agents,
  onOpen,
  onCreate,
  centerStage = false,
}: AgentConstellationProps) {
  const prime = agents.find((agent) => agent.isPrime) ?? agents[0];
  const satellites = useMemo(
    () => agents.filter((agent) => agent.id !== prime?.id),
    [agents, prime?.id],
  );
  const orbits = useMemo(() => buildOrbits(satellites), [satellites]);
  const orbitsA = useMemo(() => orbits.filter((_, i) => i % 2 === 0), [orbits]);
  const orbitsB = useMemo(() => orbits.filter((_, i) => i % 2 === 1), [orbits]);
  const [chipHover, setChipHover] = useState(false);
  const [front, setFront] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(orbits.map((o) => [o.id, true])),
  );
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!centerStage) return;
    let raf = 0;
    const tick = () => {
      const root = mapRef.current;
      if (root) {
        const next: Record<string, boolean> = {};
        for (const def of orbits) {
          const el = root.querySelector(
            `[data-chip-id="${def.id}"][data-depth="front"]`,
          ) as SVGElement | null;
          if (!el) {
            next[def.id] = true;
            continue;
          }
          const pct = parseFloat(getComputedStyle(el).offsetDistance || "0") || 0;
          next[def.id] = pct < 50;
        }
        setFront((prev) => {
          for (const id of Object.keys(next)) {
            if (prev[id] !== next[id]) return next;
          }
          return prev;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [centerStage, orbits]);

  if (!centerStage) {
    return (
      <LegacyConstellation
        agents={agents}
        prime={prime}
        satellites={satellites.slice(0, 7)}
        onOpen={onOpen}
        onCreate={onCreate}
      />
    );
  }

  return (
    <div
      ref={mapRef}
      className={`orbital-map agent-orbital-map${chipHover ? " is-orbit-paused" : ""}`}
      aria-label="Agent constellation"
    >
      <svg
        className="orbital-svg"
        viewBox="0 0 720 480"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill={s.violet ? "#b596f0" : "#e9ebe8"}
            opacity={s.o}
          />
        ))}

        <g transform={`rotate(-17 ${CX} ${CY})`}>
          <path className="orbit-line" d={orbitPath(302, 118)} />
          <path className="orbit-line orbit-violet" d={orbitPath(238, 92)} />
          <path className="orbit-line orbit-fade-a" d={orbitPath(170, 64)} />
          <path className="orbit-line orbit-line-faint" d={orbitPath(120, 44)} />
          <Traveler rx={302} ry={118} r={3.4} duration={86} violet />
          <Traveler rx={302} ry={118} r={2.1} duration={86} delay={-36} />
          <Traveler rx={238} ry={92} r={2.6} duration={64} delay={-12} />
          <Traveler rx={170} ry={64} r={2.2} duration={54} delay={-8} violet />
        </g>
        <g transform={`rotate(14 ${CX} ${CY})`}>
          <path className="orbit-line orbit-fade-b" d={orbitPath(200, 152)} />
          <Traveler rx={200} ry={152} r={2.4} duration={104} delay={-52} />
          <Traveler rx={200} ry={152} r={1.7} duration={104} delay={-14} />
        </g>

        <g transform={`rotate(-17 ${CX} ${CY})`} className="orbit-chip-layer-back">
          {orbitsA.map((def) => (
            <AgentOrbitChip
              key={`${def.id}-back`}
              def={def}
              depth="back"
              visible={!front[def.id]}
              onOpen={onOpen}
              onHoverChange={setChipHover}
            />
          ))}
        </g>
        <g transform={`rotate(14 ${CX} ${CY})`} className="orbit-chip-layer-back">
          {orbitsB.map((def) => (
            <AgentOrbitChip
              key={`${def.id}-back`}
              def={def}
              depth="back"
              visible={!front[def.id]}
              onOpen={onOpen}
              onHoverChange={setChipHover}
            />
          ))}
        </g>

        <foreignObject
          className="orbital-globe-fo"
          x={CX - 84}
          y={CY - 84}
          width={168}
          height={168}
        >
          <div className="orbital-globe-inner agent-orbital-core">
            {prime ? (
              <button
                type="button"
                className="agent-orbit-core-btn"
                onClick={() => onOpen(prime.id)}
                aria-label={`Open ${prime.name}`}
              >
                <span className="agent-orbit-core-ring" aria-hidden="true" />
                <span className="agent-orbit-core-avatar">
                  {agentAvatarSrc(prime.avatarId) ? (
                    <img src={agentAvatarSrc(prime.avatarId)} alt="" />
                  ) : (
                    prime.initials
                  )}
                </span>
                <span className="agent-orbit-core-meta">
                  <span className="agent-orbit-core-crown">Prime</span>
                  <strong>{prime.name}</strong>
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="agent-orbit-core-btn is-empty"
                onClick={onCreate}
              >
                <span className="agent-orbit-core-ring" aria-hidden="true" />
                <strong>Create prime</strong>
              </button>
            )}
          </div>
        </foreignObject>

        <g transform={`rotate(-17 ${CX} ${CY})`} className="orbit-chip-layer-front">
          {orbitsA.map((def) => (
            <AgentOrbitChip
              key={`${def.id}-front`}
              def={def}
              depth="front"
              visible={Boolean(front[def.id])}
              onOpen={onOpen}
              onHoverChange={setChipHover}
            />
          ))}
        </g>
        <g transform={`rotate(14 ${CX} ${CY})`} className="orbit-chip-layer-front">
          {orbitsB.map((def) => (
            <AgentOrbitChip
              key={`${def.id}-front`}
              def={def}
              depth="front"
              visible={Boolean(front[def.id])}
              onOpen={onOpen}
              onHoverChange={setChipHover}
            />
          ))}
        </g>

        <g className="orbit-flares">
          <circle cx={118} cy={210} r={16} />
          <circle cx={548} cy={148} r={13} />
          <circle cx={430} cy={362} r={11} />
        </g>
      </svg>
    </div>
  );
}

function AgentOrbitChip({
  def,
  depth,
  visible,
  onOpen,
  onHoverChange,
}: {
  def: AgentOrbitDef;
  depth: "front" | "back";
  visible: boolean;
  onOpen: (id: string) => void;
  onHoverChange: (hovering: boolean) => void;
}) {
  const status = deriveAgentStatus(def.agent);
  return (
    <g
      data-chip-id={def.id}
      data-depth={depth}
      className={`orbit-chip-motion orbit-chip-depth-${depth}${visible ? " is-visible" : " is-hidden"}`}
      style={{
        offsetPath: `path('${orbitPath(def.rx, def.ry)}')`,
        offsetDistance: `${def.restAt}%`,
        animationDuration: `${def.duration}s`,
        animationDelay: `${def.delay}s`,
      }}
    >
      <foreignObject x={-92} y={-28} width={184} height={56} overflow="visible">
        <div
          className="orbit-chip-holder"
          style={
            {
              transform: `rotate(${def.counter}deg)`,
              "--agent-accent": def.agent.accentColor,
            } as CSSProperties
          }
          onPointerEnter={() => {
            if (visible) onHoverChange(true);
          }}
          onPointerLeave={() => onHoverChange(false)}
        >
          <button
            type="button"
            className="orbit-chip orbit-chip-orbiting agent-orbit-chip"
            onClick={() => onOpen(def.agent.id)}
          >
            <span className="orbit-chip-icon agent-orbit-chip-avatar">
              {agentAvatarSrc(def.agent.avatarId) ? (
                <img src={agentAvatarSrc(def.agent.avatarId)} alt="" />
              ) : (
                def.agent.initials
              )}
            </span>
            <span className="orbit-chip-texts">
              <span className="orbit-chip-label">{def.agent.name}</span>
              <span className="orbit-chip-status">
                {def.agent.role} · {statusLabel(status)}
              </span>
            </span>
          </button>
        </div>
      </foreignObject>
    </g>
  );
}

function LegacyConstellation({
  agents,
  prime,
  satellites,
  onOpen,
  onCreate,
}: {
  agents: AgentConfig[];
  prime?: AgentConfig;
  satellites: AgentConfig[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section className="agent-constellation" aria-label="Agent constellation">
      <div className="agent-constellation-copy">
        <span className="agent-constellation-eyebrow">Live orchestration map</span>
        <strong>
          {prime ? `${prime.name} leads your agent team` : "Build your agent team"}
        </strong>
        <span>
          {prime
            ? "Your Prime Agent receives work, delegates it to specialists, and keeps every handoff visible."
            : "Create a Prime Agent, then surround it with specialists."}
        </span>
      </div>
      <div className="agent-orbit-stage">
        {prime ? (
          <button className="agent-prime-core" type="button" onClick={() => onOpen(prime.id)}>
            <span className="agent-prime-rings" aria-hidden="true" />
            <span className="agent-prime-avatar">
              {agentAvatarSrc(prime.avatarId) ? (
                <img src={agentAvatarSrc(prime.avatarId)} alt="" />
              ) : (
                prime.initials
              )}
            </span>
            <span className="agent-prime-crown">Prime agent</span>
            <strong>{prime.name}</strong>
            <small>Coordinates {satellites.length} specialists</small>
          </button>
        ) : (
          <button type="button" className="agent-prime-core is-empty" onClick={onCreate}>
            Create prime agent
          </button>
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
                {agentAvatarSrc(agent.avatarId) ? (
                  <img src={agentAvatarSrc(agent.avatarId)} alt="" />
                ) : (
                  agent.initials
                )}
              </span>
              <span className="agent-satellite-copy">
                <strong>{agent.name}</strong>
                <small>
                  {agent.role} · {statusLabel(status)}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="agent-constellation-stats">
        <span>
          <strong>{agents.length}</strong> agents
        </span>
        <span>
          <strong>{agents.filter((a) => a.enabled).length}</strong> online
        </span>
      </div>
    </section>
  );
}
