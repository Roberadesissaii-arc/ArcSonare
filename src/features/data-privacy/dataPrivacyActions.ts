/**
 * Data & Privacy helpers: scan merge, localStorage sizing, privacy ring state.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Prefs } from "../../config/prefs";
import { USAGE_CATEGORIES } from "./dataCategoryRegistry";
import type {
  CategoryUsage,
  PrivacyRingState,
  StorageScanResult,
} from "./dataPrivacyTypes";

export function localStorageBytes(prefixes: string[]): number {
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key.startsWith(p))) {
        total += (window.localStorage.getItem(key)?.length ?? 0) * 2;
      }
    }
  } catch {
    // localStorage unavailable.
  }
  return total;
}

export function localStorageKeys(prefixes: string[]): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) keys.push(key);
    }
  } catch {
    // ignore
  }
  return keys;
}

/** Estimate activity/agent/task store sizes from localStorage. */
export function browserActivityUsage(): CategoryUsage {
  const bytes = localStorageBytes([
    "arcsonare.activity",
    "arcsonare.agents",
    "arcsonare.tasks",
    "arcsonare.agentApprovals",
  ]);
  const keys = localStorageKeys([
    "arcsonare.activity",
    "arcsonare.agents",
    "arcsonare.tasks",
    "arcsonare.agentApprovals",
  ]);
  return {
    id: "activity-logs",
    bytes,
    fileCount: keys.length,
    scanErrors: 0,
    itemCount: keys.length,
  };
}

export async function scanStorage(): Promise<StorageScanResult> {
  const disk = await invoke<StorageScanResult>("scan_data_storage");
  const activity = browserActivityUsage();
  const byId = new Map(disk.categories.map((c) => [c.id, { ...c }]));

  // Ensure all UI categories exist.
  for (const def of USAGE_CATEGORIES) {
    if (!byId.has(def.id)) {
      byId.set(def.id, {
        id: def.id,
        bytes: 0,
        fileCount: 0,
        scanErrors: 0,
      });
    }
  }
  byId.set("activity-logs", activity);

  const categories = USAGE_CATEGORIES.map(
    (d) => byId.get(d.id) ?? { id: d.id, bytes: 0, fileCount: 0, scanErrors: 0 },
  );

  const totalBytes = categories.reduce((n, c) => n + c.bytes, 0);
  const totalFiles = categories.reduce((n, c) => n + c.fileCount, 0);

  return {
    ...disk,
    categories,
    totalBytes,
    totalFiles,
  };
}

export function derivePrivacyRing(prefs: Prefs["dataPrivacy"], folderReady: boolean): {
  state: PrivacyRingState;
  label: string;
} {
  if (!folderReady) {
    return { state: "storage-issue", label: "Storage issue" };
  }
  if (prefs.allowCloud && !prefs.askBeforeCloud) {
    return { state: "review", label: "Review recommended" };
  }
  if (prefs.allowCloud) {
    return { state: "cloud-active", label: "Cloud processing allowed" };
  }
  if (prefs.storeRawAudio || prefs.diagnostics) {
    return { state: "review", label: "Review recommended" };
  }
  return { state: "protected", label: "You’re in control" };
}

export function encryptionLabel(status: string): string {
  switch (status) {
    case "application-encrypted":
      return "AES-256 enabled";
    case "windows-protected":
      return "Protected by Windows";
    case "secrets-protected-separately":
      return "Secrets protected separately";
    case "none":
      return "Not encrypted by ArcSonare";
    default:
      return "Unknown";
  }
}

export function backupLabel(status: string): string {
  switch (status) {
    case "not-configured":
      return "Not configured";
    case "never":
      return "Never";
    case "completed":
      return "Completed";
    case "failed":
      return "Backup failed";
    case "running":
      return "In progress";
    default:
      return "Not configured";
  }
}

export function folderStatusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Local storage active";
    case "read-only":
      return "Read-only";
    case "unavailable":
      return "Data folder not initialized";
    case "error":
      return "Storage error";
    default:
      return "Checking…";
  }
}
