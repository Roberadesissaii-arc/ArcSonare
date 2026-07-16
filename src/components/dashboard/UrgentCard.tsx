import { navigate } from "../../stores/appStore";
import { filterTasks, useTasks } from "../../stores/taskStore";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** Urgent work pulled from the shared task store. */
export function UrgentCard() {
  const tasks = useTasks();
  const urgent = filterTasks(tasks, "urgent").slice(0, 4);

  return (
    <section className="card urgent-card">
      <div className="card-head">
        <span className="card-label">Urgent</span>
      </div>
      {urgent.length === 0 ? (
        <p className="card-text">Nothing urgent right now.</p>
      ) : (
        <ul className="urgent-list">
          {urgent.map((task) => (
            <li key={task.id} className="urgent-row">
              <span className={`severity-dot sev-${task.priority}`} aria-hidden="true" />
              <span className="urgent-meta">
                <span className="urgent-title">{task.title}</span>
                {task.due ? <span className="urgent-due">{task.due}</span> : null}
              </span>
              <span className={`priority-badge pri-${task.priority}`}>
                {PRIORITY_LABEL[task.priority]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="card-footer-link"
        onClick={() => navigate("tasks", { taskFilter: "urgent" })}
      >
        View all urgent →
      </button>
    </section>
  );
}
