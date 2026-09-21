import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { filterTasks, setTaskPrefs, useTasks } from "../../stores/taskStore";
import { navigate } from "../../stores/appStore";
import { useVoiceState } from "../../stores/voiceStore";
import { usePrefs } from "../../stores/settingsStore";
import { characterById } from "../../features/voice-settings/voiceCharacters";
import { BotIcon, CalendarIcon, ListIcon, SearchIcon } from "../Icons";
import { ArcSonareCore } from "./ArcSonareCore";
import { OrbitActionChip } from "./OrbitActionChip";
import { SonareMarbleOrb, type MarbleTint } from "../voice/SonareMarbleOrb";

const CX = 360;
const CY = 240;
const GLOBE_SIZE = 168;

type OrbitChipData = {
  icon: "search" | "tasks" | "calendar" | "agent";
  label: string;
  status: string;
};

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
  chip: OrbitChipData;
  taskId?: string;
  rx: number;
  ry: number;
  counter: number;
  duration: number;
  delay: number;
  restAt: number;
}

const TILT_A = -17;
const TILT_B = 14;

/**
 * Fixed sample chips for the sign-in screen.
 *
 * The signed-in dashboard orbits the user's real open tasks. The sign-in page
 * must never do that — it renders before authentication, so real task titles
 * would be readable by anyone looking at a locked machine.
 */
const EXAMPLE_CHIPS: OrbitChipData[] = [
  { icon: "tasks", label: "Draft the launch brief", status: "Today" },
  { icon: "calendar", label: "Team sync at 3:00", status: "Today" },
  { icon: "agent", label: "Summarise this week", status: "Agent" },
  { icon: "search", label: "Find the Q3 report", status: "Open" },
];

const ORBIT_SLOTS: Omit<ChipOrbitDef, "chip">[] = [
  { id: "chip-0", rx: 268, ry: 104, counter: 17, duration: 72, delay: -38, restAt: 53 },
  { id: "chip-1", rx: 238, ry: 92, counter: 17, duration: 88, delay: -11, restAt: 12 },
  { id: "chip-2", rx: 200, ry: 152, counter: -14, duration: 64, delay: -51, restAt: 80 },
  { id: "chip-3", rx: 220, ry: 132, counter: -14, duration: 78, delay: -28, restAt: 35 },
];

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

/** Experimental: the marble riding one of the existing orbits as a traveler. */
function OrbitingMarble({
  rx,
  ry,
  size,
  duration,
  delay = 0,
  tint,
}: {
  rx: number;
  ry: number;
  size: number;
  duration: number;
  delay?: number;
  tint: MarbleTint;
}) {
  return (
    <foreignObject
      className="orbit-marble-travel"
      x={-size / 2}
      y={-size / 2}
      width={size}
      height={size}
      overflow="visible"
      style={{
        offsetPath: `path('${orbitPath(rx, ry)}')`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      }}
    >
      <SonareMarbleOrb size={size} tint={tint} />
    </foreignObject>
  );
}

function OrbitingChip({
  def,
  depth,
  visible,
  hovered,
  onHoverChange,
  onActivate,
}: {
  def: ChipOrbitDef;
  depth: "front" | "back";
  visible: boolean;
  hovered: boolean;
  onHoverChange: (chipId: string | null) => void;
  onActivate: (taskId: string) => void;
}) {
  const Icon = CHIP_ICONS[def.chip.icon];
  return (
    <g
      data-chip-id={def.id}
      data-depth={depth}
      className={`orbit-chip-motion orbit-chip-depth-${depth}${visible ? " is-visible" : " is-hidden"}${hovered ? " is-hovered" : ""}`}
      style={{
        offsetPath: `path('${orbitPath(def.rx, def.ry)}')`,
        offsetDistance: `${def.restAt}%`,
        animationDuration: `${def.duration}s`,
        animationDelay: `${def.delay}s`,
      }}
    >
      <foreignObject x={-85} y={-27} width={170} height={54} overflow="visible">
        <div
          className={`orbit-chip-holder${def.taskId ? " is-actionable" : ""}`}
          style={{ transform: `rotate(${def.counter}deg)` }}
          role={def.taskId ? "button" : undefined}
          tabIndex={def.taskId && visible ? 0 : undefined}
          aria-label={def.taskId ? `Open task: ${def.chip.label}` : undefined}
          onPointerEnter={() => {
            if (visible) onHoverChange(def.id);
          }}
          onPointerLeave={() => onHoverChange(null)}
          onClick={() => {
            if (visible && def.taskId) onActivate(def.taskId);
          }}
          onKeyDown={(event) => {
            if (
              visible &&
              def.taskId &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              onActivate(def.taskId);
            }
          }}
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
  hoveredChipId,
  onHoverChange,
  onActivate,
}: {
  chips: ChipOrbitDef[];
  front: Record<string, boolean>;
  hoveredChipId: string | null;
  onHoverChange: (chipId: string | null) => void;
  onActivate: (taskId: string) => void;
}) {
  return (
    <>
      {chips.map((def) => (
        <OrbitingChip
          key={`${def.id}-back`}
          def={def}
          depth="back"
          visible={!front[def.id]}
          hovered={hoveredChipId === def.id}
          onHoverChange={onHoverChange}
          onActivate={onActivate}
        />
      ))}
    </>
  );
}

function ChipSetFront({
  chips,
  front,
  hoveredChipId,
  onHoverChange,
  onActivate,
}: {
  chips: ChipOrbitDef[];
  front: Record<string, boolean>;
  hoveredChipId: string | null;
  onHoverChange: (chipId: string | null) => void;
  onActivate: (taskId: string) => void;
}) {
  return (
    <>
      {chips.map((def) => (
        <OrbitingChip
          key={`${def.id}-front`}
          def={def}
          depth="front"
          visible={Boolean(front[def.id])}
          hovered={hoveredChipId === def.id}
          onHoverChange={onHoverChange}
          onActivate={onActivate}
        />
      ))}
    </>
  );
}

/**
 * Atmospheric map with orbit chips.
 *
 * @param examples — render fixed sample chips instead of the user's tasks.
 *   Used by the sign-in screen, which must not expose real data.
 */
export function OrbitalCommandMap({ examples = false }: { examples?: boolean } = {}) {
  const voice = useVoiceState();
  const tasks = useTasks();
  const prefs = usePrefs();
  const marbleTint = characterById(prefs.voice.voiceId).marbleTint;
  const [hoveredChipId, setHoveredChipId] = useState<string | null>(null);
  const chipHover = hoveredChipId !== null;

  const allChips = useMemo(() => {
    if (examples) {
      return EXAMPLE_CHIPS.map((chip, i) => ({ ...ORBIT_SLOTS[i], chip }));
    }
    const open = filterTasks(tasks, "open");
    const urgent = filterTasks(tasks, "urgent");
    const today = filterTasks(tasks, "today");
    const ranked = [
      ...urgent,
      ...today.filter((t) => !urgent.some((u) => u.id === t.id)),
      ...open.filter(
        (t) =>
          !urgent.some((u) => u.id === t.id) && !today.some((d) => d.id === t.id),
      ),
    ].slice(0, 4);

    // No placeholder cards — empty galaxy until the user has real open tasks.
    if (ranked.length === 0) return [] as ChipOrbitDef[];

    return ranked.map((t, i) => ({
      ...ORBIT_SLOTS[i],
      taskId: t.id,
      chip: {
        icon: (t.agent
          ? "agent"
          : t.dueBucket !== "none"
            ? "calendar"
            : i % 2 === 0
              ? "tasks"
              : "search") as OrbitChipData["icon"],
        label: t.title.length > 22 ? `${t.title.slice(0, 20)}…` : t.title,
        status: t.urgent
          ? "Urgent"
          : t.due
            ? t.due
            : t.dueBucket === "today"
              ? "Today"
              : "Open",
      },
    }));
  }, [tasks, examples]);

  const chipsA = allChips.slice(0, 2);
  const chipsB = allChips.slice(2, 4);

  const openTask = (taskId: string) => {
    setTaskPrefs({ lastSelectedId: taskId });
    navigate("tasks", { taskFilter: "all" });
  };

  const [front, setFront] = useState<Record<string, boolean>>({});
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
        for (const def of allChips) {
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
  }, [allChips]);

  return (
    <div
      ref={mapRef}
      className={`orbital-map${chipHover ? " is-orbit-paused" : ""}${systemActive ? " is-system-active" : ""}`}
    >
      <svg
        className="orbital-svg"
        viewBox="0 0 720 480"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden={examples ? true : undefined}
        aria-label={examples ? undefined : "Orbiting task shortcuts"}
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
          <OrbitingMarble rx={238} ry={92} size={30} duration={64} delay={-12} tint={marbleTint} />
        </g>
        <g transform={`rotate(${TILT_B} ${CX} ${CY})`}>
          <path className="orbit-line orbit-fade-b" d={orbitPath(200, 152)} />
          <Traveler rx={200} ry={152} r={2.4} duration={104} delay={-52} />
          <Traveler rx={200} ry={152} r={1.7} duration={104} delay={-14} />
        </g>

        <g transform={`rotate(${TILT_A} ${CX} ${CY})`} className="orbit-chip-layer-back">
          <ChipSet
            chips={chipsA}
            front={front}
            hoveredChipId={hoveredChipId}
            onHoverChange={setHoveredChipId}
            onActivate={openTask}
          />
        </g>
        <g transform={`rotate(${TILT_B} ${CX} ${CY})`} className="orbit-chip-layer-back">
          <ChipSet
            chips={chipsB}
            front={front}
            hoveredChipId={hoveredChipId}
            onHoverChange={setHoveredChipId}
            onActivate={openTask}
          />
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

        <g transform={`rotate(${TILT_A} ${CX} ${CY})`} className="orbit-chip-layer-front">
          <ChipSetFront
            chips={chipsA}
            front={front}
            hoveredChipId={hoveredChipId}
            onHoverChange={setHoveredChipId}
            onActivate={openTask}
          />
        </g>
        <g transform={`rotate(${TILT_B} ${CX} ${CY})`} className="orbit-chip-layer-front">
          <ChipSetFront
            chips={chipsB}
            front={front}
            hoveredChipId={hoveredChipId}
            onHoverChange={setHoveredChipId}
            onActivate={openTask}
          />
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
