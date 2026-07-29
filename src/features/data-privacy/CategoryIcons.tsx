import type { ReactNode } from "react";
import {
  BotIcon,
  CpuIcon,
  FileTextIcon,
  FolderIcon,
  LayersIcon,
  MicIcon,
  MonitorIcon,
  SearchIcon,
  SparkleIcon,
  WaveIcon,
} from "../../components/Icons";
import type { DataCategoryId } from "./dataPrivacyTypes";
import type { RetentionDataType } from "../../config/prefs";

const USAGE_ICONS: Record<DataCategoryId, ReactNode> = {
  "screen-captures": <MonitorIcon size={14} />,
  "voice-transcripts": <MicIcon size={14} />,
  "activity-logs": <BotIcon size={14} />,
  "model-cache": <CpuIcon size={14} />,
  other: <FolderIcon size={14} />,
};

const RETENTION_ICONS: Record<RetentionDataType, ReactNode> = {
  "voice-transcripts": <FileTextIcon size={14} />,
  "raw-audio": <WaveIcon size={14} />,
  "screen-captures": <MonitorIcon size={14} />,
  "screen-annotations": <LayersIcon size={14} />,
  "agent-activity": <BotIcon size={14} />,
  "search-history": <SearchIcon size={14} />,
  "command-history": <SparkleIcon size={14} />,
};

export function UsageCategoryIcon({
  id,
  tone,
}: {
  id: DataCategoryId;
  tone: string;
}) {
  return (
    <span className={`data-usage-icon tone-${tone}`} aria-hidden="true">
      {USAGE_ICONS[id]}
    </span>
  );
}

export function DataCategoryIcon({
  id,
  tone,
}: {
  id: DataCategoryId;
  tone: string;
}) {
  return (
    <span className={`data-cat-icon tone-${tone}`} aria-hidden="true">
      {USAGE_ICONS[id]}
    </span>
  );
}

export function RetentionCategoryIcon({ id }: { id: RetentionDataType }) {
  return (
    <span className="data-retention-icon" aria-hidden="true">
      {RETENTION_ICONS[id]}
    </span>
  );
}
