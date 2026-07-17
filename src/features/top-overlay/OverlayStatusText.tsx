import { modeToOrbStatus, statusColorClass, type OverlayMode } from "./overlayTypes";

interface OverlayStatusTextProps {
  mode: OverlayMode;
  status: string;
}

/** Product name + live status line. */
export function OverlayStatusText({ mode, status }: OverlayStatusTextProps) {
  return (
    <span className="overlay-status-text">
      <span className="ost-name">ArcSonare</span>
      <span className={`ost-status ${statusColorClass(mode)}`} role="status" aria-live="polite">
        {status}
      </span>
    </span>
  );
}

export { modeToOrbStatus };
