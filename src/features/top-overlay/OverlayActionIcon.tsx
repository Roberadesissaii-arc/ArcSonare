import { ChevronDownIcon, CloseIcon } from "../../components/Icons";
import { getIconById } from "../../config/topOverlayIconRegistry";
import type { OverlayMode } from "./overlayTypes";

interface OverlayActionIconProps {
  mode: OverlayMode;
  applicationId?: string;
  applicationIcon?: string;
  applicationName?: string;
  onCancel: () => void;
  /** When true, show the Gemini-style app chip with chevron (dropdown affordance). */
  expanded?: boolean;
}

const DROPDOWN_MODES: OverlayMode[] = [
  "drafting-email",
  "scheduling-meeting",
  "creating-task",
  "screen-context",
  "confirmation",
  "clarifying",
];

const APP_LOGO_MODES: OverlayMode[] = [
  "opening-app",
  "opening-web",
  "web-search",
  "drafting-email",
  "scheduling-meeting",
  "creating-task",
  "screen-context",
  "responding",
  "confirmation",
  "success",
  "clarifying",
];

/**
 * Right-side control: close (X), app logo hold, or Gemini-style app chip
 * with chevron when a draft dropdown is open.
 */
export function OverlayActionIcon({
  mode,
  applicationId,
  applicationIcon,
  applicationName,
  onCancel,
  expanded,
}: OverlayActionIconProps) {
  const fromRegistry = applicationId ? getIconById(applicationId) : undefined;
  const resolvedIcon =
    (applicationIcon && applicationIcon.length > 0 ? applicationIcon : undefined) ||
    (fromRegistry?.iconPath && fromRegistry.iconPath.length > 0
      ? fromRegistry.iconPath
      : undefined);
  const resolvedName = applicationName || fromRegistry?.displayName;

  const showDropdownChip =
    Boolean(resolvedIcon) &&
    (expanded || DROPDOWN_MODES.includes(mode)) &&
    DROPDOWN_MODES.includes(mode);

  if (showDropdownChip && resolvedIcon) {
    return (
      <span
        className="overlay-action-chip"
        role="img"
        aria-label={`${resolvedName ?? "Application"} draft`}
      >
        <span className="overlay-action-chip-inner">
          <img src={resolvedIcon} alt="" width={22} height={22} draggable={false} />
          <ChevronDownIcon size={14} />
        </span>
      </span>
    );
  }

  const showApp = Boolean(resolvedIcon) && APP_LOGO_MODES.includes(mode);
  if (showApp && resolvedIcon) {
    return (
      <span
        className="overlay-action-circle overlay-action-app"
        role="img"
        aria-label={`${resolvedName ?? "Application"} action`}
      >
        <img src={resolvedIcon} alt="" width={27} height={27} draggable={false} />
      </span>
    );
  }

  if (mode === "success") {
    return (
      <button
        type="button"
        className="overlay-action-circle overlay-action-close"
        onClick={onCancel}
        aria-label="Close ArcSonare"
        title="Close"
      >
        <CloseIcon size={17} />
      </button>
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
