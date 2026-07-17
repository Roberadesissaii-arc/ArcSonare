import { useEffect, useRef, useState } from "react";
import { DotsIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { modelById } from "../../config/modelRegistry";
import { characterById } from "../voice-settings/voiceCharacters";
import type { AgentConfig } from "./agentStore";
import { PERMISSION_AREAS } from "./agentStore";
import {
  canActivate,
  capabilityTags,
  currentTaskForAgent,
  deriveAgentStatus,
  relativeTime,
  statusLabel,
} from "./agentSelectors";
import type { Task } from "../../stores/taskStore";
import { agentAvatarSrc } from "./agentAvatars";

interface AgentCardProps {
  agent: AgentConfig;
  tasks: Task[];
  selected?: boolean;
  onOpen: () => void;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
  onAssign: () => void;
  onSetPrime: () => void;
  view: "grid" | "list";
}

export function AgentCard({
  agent,
  tasks,
  selected,
  onOpen,
  onToggle,
  onDelete,
  onAssign,
  onSetPrime,
  view,
}: AgentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const status = deriveAgentStatus(agent);
  const model = modelById(agent.modelId);
  const voice = characterById(agent.voice.voiceId);
  const tools = PERMISSION_AREAS.filter(
    (a) => agent.permissions[a.id] !== "deny",
  ).length;
  const current = currentTaskForAgent(tasks, agent);
  const tags = capabilityTags(agent);
  const activation = canActivate(agent);
  const toggleDisabled = !agent.enabled && !activation.ok;
  const avatarSrc = agentAvatarSrc(agent.avatarId);

  useEffect(() => {
    if (!menuOpen) return;
    const onPtr = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPtr);
    return () => window.removeEventListener("pointerdown", onPtr);
  }, [menuOpen]);

  const runtimeLabel =
    agent.runtimeType === "manual"
      ? "Manual"
      : agent.runtimeType === "local"
        ? "Local"
        : agent.runtimeType === "cloud"
          ? "Cloud"
          : "Hybrid";

  if (view === "list") {
    return (
      <div
        className={`agent-list-row${selected ? " is-selected" : ""}`}
        role="option"
        aria-selected={!!selected}
      >
        <button type="button" className="agent-list-open" onClick={onOpen}>
          <span
            className="agent-avatar sm"
            style={{
              background: `radial-gradient(circle at 35% 28%, ${agent.accentColor}55, #121a21 70%)`,
            }}
          >
            {avatarSrc ? <img src={avatarSrc} alt="" /> : agent.initials || "?"}
          </span>
          <span className="agent-list-meta">
            <span className="agent-card-title">{agent.name}</span>
            <span className="agent-card-role">{agent.role}</span>
          </span>
          <span className={`agent-status-pill status-${status}`}>
            {statusLabel(status)}
            {agent.demo ? " · demo" : ""}
          </span>
          <span className="agent-list-task">
            {current ? current.title : "No active task"}
          </span>
          <span className="agent-list-model">
            {model?.displayName ?? "Not assigned"}
          </span>
          <span className="agent-list-runtime">{runtimeLabel}</span>
        </button>
        <Toggle
          checked={agent.enabled}
          disabled={toggleDisabled}
          onChange={(next) => onToggle(next)}
          label={`${agent.name} enabled`}
        />
      </div>
    );
  }

  return (
    <article
      className={`agent-card agent-surface${selected ? " is-selected" : ""}`}
      aria-label={`${agent.name}, ${statusLabel(status)}, ${
        current
          ? `current task ${current.title}, ${current.progress} percent`
          : "no active task"
      }, last active ${relativeTime(agent.lastActiveAt)}`}
    >
      <div className="agent-card-head">
        <span
          className="agent-avatar"
          style={{
            background: `radial-gradient(circle at 35% 28%, ${agent.accentColor}44, rgba(17,23,31,0.95) 72%)`,
            borderColor: `${agent.accentColor}33`,
          }}
          aria-hidden="true"
        >
          {avatarSrc ? <img src={avatarSrc} alt="" /> : agent.initials || "?"}
        </span>
        <div className="agent-names">
          <div className="agent-name-row">
            <h3 className="agent-card-title">{agent.name}</h3>
            <span className={`agent-status-pill status-${status}`}>
              {statusLabel(status)}
              {agent.demo ? " · demo" : ""}
            </span>
          </div>
          <p className="agent-card-role">{agent.role}</p>
          {agent.isPrime ? <span className="agent-prime-badge">Prime agent</span> : null}
        </div>
        <Toggle
          checked={agent.enabled}
          disabled={toggleDisabled}
          onChange={(next) => onToggle(next)}
          label={`${agent.name} enabled`}
        />
      </div>

      {toggleDisabled ? (
        <p className="agent-card-hint">{activation.reason}</p>
      ) : null}

      <p className="agent-card-desc">
        {agent.description || "No description yet."}
      </p>

      {tags.length > 0 ? (
        <div className="agent-capability-tags">
          {tags.map((tag) => (
            <span key={tag} className="agent-capability-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <dl className="agent-card-meta">
        <div>
          <dt>Model</dt>
          <dd>{model?.displayName ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt>Voice</dt>
          <dd>{agent.voice.enabled ? voice.displayName : "Off"}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{tools} tools</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{runtimeLabel}</dd>
        </div>
      </dl>

      <div className="agent-current">
        <span className="agent-current-label">
          {current?.demo ? "Demo task" : "Current task"}
        </span>
        <p className="agent-current-title">
          {current?.title ??
            (status === "paused"
              ? "Paused"
              : status === "not-configured"
                ? "Configure to assign work"
                : "No active task")}
        </p>
        {current ? (
          <div className="agent-progress-row">
            <span className="agent-progress-track" aria-hidden="true">
              <span
                className="agent-progress-fill"
                style={{ width: `${current.progress}%` }}
              />
            </span>
            <span className="agent-progress-pct">{current.progress}%</span>
          </div>
        ) : null}
      </div>

      <div className="agent-card-foot">
        <span className="agent-last-active">
          Solo · Last active: {relativeTime(agent.lastActiveAt)}
        </span>
        <div className="agent-card-actions">
          <button type="button" className="btn btn-small" onClick={onOpen}>
            Open details
          </button>
          <div className="agent-more-wrap" ref={menuRef}>
            <button
              type="button"
              className="agent-more-btn"
              aria-label={`More actions for ${agent.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <DotsIcon size={14} />
            </button>
            {menuOpen ? (
              <ul className="agent-more-menu" role="menu">
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSetPrime();
                      setMenuOpen(false);
                    }}
                    disabled={agent.isPrime}
                  >
                    {agent.isPrime ? "Current Prime Agent" : "Make Prime Agent"}
                  </button>
                </li>
                <li>
                  <button type="button" role="menuitem" onClick={onOpen}>
                    Open details
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onToggle(!agent.enabled);
                      setMenuOpen(false);
                    }}
                    disabled={toggleDisabled && !agent.enabled}
                  >
                    {agent.enabled ? "Pause" : "Activate"}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onAssign();
                      setMenuOpen(false);
                    }}
                  >
                    Assign task
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      onDelete();
                      setMenuOpen(false);
                    }}
                  >
                    Delete
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
