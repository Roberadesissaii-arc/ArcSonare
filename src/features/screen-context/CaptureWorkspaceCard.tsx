import type { ReactNode } from "react";
import {
  MonitorIcon,
  ShieldCheckIcon,
  SlidersIcon,
  TargetArrowIcon,
  VolumeIcon,
  ZapIcon,
} from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import type { Prefs } from "../../config/prefs";
import { ScreenContextCard } from "./ScreenContextCard";

type ScreenContextPrefs = Prefs["screenContext"];

interface CaptureWorkspaceCardProps {
  sc: ScreenContextPrefs;
  onChange: (patch: Partial<ScreenContextPrefs>) => void;
}

type RowKey =
  | "enabled"
  | "requireConfirmation"
  | "showIndicator"
  | "playCaptureSound"
  | "includePointer"
  | "includeShadows"
  | "hideArcSonareWindows"
  | "autoDeleteTemp"
  | "askBeforeCloud";

const ROWS: {
  key: RowKey;
  label: string;
  description: string;
  icon: ReactNode;
  forceDisabled?: boolean;
  titleAttr?: string;
}[] = [
  {
    key: "enabled",
    label: "Enable Screen Context",
    description: "Allow ArcSonare to observe and capture your selected screen.",
    icon: <MonitorIcon size={14} />,
  },
  {
    key: "requireConfirmation",
    label: "Require confirmation before capture",
    description: "Ask before taking a screenshot or creating context.",
    icon: <ShieldCheckIcon size={14} />,
  },
  {
    key: "showIndicator",
    label: "Show capture indicator",
    description: "Display the violet screen edge while Screen Context is active.",
    icon: <ZapIcon size={14} />,
  },
  {
    key: "playCaptureSound",
    label: "Play capture sound",
    description: "Play a short sound when a capture is taken.",
    icon: <VolumeIcon size={14} />,
  },
  {
    key: "includePointer",
    label: "Include mouse pointer",
    description: "Include the current pointer position in captured context.",
    icon: <TargetArrowIcon size={14} />,
    forceDisabled: true,
    titleAttr: "Pointer capture is not supported by the current backend.",
  },
  {
    key: "includeShadows",
    label: "Include window shadows",
    description: "Include visible drop shadows around captured windows.",
    icon: <SlidersIcon size={14} />,
  },
  {
    key: "hideArcSonareWindows",
    label: "Hide ArcSonare windows from captures",
    description: "Exclude ArcSonare overlays and windows where Windows allows it.",
    icon: <MonitorIcon size={14} />,
  },
  {
    key: "autoDeleteTemp",
    label: "Automatically delete temporary captures",
    description: "Remove temporary files after they are no longer required.",
    icon: <SlidersIcon size={14} />,
  },
  {
    key: "askBeforeCloud",
    label: "Ask before sending captures to cloud providers",
    description: "Confirm before sharing screen content with external model services.",
    icon: <ShieldCheckIcon size={14} />,
  },
];

export function CaptureWorkspaceCard({ sc, onChange }: CaptureWorkspaceCardProps) {
  const values: Record<RowKey, boolean> = {
    enabled: sc.enabled,
    requireConfirmation: sc.requireConfirmation,
    showIndicator: sc.showIndicator,
    playCaptureSound: sc.playCaptureSound,
    includePointer: sc.includePointer,
    includeShadows: sc.includeShadows,
    hideArcSonareWindows: sc.hideArcSonareWindows,
    autoDeleteTemp: sc.autoDeleteTemp,
    askBeforeCloud: sc.askBeforeCloud,
  };

  return (
    <ScreenContextCard
      number={1}
      title="Capture workspace"
      description="Core behavior for indicators, sounds, and capture hygiene."
      className="screen-context-card-workspace"
    >
      <div className="screen-context-toggle-list">
        {ROWS.map((row) => {
          const rowDisabled =
            row.forceDisabled || (!sc.enabled && row.key !== "enabled");
          return (
            <div key={row.key} className="screen-context-toggle-row">
              <span className="screen-context-toggle-icon" aria-hidden="true">
                {row.icon}
              </span>
              <div className="screen-context-toggle-copy" title={row.titleAttr}>
                <span className="screen-context-toggle-label">{row.label}</span>
                <span className="screen-context-toggle-desc">{row.description}</span>
              </div>
              <Toggle
                checked={values[row.key]}
                onChange={(checked) => onChange({ [row.key]: checked })}
                label={row.label}
                disabled={rowDisabled}
              />
            </div>
          );
        })}
      </div>
    </ScreenContextCard>
  );
}
