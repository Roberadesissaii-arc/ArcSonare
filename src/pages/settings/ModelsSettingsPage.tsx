import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import {
  MODELS,
  PROVIDERS,
  modelById,
  type ModelInfo,
  type ProviderId,
} from "../../config/modelRegistry";
import type { ModelRole } from "../../config/prefs";
import { ModelCard } from "../../features/models/ModelCard";
import { ModelDetailDrawer } from "../../features/models/ModelDetailDrawer";
import { ModelFilterBar } from "../../features/models/ModelFilterBar";
import {
  filterModels,
  modelStatus,
  overviewCounts,
  providerStatuses,
  rolesForModel,
  searchModels,
  sortModels,
  STRIP_ROLES,
} from "../../features/models/modelHelpers";
import { ModelOverviewCard } from "../../features/models/ModelOverviewCard";
import { ModelRoleStrip } from "../../features/models/ModelRoleStrip";
import { ModelSelector } from "../../features/models/ModelSelector";
import { ProviderConfiguration } from "../../features/models/ProviderConfiguration";
import { ProviderStatusCard } from "../../features/models/ProviderStatusCard";
import { RoutingFallbackCard } from "../../features/models/RoutingFallbackCard";
import type {
  ModelFilterId,
  ModelSortId,
  ModelViewMode,
  StripRoleId,
} from "../../features/models/modelTypes";
import { deepseekReply } from "../../services/DeepSeekService";
import { geminiReply } from "../../services/GeminiService";
import {
  ensureOllamaCloudModel,
  ensureOllamaModel,
  ollamaCloudChat,
  ollamaReply,
  probeOllama,
  type OllamaStatus,
} from "../../services/OllamaService";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import { assistantSystemContext } from "../../services/assistantTools";

type KeyStatus = Record<ProviderId, boolean>;

type SelectorMode =
  | { kind: "strip"; role: StripRoleId }
  | { kind: "fallback" }
  | { kind: "offline" }
  | null;

function pickOllamaModel(installed: string[], saved: string): string {
  if (saved && installed.includes(saved)) return saved;
  return installed[0] ?? "";
}

function markRecent(modelId: string) {
  updatePrefs((p) => {
    const prev = p.models.browser.recentlyUsed.filter((id) => id !== modelId);
    return {
      ...p,
      models: {
        ...p.models,
        browser: {
          ...p.models.browser,
          recentlyUsed: [modelId, ...prev].slice(0, 12),
        },
      },
    };
  });
}

export function ModelsSettingsPage() {
  const prefs = usePrefs();
  const modelsPrefs = prefs.models;
  const [keys, setKeys] = useState<KeyStatus>({
    anthropic: false,
    openai: false,
    google: false,
    xai: false,
    deepseek: false,
    ollama: false,
  });
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selector, setSelector] = useState<SelectorMode>(null);
  const [providerPanel, setProviderPanel] = useState<ProviderId | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testModelId, setTestModelId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState("Say hello in one short sentence.");
  const [assignError, setAssignError] = useState<string | null>(null);

  const filter = (modelsPrefs.browser.filter as ModelFilterId) || "all";
  const sort = (modelsPrefs.browser.sort as ModelSortId) || "recommended";
  const view = (modelsPrefs.browser.view as ModelViewMode) || "grid";

  const refreshKeys = useCallback(() => {
    for (const provider of PROVIDERS) {
      invoke<boolean>("has_provider_key", { provider: provider.id })
        .then((has) =>
          setKeys((prev) =>
            prev[provider.id] === has ? prev : { ...prev, [provider.id]: has },
          ),
        )
        .catch(() => undefined);
    }
  }, []);

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

  useEffect(refreshKeys, [refreshKeys]);
  useEffect(refreshOllama, [refreshOllama]);

  const setBrowser = (patch: Partial<typeof modelsPrefs.browser>) =>
    updatePrefs((p) => ({
      ...p,
      models: { ...p.models, browser: { ...p.models.browser, ...patch } },
    }));

  const setRole = (role: ModelRole, modelId: string | null) => {
    updatePrefs((p) => ({
      ...p,
      models: { ...p.models, roles: { ...p.models.roles, [role]: modelId } },
    }));
    if (modelId) markRecent(modelId);
  };

  const selectAsDefault = async (model: ModelInfo) => {
    setAssignError(null);
    if (model.id === "ollama-local") {
      const ready = await ensureOllamaModel();
      if (!ready.ok) {
        setAssignError(ready.message);
        refreshOllama();
        return;
      }
      setRole("assistant", "ollama-local");
      refreshOllama();
      return;
    }
    if (model.id === "ollama-cloud") {
      if (!keys.ollama) {
        setAssignError(
          "Save an Ollama Cloud API key first (Configure Ollama → Cloud).",
        );
        setProviderPanel("ollama");
        return;
      }
      const ready = await ensureOllamaCloudModel();
      if (!ready.ok) {
        setAssignError(ready.message);
        setProviderPanel("ollama");
        return;
      }
      setRole("assistant", "ollama-cloud");
      return;
    }
    if (model.provider === "deepseek" && !keys.deepseek) {
      setAssignError("Save a DeepSeek API key first (Configure DeepSeek).");
      setProviderPanel("deepseek");
      return;
    }
    if (model.provider === "google" && !keys.google) {
      setAssignError(
        "Save a Google AI Studio (Gemini) API key first (Configure Google).",
      );
      setProviderPanel("google");
      return;
    }
    if (model.id === "google-gemini" || model.provider === "google") {
      setRole("assistant", "google-gemini");
      return;
    }
    setRole("assistant", model.id);
  };

  const canTest = (model: ModelInfo) =>
    model.id === "ollama-local" ||
    model.id === "ollama-cloud" ||
    model.id === "google-gemini" ||
    model.provider === "deepseek" ||
    model.provider === "google";

  const runTest = async (model: ModelInfo, prompt: string) => {
    setTesting(true);
    setTestModelId(model.id);
    setTestResult(null);
    try {
      if (model.id === "ollama-local") {
        const ready = await ensureOllamaModel();
        if (!ready.ok) {
          setTestResult(ready.message);
          return;
        }
        const reply = await ollamaReply(prompt);
        setTestResult(`✓ ${ready.model}: ${reply}`);
        markRecent(model.id);
        return;
      }
      if (model.id === "ollama-cloud") {
        if (!keys.ollama) {
          setTestResult("Save an Ollama Cloud API key first, then try again.");
          return;
        }
        const ready = await ensureOllamaCloudModel();
        if (!ready.ok) {
          setTestResult(ready.message);
          return;
        }
        const reply = await ollamaCloudChat(
          [
            { role: "system", content: assistantSystemContext() },
            { role: "user", content: prompt },
          ],
          ready.model,
        );
        setTestResult(`✓ Cloud ${ready.model}: ${reply}`);
        markRecent(model.id);
        return;
      }
      if (model.provider === "deepseek") {
        if (!keys.deepseek) {
          setTestResult("Save a DeepSeek API key first, then try again.");
          return;
        }
        const reply = await deepseekReply(prompt, model.modelName);
        setTestResult(`✓ ${model.displayName}: ${reply}`);
        markRecent(model.id);
        return;
      }
      if (model.provider === "google" || model.id === "google-gemini") {
        if (!keys.google) {
          setTestResult(
            "Save a Google AI Studio (Gemini) API key first, then try again.",
          );
          return;
        }
        const modelName =
          prefs.models.googleModel?.trim() || model.modelName || "gemini-3.5-flash";
        const reply = await geminiReply(prompt, modelName);
        setTestResult(`✓ Google Gemini (${modelName}): ${reply}`);
        markRecent("google-gemini");
        return;
      }
      setTestResult("Live testing is not wired for this provider yet.");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/403|requires a subscription|upgrade for access/i.test(raw)) {
        setTestResult(
          `${raw}\n\nThis cloud model needs Ollama Pro/Max. Open Configure provider → Check free / paid, then pick a Free model (no need to reconnect the key).`,
        );
      } else {
        setTestResult(raw);
      }
    } finally {
      setTesting(false);
      if (model.id === "ollama-local") refreshOllama();
    }
  };

  const visibleModels = useMemo(() => {
    const filtered = filterModels(MODELS, filter, modelsPrefs.roles.assistant);
    const searched = searchModels(filtered, search);
    return sortModels(searched, sort, modelsPrefs.browser.recentlyUsed);
  }, [filter, search, sort, modelsPrefs.roles.assistant, modelsPrefs.browser.recentlyUsed]);

  const counts = useMemo(() => overviewCounts(MODELS), []);
  const statuses = useMemo(() => providerStatuses(keys, ollama), [keys, ollama]);
  const detailModel = detailId ? modelById(detailId) : undefined;

  const selectorModels = useMemo(() => {
    if (!selector) return [];
    if (selector.kind === "fallback") {
      return MODELS.filter((m) => m.supportsText);
    }
    if (selector.kind === "offline") {
      return MODELS.filter((m) => m.locality === "local" && m.supportsText);
    }
    const role = STRIP_ROLES.find((r) => r.id === selector.role);
    return role ? MODELS.filter(role.fits) : [];
  }, [selector]);

  const selectorSelectedId = (() => {
    if (!selector) return null;
    if (selector.kind === "fallback") return modelsPrefs.fallbackModelId;
    if (selector.kind === "offline") return modelsPrefs.offlineFallbackModelId;
    if (selector.role === "local") {
      return modelsPrefs.roles.assistant === "ollama-local" ? "ollama-local" : null;
    }
    const prefsRole = STRIP_ROLES.find((r) => r.id === selector.role)?.prefsRole;
    return prefsRole ? modelsPrefs.roles[prefsRole] : null;
  })();

  const onSelectorPick = (modelId: string | null) => {
    if (!selector) return;
    setAssignError(null);
    if (selector.kind === "fallback") {
      patchPrefs("models", { fallbackModelId: modelId });
      if (modelId) markRecent(modelId);
      setSelector(null);
      return;
    }
    if (selector.kind === "offline") {
      const model = modelId ? modelById(modelId) : undefined;
      if (model && model.locality !== "local") {
        setAssignError("Offline fallback must be a local model.");
        return;
      }
      patchPrefs("models", { offlineFallbackModelId: modelId });
      if (modelId) markRecent(modelId);
      setSelector(null);
      return;
    }
    if (selector.role === "local") {
      if (!modelId || modelId === "ollama-local") {
        void selectAsDefault(modelById("ollama-local")!);
      }
      setSelector(null);
      return;
    }
    const prefsRole = STRIP_ROLES.find((r) => r.id === selector.role)?.prefsRole;
    if (!prefsRole) return;
    if (modelId) {
      const model = modelById(modelId);
      const roleDef = STRIP_ROLES.find((r) => r.id === selector.role);
      if (model && roleDef && !roleDef.fits(model)) {
        setAssignError(`${model.displayName} is not compatible with ${roleDef.label}.`);
        return;
      }
    }
    setRole(prefsRole, modelId);
    setSelector(null);
  };

  // Validate persisted IDs that no longer exist.
  useEffect(() => {
    let changed = false;
    const roles = { ...modelsPrefs.roles };
    for (const key of Object.keys(roles) as ModelRole[]) {
      const id = roles[key];
      if (id && !modelById(id)) {
        roles[key] = null;
        changed = true;
      }
    }
    if (changed) {
      patchPrefs("models", { roles });
      setAssignError("A saved model is no longer available. Please choose a replacement.");
    }
  }, [modelsPrefs.roles]);

  return (
    <div className="page models-page">
      <SettingsPageHeader
        title="Models"
        description="Choose the best models for each ArcSonare capability. Defaults can be overridden per task or conversation."
      />

      <div className="models-top-stack">
        <ModelRoleStrip
          roles={modelsPrefs.roles}
          ollamaModel={modelsPrefs.ollamaModel}
          ollama={ollama}
          onSelectRole={(role) => setSelector({ kind: "strip", role })}
        />

        <ModelFilterBar
          filter={filter}
          sort={sort}
          view={view}
          search={search}
          onFilter={(id) => setBrowser({ filter: id })}
          onSort={(id) => setBrowser({ sort: id })}
          onView={(next) => setBrowser({ view: next })}
          onSearch={setSearch}
        />

        {assignError ? (
          <p className="models-inline-error" role="alert">
            {assignError}
          </p>
        ) : null}
      </div>

      <div className="models-page-layout">
        <div className="models-main-column">
          {visibleModels.length === 0 ? (
            <div className="models-empty-state" role="status">
              <p>No models match this filter.</p>
              <div className="models-empty-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setBrowser({ filter: "all" })}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setProviderPanel("ollama")}
                >
                  Detect local models
                </button>
              </div>
            </div>
          ) : (
            <div className={`models-browser models-browser-${view}`}>
              {visibleModels.map((model) => {
                const status = modelStatus(
                  model,
                  keys,
                  ollama,
                  modelsPrefs.ollamaModel,
                  modelsPrefs.ollamaCloudModel,
                );
                const selected = modelsPrefs.roles.assistant === model.id;
                return (
                  <ModelCard
                    key={model.id}
                    model={model}
                    selected={selected}
                    statusKind={status.kind}
                    statusLabel={status.label}
                    activeModelName={
                      model.id === "ollama-local"
                        ? modelsPrefs.ollamaModel || undefined
                        : model.id === "ollama-cloud"
                          ? modelsPrefs.ollamaCloudModel || undefined
                          : model.id === "google-gemini"
                            ? modelsPrefs.googleModel || undefined
                            : undefined
                    }
                    view={view}
                    testing={testing && testModelId === model.id}
                    onOpen={() => {
                      setDetailId(model.id);
                      setTestResult(null);
                    }}
                    onPrimary={() => void selectAsDefault(model)}
                    onTest={
                      canTest(model) ? () => void runTest(model, testPrompt) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        <aside className="models-side-column" aria-label="Model management">
          <RoutingFallbackCard
            fallbackModelId={modelsPrefs.fallbackModelId}
            offlineFallbackModelId={modelsPrefs.offlineFallbackModelId}
            autoRouting={modelsPrefs.autoRouting}
            onPickFallback={() => setSelector({ kind: "fallback" })}
            onPickOffline={() => setSelector({ kind: "offline" })}
            onAutoRouting={(autoRouting) => patchPrefs("models", { autoRouting })}
          />
          <ProviderStatusCard
            statuses={statuses}
            onOpenProvider={(id) => setProviderPanel(id as ProviderId)}
          />
          <ModelOverviewCard
            {...counts}
            onConfigureProviders={() => setProviderPanel("openai")}
          />
        </aside>
      </div>

      {detailModel ? (
        <ModelDetailDrawer
          model={detailModel}
          statusKind={
            modelStatus(
              detailModel,
              keys,
              ollama,
              modelsPrefs.ollamaModel,
              modelsPrefs.ollamaCloudModel,
            ).kind
          }
          statusLabel={
            modelStatus(
              detailModel,
              keys,
              ollama,
              modelsPrefs.ollamaModel,
              modelsPrefs.ollamaCloudModel,
            ).label
          }
          assignedRoles={rolesForModel(detailModel.id, modelsPrefs.roles)}
          activeModelName={
            detailModel.id === "ollama-local"
              ? modelsPrefs.ollamaModel || undefined
              : detailModel.id === "ollama-cloud"
                ? modelsPrefs.ollamaCloudModel || undefined
                : detailModel.id === "google-gemini"
                  ? modelsPrefs.googleModel || undefined
                  : undefined
          }
          testing={testing && testModelId === detailModel.id}
          testResult={testModelId === detailModel.id ? testResult : null}
          testPrompt={testPrompt}
          onTestPromptChange={setTestPrompt}
          onTest={
            canTest(detailModel)
              ? () => void runTest(detailModel, testPrompt)
              : undefined
          }
          onSetDefault={() => void selectAsDefault(detailModel)}
          onConfigure={() => setProviderPanel(detailModel.provider)}
          onClose={() => setDetailId(null)}
          testLocked={testing}
        />
      ) : null}

      {selector ? (
        <ModelSelector
          title={
            selector.kind === "fallback"
              ? "Fallback model"
              : selector.kind === "offline"
                ? "Offline fallback"
                : `Assign ${STRIP_ROLES.find((r) => r.id === selector.role)?.label ?? "role"}`
          }
          description={
            selector.kind === "offline"
              ? "Only local models can be used offline."
              : selector.kind === "strip"
                ? "Only models with the required capabilities are listed."
                : "Used when the primary model is unavailable."
          }
          models={selectorModels}
          selectedId={selectorSelectedId}
          onSelect={onSelectorPick}
          onClose={() => setSelector(null)}
          allowNone={selector.kind !== "offline"}
          emptyMessage={
            selector.kind === "strip"
              ? "No compatible models for this role. Configure a provider that supports it."
              : "No compatible models available."
          }
        />
      ) : null}

      {providerPanel ? (
        <ProviderConfiguration
          providerId={providerPanel}
          hasKey={keys[providerPanel]}
          ollama={ollama}
          onChanged={refreshKeys}
          onRefreshOllama={refreshOllama}
          onClose={() => setProviderPanel(null)}
        />
      ) : null}
    </div>
  );
}
