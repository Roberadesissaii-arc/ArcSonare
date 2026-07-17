import { SparkleIcon } from "../../../components/Icons";
import { getIconById } from "../../../config/topOverlayIconRegistry";
import {
  requestSendEmailConfirmation,
  updatePayload,
} from "../overlayActions";
import type { EmailDraftPayload, OverlayActionPayload } from "../overlayTypes";

interface EmailDraftPanelProps {
  data: EmailDraftPayload;
  requiresConfirmation: boolean;
  onCancel: () => void;
}

/** Draft-email dropdown matching the ArcSonare top-overlay reference. */
export function EmailDraftPanel({ data }: EmailDraftPanelProps) {
  const icon = getIconById(data.providerId)?.iconPath;

  const patch = (partial: Partial<EmailDraftPayload>) => {
    updatePayload({ type: "email", data: { ...data, ...partial } } satisfies OverlayActionPayload);
  };

  return (
    <div className="overlay-panel email-panel email-panel-ref">
      <div className="panel-row panel-title-row">
        {icon ? <img src={icon} alt="" width={22} height={22} draggable={false} /> : null}
        <span className="panel-heading">Draft email</span>
      </div>

      <div className="email-meta">
        <div className="email-meta-row">
          <span className="email-meta-label">To</span>
          <input
            className="email-meta-value"
            value={data.to}
            aria-label="To"
            onChange={(e) => patch({ to: e.target.value })}
          />
        </div>
        <div className="email-meta-row">
          <span className="email-meta-label">Subject</span>
          <input
            className="email-meta-value"
            value={data.subject}
            aria-label="Subject"
            onChange={(e) => patch({ subject: e.target.value })}
          />
        </div>
      </div>

      <textarea
        className="email-body"
        rows={4}
        value={data.body}
        aria-label="Message"
        onChange={(e) => patch({ body: e.target.value })}
      />

      <div className="email-foot">
        <button
          type="button"
          className="email-sparkle-btn"
          aria-label="Send draft"
          title="Send"
          onClick={() => void requestSendEmailConfirmation()}
        >
          <SparkleIcon size={20} />
        </button>
      </div>
    </div>
  );
}
