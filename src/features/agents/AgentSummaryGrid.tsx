import {
  BotIcon,
  CheckIcon,
  ClockIcon,
  WarningIcon,
} from "../../components/Icons";
import { AgentSummaryCard } from "./AgentSummaryCard";

interface Counts {
  active: number;
  idleConfigured: number;
  paused: number;
  completedToday: number;
  waiting: number;
  waitingHigh: number;
  failed: number;
}

interface AgentSummaryGridProps {
  counts: Counts;
  focus: "none" | "waiting" | "failed" | "active" | "completed";
  onFocus: (focus: AgentSummaryGridProps["focus"]) => void;
}

export function AgentSummaryGrid({
  counts,
  focus,
  onFocus,
}: AgentSummaryGridProps) {
  return (
    <div className="agent-summary-grid" aria-label="Agent summary">
      <AgentSummaryCard
        icon={<BotIcon size={20} />}
        value={counts.active}
        label="Active agents"
        support={
          counts.active === 0
            ? "No agents are currently active."
            : `${counts.idleConfigured} idle · ${counts.paused} paused`
        }
        tone="violet"
        selected={focus === "active"}
        onSelect={() => onFocus(focus === "active" ? "none" : "active")}
        /* No fabricated sparklines — empty until utilization history exists. */
        spark={[]}
      />
      <AgentSummaryCard
        icon={<CheckIcon size={20} />}
        value={counts.completedToday}
        label="Tasks completed today"
        support={
          counts.completedToday === 0
            ? "No comparison available"
            : "From assigned agent tasks"
        }
        tone="blue"
        selected={focus === "completed"}
        onSelect={() => onFocus(focus === "completed" ? "none" : "completed")}
        spark={[]}
      />
      <AgentSummaryCard
        icon={<ClockIcon size={20} />}
        value={counts.waiting}
        label="Waiting for approval"
        support={
          counts.waiting === 0
            ? "Queue is clear"
            : `${counts.waitingHigh} high priority`
        }
        tone="orange"
        selected={focus === "waiting"}
        onSelect={() => onFocus(focus === "waiting" ? "none" : "waiting")}
      />
      <AgentSummaryCard
        icon={<WarningIcon size={20} />}
        value={counts.failed}
        label="Failed actions"
        support={
          counts.failed === 0
            ? "No failed actions"
            : `${counts.failed} need attention`
        }
        tone="red"
        selected={focus === "failed"}
        onSelect={() => onFocus(focus === "failed" ? "none" : "failed")}
      />
    </div>
  );
}
