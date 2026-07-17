import { confirmScheduleMeeting } from "../overlayActions";
import type { MeetingPayload } from "../overlayTypes";
import { getIconById } from "../../../config/topOverlayIconRegistry";

interface MeetingPanelProps {
  data: MeetingPayload;
  onCancel: () => void;
}

export function MeetingPanel({ data, onCancel }: MeetingPanelProps) {
  const icon = getIconById(data.providerId)?.iconPath;

  return (
    <div className="overlay-panel meeting-panel">
      <div className="panel-row panel-title-row">
        {icon ? <img src={icon} alt="" width={22} height={22} /> : null}
        <span className="panel-heading">{data.title}</span>
      </div>
      <div className="panel-meta">
        <div>
          <span className="panel-label">When</span>
          <strong>
            {data.dateLabel}, {data.startTime} – {data.endTime}
          </strong>
        </div>
        <div>
          <span className="panel-label">Duration</span>
          <strong>{data.durationLabel}</strong>
        </div>
        <div>
          <span className="panel-label">Location</span>
          <strong>{data.location ?? "—"}</strong>
        </div>
      </div>
      {data.hasConflict ? (
        <p className="panel-warning">Possible conflict on your calendar</p>
      ) : null}
      <p className="panel-note">Scheduling requires a connected calendar provider.</p>
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void confirmScheduleMeeting()}>
          Schedule
        </button>
      </div>
    </div>
  );
}
