import { ArcSonareCore } from "../dashboard/ArcSonareCore";
import { agentAvatarSrc } from "../../features/agents/agentAvatars";
import type { AgentConfig } from "../../features/agents/agentStore";

const CX = 360;
const CY = 240;
const GLOBE_SIZE = 168;
const TILT_A = -17;
const TILT_B = 14;
const AVATAR_SIZE = 36;

interface Ring {
  rx: number;
  ry: number;
  duration: number;
  tilt: number;
}

// Same orbit family as the Dashboard's OrbitalCommandMap, split across the
// same two tilt groups — this is what gives the layered 3D perspective.
const RINGS: Ring[] = [
  { rx: 302, ry: 118, duration: 86, tilt: TILT_A },
  { rx: 238, ry: 92, duration: 64, tilt: TILT_A },
  { rx: 170, ry: 64, duration: 54, tilt: TILT_A },
  { rx: 200, ry: 152, duration: 104, tilt: TILT_B },
];

function orbitPath(rx: number, ry: number): string {
  return `M ${CX + rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX - rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX + rx} ${CY} Z`;
}

/** Splits agents across the available rings, filling inner rings first. */
function distribute(agents: AgentConfig[]): { agent: AgentConfig; ring: Ring }[] {
  const perRing = Math.ceil(agents.length / RINGS.length);
  return agents.map((agent, i) => ({
    agent,
    ring: RINGS[Math.min(RINGS.length - 1, Math.floor(i / perRing))],
  }));
}

function OrbitingAgent({
  agent,
  ring,
  index,
  countOnRing,
  selected,
  onSelect,
}: {
  agent: AgentConfig;
  ring: Ring;
  index: number;
  countOnRing: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const src = agentAvatarSrc(agent.avatarId);
  const delay = -((index / Math.max(1, countOnRing)) * ring.duration);

  return (
    <foreignObject
      className="agent-orbit-travel"
      x={-AVATAR_SIZE / 2}
      y={-AVATAR_SIZE / 2}
      width={AVATAR_SIZE}
      height={AVATAR_SIZE}
      overflow="visible"
      style={{
        offsetPath: `path('${orbitPath(ring.rx, ring.ry)}')`,
        animationDuration: `${ring.duration}s`,
        animationDelay: `${delay}s`,
      }}
    >
      <button
        type="button"
        className={`agent-orbit-avatar${selected ? " selected" : ""}`}
        onClick={() => onSelect(agent.id)}
        title={agent.name}
        aria-label={`Select ${agent.name}`}
      >
        {src ? <img src={src} alt="" /> : <span>{agent.initials}</span>}
      </button>
    </foreignObject>
  );
}

interface AgentOrbitalMapProps {
  agents: AgentConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Agent-page counterpart to the Dashboard's orbital command map. */
export function AgentOrbitalMap({ agents, selectedId, onSelect }: AgentOrbitalMapProps) {
  const placed = distribute(agents);
  const byRing = RINGS.map((ring) => placed.filter((p) => p.ring === ring));
  const ringsByTilt = (tilt: number) =>
    RINGS.map((ring, i) => ({ ring, i })).filter(({ ring }) => ring.tilt === tilt);

  return (
    <div className="orbital-map">
      <svg
        className="orbital-svg"
        viewBox="0 0 720 480"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {[TILT_A, TILT_B].map((tilt) => (
          <g key={`lines-${tilt}`} transform={`rotate(${tilt} ${CX} ${CY})`}>
            {ringsByTilt(tilt).map(({ ring }) => (
              <path
                key={`${ring.rx}-${ring.ry}`}
                className="orbit-line"
                d={orbitPath(ring.rx, ring.ry)}
              />
            ))}
          </g>
        ))}

        <foreignObject
          className="orbital-globe-fo"
          x={CX - GLOBE_SIZE / 2}
          y={CY - GLOBE_SIZE / 2}
          width={GLOBE_SIZE}
          height={GLOBE_SIZE}
        >
          <div className="orbital-globe-inner">
            <ArcSonareCore size={GLOBE_SIZE} />
          </div>
        </foreignObject>

        {[TILT_A, TILT_B].map((tilt) => (
          <g key={`agents-${tilt}`} transform={`rotate(${tilt} ${CX} ${CY})`}>
            {ringsByTilt(tilt).map(({ ring, i }) =>
              byRing[i].map(({ agent }, idx) => (
                <OrbitingAgent
                  key={agent.id}
                  agent={agent}
                  ring={ring}
                  index={idx}
                  countOnRing={byRing[i].length}
                  selected={agent.id === selectedId}
                  onSelect={onSelect}
                />
              )),
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
