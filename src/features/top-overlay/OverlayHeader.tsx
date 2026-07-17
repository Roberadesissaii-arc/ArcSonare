import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { SonareLiveWaveform } from "../../components/voice/SonareLiveWaveform";
import { OverlayActionIcon } from "./OverlayActionIcon";
import { OverlayStatusText, modeToOrbStatus } from "./OverlayStatusText";
import {
  getIconById,
  TOP_OVERLAY_ICONS,
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

/** Resolve app from id, or fall back to status text (“Spotify opened”). */
function resolveApp(
  applicationId: string | undefined,
  status: string,
): TopOverlayIconDefinition | undefined {
  if (applicationId) {
    const byId = getIconById(applicationId);
    if (byId?.iconPath) return byId;
  }
  // Status text may say “Drafting email…” — map that to Gmail without
  // treating the word “email” as a generic open-alias.
  const lower = status.toLowerCase();
  if (/\b(email|gmail|mail)\b/.test(lower)) {
    const gmail = getIconById("gmail");
    if (gmail?.iconPath) return gmail;
  }
  for (const entry of TOP_OVERLAY_ICONS) {
    const names = [entry.displayName, ...entry.aliases];
    if (names.some((n) => {
      const alias = n.toLowerCase();
      return alias.length >= 4 && lower.includes(alias);
    })) {
      if (entry.iconPath) return entry;
    }
  }
  return undefined;
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
  const app = resolveApp(applicationId, status);
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
