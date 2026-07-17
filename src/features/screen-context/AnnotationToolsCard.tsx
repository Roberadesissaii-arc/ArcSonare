import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUpRightIcon,
  BlurIcon,
  CircleIcon,
  HighlighterIcon,
  PenIcon,
  SquareIcon,
} from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import { Toggle } from "../../components/settings/Toggle";
import type { Prefs } from "../../config/prefs";
import { ScreenContextCard } from "./ScreenContextCard";

type AnnotationPrefs = Prefs["screenContext"]["annotation"];

interface AnnotationToolsCardProps {
  annotation: AnnotationPrefs;
  onAnnotationChange: (patch: Partial<AnnotationPrefs>) => void;
}

const TOOLS: {
  key: keyof Pick<
    AnnotationPrefs,
    "pen" | "rectangle" | "ellipse" | "arrow" | "highlighter" | "redact"
  >;
  label: string;
  icon: ReactNode;
}[] = [
  { key: "pen", label: "Pen", icon: <PenIcon size={16} /> },
  { key: "rectangle", label: "Rect", icon: <SquareIcon size={16} /> },
  { key: "ellipse", label: "Ellipse", icon: <CircleIcon size={16} /> },
  { key: "arrow", label: "Arrow", icon: <ArrowUpRightIcon size={16} /> },
  { key: "highlighter", label: "Highlighter", icon: <HighlighterIcon size={16} /> },
  { key: "redact", label: "Blur / Redact", icon: <BlurIcon size={16} /> },
];

const COLORS: { value: string; label: string }[] = [
  { value: "#A576FF", label: "Violet" },
  { value: "#7099F4", label: "Blue" },
  { value: "#55D59A", label: "Green" },
  { value: "#E8B15B", label: "Amber" },
  { value: "#E36E77", label: "Rose" },
  { value: "#FFFFFF", label: "White" },
  { value: "#E9ECEE", label: "Soft white" },
  { value: "#737C83", label: "Graphite" },
];

const THICKNESS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="screen-context-color-leading"
      style={{ "--swatch": color } as CSSProperties}
      aria-hidden="true"
    />
  );
}

export function AnnotationToolsCard({
  annotation,
  onAnnotationChange,
}: AnnotationToolsCardProps) {
  const colorOptions = COLORS.map((c) => ({
    value: c.value,
    label: c.label,
    leading: <ColorSwatch color={c.value} />,
  }));
  const thicknessOptions = THICKNESS.map((n) => ({
    value: String(n),
    label: `${n} px`,
  }));
  const nearestThickness = THICKNESS.reduce((best, n) =>
    Math.abs(n - annotation.thickness) < Math.abs(best - annotation.thickness)
      ? n
      : best,
  );
  const thicknessValue = String(
    THICKNESS.includes(annotation.thickness as (typeof THICKNESS)[number])
      ? annotation.thickness
      : nearestThickness,
  );

  const knownColor = COLORS.some((c) => c.value === annotation.color)
    ? annotation.color
    : COLORS[0].value;

  return (
    <ScreenContextCard
      number={3}
      title="Annotation tools"
      description="Mark up what matters before capture."
      className="screen-context-card-tools"
    >
      <div className="screen-context-tool-grid">
        {TOOLS.map((tool) => {
          const on = annotation[tool.key];
          return (
            <button
              key={tool.key}
              type="button"
              className={`screen-context-tool-tile${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => onAnnotationChange({ [tool.key]: !on })}
            >
              <span className="screen-context-tool-tile-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <span className="screen-context-tool-tile-label">{tool.label}</span>
            </button>
          );
        })}
      </div>

      <div className="screen-context-tool-options">
        <div className="screen-context-toggle-row is-compact">
          <div className="screen-context-toggle-copy">
            <span className="screen-context-toggle-label">Show annotation toolbar</span>
          </div>
          <Toggle
            checked={annotation.showToolbar}
            onChange={(showToolbar) => onAnnotationChange({ showToolbar })}
            label="Show annotation toolbar"
          />
        </div>
        <div className="screen-context-toggle-row is-compact">
          <div className="screen-context-toggle-copy">
            <span className="screen-context-toggle-label">Keep annotation after capture</span>
          </div>
          <Toggle
            checked={annotation.keepAfterCapture}
            onChange={(keepAfterCapture) => onAnnotationChange({ keepAfterCapture })}
            label="Keep annotation after capture"
          />
        </div>
        <div className="screen-context-toggle-row is-compact">
          <div className="screen-context-toggle-copy">
            <span className="screen-context-toggle-label">Automatically crop to annotations</span>
          </div>
          <Toggle
            checked={annotation.autoCrop}
            onChange={(autoCrop) => onAnnotationChange({ autoCrop })}
            label="Automatically crop to annotations"
          />
        </div>
      </div>

      <div className="screen-context-tool-style screen-context-tool-style-dropdowns">
        <label className="screen-context-style-field">
          <span className="screen-context-style-label">Ink color</span>
          <Dropdown
            options={colorOptions}
            value={knownColor}
            onChange={(color) => onAnnotationChange({ color })}
            ariaLabel="Annotation color"
            className="screen-context-style-dropdown"
          />
        </label>
        <label className="screen-context-style-field">
          <span className="screen-context-style-label">Stroke size</span>
          <Dropdown
            options={thicknessOptions}
            value={thicknessValue}
            onChange={(v) => onAnnotationChange({ thickness: Number(v) })}
            ariaLabel="Annotation stroke size in pixels"
            className="screen-context-style-dropdown"
          />
        </label>
      </div>
    </ScreenContextCard>
  );
}
