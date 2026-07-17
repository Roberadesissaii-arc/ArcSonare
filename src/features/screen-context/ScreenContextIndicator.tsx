import { usePrefs } from "../../stores/settingsStore";

/**
 * Rendered inside each `sonare-edge-*` window: the violet perimeter that
 * says "ArcSonare is currently viewing this screen". The native window is
 * click-through and excluded from captures; everything here is decoration.
 */
export function ScreenContextIndicator() {
  const prefs = usePrefs();
  const sc = prefs.screenContext;
  const alpha = Math.max(0.2, Math.min(1, sc.edgeIntensity / 100));

  return (
    <div
      className={`edge-root edge-style-${sc.edgeStyle}`}
      style={{ "--edge-alpha": alpha } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="edge-line edge-top" />
      <span className="edge-line edge-bottom" />
      <span className="edge-line edge-left" />
      <span className="edge-line edge-right" />
      <span className="edge-corner edge-tl" />
      <span className="edge-corner edge-tr" />
      <span className="edge-corner edge-bl" />
      <span className="edge-corner edge-br" />
      <span className="edge-glow" />
      {sc.showLabel ? (
        <span className="edge-label">ArcSonare Screen Context</span>
      ) : null}
    </div>
  );
}
