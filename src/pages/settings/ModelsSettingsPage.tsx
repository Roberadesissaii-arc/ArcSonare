import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckIcon } from "../../components/Icons";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
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

type KeyStatus = Record<ProviderId, boolean>;

function ModelCard({
  model,
  connected,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  connected: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const provider = providerById(model.provider);
  return (
    <div className={`model-card${selected ? " selected" : ""}`}>
      <div className="model-card-head">
        <span className="model-logo-tile">
          <img src={model.logo} alt="" width={26} height={26} draggable={false} />
        </span>
        <span className="model-card-names">
          <span className="model-card-name">{model.displayName}</span>
          <span className="model-card-provider">{provider.name}</span>
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
      </div>
    </div>
  );
}

function ProviderConfigCard({
  providerId,
  hasKey,
  onChanged,
}: {
  providerId: ProviderId;
  hasKey: boolean;
  onChanged: () => void;
}) {
  const provider = providerById(providerId);
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
        <span className={`model-badge ${hasKey ? "status-connected" : "status-unconfigured"}`}>
          {provider.configuration === "local-runtime"
            ? "Runtime not detected"
            : hasKey
              ? "Key stored"
              : "No key"}
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
        <p className="field-help">
          Ollama is configured by installing it locally. Runtime detection is
          not implemented yet, so local models stay unavailable in this build.
        </p>
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
    ollama: false,
  });

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
  useEffect(refreshKeys, []);

  const isConnected = (model: ModelInfo) =>
    model.locality === "cloud" && keys[model.provider];

  const setRole = (role: ModelRole, modelId: string | null) =>
    updatePrefs((p) => ({
      ...p,
      models: { ...p.models, roles: { ...p.models.roles, [role]: modelId } },
    }));

  const set = (patch: Partial<typeof models>) => patchPrefs("models", patch);

  const NONE = "__none__";

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Models</h1>
        <p className="page-subtitle">
          Which models power each part of ArcSonare. A model runs only after
          its provider is configured — nothing here executes yet.
        </p>
      </header>

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
              onSelect={() => setRole("assistant", model.id)}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Model roles"
        description="Assign a model to each ArcSonare capability. Roles without a fitting model stay unassigned."
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
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
