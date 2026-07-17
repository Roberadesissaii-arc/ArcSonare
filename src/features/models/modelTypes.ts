import type { ModelInfo, ProviderId } from "../../config/modelRegistry";

export type ModelFilterId =
  | "all"
  | "default"
  | "voice"
  | "vision"
  | "tools"
  | "audio"
  | "local"
  | "cloud";

export type ModelSortId =
  | "recommended"
  | "recent"
  | "name"
  | "provider"
  | "fastest"
  | "local-first"
  | "cloud-first";

export type ModelViewMode = "grid" | "list";

export type ModelStatusKind =
  | "connected"
  | "configured"
  | "running"
  | "not-configured"
  | "unavailable"
  | "error";

export type StripRoleId =
  | "assistant"
  | "speech"
  | "transcription"
  | "screen"
  | "local";

export interface StripRoleDef {
  id: StripRoleId;
  label: string;
  /** Prefs role key, or null for the Local Model tile. */
  prefsRole: import("../../config/prefs").ModelRole | null;
  fits: (m: ModelInfo) => boolean;
}

export interface ProviderRuntimeStatus {
  providerId: ProviderId;
  hasKey: boolean;
  /** Honest label based on what we actually know. */
  label: "Configured" | "Not configured" | "Running" | "Offline" | "Not detected";
  kind: ModelStatusKind;
}

export interface ModelTestState {
  modelId: string | null;
  busy: boolean;
  result: string | null;
}
