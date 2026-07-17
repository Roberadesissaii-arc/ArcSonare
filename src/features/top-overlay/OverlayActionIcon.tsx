import { CloseIcon, CheckIcon } from "../../components/Icons";
import type { OverlayMode } from "./overlayTypes";

interface OverlayActionIconProps {
  mode: OverlayMode;
  applicationIcon?: string;
  applicationName?: string;
  onCancel: () => void;
}

/**
 * Right-side circular control: Close for voice states, app icon when opening
 * or acting on an application, check/error for terminal states.
 */
export function OverlayActionIcon({
  mode,
  applicationIcon,
  applicationName,
  onCancel,
}: OverlayActionIconProps) {
  const showApp =
    Boolean(applicationIcon) &&
    (mode === "opening-app" ||
      mode === "opening-web" ||
      mode === "web-search" ||
      mode === "drafting-email" ||
      mode === "scheduling-meeting" ||
      mode === "creating-task" ||
      mode === "screen-context" ||
      mode === "responding" ||
      mode === "confirmation" ||
      mode === "success" ||
      mode === "clarifying");

  if (mode === "success" && !applicationIcon) {
    return (
      <span className="overlay-action-circle overlay-action-success" role="img" aria-label="Action completed">
        <CheckIcon size={20} />
      </span>
    );
  }

  if (mode === "error") {
    return (
      <button
        type="button"
        className="overlay-action-circle overlay-action-error"
        onClick={onCancel}
        aria-label="Dismiss error"
      >
        <CloseIcon size={17} />
      </button>
    );
  }

  if (showApp && applicationIcon) {
    return (
      <span
        className="overlay-action-circle overlay-action-app"
        role="img"
        aria-label={`${applicationName ?? "Application"} action`}
      >
        <img src={applicationIcon} alt="" width={27} height={27} draggable={false} />
      </span>
    );
  }

  return (
    <button
      type="button"
      className="overlay-action-circle overlay-action-close"
      onClick={onCancel}
      aria-label="Cancel ArcSonare request"
      title="Cancel"
    >
      <CloseIcon size={17} />
    </button>
  );
}
