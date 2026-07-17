import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { SonareLiveWaveform } from "../../components/voice/SonareLiveWaveform";
import { OverlayActionIcon } from "./OverlayActionIcon";
import { OverlayStatusText, modeToOrbStatus } from "./OverlayStatusText";
import {
  getIconById,
  type TopOverlayIconDefinition,
} from "../../config/topOverlayIconRegistry";
import type { OverlayMode } from "./overlayTypes";
import type { OrbVisualStatus } from "./overlayTypes";

interface OverlayHeaderProps {
  mode: OverlayMode;
  status: string;
  applicationId?: string;
  applicationIcon?: string;
  waveformLevels: number[];
  onCancel: () => void;
  expanded: boolean;
}

function toVoiceStatus(orb: OrbVisualStatus) {
  if (orb === "opening" || orb === "confirmation") return "responding" as const;
  return orb;
}

/**
 * Resolve app only from an explicit applicationId set by an open/draft/search
 * action. Never scan status/reply text — phrases like “calendar” or “schedule”
 * in a time answer must not surface a Google Calendar icon.
 */
function resolveApp(
  applicationId: string | undefined,
): TopOverlayIconDefinition | undefined {
  if (!applicationId) return undefined;
  const byId = getIconById(applicationId);
  return byId?.iconPath ? byId : undefined;
}

export function OverlayHeader({
  mode,
  status,
  applicationId,
  applicationIcon,
  waveformLevels,
  onCancel,
  expanded,
}: OverlayHeaderProps) {
  const orb = modeToOrbStatus(mode);
  const app = resolveApp(applicationId);
  const icon =
    (applicationIcon && applicationIcon.length > 0 ? applicationIcon : undefined) ||
    app?.iconPath;

  return (
    <div className={`overlay-header${expanded ? " is-expanded" : ""}`}>
      <span className="overlay-marble">
        <SonareMarbleOrb status={toVoiceStatus(orb)} size={50} />
      </span>
      <OverlayStatusText mode={mode} status={status} />
      <span className="overlay-divider" aria-hidden="true" />
      <div className="overlay-wave">
        <SonareLiveWaveform
          variant={toVoiceStatus(orb)}
          width={230}
          height={40}
          bars={52}
          levels={waveformLevels.length ? waveformLevels : undefined}
        />
      </div>
      <OverlayActionIcon
        mode={mode}
        applicationId={app?.id ?? applicationId}
        applicationIcon={icon}
        applicationName={app?.displayName}
        onCancel={onCancel}
        expanded={expanded}
      />
    </div>
  );
}
