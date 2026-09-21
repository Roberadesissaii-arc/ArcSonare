import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon } from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import { providerById, GOOGLE_GEMINI_MODELS, type ProviderId } from "../../config/modelRegistry";
import { updatePrefs, usePrefs } from "../../stores/settingsStore";

interface ProviderConfigurationProps {
  providerId: ProviderId;
  hasKey: boolean;
  onChanged: () => void;
  /** Fired after a key is stored successfully (auto-assign roles). */
  onConnected?: () => void;
  onClose: () => void;
}

export function ProviderConfiguration({
  providerId,
  hasKey,
  onChanged,
  onConnected,
  onClose,
}: ProviderConfigurationProps) {
  const provider = providerById(providerId);
  const prefs = usePrefs();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus(null);
    invoke("set_provider_key", { provider: providerId, key: trimmed })
      .then(() => {
        setKey("");
        setStatus("API key saved securely.");
        onChanged();
        onConnected?.();
      })
      .catch((err) =>
        setStatus(typeof err === "string" ? err : "The key could not be saved."),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    setStatus(null);
    invoke("delete_provider_key", { provider: providerId })
      .then(() => {
        setStatus("Stored key removed.");
        onChanged();
      })
      .catch((err) =>
        setStatus(typeof err === "string" ? err : "The key could not be removed."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="models-selector-backdrop" role="presentation">
      <div
        className="models-provider-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${provider.name} configuration`}
      >
        <header className="models-selector-head">
          <div className="models-drawer-title-row">
            <span className="models-card-logo" aria-hidden="true">
              <img src={provider.logo} alt="" width={24} height={24} draggable={false} />
            </span>
            <div>
              <h2>{provider.name}</h2>
              <p>{provider.description}</p>
            </div>
          </div>
          <button type="button" className="models-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </header>

        {providerId === "google" ? (
          <div className="models-provider-body">
            <p className="models-empty-note">
              {hasKey
                ? "Google AI Studio API key is stored securely. Choose which Gemini text model ArcSonare uses everywhere."
                : "Paste a Google AI Studio (Gemini) API key. Then pick one Gemini model below."}
            </p>
            <div className="provider-card-body">
              <input
                type="password"
                className="text-input provider-key-input"
                placeholder={hasKey ? "Replace stored Google API key…" : "Paste Google AI Studio API key…"}
                value={key}
                aria-label="Google Gemini API key"
                autoComplete="off"
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || !key.trim()}
                onClick={save}
              >
                Save key
              </button>
              {hasKey ? (
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  disabled={busy}
                  onClick={remove}
                >
                  Remove key
                </button>
              ) : null}
            </div>

            <h3 className="models-provider-section" style={{ marginTop: 18 }}>
              Gemini model
            </h3>
            <div className="provider-card-body" style={{ marginTop: 8 }}>
              <Dropdown
                options={GOOGLE_GEMINI_MODELS.map((m) => ({
                  value: m.id,
                  label: `${m.label} — ${m.description}`,
                }))}
                value={
                  GOOGLE_GEMINI_MODELS.some((m) => m.id === prefs.models.googleModel)
                    ? prefs.models.googleModel
                    : GOOGLE_GEMINI_MODELS[0].id
                }
                onChange={(googleModel) => {
                  updatePrefs((p) => ({
                    ...p,
                    models: { ...p.models, googleModel },
                  }));
                  setStatus(`Gemini model set to “${googleModel}”.`);
                }}
                ariaLabel="Gemini model"
              />
            </div>
            {hasKey ? (
              <p className="field-help">An API key is stored securely.</p>
            ) : null}
          </div>
        ) : provider.configuration === "api-key" ? (
          <div className="models-provider-body">
            <p className="models-empty-note">
              {hasKey
                ? "An API key is stored securely. Paste a new key to replace it."
                : "Paste an API key. It is saved to Windows Credential Manager — never localStorage."}
            </p>
            <div className="provider-card-body">
              <input
                type="password"
                className="text-input provider-key-input"
                placeholder={hasKey ? "Replace stored key…" : "Paste API key…"}
                value={key}
                aria-label={`${provider.name} API key`}
                autoComplete="off"
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || !key.trim()}
                onClick={save}
              >
                Save
              </button>
              {hasKey ? (
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  disabled={busy}
                  onClick={remove}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="models-provider-body">
            <p className="models-empty-note">{provider.description}</p>
          </div>
        )}

        {status ? (
          <p className="field-help" role="status">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}
