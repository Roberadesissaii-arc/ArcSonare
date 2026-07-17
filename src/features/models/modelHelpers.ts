import {
  MODELS,
  MODEL_ROLE_INFO,
  modelById,
  providerById,
  type ModelInfo,
  type ProviderId,
} from "../../config/modelRegistry";
import type { ModelRole } from "../../config/prefs";
import type {
  ModelFilterId,
  ModelSortId,
  ModelStatusKind,
  ProviderRuntimeStatus,
  StripRoleDef,
} from "./modelTypes";
import type { OllamaStatus } from "../../services/OllamaService";

export const STRIP_ROLES: StripRoleDef[] = [
  {
    id: "assistant",
    label: "Default Assistant",
    prefsRole: "assistant",
    fits: (m) => m.supportsText,
  },
  {
    id: "speech",
    label: "Voice",
    prefsRole: "speech",
    fits: (m) => m.supportsAudioOutput || m.contextType === "realtime",
  },
  {
    id: "transcription",
    label: "Transcription",
    prefsRole: "transcription",
    fits: (m) => m.supportsAudioInput && !m.supportsAudioOutput,
  },
  {
    id: "screen",
    label: "Screen Context",
    prefsRole: "screen",
    fits: (m) => m.supportsImage,
  },
  {
    id: "local",
    label: "Local Model",
    prefsRole: null,
    fits: (m) => m.locality === "local",
  },
];

export const FILTERS: { id: ModelFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "default", label: "Default" },
  { id: "voice", label: "Voice" },
  { id: "vision", label: "Vision" },
  { id: "tools", label: "Tools" },
  { id: "audio", label: "Audio" },
  { id: "local", label: "Local" },
  { id: "cloud", label: "Cloud" },
];

export const SORTS: { id: ModelSortId; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "recent", label: "Recently used" },
  { id: "name", label: "Name" },
  { id: "provider", label: "Provider" },
  { id: "fastest", label: "Fastest" },
  { id: "local-first", label: "Local first" },
  { id: "cloud-first", label: "Cloud first" },
];

export function isModelConnected(
  model: ModelInfo,
  keys: Record<ProviderId, boolean>,
  ollama: OllamaStatus | null,
  ollamaModel: string,
): boolean {
  if (model.provider === "ollama") {
    return Boolean(ollama?.available && ollamaModel.trim());
  }
  return Boolean(keys[model.provider]);
}

export function modelStatus(
  model: ModelInfo,
  keys: Record<ProviderId, boolean>,
  ollama: OllamaStatus | null,
  ollamaModel: string,
): { kind: ModelStatusKind; label: string } {
  if (model.provider === "ollama") {
    if (ollama?.available && ollamaModel.trim()) {
      return { kind: "running", label: "Running locally" };
    }
    if (ollama && !ollama.available) {
      return { kind: "unavailable", label: "Offline" };
    }
    return { kind: "not-configured", label: "Not detected" };
  }
  if (keys[model.provider]) {
    // Key stored — not a live health check.
    return { kind: "configured", label: "Configured" };
  }
  return { kind: "not-configured", label: "Not configured" };
}

export function providerStatuses(
  keys: Record<ProviderId, boolean>,
  ollama: OllamaStatus | null,
): ProviderRuntimeStatus[] {
  const ids = Array.from(new Set(MODELS.map((m) => m.provider)));
  return ids.map((providerId) => {
    const provider = providerById(providerId);
    if (provider.configuration === "local-runtime") {
      if (ollama?.available) {
        return {
          providerId,
          hasKey: false,
          label: "Running" as const,
          kind: "running" as const,
        };
      }
      return {
        providerId,
        hasKey: false,
        label: ollama ? ("Offline" as const) : ("Not detected" as const),
        kind: "unavailable" as const,
      };
    }
    if (keys[providerId]) {
      return {
        providerId,
        hasKey: true,
        label: "Configured" as const,
        kind: "configured" as const,
      };
    }
    return {
      providerId,
      hasKey: false,
      label: "Not configured" as const,
      kind: "not-configured" as const,
    };
  });
}

export function filterModels(
  models: ModelInfo[],
  filter: ModelFilterId,
  defaultAssistantId: string | null,
): ModelInfo[] {
  switch (filter) {
    case "default":
      return models.filter((m) => m.id === defaultAssistantId);
    case "voice":
      return models.filter((m) => m.supportsAudioOutput || m.contextType === "realtime");
    case "vision":
      return models.filter((m) => m.supportsImage);
    case "tools":
      return models.filter((m) => m.supportsTools);
    case "audio":
      return models.filter((m) => m.supportsAudioInput || m.supportsAudioOutput);
    case "local":
      return models.filter((m) => m.locality === "local");
    case "cloud":
      return models.filter((m) => m.locality === "cloud");
    default:
      return models;
  }
}

export function sortModels(
  models: ModelInfo[],
  sort: ModelSortId,
  recentlyUsed: string[],
): ModelInfo[] {
  const list = [...models];
  const recentIndex = (id: string) => {
    const i = recentlyUsed.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  switch (sort) {
    case "recent":
      return list.sort((a, b) => recentIndex(a.id) - recentIndex(b.id));
    case "name":
      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    case "provider":
      return list.sort((a, b) =>
        providerById(a.provider).name.localeCompare(providerById(b.provider).name),
      );
    case "fastest":
      return list.sort((a, b) => {
        const score = (m: ModelInfo) =>
          (m.supportsReasoning ? 2 : 0) + (m.contextType === "long" ? 1 : 0);
        return score(a) - score(b) || a.displayName.localeCompare(b.displayName);
      });
    case "local-first":
      return list.sort((a, b) => {
        if (a.locality !== b.locality) return a.locality === "local" ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
    case "cloud-first":
      return list.sort((a, b) => {
        if (a.locality !== b.locality) return a.locality === "cloud" ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
    case "recommended":
    default:
      return list.sort((a, b) => {
        const rank = (m: ModelInfo) => {
          if (m.id === "ollama-local") return 0;
          if (m.provider === "deepseek") return 1;
          if (m.supportsReasoning && m.supportsTools) return 2;
          if (m.supportsText) return 3;
          return 4;
        };
        return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
      });
  }
}

export function searchModels(models: ModelInfo[], query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((m) => {
    const provider = providerById(m.provider).name.toLowerCase();
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      provider.includes(q) ||
      m.capabilities.some((c) => c.toLowerCase().includes(q)) ||
      m.locality.includes(q)
    );
  });
}

export function rolesForModel(
  modelId: string,
  roles: Record<ModelRole, string | null>,
): string[] {
  const labels: string[] = [];
  for (const info of MODEL_ROLE_INFO) {
    if (roles[info.id] === modelId) labels.push(info.label);
  }
  return labels;
}

export function resolveAssignedModel(
  modelId: string | null | undefined,
): ModelInfo | undefined {
  if (!modelId) return undefined;
  return modelById(modelId);
}

export function overviewCounts(models: ModelInfo[]) {
  return {
    total: models.length,
    cloud: models.filter((m) => m.locality === "cloud").length,
    local: models.filter((m) => m.locality === "local").length,
    audio: models.filter((m) => m.supportsAudioInput || m.supportsAudioOutput).length,
    vision: models.filter((m) => m.supportsImage).length,
  };
}
