import { useEffect, useRef, useState, type ComponentType } from "react";
import { ORBIT_CHIPS } from "../../data/demoData";
import { useVoiceState } from "../../stores/voiceStore";
import { BotIcon, CalendarIcon, ListIcon, SearchIcon } from "../Icons";
import { ArcSonareCore } from "./ArcSonareCore";
import { OrbitActionChip } from "./OrbitActionChip";

const CX = 360;
const CY = 240;
const GLOBE_SIZE = 168;

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

const CHIP_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  search: SearchIcon,
  tasks: ListIcon,
  calendar: CalendarIcon,
  agent: BotIcon,
};

interface ChipOrbitDef {
  id: string;
  chip: (typeof ORBIT_CHIPS)[number];
  rx: number;
  ry: number;
  counter: number;
  duration: number;
  delay: number;
  restAt: number;
}

const TILT_A = -17;
const TILT_B = 14;

const CHIPS_A: ChipOrbitDef[] = [
  {
    id: "chip-0",
    chip: ORBIT_CHIPS[0],
    rx: 268,
    ry: 104,
    counter: 17,
    duration: 72,
    delay: -38,
    restAt: 53,
  },
  {
    id: "chip-1",
    chip: ORBIT_CHIPS[1],
    rx: 238,
    ry: 92,
    counter: 17,
    duration: 88,
    delay: -11,
    restAt: 12,
  },
];

const CHIPS_B: ChipOrbitDef[] = [
  {
    id: "chip-2",
    chip: ORBIT_CHIPS[2],
    rx: 200,
    ry: 152,
    counter: -14,
    duration: 64,
    delay: -51,
    restAt: 80,
  },
  {
    id: "chip-3",
    chip: ORBIT_CHIPS[3],
    rx: 220,
    ry: 132,
    counter: -14,
    duration: 78,
    delay: -28,
    restAt: 35,
  },
];

const ALL_CHIPS = [...CHIPS_A, ...CHIPS_B];

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

function OrbitingChip({
  def,
  depth,
  visible,
  onHoverChange,
}: {
  def: ChipOrbitDef;
  depth: "front" | "back";
  visible: boolean;
  onHoverChange: (hovering: boolean) => void;
}) {
  const Icon = CHIP_ICONS[def.chip.icon];
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
      <foreignObject x={-85} y={-27} width={170} height={54} overflow="visible">
        <div
          className="orbit-chip-holder"
          style={{ transform: `rotate(${def.counter}deg)` }}
          onPointerEnter={() => {
            if (visible) onHoverChange(true);
          }}
          onPointerLeave={() => onHoverChange(false)}
        >
          <OrbitActionChip
            icon={Icon}
            label={def.chip.label}
            status={def.chip.status}
            orbiting
          />
        </div>
      </foreignObject>
    </g>
  );
}

function ChipSet({
  chips,
  front,
  onHoverChange,
}: {
  chips: ChipOrbitDef[];
  front: Record<string, boolean>;
  onHoverChange: (h: boolean) => void;
}) {
  return (
    <>
      {chips.map((def) => (
        <OrbitingChip
          key={`${def.id}-back`}
          def={def}
          depth="back"
          visible={!front[def.id]}
          onHoverChange={onHoverChange}
        />
      ))}
    </>
  );
}

function ChipSetFront({
  chips,
  front,
  onHoverChange,
}: {
  chips: ChipOrbitDef[];
  front: Record<string, boolean>;
  onHoverChange: (h: boolean) => void;
}) {
  return (
    <>
      {chips.map((def) => (
        <OrbitingChip
          key={`${def.id}-front`}
          def={def}
          depth="front"
          visible={Boolean(front[def.id])}
          onHoverChange={onHoverChange}
        />
      ))}
    </>
  );
}

/**
 * Atmospheric intelligence map: starfield, orbits, dotted globe core, and
 * task chips that pass in front of / behind the globe based on orbit phase.
 */
export function OrbitalCommandMap() {
  const voice = useVoiceState();
  const [chipHover, setChipHover] = useState(false);
  const [front, setFront] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALL_CHIPS.map((c) => [c.id, true])),
  );
  const mapRef = useRef<HTMLDivElement>(null);

  const systemActive =
    voice.status === "listening" ||
    voice.status === "thinking" ||
    voice.status === "responding" ||
    voice.isOverlayVisible;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const root = mapRef.current;
      if (root) {
        const next: Record<string, boolean> = {};
        for (const def of ALL_CHIPS) {
          // Sample the front-layer instance (always mounted, always animating).
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
  }, []);

  return (
    <div
      ref={mapRef}
      className={`orbital-map${chipHover ? " is-orbit-paused" : ""}${systemActive ? " is-system-active" : ""}`}
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

        <g transform={`rotate(${TILT_A} ${CX} ${CY})`}>
          <path className="orbit-line" d={orbitPath(302, 118)} />
          <path className="orbit-line orbit-violet" d={orbitPath(238, 92)} />
          <path className="orbit-line orbit-fade-a" d={orbitPath(170, 64)} />
          <path className="orbit-line orbit-line-faint" d={orbitPath(120, 44)} />
          <Traveler rx={302} ry={118} r={3.4} duration={86} violet />
          <Traveler rx={302} ry={118} r={2.1} duration={86} delay={-36} />
          <Traveler rx={238} ry={92} r={2.6} duration={64} delay={-12} />
          <Traveler rx={238} ry={92} r={1.9} duration={64} delay={-40} />
          <Traveler rx={170} ry={64} r={2.2} duration={54} delay={-8} violet />
          <Traveler rx={120} ry={44} r={1.8} duration={50} delay={-22} />
        </g>
        <g transform={`rotate(${TILT_B} ${CX} ${CY})`}>
          <path className="orbit-line orbit-fade-b" d={orbitPath(200, 152)} />
          <Traveler rx={200} ry={152} r={2.4} duration={104} delay={-52} />
          <Traveler rx={200} ry={152} r={1.7} duration={104} delay={-14} />
        </g>

        {/* Back chips (both tilt groups) */}
        <g transform={`rotate(${TILT_A} ${CX} ${CY})`} className="orbit-chip-layer-back">
          <ChipSet chips={CHIPS_A} front={front} onHoverChange={setChipHover} />
        </g>
        <g transform={`rotate(${TILT_B} ${CX} ${CY})`} className="orbit-chip-layer-back">
          <ChipSet chips={CHIPS_B} front={front} onHoverChange={setChipHover} />
        </g>

        <foreignObject
          className="orbital-globe-fo"
          x={CX - GLOBE_SIZE / 2}
          y={CY - GLOBE_SIZE / 2}
          width={GLOBE_SIZE}
          height={GLOBE_SIZE}
        >
          <div className="orbital-globe-inner">
            <ArcSonareCore
              size={GLOBE_SIZE}
              active={systemActive}
              paused={chipHover}
            />
          </div>
        </foreignObject>

        {/* Front chips */}
        <g transform={`rotate(${TILT_A} ${CX} ${CY})`} className="orbit-chip-layer-front">
          <ChipSetFront chips={CHIPS_A} front={front} onHoverChange={setChipHover} />
        </g>
        <g transform={`rotate(${TILT_B} ${CX} ${CY})`} className="orbit-chip-layer-front">
          <ChipSetFront chips={CHIPS_B} front={front} onHoverChange={setChipHover} />
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
