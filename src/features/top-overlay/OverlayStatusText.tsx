import { modeToOrbStatus, statusColorClass, type OverlayMode } from "./overlayTypes";

interface OverlayStatusTextProps {
  mode: OverlayMode;
  status: string;
  /** Tap the status line to open/close the transcript dropdown. */
  onStatusClick?: () => void;
  expanded?: boolean;
}

/** Product name + live status line (tappable for full transcript). */
export function OverlayStatusText({
  mode,
  status,
  onStatusClick,
  expanded = false,
}: OverlayStatusTextProps) {
  const clickable = Boolean(onStatusClick);
  return (
    <span className={`overlay-status-text${clickable ? " is-clickable" : ""}`}>
      <span className="ost-name">ArcSonare</span>
      {clickable ? (
        <button
          type="button"
          className={`ost-status ost-status-btn ${statusColorClass(mode)}${
            expanded ? " is-expanded" : ""
          }`}
          role="status"
          aria-live="polite"
          aria-expanded={expanded}
          title={expanded ? "Hide transcript" : "Show full transcript"}
          onClick={(e) => {
            e.stopPropagation();
            onStatusClick?.();
          }}
        >
          {status}
        </button>
      ) : (
        <span className={`ost-status ${statusColorClass(mode)}`} role="status" aria-live="polite">
          {status}
        </span>
      )}
    </span>
  );
}

export { modeToOrbStatus };
