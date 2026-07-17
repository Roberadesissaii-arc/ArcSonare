import { confirmCreateTask, updatePayload } from "../overlayActions";
import type { OverlayActionPayload, TaskPayload } from "../overlayTypes";
import { ListIcon } from "../../../components/Icons";

interface TaskPanelProps {
  data: TaskPayload;
  onCancel: () => void;
}

export function TaskPanel({ data, onCancel }: TaskPanelProps) {
  const patch = (partial: Partial<TaskPayload>) => {
    updatePayload({ type: "task", data: { ...data, ...partial } } satisfies OverlayActionPayload);
  };

  return (
    <div className="overlay-panel task-panel">
      <div className="panel-row panel-title-row">
        <span className="panel-sys-icon" aria-hidden="true">
          <ListIcon size={18} />
        </span>
        <span className="panel-heading">New task</span>
      </div>
      <label className="panel-field">
        <span>Title</span>
        <input value={data.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>
      <label className="panel-field">
        <span>Description</span>
        <textarea
          rows={3}
          value={data.description ?? ""}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </label>
      <div className="panel-meta">
        <div>
          <span className="panel-label">Due</span>
          <strong>{data.dueLabel ?? "—"}</strong>
        </div>
        <div>
          <span className="panel-label">Assignee</span>
          <strong>{data.assignee ?? "—"}</strong>
        </div>
        <div>
          <span className="panel-label">Priority</span>
          <strong>{data.priority ?? "medium"}</strong>
        </div>
      </div>
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void confirmCreateTask()}
          disabled={!data.title.trim()}
        >
          Create Task
        </button>
      </div>
    </div>
  );
}
