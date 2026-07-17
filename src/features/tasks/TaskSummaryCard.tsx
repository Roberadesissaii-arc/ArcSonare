import type { ReactNode } from "react";
import { ChevronRightIcon } from "../../components/Icons";

export type SummaryTone = "violet" | "blue" | "red" | "green";

interface TaskSummaryCardProps {
  icon: ReactNode;
  value: number;
  label: string;
  description: string;
  tone: SummaryTone;
  selected: boolean;
  onSelect: () => void;
}

/** Smoked-titanium summary card — accent only in the icon tile (no edge stripe). */
export function TaskSummaryCard({
  icon,
  value,
  label,
  description,
  tone,
  selected,
  onSelect,
}: TaskSummaryCardProps) {
  return (
    <button
      type="button"
      className={`task-summary-card tone-${tone}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. ${description}`}
    >
      <span className="task-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="task-summary-body">
        <span className="task-summary-value">{value}</span>
        <span className="task-summary-label">{label}</span>
        <span className="task-summary-desc">{description}</span>
      </span>
      <span className="task-summary-chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  );
}
