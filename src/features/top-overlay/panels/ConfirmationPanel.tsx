import { runOverlayIntent } from "../overlayActions";
import type { ClarificationPayload } from "../overlayTypes";
import { getIconById } from "../../../config/topOverlayIconRegistry";

interface ConfirmationPanelProps {
  data: ClarificationPayload;
  onCancel: () => void;
}

export function ConfirmationPanel({ data, onCancel }: ConfirmationPanelProps) {
  return (
    <div className="overlay-panel confirm-panel">
      <p className="panel-heading">{data.question}</p>
      <div className="confirm-options">
        {data.options.map((opt) => {
          const icon = getIconById(opt.id)?.iconPath;
          return (
            <button
              key={opt.id}
              type="button"
              className="confirm-option"
              onClick={() =>
                void runOverlayIntent({
                  kind: "open",
                  appId: opt.id,
                  entry: getIconById(opt.id)!,
                })
              }
            >
              {icon ? <img src={icon} alt="" width={22} height={22} /> : null}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
