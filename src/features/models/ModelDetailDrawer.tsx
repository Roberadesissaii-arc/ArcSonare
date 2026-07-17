import { useEffect, useRef } from "react";
import { CloseIcon } from "../../components/Icons";
import { providerById, type ModelInfo } from "../../config/modelRegistry";
import type { ModelStatusKind } from "./modelTypes";

interface ModelDetailDrawerProps {
  model: ModelInfo;
  statusKind: ModelStatusKind;
  statusLabel: string;
  assignedRoles: string[];
  activeModelName?: string;
  testing?: boolean;
  testResult?: string | null;
  testPrompt: string;
  onTestPromptChange: (value: string) => void;
  onTest?: () => void;
  onSetDefault: () => void;
  onConfigure: () => void;
  onClose: () => void;
  testLocked?: boolean;
}

export function ModelDetailDrawer({
  model,
  statusKind,
  statusLabel,
  assignedRoles,
  activeModelName,
  testing,
  testResult,
  testPrompt,
  onTestPromptChange,
  onTest,
  onSetDefault,
  onConfigure,
  onClose,
  testLocked,
}: ModelDetailDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const provider = providerById(model.provider);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !testLocked) onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (testLocked) return;
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose, testLocked]);

  return (
    <div className="models-drawer-backdrop" role="presentation">
      <aside
        ref={panelRef}
        className="models-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${model.displayName} details`}
      >
        <header className="models-drawer-head">
          <div className="models-drawer-title-row">
            <span className="models-card-logo" aria-hidden="true">
              <img src={model.logo} alt="" width={28} height={28} draggable={false} />
            </span>
            <div>
              <p className="models-card-provider">{provider.name}</p>
              <h2>
                {model.displayName}
                {activeModelName ? ` · ${activeModelName}` : ""}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="models-icon-btn"
            aria-label="Close details"
            onClick={onClose}
            disabled={testLocked}
          >
            <CloseIcon size={15} />
          </button>
        </header>

        <p className="models-drawer-desc">{model.description}</p>

        <div className={`models-status models-status-${statusKind}`} style={{ marginBottom: 14 }}>
          <span className="models-status-dot" aria-hidden="true" />
          {statusLabel}
        </div>

        <section className="models-drawer-section">
          <h3>Capabilities</h3>
          <div className="models-card-chips">
            {model.capabilities.map((cap) => (
              <span key={cap} className="models-chip">
                {cap}
              </span>
            ))}
            <span className="models-chip">
              {model.locality === "local" ? "Local" : "Cloud"}
            </span>
          </div>
        </section>

        <section className="models-drawer-section">
          <h3>Support</h3>
          <ul className="models-drawer-facts">
            <li>Text: {model.supportsText ? "Yes" : "No"}</li>
            <li>Vision: {model.supportsImage ? "Yes" : "No"}</li>
            <li>Audio in: {model.supportsAudioInput ? "Yes" : "No"}</li>
            <li>Audio out: {model.supportsAudioOutput ? "Yes" : "No"}</li>
            <li>Tools: {model.supportsTools ? "Yes" : "No"}</li>
            <li>Reasoning: {model.supportsReasoning ? "Yes" : "No"}</li>
          </ul>
        </section>

        <section className="models-drawer-section">
          <h3>Assigned roles</h3>
          {assignedRoles.length ? (
            <div className="models-card-chips">
              {assignedRoles.map((role) => (
                <span key={role} className="models-chip">
                  {role}
                </span>
              ))}
            </div>
          ) : (
            <p className="models-empty-note">Not assigned to any role yet.</p>
          )}
        </section>

        <section className="models-drawer-section">
          <h3>Test prompt</h3>
          <textarea
            className="models-test-input"
            rows={3}
            value={testPrompt}
            onChange={(e) => onTestPromptChange(e.target.value)}
            placeholder="Say hello in one short sentence."
            aria-label="Test prompt"
          />
          <div className="models-drawer-actions">
            {onTest ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={testing || !testPrompt.trim()}
                onClick={onTest}
              >
                {testing ? "Testing…" : "Send test"}
              </button>
            ) : (
              <button type="button" className="btn btn-small" disabled title="Test not available">
                Test unavailable
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={onSetDefault}>
              Set as default
            </button>
            <button type="button" className="btn btn-small" onClick={onConfigure}>
              Configure provider
            </button>
          </div>
          {testResult ? (
            <p className="models-test-result" role="status">
              {testResult}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
