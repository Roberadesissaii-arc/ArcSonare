import type { ReactNode } from "react";
import { ChevronRightIcon } from "../../components/Icons";

export type SummaryTone = "violet" | "blue" | "orange" | "red";

interface AgentSummaryCardProps {
  icon: ReactNode;
  value: number;
  label: string;
  support: string;
  tone: SummaryTone;
  selected?: boolean;
  onSelect?: () => void;
  spark?: number[];
}

export function AgentSummaryCard({
  icon,
  value,
  label,
  support,
  tone,
  selected,
  onSelect,
  spark = [],
}: AgentSummaryCardProps) {
  const max = Math.max(1, ...spark);
  return (
    <button
      type="button"
      className={`agent-summary-card tone-${tone}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. ${support}`}
    >
      <span className="agent-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="agent-summary-body">
        <span className="agent-summary-value">{value}</span>
        <span className="agent-summary-label">{label}</span>
        <span className="agent-summary-support">{support}</span>
      </span>
      <span className="agent-summary-side" aria-hidden="true">
        <span className="agent-summary-spark">
          {spark.length > 0
            ? spark.map((n, i) => (
                <span
                  key={i}
                  style={{ height: `${Math.max(12, (n / max) * 100)}%` }}
                />
              ))
            : Array.from({ length: 7 }, (_, i) => (
                <span key={i} className="is-empty" style={{ height: "20%" }} />
              ))}
        </span>
        <ChevronRightIcon size={14} />
      </span>
    </button>
  );
}
