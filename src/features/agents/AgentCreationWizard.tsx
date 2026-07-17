import { useEffect, useMemo, useState } from "react";
import { CloseIcon } from "../../components/Icons";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { Slider } from "../../components/settings/Slider";
import { MODELS, modelById } from "../../config/modelRegistry";
import { VOICE_PROFILES } from "../voice/VoiceSelector";
import {
  addAgent,
  PERMISSION_AREAS,
  SUPPORTED_TRIGGERS,
  type AgentConfig,
  type PermissionLevel,
  type TriggerId,
} from "./agentStore";
import { addActivity } from "../../stores/appStore";

const STEPS = [
  "Identity",
  "Instructions",
  "Model",
  "Voice",
  "Tools & permissions",
  "Memory & data",
  "Triggers",
  "Review",
] as const;

const TRIGGER_INFO: { id: TriggerId; label: string; description: string }[] = [
  { id: "manual", label: "Manual only", description: "You start the agent yourself." },
  { id: "schedule", label: "Schedule", description: "Runs on a schedule (requires the agent runtime)." },
  { id: "task-assignment", label: "Task assignment", description: "Runs when a task is assigned to it." },
  { id: "notification", label: "Incoming notification", description: "Runs on matching notifications." },
  { id: "wake-phrase", label: "Wake phrase", description: "Runs on a wake phrase (requires the wake-word engine)." },
  { id: "screen-context", label: "Screen Context event", description: "Runs when screen context is captured." },
  { id: "connected-app", label: "Connected app event", description: "Runs on integration events." },
];

const ACCENTS = ["#916EFF", "#59D999", "#6696E4", "#E7AD54", "#E56C73", "#A2A8A4"];

const NONE = "__none__";

interface AgentCreationWizardProps {
  draft: AgentConfig;
  onClose: () => void;
  onCreated: (agent: AgentConfig) => void;
}

/** Eight-step agent creation wizard with per-step validation. */
export function AgentCreationWizard({ draft, onClose, onCreated }: AgentCreationWizardProps) {
  const [step, setStep] = useState(0);
  const [agent, setAgent] = useState<AgentConfig>(draft);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const set = (patch: Partial<AgentConfig>) => setAgent((a) => ({ ...a, ...patch }));
  const setInstructions = (patch: Partial<AgentConfig["instructions"]>) =>
    setAgent((a) => ({ ...a, instructions: { ...a.instructions, ...patch } }));
  const setVoice = (patch: Partial<AgentConfig["voice"]>) =>
    setAgent((a) => ({ ...a, voice: { ...a.voice, ...patch } }));
  const setMemory = (patch: Partial<AgentConfig["memory"]>) =>
    setAgent((a) => ({ ...a, memory: { ...a.memory, ...patch } }));
  const setPermission = (area: string, level: PermissionLevel) =>
    setAgent((a) => ({
      ...a,
      permissions: { ...a.permissions, [area]: level },
    }));

  const stepError = useMemo((): string | null => {
    if (step === 0) {
      if (!agent.name.trim()) return "The agent needs a name.";
      if (!agent.role.trim()) return "Give the agent a short role.";
    }
    if (step === 1 && !agent.instructions.objective.trim()) {
      return "Describe the agent's primary objective.";
    }
    return null;
  }, [step, agent]);

  const next = () => {
    if (stepError) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const create = () => {
    if (!agent.name.trim() || !agent.instructions.objective.trim()) {
      setAttempted(true);
      return;
    }
    const initials =
      agent.initials.trim() ||
      agent.name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    const finalAgent: AgentConfig = { ...agent, initials, createdAt: Date.now() };
    addAgent(finalAgent);
    addActivity(`Created agent ${finalAgent.name}`, "agent");
    onCreated(finalAgent);
  };

  const model = modelById(agent.modelId);
  const modelOptions = [
    { value: NONE, label: "Not assigned" },
    ...MODELS.map((m) => ({ value: m.id, label: m.displayName })),
  ];

  const unsupportedTriggers = agent.triggers.filter(
    (t) => !SUPPORTED_TRIGGERS.includes(t),
  );

  return (
    <div className="modal-backdrop">
      <div className="modal wizard" role="dialog" aria-label="Create agent">
        <div className="modal-head">
          <span className="modal-title">Create agent</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close wizard">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="wizard-steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((label, index) => (
            <span
              key={label}
              className={`wizard-step${index === step ? " active" : ""}${index < step ? " done" : ""}`}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="wizard-body">
          {step === 0 ? (
            <>
              <label className="modal-label" htmlFor="agent-name">Agent name</label>
              <input
                id="agent-name"
                className="modal-input"
                value={agent.name}
                maxLength={40}
                onChange={(e) => set({ name: e.target.value })}
              />
              <label className="modal-label" htmlFor="agent-role">Role</label>
              <input
                id="agent-role"
                className="modal-input"
                value={agent.role}
                maxLength={30}
                placeholder="Research, Writing, Coordination…"
                onChange={(e) => set({ role: e.target.value })}
              />
              <label className="modal-label" htmlFor="agent-desc">Description</label>
              <textarea
                id="agent-desc"
                className="modal-input modal-textarea"
                rows={2}
                value={agent.description}
                maxLength={160}
                onChange={(e) => set({ description: e.target.value })}
              />
              <label className="modal-label" htmlFor="agent-initials">
                Avatar initials (uploaded images arrive later)
              </label>
              <input
                id="agent-initials"
                className="modal-input wizard-initials"
                value={agent.initials}
                maxLength={2}
                placeholder="Auto"
                onChange={(e) => set({ initials: e.target.value.toUpperCase() })}
              />
              <label className="modal-label">Accent color</label>
              <div className="wizard-accents">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`annotate-color${agent.accentColor === c ? " active" : ""}`}
                    style={{ background: c }}
                    aria-label={`Accent ${c}`}
                    onClick={() => set({ accentColor: c })}
                  />
                ))}
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <label className="modal-label" htmlFor="agent-objective">Primary objective</label>
              <textarea
                id="agent-objective"
                className="modal-input modal-textarea"
                rows={2}
                value={agent.instructions.objective}
                onChange={(e) => setInstructions({ objective: e.target.value })}
              />
              <label className="modal-label" htmlFor="agent-system">System instructions</label>
              <textarea
                id="agent-system"
                className="modal-input modal-textarea"
                rows={3}
                value={agent.instructions.system}
                onChange={(e) => setInstructions({ system: e.target.value })}
              />
              <label className="modal-label" htmlFor="agent-guidelines">Behavior guidelines</label>
              <textarea
                id="agent-guidelines"
                className="modal-input modal-textarea"
                rows={2}
                value={agent.instructions.guidelines}
                onChange={(e) => setInstructions({ guidelines: e.target.value })}
              />
              <div className="modal-row">
                <div className="modal-field">
                  <label className="modal-label">Tone</label>
                  <Dropdown
                    options={[
                      { value: "Professional", label: "Professional" },
                      { value: "Friendly", label: "Friendly" },
                      { value: "Direct", label: "Direct" },
                      { value: "Neutral", label: "Neutral" },
                    ]}
                    value={agent.instructions.tone}
                    onChange={(tone) => setInstructions({ tone })}
                    ariaLabel="Tone"
                  />
                </div>
                <div className="modal-field">
                  <label className="modal-label">Response style</label>
                  <SegmentedControl
                    options={[
                      { value: "concise", label: "Concise" },
                      { value: "balanced", label: "Balanced" },
                      { value: "detailed", label: "Detailed" },
                    ]}
                    value={agent.instructions.responseStyle}
                    onChange={(responseStyle) =>
                      setInstructions({
                        responseStyle: responseStyle as AgentConfig["instructions"]["responseStyle"],
                      })
                    }
                    ariaLabel="Response style"
                  />
                </div>
              </div>
              <label className="modal-label" htmlFor="agent-prohibited">Prohibited actions</label>
              <textarea
                id="agent-prohibited"
                className="modal-input modal-textarea"
                rows={2}
                placeholder="Never send email without approval…"
                value={agent.instructions.prohibited}
                onChange={(e) => setInstructions({ prohibited: e.target.value })}
              />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <label className="modal-label">Primary model</label>
              <Dropdown
                options={modelOptions}
                value={agent.modelId ?? NONE}
                onChange={(v) => set({ modelId: v === NONE ? null : v })}
                ariaLabel="Primary model"
              />
              {model ? (
                <p className="field-help">
                  {model.displayName} · {model.locality === "local" ? "Local" : "Cloud"} ·
                  requires its provider to be configured under Settings → Models.
                </p>
              ) : (
                <p className="field-help">
                  Without a model the agent stays “Not configured” and cannot run.
                </p>
              )}
              <label className="modal-label">Fallback model</label>
              <Dropdown
                options={modelOptions}
                value={agent.fallbackModelId ?? NONE}
                onChange={(v) => set({ fallbackModelId: v === NONE ? null : v })}
                ariaLabel="Fallback model"
              />
              <div className="modal-row">
                <div className="modal-field">
                  <label className="modal-label">Reasoning preference</label>
                  <SegmentedControl
                    options={[
                      { value: "fast", label: "Fast" },
                      { value: "balanced", label: "Balanced" },
                      { value: "deep", label: "Deep" },
                    ]}
                    value={agent.reasoningPreference}
                    onChange={(reasoningPreference) =>
                      set({
                        reasoningPreference:
                          reasoningPreference as AgentConfig["reasoningPreference"],
                      })
                    }
                    ariaLabel="Reasoning preference"
                  />
                </div>
                <div className="modal-field">
                  <label className="modal-label">Cost preference</label>
                  <SegmentedControl
                    options={[
                      { value: "economy", label: "Economy" },
                      { value: "balanced", label: "Balanced" },
                      { value: "best", label: "Best" },
                    ]}
                    value={agent.costPreference}
                    onChange={(costPreference) =>
                      set({ costPreference: costPreference as AgentConfig["costPreference"] })
                    }
                    ariaLabel="Cost preference"
                  />
                </div>
              </div>
              <div className="wizard-toggle-row">
                <span>Local-only (never use cloud models)</span>
                <Toggle
                  checked={agent.localOnly}
                  onChange={(localOnly) => set({ localOnly })}
                  label="Local-only"
                />
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="wizard-toggle-row">
                <span>Enable spoken responses</span>
                <Toggle
                  checked={agent.voice.enabled}
                  onChange={(enabled) => setVoice({ enabled })}
                  label="Enable spoken responses"
                />
              </div>
              <label className="modal-label">Voice</label>
              <Dropdown
                options={VOICE_PROFILES.map((v) => ({ value: v.id, label: `${v.name} — ${v.tone}` }))}
                value={agent.voice.voiceId}
                onChange={(voiceId) => setVoice({ voiceId })}
                ariaLabel="Agent voice"
              />
              <label className="modal-label">Speaking speed</label>
              <Slider
                value={agent.voice.speed}
                min={50}
                max={200}
                step={5}
                onChange={(speed) => setVoice({ speed })}
                label="Agent speaking speed"
                format={(v) => `${v}%`}
                disabled={!agent.voice.enabled}
              />
              <label className="modal-label">Agent voice volume</label>
              <Slider
                value={agent.voice.volume}
                min={0}
                max={100}
                onChange={(volume) => setVoice({ volume })}
                label="Agent voice volume"
                format={(v) => `${v}%`}
                disabled={!agent.voice.enabled}
              />
              <div className="wizard-toggle-row">
                <span>Allow interruptions</span>
                <Toggle
                  checked={agent.voice.allowInterruptions}
                  onChange={(allowInterruptions) => setVoice({ allowInterruptions })}
                  label="Allow interruptions"
                  disabled={!agent.voice.enabled}
                />
              </div>
              <p className="field-help">
                Voice preview requires a configured speech provider.
              </p>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="field-help">
                High-risk areas default to “Ask every time”. Nothing executes
                without the agent runtime, but these defaults carry over.
              </p>
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
                    onChange={(level) => setPermission(area.id, level)}
                    ariaLabel={`Permission for ${area.label}`}
                  />
                </div>
              ))}
            </>
          ) : null}

          {step === 5 ? (
            <>
              <label className="modal-label">Memory</label>
              <SegmentedControl
                options={[
                  { value: "none", label: "No memory" },
                  { value: "session", label: "Session" },
                  { value: "local-long-term", label: "Local long-term" },
                ]}
                value={agent.memory.mode}
                onChange={(mode) =>
                  setMemory({ mode: mode as AgentConfig["memory"]["mode"] })
                }
                ariaLabel="Memory mode"
              />
              <label className="modal-label">Memory retention</label>
              <Dropdown
                options={[
                  { value: "session", label: "Until the session ends" },
                  { value: "7d", label: "7 days" },
                  { value: "30d", label: "30 days" },
                  { value: "manual", label: "Until manually deleted" },
                ]}
                value={agent.memory.retention}
                onChange={(retention) =>
                  setMemory({ retention: retention as AgentConfig["memory"]["retention"] })
                }
                ariaLabel="Memory retention"
              />
              <label className="modal-label" htmlFor="agent-sources">Allowed data sources</label>
              <input
                id="agent-sources"
                className="modal-input"
                placeholder="Tasks, calendar…"
                value={agent.memory.allowedSources}
                onChange={(e) => setMemory({ allowedSources: e.target.value })}
              />
              <label className="modal-label" htmlFor="agent-excluded">Excluded folders or applications</label>
              <input
                id="agent-excluded"
                className="modal-input"
                placeholder="C:\Private, 1Password…"
                value={agent.memory.excluded}
                onChange={(e) => setMemory({ excluded: e.target.value })}
              />
            </>
          ) : null}

          {step === 6 ? (
            <>
              {TRIGGER_INFO.map((trigger) => {
                const active = agent.triggers.includes(trigger.id);
                const supported = SUPPORTED_TRIGGERS.includes(trigger.id);
                return (
                  <div className="wizard-toggle-row" key={trigger.id}>
                    <span>
                      {trigger.label}
                      {!supported ? <span className="badge-muted">Coming later</span> : null}
                      <span className="wizard-trigger-desc">{trigger.description}</span>
                    </span>
                    <Toggle
                      checked={active}
                      onChange={(on) =>
                        set({
                          triggers: on
                            ? [...agent.triggers, trigger.id]
                            : agent.triggers.filter((t) => t !== trigger.id),
                        })
                      }
                      label={trigger.label}
                      disabled={trigger.id === "manual"}
                    />
                  </div>
                );
              })}
              <p className="field-help">
                Only manual start works in this build; other triggers are saved
                for the future agent runtime and clearly marked.
              </p>
            </>
          ) : null}

          {step === 7 ? (
            <div className="wizard-review">
              <dl className="detail-grid">
                <dt>Name</dt>
                <dd>{agent.name || "—"}</dd>
                <dt>Model</dt>
                <dd>{model?.displayName ?? "Not assigned"}</dd>
                <dt>Voice</dt>
                <dd>
                  {agent.voice.enabled
                    ? VOICE_PROFILES.find((v) => v.id === agent.voice.voiceId)?.name
                    : "Off"}
                </dd>
                <dt>Tools</dt>
                <dd>
                  {PERMISSION_AREAS.filter((a) => agent.permissions[a.id] !== "deny")
                    .map((a) => a.label)
                    .join(", ") || "None"}
                </dd>
                <dt>Memory</dt>
                <dd>{agent.memory.mode}</dd>
                <dt>Triggers</dt>
                <dd>{agent.triggers.join(", ")}</dd>
              </dl>
              {!agent.modelId ? (
                <p className="field-error">
                  Warning: no model is assigned — the agent will be “Not configured”.
                </p>
              ) : null}
              {unsupportedTriggers.length > 0 ? (
                <p className="field-help">
                  {unsupportedTriggers.join(", ")} will activate once the agent
                  runtime ships.
                </p>
              ) : null}
              {PERMISSION_AREAS.some(
                (a) => a.highRisk && agent.permissions[a.id] === "allow",
              ) ? (
                <p className="field-error">
                  Security warning: a high-risk area is set to Allow without
                  asking. Consider “Ask every time”.
                </p>
              ) : null}
            </div>
          ) : null}

          {attempted && stepError ? (
            <p className="field-error" role="alert">
              {stepError}
            </p>
          ) : null}
        </div>

        <div className="modal-actions">
          {step > 0 ? (
            <button type="button" className="btn" onClick={back}>
              Back
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={next}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={create}>
              Create agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
