import { useEffect, useMemo, useRef, useState } from "react";
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

// More distinct rings than the Dashboard reuses on its own map, so up to ~10
// agents spread across visibly separate orbits instead of clustering on a
// few paths. Same two tilt families (and aspect ratios) as the Dashboard.
const RINGS: Ring[] = [
  { rx: 302, ry: 118, duration: 86, tilt: TILT_A },
  { rx: 264, ry: 102, duration: 74, tilt: TILT_A },
  { rx: 228, ry: 88, duration: 64, tilt: TILT_A },
  { rx: 196, ry: 75, duration: 56, tilt: TILT_A },
  { rx: 164, ry: 63, duration: 50, tilt: TILT_A },
  { rx: 220, ry: 166, duration: 112, tilt: TILT_B },
  { rx: 200, ry: 152, duration: 100, tilt: TILT_B },
  { rx: 180, ry: 136, duration: 90, tilt: TILT_B },
];

function orbitPath(rx: number, ry: number): string {
  return `M ${CX + rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX - rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX + rx} ${CY} Z`;
}

interface Placement {
  agent: AgentConfig;
  ring: Ring;
}

/** Splits agents across the available rings, filling inner rings first. */
function distribute(agents: AgentConfig[]): Placement[] {
  const perRing = Math.ceil(agents.length / RINGS.length) || 1;
  return agents.map((agent, i) => ({
    agent,
    ring: RINGS[Math.min(RINGS.length - 1, Math.floor(i / perRing))],
  }));
}

function AgentTraveler({
  agent,
  ring,
  index,
  countOnRing,
  depth,
  visible,
  selected,
  onSelect,
}: {
  agent: AgentConfig;
  ring: Ring;
  index: number;
  countOnRing: number;
  depth: "front" | "back";
  visible: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const src = agentAvatarSrc(agent.avatarId);
  const delay = -((index / Math.max(1, countOnRing)) * ring.duration);

  return (
    <g
      data-agent-id={agent.id}
      data-depth={depth}
      className={`agent-orbit-motion agent-orbit-depth-${depth}${visible ? " is-visible" : " is-hidden"}`}
      style={{
        offsetPath: `path('${orbitPath(ring.rx, ring.ry)}')`,
        animationDuration: `${ring.duration}s`,
        animationDelay: `${delay}s`,
      }}
    >
      <foreignObject
        x={-AVATAR_SIZE / 2}
        y={-AVATAR_SIZE / 2}
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        overflow="visible"
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
    </g>
  );
}

interface AgentOrbitalMapProps {
  agents: AgentConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Agent-page counterpart to the Dashboard's orbital command map. */
export function AgentOrbitalMap({ agents, selectedId, onSelect }: AgentOrbitalMapProps) {
  const placed = useMemo(() => distribute(agents), [agents]);
  const mapRef = useRef<SVGSVGElement>(null);
  const [front, setFront] = useState<Record<string, boolean>>({});

  // Tracks each avatar's live position along its orbit so it can render
  // behind the central globe on the far side and in front on the near side
  // — same technique as OrbitalCommandMap's task chips.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const root = mapRef.current;
      if (root) {
        const next: Record<string, boolean> = {};
        for (const { agent } of placed) {
          const el = root.querySelector(
            `[data-agent-id="${agent.id}"][data-depth="front"]`,
          ) as SVGGElement | null;
          if (!el) {
            next[agent.id] = true;
            continue;
          }
          const pct = parseFloat(getComputedStyle(el).offsetDistance || "0") || 0;
          next[agent.id] = pct < 50;
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
  }, [placed]);

  const byRing = useMemo(() => {
    const map = new Map<Ring, Placement[]>();
    for (const ring of RINGS) {
      map.set(ring, placed.filter((p) => p.ring === ring));
    }
    return map;
  }, [placed]);
  const ringsByTilt = (tilt: number) => RINGS.filter((r) => r.tilt === tilt);

  const layer = (depth: "front" | "back") =>
    [TILT_A, TILT_B].map((tilt) => (
      <g key={`${depth}-${tilt}`} transform={`rotate(${tilt} ${CX} ${CY})`}>
        {ringsByTilt(tilt).map((ring) =>
          (byRing.get(ring) ?? []).map(({ agent }, idx) => (
            <AgentTraveler
              key={`${agent.id}-${depth}`}
              agent={agent}
              ring={ring}
              index={idx}
              countOnRing={(byRing.get(ring) ?? []).length}
              depth={depth}
              visible={depth === "front" ? Boolean(front[agent.id]) : !front[agent.id]}
              selected={agent.id === selectedId}
              onSelect={onSelect}
            />
          )),
        )}
      </g>
    ));

  return (
    <div className="orbital-map">
      <svg
        ref={mapRef}
        className="orbital-svg"
        viewBox="0 0 720 480"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {[TILT_A, TILT_B].map((tilt) => (
          <g key={`lines-${tilt}`} transform={`rotate(${tilt} ${CX} ${CY})`}>
            {ringsByTilt(tilt).map((ring) => (
              <path
                key={`${ring.rx}-${ring.ry}`}
                className="orbit-line"
                d={orbitPath(ring.rx, ring.ry)}
              />
            ))}
          </g>
        ))}

        {layer("back")}

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

        {layer("front")}
      </svg>
    </div>
  );
}
