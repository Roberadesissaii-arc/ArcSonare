import {
  CalendarIcon,
  CheckIcon,
  ListIcon,
  ZapIcon,
} from "../../components/Icons";
import type { TaskFilter } from "../../stores/taskStore";
import { TaskSummaryCard } from "./TaskSummaryCard";

interface Counts {
  open: number;
  today: number;
  urgent: number;
  completed: number;
}

interface TaskSummaryGridProps {
  counts: Counts;
  activeFilter: TaskFilter;
  onFilter: (filter: TaskFilter) => void;
}

export function TaskSummaryGrid({
  counts,
  activeFilter,
  onFilter,
}: TaskSummaryGridProps) {
  return (
    <div className="task-summary-grid" aria-label="Task summary">
      <TaskSummaryCard
        icon={<ListIcon size={22} />}
        value={counts.open}
        label="Open"
        description="Tasks in progress"
        tone="violet"
        selected={activeFilter === "open"}
        onSelect={() => onFilter(activeFilter === "open" ? "all" : "open")}
      />
      <TaskSummaryCard
        icon={<CalendarIcon size={22} />}
        value={counts.today}
        label="Due today"
        description="Needs attention"
        tone="blue"
        selected={activeFilter === "today"}
        onSelect={() => onFilter(activeFilter === "today" ? "all" : "today")}
      />
      <TaskSummaryCard
        icon={<ZapIcon size={22} />}
        value={counts.urgent}
        label="Urgent"
        description="High priority"
        tone="red"
        selected={activeFilter === "urgent"}
        onSelect={() => onFilter(activeFilter === "urgent" ? "all" : "urgent")}
      />
      <TaskSummaryCard
        icon={<CheckIcon size={22} />}
        value={counts.completed}
        label="Completed"
        description="Recently finished"
        tone="green"
        selected={activeFilter === "completed"}
        onSelect={() =>
          onFilter(activeFilter === "completed" ? "all" : "completed")
        }
      />
    </div>
  );
}
