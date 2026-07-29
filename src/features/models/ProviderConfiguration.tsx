import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon } from "../../components/Icons";
import { Dropdown } from "../../components/settings/Dropdown";
import { providerById, GOOGLE_GEMINI_MODELS, type ProviderId } from "../../config/modelRegistry";
import {
  fetchOllamaCloudCatalog,
  type OllamaCloudCatalog,
  type OllamaStatus,
} from "../../services/OllamaService";
import { updatePrefs, usePrefs } from "../../stores/settingsStore";

interface ProviderConfigurationProps {
  providerId: ProviderId;
  hasKey: boolean;
  ollama: OllamaStatus | null;
  onChanged: () => void;
  onRefreshOllama: () => void;
  onClose: () => void;
}

function accessLabel(access: string): string {
  if (access === "free") return "Free";
  if (access === "paid") return "Paid (Pro/Max)";
  return "Unknown";
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
  const [cloudModel, setCloudModel] = useState(
    prefs.models.ollamaCloudModel || "",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<OllamaCloudCatalog | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);

  const loadCatalog = (checkAccess: boolean) => {
    if (!hasKey) return;
    setCatalogBusy(true);
    setStatus(null);
    fetchOllamaCloudCatalog(checkAccess)
      .then((next) => {
        setCatalog(next);
        setStatus(next.message);
        const preferred =
          next.models.find((m) => m.access === "free")?.name ??
          next.models[0]?.name ??
          "";
        if (!cloudModel.trim() && preferred) {
          setCloudModel(preferred);
        }
      })
      .catch((err) =>
        setStatus(
          typeof err === "string"
            ? err
            : "Could not list Ollama Cloud models with the stored key.",
        ),
      )
      .finally(() => setCatalogBusy(false));
  };

  useEffect(() => {
    if (providerId === "ollama" && hasKey) {
      loadCatalog(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when panel opens with a key
  }, [providerId, hasKey]);

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
        setCatalog(null);
        onChanged();
      })
      .catch((err) =>
        setStatus(typeof err === "string" ? err : "The key could not be removed."),
      )
      .finally(() => setBusy(false));
  };

  const ollamaReady = providerId === "ollama" && Boolean(ollama?.available);

  const saveCloudModel = (name = cloudModel.trim()) => {
    setCloudModel(name);
    updatePrefs((p) => ({
      ...p,
      models: { ...p.models, ollamaCloudModel: name },
    }));
    const entry = catalog?.models.find((m) => m.name === name);
    const tier = entry ? ` · ${accessLabel(entry.access)}` : "";
    setStatus(
      name
        ? `Cloud model saved as “${name}”${tier}. Set Ollama Cloud as default to use it.`
        : "Cloud model cleared.",
    );
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

        {providerId === "ollama" ? (
          <div className="models-provider-body">
            <h3 className="models-provider-section">Local</h3>
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
                      models: { ...p.models, ollamaModel },
                    }));
                    setStatus(
                      `Local model set to “${ollamaModel}”. Use “Set as default” on Ollama (local) to make it the everyday assistant.`,
                    );
                  }}
                  ariaLabel="Installed Ollama model"
                />
              ) : null}
            </div>

            <h3 className="models-provider-section" style={{ marginTop: 18 }}>
              Cloud
            </h3>
            <p className="models-empty-note">
              Uses https://ollama.com with your API key. Some cloud models need Pro/Max —
              use Check free / paid, then pick a Free model from the list. No need to
              reconnect the key.
            </p>
            <div className="provider-card-body">
              <input
                type="password"
                className="text-input provider-key-input"
                placeholder={hasKey ? "Replace stored Ollama Cloud API key…" : "Paste Ollama Cloud API key…"}
                value={key}
                aria-label="Ollama Cloud API key"
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

            {hasKey ? (
              <div className="provider-card-body" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={catalogBusy}
                  onClick={() => loadCatalog(false)}
                >
                  {catalogBusy && !catalog?.checked ? "Loading…" : "Refresh list"}
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  disabled={catalogBusy}
                  onClick={() => loadCatalog(true)}
                >
                  {catalogBusy ? "Checking…" : "Check free / paid"}
                </button>
              </div>
            ) : null}

            {hasKey && catalog?.models.length ? (
              <div className="provider-card-body" style={{ marginTop: 10 }}>
                <Dropdown
                  options={catalog.models.map((m) => ({
                    value: m.name,
                    label: `${m.name} · ${accessLabel(m.access)}`,
                  }))}
                  value={
                    catalog.models.some((m) => m.name === cloudModel)
                      ? cloudModel
                      : catalog.models[0].name
                  }
                  onChange={(name) => saveCloudModel(name)}
                  ariaLabel="Ollama Cloud model"
                />
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => saveCloudModel()}
                >
                  Save model
                </button>
              </div>
            ) : (
              <div className="provider-card-body" style={{ marginTop: 10 }}>
                <input
                  type="text"
                  className="text-input provider-key-input"
                  placeholder="Cloud model name (e.g. gpt-oss:20b)"
                  value={cloudModel}
                  aria-label="Ollama Cloud model name"
                  onChange={(e) => setCloudModel(e.target.value)}
                />
                <button type="button" className="btn btn-small" onClick={() => saveCloudModel()}>
                  Save model
                </button>
              </div>
            )}

            {catalog?.models.length ? (
              <ul className="models-empty-note" style={{ marginTop: 10, paddingLeft: 18 }}>
                {catalog.models.slice(0, 8).map((m) => (
                  <li key={m.name}>
                    <strong>{m.name}</strong> — {accessLabel(m.access)}
                    {m.detail ? ` · ${m.detail}` : ""}
                  </li>
                ))}
                {catalog.models.length > 8 ? (
                  <li>…and {catalog.models.length - 8} more in the dropdown</li>
                ) : null}
              </ul>
            ) : null}

            {hasKey ? (
              <p className="field-help">An Ollama Cloud API key is stored securely.</p>
            ) : null}
          </div>
        ) : providerId === "google" ? (
          <div className="models-provider-body">
            <p className="models-empty-note">
              {hasKey
                ? "Google AI Studio API key is stored securely. Choose which Gemini text model ArcSonare uses everywhere."
                : "Paste a Google AI Studio (Gemini) API key. Then pick one Gemini model below — one Google card covers all of them."}
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
            <p className="models-empty-note">
              Text chat only (no image, video, or robotics models). Used for dashboard chat and the voice overlay.
            </p>
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
                  setStatus(
                    `Gemini model set to “${googleModel}”. Use Set as default on Google Gemini to make it the everyday assistant.`,
                  );
                }}
                ariaLabel="Gemini model"
              />
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => {
                  updatePrefs((p) => ({
                    ...p,
                    models: {
                      ...p.models,
                      roles: { ...p.models.roles, assistant: "google-gemini" },
                    },
                  }));
                  setStatus("Google Gemini is now your everyday assistant.");
                  onChanged();
                }}
              >
                Set as default assistant
              </button>
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
