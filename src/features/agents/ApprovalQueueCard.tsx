import {
  approveRequest,
  rejectRequest,
  type AgentApproval,
  type AgentConfig,
} from "./agentStore";
import { relativeTime } from "./agentHealth";

interface ApprovalQueueCardProps {
  approvals: AgentApproval[];
  agents: AgentConfig[];
  onChanged: () => void;
}

export function ApprovalQueueCard({
  approvals,
  agents,
  onChanged,
}: ApprovalQueueCardProps) {
  const pending = approvals.filter((a) => a.status === "pending");

  const agentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? "Unknown agent";

  return (
    <section className="agent-rail-card agent-surface" aria-label="Approval queue">
      <div className="agent-rail-head">
        <span className="agent-rail-label">
          Approval queue
          {pending.length > 0 ? (
            <span className="agent-rail-badge">{pending.length}</span>
          ) : null}
        </span>
      </div>
      {pending.length === 0 ? (
        <p className="agent-rail-empty">
          No approvals waiting. Agents will ask before performing protected
          actions once the runtime can execute them.
        </p>
      ) : (
        <ul className="agent-approval-list">
          {pending.map((item) => (
            <li key={item.id}>
              <div className="agent-approval-top">
                <span className={`agent-priority pri-${item.priority}`}>
                  {item.priority}
                </span>
                <span className="agent-approval-agent">
                  {agentName(item.agentId)}
                </span>
              </div>
              <p className="agent-approval-title">{item.title}</p>
              <p className="agent-approval-summary">{item.summary}</p>
              <time dateTime={item.requestedAt}>
                Requested {relativeTime(Date.parse(item.requestedAt))}
              </time>
              <div className="agent-approval-actions">
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  onClick={() => {
                    const ok = window.confirm(
                      `Approve “${item.title}”? Approval alone does not execute the action until a runtime confirms it.`,
                    );
                    if (!ok) return;
                    approveRequest(item.id);
                    onChanged();
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    rejectRequest(item.id);
                    onChanged();
                  }}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
