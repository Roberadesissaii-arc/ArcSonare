import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUpRightIcon,
  BlurIcon,
  CircleIcon,
  HighlighterIcon,
  PenIcon,
  SquareIcon,
} from "../../components/Icons";
import { Slider } from "../../components/settings/Slider";
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

const SWATCHES = ["#A576FF", "#62dea0", "#ffb347", "#ff6b8a", "#ffffff"];

export function AnnotationToolsCard({
  annotation,
  onAnnotationChange,
}: AnnotationToolsCardProps) {
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

      <div className="screen-context-tool-style">
        <Slider
          value={annotation.thickness}
          min={1}
          max={10}
          onChange={(thickness) => onAnnotationChange({ thickness })}
          label="Annotation thickness"
          format={(v) => `${v}px`}
        />
        <div className="screen-context-color-swatches" role="group" aria-label="Annotation color">
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`screen-context-color-swatch${annotation.color === color ? " is-active" : ""}`}
              style={{ "--swatch": color } as CSSProperties}
              aria-label={`Color ${color}`}
              aria-pressed={annotation.color === color}
              onClick={() => onAnnotationChange({ color })}
            />
          ))}
        </div>
      </div>
    </ScreenContextCard>
  );
}
