import { ZapIcon } from "../Icons";
import { EmptyState } from "../EmptyState";
import { navigate } from "../../stores/appStore";
import { filterTasks, useTasks, type Task } from "../../stores/taskStore";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;
// The rail card can display three complete rows at every supported dashboard
// height. Additional tasks remain available through the footer instead of
// being rendered into a clipped flex area.
const URGENT_SLOTS = 3;

/** Tall right-rail card: urgent work first, then more open tasks from the list. */
export function UrgentCard() {
  const tasks = useTasks();
  const urgent = filterTasks(tasks, "urgent");
  const open = filterTasks(tasks, "open").filter(
    (t) => !urgent.some((u) => u.id === t.id),
  );

  const primary = urgent.slice(0, URGENT_SLOTS);
  const secondary = open.slice(
    0,
    primary.length >= URGENT_SLOTS
      ? 0
      : Math.min(URGENT_SLOTS, URGENT_SLOTS - primary.length),
  );
  const totalUrgent = urgent.length;
  const totalOpen = filterTasks(tasks, "open").length;

  return (
    <section className="card sonare-card urgent-card">
      <div className="card-head urgent-card-head">
        <span className="card-label">Urgent</span>
        {totalUrgent > 0 ? (
          <span className="urgent-count" aria-label={`${totalUrgent} urgent tasks`}>
            {totalUrgent}
          </span>
        ) : null}
      </div>
      <p className="card-lede">Tasks that need attention first.</p>

      {primary.length === 0 && secondary.length === 0 ? (
        <EmptyState
          icon={<ZapIcon size={23} />}
          title="All clear"
          description="Nothing urgent right now. Urgent tasks will appear here."
        />
      ) : (
        <div className="urgent-body">
          {primary.length > 0 ? (
            <ul className="urgent-list">
              {primary.map((task) => (
                <UrgentRow key={task.id} task={task} />
              ))}
            </ul>
          ) : null}

          {secondary.length > 0 ? (
            <div className="urgent-secondary">
              <span className="urgent-secondary-label">Also on your list</span>
              <ul className="urgent-list urgent-list-secondary">
                {secondary.map((task) => (
                  <UrgentRow key={task.id} task={task} muted />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <button
        type="button"
        className="card-footer-link"
        onClick={() =>
          navigate("tasks", {
            taskFilter: totalUrgent > 0 ? "urgent" : "open",
          })
        }
      >
        {totalUrgent > 0
          ? `View all tasks · ${totalOpen} open`
          : "View all tasks →"}
      </button>
    </section>
  );
}

function UrgentRow({ task, muted }: { task: Task; muted?: boolean }) {
  return (
    <li>
      <button
        type="button"
        className={`urgent-row${muted ? " is-muted" : ""}`}
        onClick={() => navigate("tasks", { taskFilter: muted ? "open" : "urgent" })}
        aria-label={`Open task: ${task.title}`}
      >
        <span className={`priority-dot sev-${task.priority}`} aria-hidden="true" />
        <span className="urgent-meta">
          <span className="urgent-title">{task.title}</span>
          {task.due ? <span className="urgent-due">{task.due}</span> : null}
        </span>
        <span className={`priority-badge pri-${task.priority}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
      </button>
    </li>
  );
}
