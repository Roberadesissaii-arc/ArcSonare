import { invoke } from "@tauri-apps/api/core";
import { CheckIcon } from "../../../components/Icons";
import { getIconById } from "../../../config/topOverlayIconRegistry";
import type { SuccessPayload } from "../overlayTypes";

interface SuccessPanelProps {
  data: SuccessPayload;
  onDone: () => void;
}

export function SuccessPanel({ data, onDone }: SuccessPanelProps) {
  const icon = data.applicationId
    ? getIconById(data.applicationId)?.iconPath
    : undefined;
  const isTranscript = data.summary === "Tap status to expand";

  return (
    <div className="overlay-panel success-panel">
      <div className="panel-row panel-title-row">
        {icon ? (
          <img src={icon} alt="" width={22} height={22} />
        ) : (
          <span className="panel-sys-icon success" aria-hidden="true">
            <CheckIcon size={18} />
          </span>
        )}
        <span className="panel-heading">{isTranscript ? "Transcript" : data.title}</span>
      </div>
      <p className={`panel-body${isTranscript ? " panel-body-transcript" : ""}`}>
        {isTranscript ? data.title : data.summary || data.title}
      </p>
      {data.destination ? (
        <p className="panel-note">Sent to: {data.destination}</p>
      ) : null}
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Close
        </button>
        {data.openUrl && data.openLabel ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              void invoke("overlay_open_url", { url: data.openUrl }).then(onDone)
            }
          >
            {data.openLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
