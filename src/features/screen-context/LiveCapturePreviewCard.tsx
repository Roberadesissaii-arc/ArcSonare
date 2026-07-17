import { Toggle } from "../../components/settings/Toggle";
import type { EdgeStyle, Prefs } from "../../config/prefs";
import { ScreenContextCard } from "./ScreenContextCard";

type ScreenContextPrefs = Prefs["screenContext"];

interface LiveCapturePreviewCardProps {
  sc: ScreenContextPrefs;
  onChange: (patch: Partial<ScreenContextPrefs>) => void;
}

function activeToolLabel(annotation: ScreenContextPrefs["annotation"]): string {
  if (annotation.pen) return "Pen";
  if (annotation.rectangle) return "Rectangle";
  if (annotation.ellipse) return "Ellipse";
  if (annotation.arrow) return "Arrow";
  if (annotation.highlighter) return "Highlighter";
  if (annotation.redact) return "Blur / redact";
  return "None enabled";
}

export function LiveCapturePreviewCard({
  sc,
  onChange,
}: LiveCapturePreviewCardProps) {
  const edgeClass =
    sc.edgeStyle === "corners"
      ? "edge-corners"
      : sc.edgeStyle === "pulse"
        ? "edge-pulse"
        : "edge-perimeter";

  return (
    <ScreenContextCard
      number={4}
      title="Live capture preview"
      description="See how ArcSonare understands what you highlight."
      className="screen-context-card-preview"
    >
      <div
        className={`screen-context-live-preview${sc.showIndicator ? " has-edge" : ""} ${edgeClass}${sc.cursorTrailEnabled ? " has-trail" : ""}`}
        role="img"
        aria-label="Screen context preview illustration"
      >
        <div className="screen-context-live-scene">
          <span className="screen-context-live-edge" aria-hidden="true" />
          {sc.cursorCompanionEnabled ? (
            <span className="screen-context-live-cursor" aria-hidden="true" />
          ) : null}
          {sc.cursorTrailEnabled ? (
            <span className="screen-context-live-trail" aria-hidden="true" />
          ) : null}
          <span
            className="screen-context-live-annotation"
            aria-hidden="true"
            style={{ borderColor: sc.annotation.color }}
          />
          {sc.showLabel ? (
            <span className="screen-context-live-label">ArcSonare Screen Context</span>
          ) : null}
        </div>
      </div>

      <ul className="screen-context-live-legend">
        <li>
          <span className="screen-context-legend-dot edge" />
          Edge indicator
          {!sc.showIndicator ? " (hidden)" : ` · ${sc.edgeStyle}`}
        </li>
        <li>
          <span
            className="screen-context-legend-dot annotation"
            style={{ background: sc.annotation.color }}
          />
          Annotations · {activeToolLabel(sc.annotation)}
        </li>
        <li>
          <span className="screen-context-legend-dot trail" />
          Pointer trail
          {!sc.cursorTrailEnabled ? " (off)" : ""}
        </li>
      </ul>

      <div className="screen-context-live-toggles">
        <div className="screen-context-toggle-row is-compact">
          <div className="screen-context-toggle-copy">
            <span className="screen-context-toggle-label">Cursor companion</span>
            <span className="screen-context-toggle-desc">
              Decorative cursor in preview and hero monitor.
            </span>
          </div>
          <Toggle
            checked={sc.cursorCompanionEnabled}
            onChange={(cursorCompanionEnabled) => onChange({ cursorCompanionEnabled })}
            label="Cursor companion"
          />
        </div>
        <div className="screen-context-toggle-row is-compact">
          <div className="screen-context-toggle-copy">
            <span className="screen-context-toggle-label">Pointer trail</span>
          </div>
          <Toggle
            checked={sc.cursorTrailEnabled}
            onChange={(cursorTrailEnabled) => onChange({ cursorTrailEnabled })}
            label="Pointer trail"
          />
        </div>
        <div className="screen-context-toggle-row is-compact">
          <div className="screen-context-toggle-copy">
            <span className="screen-context-toggle-label">Show edge label</span>
          </div>
          <Toggle
            checked={sc.showLabel}
            onChange={(showLabel) => onChange({ showLabel })}
            label="Show edge label"
            disabled={!sc.enabled}
          />
        </div>
      </div>

      <div className="screen-context-edge-style" aria-label="Edge style preview">
        {(["perimeter", "corners", "pulse"] as EdgeStyle[]).map((style) => (
          <button
            key={style}
            type="button"
            className={`screen-context-edge-style-btn${sc.edgeStyle === style ? " is-active" : ""}`}
            onClick={() => onChange({ edgeStyle: style })}
          >
            {style}
          </button>
        ))}
      </div>
    </ScreenContextCard>
  );
}
