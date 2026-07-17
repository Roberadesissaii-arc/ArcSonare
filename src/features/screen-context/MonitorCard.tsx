import { CheckIcon } from "../../components/Icons";
import type { MonitorInfo } from "./types";

function resolutionLabel(height: number, scaleFactor: number): string {
  let tier = `${height}p`;
  if (height >= 2160) tier = "4K";
  else if (height >= 1440) tier = "1440p";
  else if (height >= 1080) tier = "1080p";
  else if (height >= 720) tier = "720p";
  return `${tier} · ${Math.round(scaleFactor * 100)}%`;
}

interface MonitorCardProps {
  monitor: MonitorInfo;
  index: number;
  selected: boolean;
  onToggle: () => void;
}

export function MonitorCard({ monitor, index, selected, onToggle }: MonitorCardProps) {
  return (
    <button
      type="button"
      className={`screen-context-monitor-card${selected ? " is-selected" : ""}`}
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
    >
      <span className="screen-context-monitor-frame" aria-hidden="true">
        <span className="screen-context-monitor-num">{index + 1}</span>
      </span>
      <span className="screen-context-monitor-meta">
        <span className="screen-context-monitor-top">
          <span className="screen-context-monitor-res">
            {resolutionLabel(monitor.height, monitor.scaleFactor)}
          </span>
          <span className="screen-context-monitor-role">
            {monitor.isPrimary ? "Primary" : "Secondary"}
          </span>
        </span>
        <span className="screen-context-monitor-name">
          {monitor.name} {monitor.width}×{monitor.height}
        </span>
        <span className="screen-context-monitor-pos">
          at {monitor.x}, {monitor.y}
        </span>
      </span>
      <span
        className={`screen-context-monitor-check${selected ? " is-on" : ""}`}
        aria-hidden="true"
      >
        {selected ? <CheckIcon size={12} /> : null}
      </span>
    </button>
  );
}
