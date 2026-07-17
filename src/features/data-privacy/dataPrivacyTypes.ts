/**
 * Data & Privacy domain types.
 * Configuration honesty: encryption/backup/telemetry must match real backends.
 */

export type DataCategoryId =
  | "screen-captures"
  | "voice-transcripts"
  | "activity-logs"
  | "model-cache"
  | "other";

export type FolderStatus =
  | "loading"
  | "ready"
  | "read-only"
  | "unavailable"
  | "error";

export type EncryptionStatus =
  | "unknown"
  | "none"
  | "windows-protected"
  | "secrets-protected-separately"
  | "application-encrypted"
  | "error";

export type BackupStatus =
  | "not-configured"
  | "never"
  | "running"
  | "completed"
  | "failed";

export interface CategoryUsage {
  id: DataCategoryId | string;
  bytes: number;
  fileCount: number;
  scanErrors: number;
  /** Frontend-only: item count from stores when files aren't on disk. */
  itemCount?: number;
}

export interface StorageScanResult {
  dataDir: string;
  configDir: string;
  folderStatus: FolderStatus | string;
  totalBytes: number;
  totalFiles: number;
  categories: CategoryUsage[];
  scannedAt: string;
  scanDurationMs: number;
  errors: string[];
  encryptionStatus: EncryptionStatus | string;
  backupStatus: BackupStatus | string;
}

export type PrivacyRingState =
  | "protected"
  | "review"
  | "cloud-active"
  | "action-required"
  | "storage-issue";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function percentOf(part: number, total: number): number {
  if (!total || total <= 0 || !Number.isFinite(part)) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}
