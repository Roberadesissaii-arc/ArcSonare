import { ORBIT_CHIPS } from "../../data/demoData";
import { CalendarIcon, ListIcon, SearchIcon } from "../Icons";
import { ArcSonareCore } from "./ArcSonareCore";
import { OrbitActionChip } from "./OrbitActionChip";

const CX = 360;
const CY = 240;

/** Ellipse path centered on the map, used both for strokes and motion. */
function orbitPath(rx: number, ry: number): string {
  return `M ${CX + rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX - rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX + rx} ${CY} Z`;
}

/** Deterministic pseudo-random in [0, 1) — stable star field. */
function seeded(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ~64 deterministic dust particles; a few carry a violet tint.
const STARS = Array.from({ length: 64 }, (_, i) => ({
  x: Math.round(seeded(i * 3 + 1) * 712) + 4,
  y: Math.round(seeded(i * 3 + 2) * 468) + 6,
  r: 0.6 + seeded(i * 3 + 3) * 1.4,
  o: 0.1 + seeded(i * 7 + 5) * 0.32,
  violet: seeded(i * 11 + 9) > 0.86,
}));

interface TravelerProps {
  rx: number;
  ry: number;
  r: number;
  duration: number;
  delay?: number;
  violet?: boolean;
}

/** A node traveling along an orbit via CSS motion path (viewBox units). */
function Traveler({ rx, ry, r, duration, delay = 0, violet }: TravelerProps) {
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

const CHIP_ICONS = {
  search: SearchIcon,
  tasks: ListIcon,
  calendar: CalendarIcon,
};

interface OrbitingChipProps {
  chip: (typeof ORBIT_CHIPS)[number];
  rx: number;
  ry: number;
  /** Counter-rotation (deg) cancelling the parent group tilt. */
  counter: number;
  duration: number;
  delay: number;
  /** Resting position under reduced motion, as offset-distance %. */
  restAt: number;
}

/**
 * A task chip traveling upright along an orbit. The <g> follows the ellipse
 * via CSS motion path (offset-rotate: 0 keeps the local frame fixed) and the
 * inner holder counter-rotates the parent group tilt so text stays level.
 */
function OrbitingChip({ chip, rx, ry, counter, duration, delay, restAt }: OrbitingChipProps) {
  const Icon = CHIP_ICONS[chip.icon];
  return (
    <g
      className="orbit-chip-motion"
      style={{
        offsetPath: `path('${orbitPath(rx, ry)}')`,
        offsetDistance: `${restAt}%`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      }}
    >
      <foreignObject x={-85} y={-27} width={170} height={54} overflow="visible">
        <div className="orbit-chip-holder" style={{ transform: `rotate(${counter}deg)` }}>
          <OrbitActionChip icon={Icon} label={chip.label} status={chip.status} orbiting />
        </div>
      </foreignObject>
    </g>
  );
}

/**
 * The atmospheric intelligence visualization: layered deep background and
 * central haze (CSS), deterministic star dust, five tilted orbit paths with
 * uneven luminosity (two slowly fade), nine traveling nodes, three soft
 * flares near orbital intersections, floating action chips and the glass
 * ArcSonare core. Motion pauses with `.app-paused` and under reduced motion.
 */
export function OrbitalCommandMap() {
  return (
    <div className="orbital-map">
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

        {/* Connection lines from the core toward the chip anchors. */}
        <g className="orbit-links">
          <line x1={CX} y1={CY} x2={130} y2={135} />
          <line x1={CX} y1={CY} x2={556} y2={100} />
          <line x1={CX} y1={CY} x2={516} y2={352} />
        </g>

        <g transform={`rotate(-17 ${CX} ${CY})`}>
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
        <g transform={`rotate(14 ${CX} ${CY})`}>
          <path className="orbit-line orbit-fade-b" d={orbitPath(200, 152)} />
          <Traveler rx={200} ry={152} r={2.4} duration={104} delay={-52} />
          <Traveler rx={200} ry={152} r={1.7} duration={104} delay={-14} />
        </g>

        {/* Orbiting task cards — planets around the ArcSonare core. */}
        <g transform={`rotate(-17 ${CX} ${CY})`}>
          <OrbitingChip
            chip={ORBIT_CHIPS[0]}
            rx={268}
            ry={104}
            counter={17}
            duration={72}
            delay={-38}
            restAt={53}
          />
          <OrbitingChip
            chip={ORBIT_CHIPS[1]}
            rx={238}
            ry={92}
            counter={17}
            duration={88}
            delay={-11}
            restAt={12}
          />
        </g>
        <g transform={`rotate(14 ${CX} ${CY})`}>
          <OrbitingChip
            chip={ORBIT_CHIPS[2]}
            rx={200}
            ry={152}
            counter={-14}
            duration={64}
            delay={-51}
            restAt={80}
          />
        </g>

        {/* Soft flares near orbital intersections. */}
        <g className="orbit-flares">
          <circle cx={118} cy={210} r={16} />
          <circle cx={548} cy={148} r={13} />
          <circle cx={430} cy={362} r={11} />
        </g>
      </svg>

      <div className="orbital-core-wrap">
        <ArcSonareCore />
      </div>
    </div>
  );
}
