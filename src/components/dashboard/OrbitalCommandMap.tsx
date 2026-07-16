import { ORBIT_CHIPS } from "../../data/demoData";
import { ArcSonareLogo } from "../brand/ArcSonareLogo";
import { CalendarIcon, ListIcon, SearchIcon } from "../Icons";

const CX = 360;
const CY = 240;

/** Ellipse path centered on the map, used both for strokes and motion. */
function orbitPath(rx: number, ry: number): string {
  return `M ${CX + rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX - rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX + rx} ${CY} Z`;
}

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

// Faint fixed star-field (deterministic, no randomness on re-render).
const STARS: [number, number, number][] = [
  [64, 52, 0.2], [142, 396, 0.14], [206, 88, 0.24], [298, 428, 0.16],
  [340, 40, 0.18], [438, 452, 0.2], [512, 64, 0.15], [586, 396, 0.22],
  [648, 130, 0.17], [90, 250, 0.13], [676, 280, 0.14], [388, 458, 0.12],
  [238, 22, 0.13], [560, 22, 0.12], [30, 150, 0.16], [700, 200, 0.18],
];

const CHIP_ICONS = {
  search: SearchIcon,
  tasks: ListIcon,
  calendar: CalendarIcon,
};

/**
 * The atmospheric center of the Command Center: tilted SVG orbits, slowly
 * traveling nodes, a breathing violet ring around the ArcSonare core, and
 * three floating action chips. Motion pauses with `.app-paused` and under
 * reduced-motion preferences (see dashboard.css).
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
        {STARS.map(([x, y, o], i) => (
          <circle key={i} cx={x} cy={y} r={1.1} fill="#e9ebe8" opacity={o * 0.7} />
        ))}

        {/* Connection lines from the core toward the chip anchors. */}
        <g className="orbit-links">
          <line x1={CX} y1={CY} x2={130} y2={135} />
          <line x1={CX} y1={CY} x2={556} y2={100} />
          <line x1={CX} y1={CY} x2={516} y2={352} />
        </g>

        <g transform={`rotate(-17 ${CX} ${CY})`}>
          <path className="orbit-line" d={orbitPath(300, 118)} />
          <path className="orbit-line" d={orbitPath(236, 90)} />
          <path className="orbit-line orbit-line-faint" d={orbitPath(128, 48)} />
          <Traveler rx={300} ry={118} r={3.4} duration={82} violet />
          <Traveler rx={300} ry={118} r={2.2} duration={82} delay={-34} />
          <Traveler rx={236} ry={90} r={2.6} duration={64} delay={-12} />
          <Traveler rx={128} ry={48} r={2.1} duration={48} delay={-20} violet />
        </g>
        <g transform={`rotate(14 ${CX} ${CY})`}>
          <path className="orbit-line orbit-line-faint" d={orbitPath(196, 150)} />
          <Traveler rx={196} ry={150} r={2.4} duration={92} delay={-50} />
        </g>

        {/* Violet ring around the core. */}
        <circle className="core-ring" cx={CX} cy={CY} r={54} />
      </svg>

      <div className="orbital-core" aria-hidden="true">
        <ArcSonareLogo size={58} />
      </div>

      {ORBIT_CHIPS.map((chip) => {
        const Icon = CHIP_ICONS[chip.icon];
        return (
          <div
            key={chip.label}
            className="orbit-chip"
            style={{ left: `${chip.x}%`, top: `${chip.y}%` }}
          >
            <span className="orbit-chip-icon">
              <Icon size={13} />
            </span>
            <span className="orbit-chip-texts">
              <span className="orbit-chip-label">{chip.label}</span>
              <span className="orbit-chip-status">{chip.status}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
