import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { SonareLiveWaveform } from "../../components/voice/SonareLiveWaveform";
import { OverlayActionIcon } from "./OverlayActionIcon";
import { OverlayStatusText, modeToOrbStatus } from "./OverlayStatusText";
import { getIconById } from "../../config/topOverlayIconRegistry";
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
  const app = applicationId ? getIconById(applicationId) : undefined;
  const icon = applicationIcon || app?.iconPath;

  return (
    <div className={`overlay-header${expanded ? " is-expanded" : ""}`}>
      <SonareMarbleOrb status={toVoiceStatus(orb)} size={50} />
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
        applicationIcon={icon}
        applicationName={app?.displayName}
        onCancel={onCancel}
      />
    </div>
  );
}
