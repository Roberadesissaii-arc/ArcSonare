import { invoke } from "@tauri-apps/api/core";
import { MonitorIcon } from "../../../components/Icons";
import type { ScreenContextPayload } from "../overlayTypes";
import { setOverlaySuccess } from "../overlayStore";
import { playEventSound } from "../../../services/SoundService";

interface ScreenContextPanelProps {
  data: ScreenContextPayload;
  onCancel: () => void;
}

export function ScreenContextPanel({ data, onCancel }: ScreenContextPanelProps) {
  const stop = async () => {
    try {
      await invoke("stop_screen_context");
      playEventSound("screen-context-stop");
    } catch {
      // ignore
    }
    onCancel();
  };

  const useContext = () => {
    if (!data.previewDataUrl) {
      setOverlaySuccess(
        {
          title: "No capture yet",
          summary: "Start capturing before using screen context. Nothing was analyzed.",
        },
        "No capture yet",
        true,
      );
      return;
    }
    setOverlaySuccess(
      {
        title: "Context captured",
        summary: "Screenshot retained for this session. No AI analysis has run yet.",
      },
      "Context captured",
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
        <span className="panel-heading">{data.monitorLabel ?? "Screen context"}</span>
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
        <button type="button" className="btn-ghost" onClick={() => void stop()}>
          Stop
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            void invoke("open_annotation", { monitorId: null }).catch(() => undefined)
          }
        >
          Annotate
        </button>
        <button type="button" className="btn-primary" onClick={useContext}>
          Use context
        </button>
      </div>
    </div>
  );
}
