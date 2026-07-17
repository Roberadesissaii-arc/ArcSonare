import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckIcon } from "../../components/Icons";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import {
  MODELS,
  MODEL_ROLE_INFO,
  PROVIDERS,
  modelById,
  providerById,
  type ModelInfo,
  type ProviderId,
} from "../../config/modelRegistry";
import type { CostPreference, ModelRole } from "../../config/prefs";
import { deepseekReply } from "../../services/DeepSeekService";
import {
  ensureOllamaModel,
  ollamaReply,
  probeOllama,
  type OllamaStatus,
} from "../../services/OllamaService";

type KeyStatus = Record<ProviderId, boolean>;

function pickOllamaModel(installed: string[], saved: string): string {
  if (saved && installed.includes(saved)) return saved;
  return installed[0] ?? "";
}

function ModelCard({
  model,
  connected,
  selected,
  activeModelName,
  onSelect,
  onTest,
  testing,
  testResult,
}: {
  model: ModelInfo;
  connected: boolean;
  selected: boolean;
  activeModelName?: string;
  onSelect: () => void;
  onTest?: () => void;
  testing?: boolean;
  testResult?: string | null;
}) {
  const provider = providerById(model.provider);
  const isOllama = model.provider === "ollama";
  const canTest = Boolean(onTest);
  return (
    <div className={`model-card${selected ? " selected" : ""}`}>
      <div className="model-card-head">
        <span className="model-logo-tile">
          <img src={model.logo} alt="" width={26} height={26} draggable={false} />
        </span>
        <span className="model-card-names">
          <span className="model-card-name">{model.displayName}</span>
          <span className="model-card-provider">
            {provider.name}
            {isOllama && activeModelName ? ` · ${activeModelName}` : ""}
          </span>
        </span>
        {selected ? (
          <span className="model-card-check" aria-hidden="true">
            <CheckIcon size={15} />
          </span>
        ) : null}
      </div>
      <p className="model-card-desc">{model.description}</p>
      <div className="model-card-badges">
        {model.capabilities.map((cap) => (
          <span key={cap} className="model-badge">
            {cap}
          </span>
        ))}
        <span className={`model-badge locality-${model.locality}`}>
          {model.locality === "local" ? "Local" : "Cloud"}
        </span>
        <span className={`model-badge ${connected ? "status-connected" : "status-unconfigured"}`}>
          {connected ? "Connected" : "Not configured"}
        </span>
      </div>
      <div className="model-card-actions">
        <button type="button" className="btn btn-small" onClick={onSelect}>
          {selected ? "Selected as default" : "Select as default"}
        </button>
        {canTest ? (
          <button
            type="button"
            className="btn btn-small"
            disabled={testing}
            onClick={onTest}
          >
            {testing ? "Testing…" : "Test reply"}
          </button>
        ) : null}
      </div>
      {canTest && testResult ? (
        <p className="field-help" role="status" style={{ marginTop: 8 }}>
          {testResult}
        </p>
      ) : null}
    </div>
  );
}

function ProviderConfigCard({
  providerId,
  hasKey,
  onChanged,
  ollama,
  onRefreshOllama,
}: {
  providerId: ProviderId;
  hasKey: boolean;
  onChanged: () => void;
  ollama: OllamaStatus | null;
  onRefreshOllama: () => void;
}) {
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
  const badge =
    provider.configuration === "local-runtime"
      ? ollamaReady
        ? "Connected"
        : "Not detected"
      : hasKey
        ? "Key stored"
        : "No key";

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <span className="model-logo-tile">
          <img src={provider.logo} alt="" width={24} height={24} draggable={false} />
        </span>
        <span className="model-card-names">
          <span className="model-card-name">{provider.name}</span>
          <span className="model-card-provider">{provider.description}</span>
        </span>
        <span
          className={`model-badge ${
            ollamaReady || hasKey ? "status-connected" : "status-unconfigured"
          }`}
        >
          {badge}
        </span>
      </div>
      {provider.configuration === "api-key" ? (
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
      ) : (
            <div className="provider-card-body" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <p className="field-help" style={{ margin: 0 }}>
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
  );
}

export function ModelsSettingsPage() {
  const prefs = usePrefs();
  const models = prefs.models;
  const [keys, setKeys] = useState<KeyStatus>({
    anthropic: false,
    openai: false,
    google: false,
    xai: false,
    deepseek: false,
    ollama: false,
  });
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testModelId, setTestModelId] = useState<string | null>(null);

  const refreshKeys = () => {
    for (const provider of PROVIDERS) {
      invoke<boolean>("has_provider_key", { provider: provider.id })
        .then((has) =>
          setKeys((prev) =>
            prev[provider.id] === has ? prev : { ...prev, [provider.id]: has },
          ),
        )
        .catch(() => undefined);
    }
  };

  const refreshOllama = useCallback(() => {
    probeOllama()
      .then((status) => {
        setOllama(status);
        if (status.available && status.models.length) {
          const current = pickOllamaModel(status.models, prefs.models.ollamaModel);
          if (current !== prefs.models.ollamaModel) {
            patchPrefs("models", { ollamaModel: current });
          }
        }
      })
      .catch((err) =>
        setOllama({
          available: false,
          models: [],
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [prefs.models.ollamaModel]);

  useEffect(refreshKeys, []);
  useEffect(refreshOllama, [refreshOllama]);

  const isConnected = (model: ModelInfo) =>
    model.provider === "ollama"
      ? Boolean(ollama?.available && prefs.models.ollamaModel)
      : model.locality === "cloud" && keys[model.provider];

  const setRole = (role: ModelRole, modelId: string | null) =>
    updatePrefs((p) => ({
      ...p,
      models: { ...p.models, roles: { ...p.models.roles, [role]: modelId } },
    }));

  const selectOllamaDefault = async () => {
    setTestModelId("ollama-local");
    setTestResult(null);
    const ready = await ensureOllamaModel();
    if (!ready.ok) {
      setTestResult(ready.message);
      refreshOllama();
      return;
    }
    setRole("assistant", "ollama-local");
    setTestResult(`Ready — using ${ready.model}. Try “hello” on the dashboard.`);
    refreshOllama();
  };

  const testOllama = async () => {
    setTesting(true);
    setTestModelId("ollama-local");
    setTestResult(null);
    try {
      const ready = await ensureOllamaModel();
      if (!ready.ok) {
        setTestResult(ready.message);
        return;
      }
      const reply = await ollamaReply("Say hello in one short sentence.");
      setTestResult(`✓ ${ready.model}: ${reply}`);
      setRole("assistant", "ollama-local");
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
      refreshOllama();
    }
  };

  const testDeepSeek = async (modelId: string) => {
    const model = modelById(modelId);
    if (!model || model.provider !== "deepseek") return;
    setTesting(true);
    setTestModelId(modelId);
    setTestResult(null);
    try {
      if (!keys.deepseek) {
        setTestResult("Save a DeepSeek API key under Providers below, then try again.");
        return;
      }
      const reply = await deepseekReply(
        "Say hello in one short sentence.",
        model.modelName,
      );
      setTestResult(`✓ ${model.displayName}: ${reply}`);
      setRole("assistant", modelId);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const set = (patch: Partial<typeof models>) => patchPrefs("models", patch);

  const NONE = "__none__";

  return (
    <div className="page">
      <SettingsPageHeader
        title="Models"
        description="Select Ollama (local) or DeepSeek (API key), then Test reply. Dashboard chat uses that model for “hello” and other questions."
      />

      <SettingsGroup
        title="Default model"
        description="Used for everyday requests unless a role overrides it."
      >
        <div className="model-grid">
          {MODELS.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              connected={isConnected(model)}
              selected={models.roles.assistant === model.id}
              activeModelName={
                model.provider === "ollama" ? models.ollamaModel || undefined : undefined
              }
              onSelect={() =>
                model.provider === "ollama"
                  ? void selectOllamaDefault()
                  : setRole("assistant", model.id)
              }
              onTest={
                model.provider === "ollama"
                  ? () => void testOllama()
                  : model.provider === "deepseek"
                    ? () => void testDeepSeek(model.id)
                    : undefined
              }
              testing={testing && testModelId === model.id}
              testResult={testModelId === model.id ? testResult : null}
            />
          ))}
        </div>
      </SettingsGroup>

      <div className="settings-card-grid">
      <SettingsGroup
        title="Model roles"
        description="Assign a model to each ArcSonare capability."
      >
        {MODEL_ROLE_INFO.map((role) => {
          const candidates = MODELS.filter(role.fits);
          const options = [
            { value: NONE, label: "Not assigned" },
            ...candidates.map((m) => ({ value: m.id, label: m.displayName })),
          ];
          const current = models.roles[role.id];
          const assigned = modelById(current);
          return (
            <SettingRow
              key={role.id}
              label={role.label}
              description={
                assigned && !isConnected(assigned) && assigned.locality === "cloud"
                  ? `${role.description} (${assigned.displayName} is not configured yet)`
                  : role.description
              }
            >
              <Dropdown
                options={options}
                value={current && candidates.some((m) => m.id === current) ? current : NONE}
                onChange={(value) => setRole(role.id, value === NONE ? null : value)}
                ariaLabel={`Model for ${role.label}`}
              />
            </SettingRow>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Model routing">
        <SettingRow
          label="Automatic model routing"
          description="Choose the best role for each request automatically."
        >
          <Toggle
            checked={models.autoRouting}
            onChange={(autoRouting) => set({ autoRouting })}
            label="Automatic model routing"
          />
        </SettingRow>
        <SettingRow label="Prefer fastest model for simple tasks">
          <Toggle
            checked={models.preferFastSimple}
            onChange={(preferFastSimple) => set({ preferFastSimple })}
            label="Prefer fastest model for simple tasks"
            disabled={!models.autoRouting}
          />
        </SettingRow>
        <SettingRow label="Prefer local model for private tasks">
          <Toggle
            checked={models.preferLocalPrivate}
            onChange={(preferLocalPrivate) => set({ preferLocalPrivate })}
            label="Prefer local model for private tasks"
            disabled={!models.autoRouting}
          />
        </SettingRow>
        <SettingRow label="Ask before sending screen content to cloud models">
          <Toggle
            checked={models.askBeforeScreenCloud}
            onChange={(askBeforeScreenCloud) => set({ askBeforeScreenCloud })}
            label="Ask before sending screen content to cloud models"
          />
        </SettingRow>
        <SettingRow label="Fall back to another model when unavailable">
          <Toggle
            checked={models.fallbackWhenUnavailable}
            onChange={(fallbackWhenUnavailable) => set({ fallbackWhenUnavailable })}
            label="Fall back to another model when unavailable"
          />
        </SettingRow>
        <SettingRow label="Maximum model cost preference">
          <SegmentedControl<CostPreference>
            options={[
              { value: "economy", label: "Economy" },
              { value: "balanced", label: "Balanced" },
              { value: "best", label: "Best quality" },
            ]}
            value={models.costPreference}
            onChange={(costPreference) => set({ costPreference })}
            ariaLabel="Maximum model cost preference"
          />
        </SettingRow>
      </SettingsGroup>
      </div>

      <SettingsGroup
        title="Provider configuration"
        description="Keys are stored in Windows Credential Manager — never in files or localStorage, and never shown after saving."
      >
        <div className="provider-list">
          {PROVIDERS.map((provider) => (
            <ProviderConfigCard
              key={provider.id}
              providerId={provider.id}
              hasKey={keys[provider.id]}
              onChanged={refreshKeys}
              ollama={ollama}
              onRefreshOllama={refreshOllama}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
