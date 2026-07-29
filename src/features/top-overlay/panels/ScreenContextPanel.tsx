import { MonitorIcon } from "../../../components/Icons";
import type { ScreenContextPayload } from "../overlayTypes";
import { setOverlaySuccess } from "../overlayStore";
import { playEventSound } from "../../../services/SoundService";

interface ScreenContextPanelProps {
  data: ScreenContextPayload;
  onCancel: () => void;
}

/** Generic screenshot-artifact preview — shown whenever a capability returns an image. */
export function ScreenContextPanel({ data, onCancel }: ScreenContextPanelProps) {
  const useContext = () => {
    if (!data.previewDataUrl) {
      setOverlaySuccess(
        {
          title: "No capture yet",
          summary: "Nothing was captured yet.",
        },
        "No capture yet",
        true,
      );
      return;
    }
    setOverlaySuccess(
      {
        title: "Screenshot captured",
        summary: "Screenshot retained for this session. No AI analysis has run yet.",
      },
      "Screenshot captured",
      true,
    );
    playEventSound("task-completed");
  };

  return (
    <div className="overlay-panel screen-panel">
      <div className="panel-row panel-title-row">
        <span className="panel-sys-icon" aria-hidden="true">
          <MonitorIcon size={18} />
        </span>
        <span className="panel-heading">{data.monitorLabel ?? "Screenshot"}</span>
      </div>
      <div className="screen-preview">
        {data.previewDataUrl ? (
          <img src={data.previewDataUrl} alt="Screen capture preview" />
        ) : (
          <div className="screen-preview-empty">No capture yet</div>
        )}
      </div>
      <p className="panel-note">
        <span className="pulse-dot" aria-hidden="true" />
        {data.privacyNote}
      </p>
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Close
        </button>
        <button type="button" className="btn-primary" onClick={useContext}>
          Use screenshot
        </button>
      </div>
    </div>
  );
}
