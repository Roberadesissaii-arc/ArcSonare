import { useEffect, useState } from "react";
import { listMonitors } from "./screenContextStore";
import type { MonitorInfo } from "./types";

interface MonitorSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/** Real monitor cards (number, name, resolution, scale, position, primary). */
export function MonitorSelector({ selectedIds, onChange }: MonitorSelectorProps) {
  const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMonitors()
      .then(setMonitors)
      .catch((err) =>
        setError(typeof err === "string" ? err : "Monitors could not be enumerated."),
      );
  }, []);

  if (error) {
    return (
      <p className="field-error" role="alert">
        {error}
      </p>
    );
  }
  if (!monitors) {
    return <p className="field-help">Enumerating monitors…</p>;
  }

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <div className="monitor-grid">
      {monitors.map((monitor, index) => {
        const selected = selectedIds.includes(monitor.id);
        return (
          <button
            type="button"
            key={monitor.id}
            className={`monitor-card${selected ? " selected" : ""}`}
            role="checkbox"
            aria-checked={selected}
            onClick={() => toggle(monitor.id)}
          >
            <span className="monitor-frame">
              <span className="monitor-number">{index + 1}</span>
            </span>
            <span className="monitor-meta">
              <span className="monitor-name">
                {monitor.name}
                {monitor.isPrimary ? (
                  <span className="monitor-primary">Primary</span>
                ) : null}
              </span>
              <span className="monitor-details">
                {monitor.width}×{monitor.height} ·{" "}
                {Math.round(monitor.scaleFactor * 100)}% · at {monitor.x},
                {monitor.y}
              </span>
            </span>
            <span className={`monitor-check${selected ? " on" : ""}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
