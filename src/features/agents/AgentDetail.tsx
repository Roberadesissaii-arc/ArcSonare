import { useEffect, useState } from "react";
import { CloseIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { MODELS, modelById } from "../../config/modelRegistry";
import { VOICE_PROFILES } from "../voice/VoiceSelector";
import { useAppState } from "../../stores/appStore";
import {
  agentStatus,
  PERMISSION_AREAS,
  removeAgent,
  updateAgent,
  type AgentConfig,
  type PermissionLevel,
} from "./agentStore";

const TABS = [
  "Overview",
  "Instructions",
  "Model",
  "Voice",
  "Permissions",
  "Memory",
  "Triggers",
  "Activity",
  "Performance",
  "Test",
] as const;
type Tab = (typeof TABS)[number];

const NONE = "__none__";

interface AgentDetailProps {
  agent: AgentConfig;
  onClose: () => void;
}

/** Right-hand drawer with the full agent configuration and sandbox. */
export function AgentDetail({ agent, onClose }: AgentDetailProps) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [testPrompt, setTestPrompt] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { activity } = useAppState();
  const status = agentStatus(agent);
  const model = modelById(agent.modelId);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const set = (patch: Partial<AgentConfig>) => updateAgent(agent.id, patch);

  const runTest = () => {
    if (!testPrompt.trim()) return;
    // Honest sandbox: shows the request package that WOULD be sent. No model
    // backend exists, so nothing is executed and no result is invented.
    const allowedTools = PERMISSION_AREAS.filter(
      (a) => agent.permissions[a.id] !== "deny",
    ).map((a) => `${a.label} (${agent.permissions[a.id]})`);
    setTestResult(
      [
        "Planned request (nothing was executed — no model backend is configured):",
        `• Model: ${model?.displayName ?? "none assigned"}`,
        `• Objective: ${agent.instructions.objective || "—"}`,
        `• Tone: ${agent.instructions.tone} · ${agent.instructions.responseStyle}`,
        `• Tools the agent may request: ${allowedTools.join(", ") || "none"}`,
        `• Prompt: “${testPrompt.trim()}”`,
        "External actions would each require your approval per the permission settings.",
      ].join("\n"),
    );
  };

  return (
    <div className="agent-drawer-backdrop" onClick={onClose}>
      <aside
        className="agent-drawer"
        role="dialog"
        aria-label={`Agent ${agent.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-drawer-head">
          <span
            className="agent-avatar"
            style={{ boxShadow: `inset 0 0 0 1px ${agent.accentColor}33` }}
            aria-hidden="true"
          >
            {agent.initials}
          </span>
          <span className="agent-names">
            <span className="card-title">{agent.name}</span>
            <span className="agent-status tone-muted">
              {status}
              {agent.demo ? " · demo agent" : ""}
            </span>
          </span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close agent details">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="agent-drawer-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`agent-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="agent-drawer-body">
          {tab === "Overview" ? (
            <>
              <dl className="detail-grid">
                <dt>State</dt>
                <dd>{status}</dd>
                <dt>Current task</dt>
                <dd>
                  {agent.demoCurrentTask
                    ? `${agent.demoCurrentTask} (demo)`
                    : "None"}
                </dd>
                <dt>Model</dt>
                <dd>{model?.displayName ?? "Not assigned"}</dd>
                <dt>Voice</dt>
                <dd>
                  {agent.voice.enabled
                    ? VOICE_PROFILES.find((v) => v.id === agent.voice.voiceId)?.name
                    : "Off"}
                </dd>
                <dt>Approvals</dt>
                <dd>None pending</dd>
                <dt>Errors</dt>
                <dd>None recorded</dd>
              </dl>
              <div className="agent-drawer-row">
                <span>Enabled</span>
                <Toggle
                  checked={agent.enabled}
                  onChange={(enabled) => set({ enabled })}
                  label={`${agent.name} enabled`}
                />
              </div>
              {!agent.modelId ? (
                <p className="field-help">
                  Assign a model under the Model tab; without one the agent
                  cannot run.
                </p>
              ) : null}
              <div className="agent-drawer-danger">
                <button
                  type="button"
                  className={`btn btn-small${confirmDelete ? " btn-danger" : ""}`}
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      window.setTimeout(() => setConfirmDelete(false), 4000);
                      return;
                    }
                    removeAgent(agent.id);
                    onClose();
                  }}
                >
                  {confirmDelete ? "Click again to delete" : "Delete agent"}
                </button>
              </div>
            </>
          ) : null}

          {tab === "Instructions" ? (
            <>
              <label className="modal-label">Primary objective</label>
              <textarea
                className="modal-input modal-textarea"
                rows={2}
                value={agent.instructions.objective}
                onChange={(e) =>
                  set({ instructions: { ...agent.instructions, objective: e.target.value } })
                }
              />
              <label className="modal-label">System instructions</label>
              <textarea
                className="modal-input modal-textarea"
                rows={4}
                value={agent.instructions.system}
                onChange={(e) =>
                  set({ instructions: { ...agent.instructions, system: e.target.value } })
                }
              />
              <label className="modal-label">Prohibited actions</label>
              <textarea
                className="modal-input modal-textarea"
                rows={2}
                value={agent.instructions.prohibited}
                onChange={(e) =>
                  set({ instructions: { ...agent.instructions, prohibited: e.target.value } })
                }
              />
            </>
          ) : null}

          {tab === "Model" ? (
            <>
              <label className="modal-label">Primary model</label>
              <Dropdown
                options={[
                  { value: NONE, label: "Not assigned" },
                  ...MODELS.map((m) => ({ value: m.id, label: m.displayName })),
                ]}
                value={agent.modelId ?? NONE}
                onChange={(v) => set({ modelId: v === NONE ? null : v })}
                ariaLabel="Primary model"
              />
              <p className="field-help">
                The model runs only after its provider is configured under
                Settings → Models.
              </p>
            </>
          ) : null}

          {tab === "Voice" ? (
            <>
              <div className="agent-drawer-row">
                <span>Spoken responses</span>
                <Toggle
                  checked={agent.voice.enabled}
                  onChange={(enabled) => set({ voice: { ...agent.voice, enabled } })}
                  label="Spoken responses"
                />
              </div>
              <label className="modal-label">Voice</label>
              <Dropdown
                options={VOICE_PROFILES.map((v) => ({
                  value: v.id,
                  label: `${v.name} — ${v.tone}`,
                }))}
                value={agent.voice.voiceId}
                onChange={(voiceId) => set({ voice: { ...agent.voice, voiceId } })}
                ariaLabel="Agent voice"
              />
              <p className="field-help">
                Voice preview requires a configured speech provider.
              </p>
            </>
          ) : null}

          {tab === "Permissions" ? (
            <>
              {PERMISSION_AREAS.map((area) => (
                <div className="wizard-permission-row" key={area.id}>
                  <span className="wizard-permission-label">
                    {area.label}
                    {area.highRisk ? <span className="risk-badge">High risk</span> : null}
                  </span>
                  <SegmentedControl<PermissionLevel>
                    options={[
                      { value: "deny", label: "Deny" },
                      { value: "ask", label: "Ask" },
                      { value: "read-only", label: "Read-only" },
                      { value: "allow", label: "Allow" },
                    ]}
                    value={agent.permissions[area.id]}
                    onChange={(level) =>
                      set({ permissions: { ...agent.permissions, [area.id]: level } })
                    }
                    ariaLabel={`Permission for ${area.label}`}
                  />
                </div>
              ))}
            </>
          ) : null}

          {tab === "Memory" ? (
            <>
              <label className="modal-label">Memory mode</label>
              <SegmentedControl
                options={[
                  { value: "none", label: "None" },
                  { value: "session", label: "Session" },
                  { value: "local-long-term", label: "Local long-term" },
                ]}
                value={agent.memory.mode}
                onChange={(mode) =>
                  set({
                    memory: { ...agent.memory, mode: mode as AgentConfig["memory"]["mode"] },
                  })
                }
                ariaLabel="Memory mode"
              />
              <p className="field-help">
                Agent memory storage arrives with the agent runtime; the
                configuration is saved now.
              </p>
            </>
          ) : null}

          {tab === "Triggers" ? (
            <>
              <dl className="detail-grid">
                <dt>Active</dt>
                <dd>{agent.triggers.join(", ")}</dd>
              </dl>
              <p className="field-help">
                Only manual start works in this build. Other configured
                triggers activate with the agent runtime.
              </p>
            </>
          ) : null}

          {tab === "Activity" ? (
            <ul className="timeline-list">
              {activity
                .filter((entry) => entry.text.includes(agent.name))
                .slice(0, 12)
                .map((entry) => (
                  <li key={entry.id} className="timeline-row">
                    <span className={`timeline-dot src-${entry.source}`} aria-hidden="true" />
                    <span className="timeline-text">{entry.text}</span>
                    <span className="timeline-time">
                      {new Date(entry.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              {activity.filter((e) => e.text.includes(agent.name)).length === 0 ? (
                <li className="timeline-row">
                  <span className="timeline-text">No activity recorded for this agent yet.</span>
                </li>
              ) : null}
            </ul>
          ) : null}

          {tab === "Performance" ? (
            <>
              <dl className="detail-grid">
                <dt>Tasks completed</dt>
                <dd>0</dd>
                <dt>Success rate</dt>
                <dd>—</dd>
                <dt>Average duration</dt>
                <dd>—</dd>
                <dt>User approvals</dt>
                <dd>0</dd>
                <dt>Errors</dt>
                <dd>0</dd>
                <dt>Model usage</dt>
                <dd>None (no model backend)</dd>
              </dl>
              <p className="field-help">
                Real performance metrics appear once the agent runtime executes
                tasks. Nothing is simulated here.
              </p>
            </>
          ) : null}

          {tab === "Test" ? (
            <>
              <label className="modal-label" htmlFor="agent-test-prompt">Test prompt</label>
              <textarea
                id="agent-test-prompt"
                className="modal-input modal-textarea"
                rows={2}
                placeholder="What would you like to test?"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              />
              <div className="agent-test-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={runTest}
                  disabled={!testPrompt.trim()}
                >
                  Run test
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setTestPrompt("");
                    setTestResult(null);
                  }}
                >
                  Reset
                </button>
              </div>
              {testResult ? (
                <pre className="agent-test-result">{testResult}</pre>
              ) : (
                <p className="field-help">
                  The sandbox shows the exact request ArcSonare would send —
                  planned steps and proposed tool access. No external action is
                  executed during testing.
                </p>
              )}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
