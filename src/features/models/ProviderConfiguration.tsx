import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon } from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import { providerById, type ProviderId } from "../../config/modelRegistry";
import { updatePrefs, usePrefs } from "../../stores/settingsStore";
import type { OllamaStatus } from "../../services/OllamaService";

interface ProviderConfigurationProps {
  providerId: ProviderId;
  hasKey: boolean;
  ollama: OllamaStatus | null;
  onChanged: () => void;
  onRefreshOllama: () => void;
  onClose: () => void;
}

export function ProviderConfiguration({
  providerId,
  hasKey,
  ollama,
  onChanged,
  onRefreshOllama,
  onClose,
}: ProviderConfigurationProps) {
  const provider = providerById(providerId);
  const prefs = usePrefs();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    setStatus(null);
    invoke("set_provider_key", { provider: providerId, key })
      .then(() => {
        setKey("");
        setStatus("Key stored in Windows Credential Manager. It is never shown again.");
        onChanged();
      })
      .catch((err) =>
        setStatus(typeof err === "string" ? err : "The key could not be stored."),
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

  const ollamaReady = providerId === "ollama" && Boolean(ollama?.available);

  return (
    <div className="models-selector-backdrop" role="presentation">
      <div className="models-provider-panel" role="dialog" aria-modal="true" aria-label={`${provider.name} configuration`}>
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

        {provider.configuration === "api-key" ? (
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
            <p className="models-empty-note">
              {ollama?.message ??
                "Connects to Ollama at http://127.0.0.1:11434. Keep `ollama serve` running."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="btn btn-small" onClick={onRefreshOllama}>
                Detect Ollama
              </button>
              {ollamaReady && ollama?.models.length ? (
                <Dropdown
                  options={ollama.models.map((m) => ({ value: m, label: m }))}
                  value={
                    prefs.models.ollamaModel &&
                    ollama.models.includes(prefs.models.ollamaModel)
                      ? prefs.models.ollamaModel
                      : ollama.models[0]
                  }
                  onChange={(ollamaModel) => {
                    updatePrefs((p) => ({
                      ...p,
                      models: {
                        ...p.models,
                        ollamaModel,
                        roles: { ...p.models.roles, assistant: "ollama-local" },
                      },
                    }));
                  }}
                  ariaLabel="Installed Ollama model"
                />
              ) : null}
            </div>
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
