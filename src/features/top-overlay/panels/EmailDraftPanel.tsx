import {
  confirmSendEmail,
  openConnectFromOverlay,
  openEmailComposeInBrowser,
  requestSendEmailConfirmation,
  saveEmailDraftLocally,
  updatePayload,
} from "../overlayActions";
import type { EmailDraftPayload, OverlayActionPayload } from "../overlayTypes";
import { getIconById } from "../../../config/topOverlayIconRegistry";

interface EmailDraftPanelProps {
  data: EmailDraftPayload;
  requiresConfirmation: boolean;
  onCancel: () => void;
}

export function EmailDraftPanel({ data, requiresConfirmation, onCancel }: EmailDraftPanelProps) {
  const icon = getIconById(data.providerId)?.iconPath;

  const patch = (partial: Partial<EmailDraftPayload>) => {
    updatePayload({ type: "email", data: { ...data, ...partial } } satisfies OverlayActionPayload);
  };

  if (!data.providerConnected) {
    return (
      <div className="overlay-panel email-panel">
        <div className="panel-row panel-title-row">
          {icon ? <img src={icon} alt="" width={22} height={22} /> : null}
          <span>Email provider not connected</span>
          <span className="panel-muted">Draft preview</span>
        </div>
        <label className="panel-field">
          <span>To</span>
          <input value={data.to} onChange={(e) => patch({ to: e.target.value })} />
        </label>
        <label className="panel-field">
          <span>Subject</span>
          <input value={data.subject} onChange={(e) => patch({ subject: e.target.value })} />
        </label>
        <label className="panel-field">
          <span>Message</span>
          <textarea
            rows={5}
            value={data.body}
            onChange={(e) => patch({ body: e.target.value })}
          />
        </label>
        <p className="panel-note">{data.contextUsed}</p>
        <div className="panel-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-ghost" onClick={() => void openConnectFromOverlay()}>
            Open Connect
          </button>
          <button type="button" className="btn-secondary" onClick={() => void saveEmailDraftLocally()}>
            Copy draft
          </button>
          <button type="button" className="btn-primary" onClick={() => void openEmailComposeInBrowser()}>
            Open Gmail compose
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-panel email-panel">
      <div className="panel-row panel-title-row">
        {icon ? <img src={icon} alt="" width={22} height={22} /> : null}
        <span>Gmail</span>
        <span className="panel-muted">Draft preview</span>
      </div>
      <label className="panel-field">
        <span>To</span>
        <input value={data.to} onChange={(e) => patch({ to: e.target.value })} />
      </label>
      <label className="panel-field">
        <span>Subject</span>
        <input value={data.subject} onChange={(e) => patch({ subject: e.target.value })} />
      </label>
      <label className="panel-field">
        <span>Message</span>
        <textarea rows={5} value={data.body} onChange={(e) => patch({ body: e.target.value })} />
      </label>
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-secondary" onClick={() => void saveEmailDraftLocally()}>
          Save draft
        </button>
        {requiresConfirmation ? (
          <button type="button" className="btn-primary" onClick={() => void confirmSendEmail()}>
            Confirm send
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void requestSendEmailConfirmation()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
