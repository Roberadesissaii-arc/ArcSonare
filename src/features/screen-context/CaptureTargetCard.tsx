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
      .then((list) => {
        setMonitors(list);
        // Keep selection honest against live hardware; seed primary if empty.
        const valid = selectedMonitorIds.filter((id) => list.some((m) => m.id === id));
        if (valid.length !== selectedMonitorIds.length) {
          const fallback =
            valid.length > 0
              ? valid
              : list.filter((m) => m.isPrimary).map((m) => m.id);
          onSelectedMonitorsChange(
            fallback.length > 0 ? fallback : list.slice(0, 1).map((m) => m.id),
          );
        } else if (selectedMonitorIds.length === 0 && list.length > 0) {
          const primary = list.filter((m) => m.isPrimary).map((m) => m.id);
          onSelectedMonitorsChange(
            primary.length > 0 ? primary : [list[0].id],
          );
        }
      })
      .catch((err) => {
        setMonitors([]);
        setError(
          typeof err === "string"
            ? err
            : "Monitors could not be enumerated. Check display permissions and try refresh.",
        );
      });
  }, [onSelectedMonitorsChange, selectedMonitorIds]);

  useEffect(() => {
    refresh();
    // Enumerate once on mount; refresh button / target changes re-run explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primary = useMemo(() => primaryFromTarget(defaultTarget), [defaultTarget]);
  const moreActive = MORE_TARGETS.some((t) => t.value === defaultTarget);

  const applyPrimary = (value: PrimaryTarget) => {
    onTargetChange(value);
    if (!monitors || monitors.length === 0) {
      void refresh();
      return;
    }
    if (value === "all-monitors") {
      onSelectedMonitorsChange(monitors.map((m) => m.id));
    } else if (value === "selected-monitor") {
      if (selectedMonitorIds.length === 0) {
        const primaryIds = monitors.filter((m) => m.isPrimary).map((m) => m.id);
        onSelectedMonitorsChange(
          primaryIds.length > 0 ? primaryIds : [monitors[0].id],
        );
      }
    }
  };

  const toggleMonitor = (id: string) => {
    // Selecting a monitor implies Selected mode.
    if (defaultTarget !== "selected-monitor") {
      onTargetChange("selected-monitor");
    }
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
        value={moreActive ? "mouse-monitor" : primary}
        onChange={applyPrimary}
        ariaLabel="Default capture target"
      />
      <p className="screen-context-target-help">
        {moreActive
          ? MORE_TARGETS.find((t) => t.value === defaultTarget)?.label
          : PRIMARY_HELP[primary]}
      </p>

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
          <div
            className="screen-context-target-more-options"
            role="radiogroup"
            aria-label="Additional capture targets"
          >
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
        {monitors === null ? (
          <p className="screen-context-field-help">Enumerating monitors…</p>
        ) : monitors.length === 0 && !error ? (
          <p className="screen-context-field-help">
            No monitors found. Press refresh to try again.
          </p>
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
