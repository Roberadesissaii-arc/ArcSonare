import { EmailDraftPanel } from "./panels/EmailDraftPanel";
import { MeetingPanel } from "./panels/MeetingPanel";
import { TaskPanel } from "./panels/TaskPanel";
import { ScreenContextPanel } from "./panels/ScreenContextPanel";
import { ConfirmationPanel } from "./panels/ConfirmationPanel";
import { SuccessPanel } from "./panels/SuccessPanel";
import { ErrorPanel } from "./panels/ErrorPanel";
import { NoticePanel } from "./panels/NoticePanel";
import type { OverlayActionPayload, OverlayError, SuccessPayload } from "./overlayTypes";

interface OverlayExpandedPanelProps {
  payload?: OverlayActionPayload;
  error?: OverlayError;
  result?: SuccessPayload;
  requiresConfirmation: boolean;
  onCancel: () => void;
}

export function OverlayExpandedPanel({
  payload,
  error,
  result,
  requiresConfirmation,
  onCancel,
}: OverlayExpandedPanelProps) {
  if (error) {
    return <ErrorPanel error={error} onCancel={onCancel} />;
  }

  if (payload?.type === "email") {
    return (
      <EmailDraftPanel
        data={payload.data}
        requiresConfirmation={requiresConfirmation}
        onCancel={onCancel}
      />
    );
  }
  if (payload?.type === "meeting") {
    return <MeetingPanel data={payload.data} onCancel={onCancel} />;
  }
  if (payload?.type === "task") {
    return <TaskPanel data={payload.data} onCancel={onCancel} />;
  }
  if (payload?.type === "screen-context") {
    return <ScreenContextPanel data={payload.data} onCancel={onCancel} />;
  }
  if (payload?.type === "clarification") {
    return <ConfirmationPanel data={payload.data} onCancel={onCancel} />;
  }
  if (payload?.type === "notice") {
    return <NoticePanel data={payload.data} onDismiss={onCancel} />;
  }
  if (payload?.type === "success" || result) {
    return (
      <SuccessPanel
        data={payload?.type === "success" ? payload.data : result!}
        onDone={onCancel}
      />
    );
  }

  return null;
}
