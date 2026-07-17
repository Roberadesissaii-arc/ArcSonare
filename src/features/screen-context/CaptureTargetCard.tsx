import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, RefreshIcon, TargetArrowIcon } from "../../components/Icons";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import type { CaptureTarget } from "../../config/prefs";
import { listMonitors } from "./screenContextStore";
import { MonitorCard } from "./MonitorCard";
import { ScreenContextCard } from "./ScreenContextCard";
import type { MonitorInfo } from "./types";

type PrimaryTarget = "mouse-monitor" | "selected-monitor" | "all-monitors";

interface CaptureTargetCardProps {
  defaultTarget: CaptureTarget;
  selectedMonitorIds: string[];
  onTargetChange: (target: CaptureTarget) => void;
  onSelectedMonitorsChange: (ids: string[]) => void;
}

const PRIMARY: { value: PrimaryTarget; label: string }[] = [
  { value: "mouse-monitor", label: "Mouse" },
  { value: "selected-monitor", label: "Selected" },
  { value: "all-monitors", label: "Desktop" },
];

const PRIMARY_HELP: Record<PrimaryTarget, string> = {
  "mouse-monitor": "Capture the monitor that currently contains the pointer.",
  "selected-monitor": "Capture only the monitor cards you select below.",
  "all-monitors": "Capture every connected display as the entire desktop.",
};

const MORE_TARGETS: { value: CaptureTarget; label: string }[] = [
  { value: "active-window", label: "Active window" },
  { value: "region", label: "User-selected region" },
];

function primaryFromTarget(target: CaptureTarget): PrimaryTarget {
  if (
    target === "mouse-monitor" ||
    target === "selected-monitor" ||
    target === "all-monitors"
  ) {
    return target;
  }
  return "mouse-monitor";
}

export function CaptureTargetCard({
  defaultTarget,
  selectedMonitorIds,
  onTargetChange,
  onSelectedMonitorsChange,
}: CaptureTargetCardProps) {
  const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(
    defaultTarget === "active-window" || defaultTarget === "region",
  );

  const refresh = useCallback(() => {
    setError(null);
    listMonitors()
      .then(setMonitors)
      .catch((err) =>
        setError(typeof err === "string" ? err : "Monitors could not be enumerated."),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const primary = useMemo(() => primaryFromTarget(defaultTarget), [defaultTarget]);
  const moreActive = MORE_TARGETS.some((t) => t.value === defaultTarget);

  const toggleMonitor = (id: string) => {
    onSelectedMonitorsChange(
      selectedMonitorIds.includes(id)
        ? selectedMonitorIds.filter((x) => x !== id)
        : [...selectedMonitorIds, id],
    );
  };

  return (
    <ScreenContextCard
      number={2}
      title="Capture target"
      description="Choose what ArcSonare should watch."
      className="screen-context-card-target"
      action={
        <button
          type="button"
          className="screen-context-icon-btn"
          aria-label="Refresh monitors"
          onClick={refresh}
        >
          <RefreshIcon size={14} />
        </button>
      }
    >
      <SegmentedControl<PrimaryTarget>
        options={PRIMARY}
        value={primary}
        onChange={(value) => onTargetChange(value)}
        ariaLabel="Default capture target"
      />
      <p className="screen-context-target-help">{PRIMARY_HELP[primary]}</p>

      <div className="screen-context-target-summary" aria-live="polite">
        <span>
          <strong>{monitors?.length ?? "—"}</strong> monitors
        </span>
        <span>
          <strong>{selectedMonitorIds.length}</strong> selected
        </span>
        <span className="screen-context-target-summary-mode">
          {moreActive
            ? MORE_TARGETS.find((t) => t.value === defaultTarget)?.label
            : PRIMARY.find((t) => t.value === primary)?.label}
        </span>
      </div>

      <div className="screen-context-target-more">
        <button
          type="button"
          className="screen-context-target-more-toggle"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <TargetArrowIcon size={13} />
          More
          <ChevronDownIcon size={13} />
        </button>
        {moreOpen ? (
          <div className="screen-context-target-more-options" role="radiogroup" aria-label="Additional capture targets">
            {MORE_TARGETS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={defaultTarget === opt.value}
                className={`screen-context-target-chip${defaultTarget === opt.value ? " is-active" : ""}`}
                onClick={() => onTargetChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
        {moreActive && !moreOpen ? (
          <p className="screen-context-target-more-active">
            {MORE_TARGETS.find((t) => t.value === defaultTarget)?.label}
          </p>
        ) : null}
      </div>

      <div className="screen-context-monitor-list">
        {error ? (
          <p className="screen-context-field-error" role="alert">
            {error}
          </p>
        ) : null}
        {!monitors ? (
          <p className="screen-context-field-help">Enumerating monitors…</p>
        ) : (
          monitors.map((monitor, index) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              index={index}
              selected={selectedMonitorIds.includes(monitor.id)}
              onToggle={() => toggleMonitor(monitor.id)}
            />
          ))
        )}
      </div>
    </ScreenContextCard>
  );
}
