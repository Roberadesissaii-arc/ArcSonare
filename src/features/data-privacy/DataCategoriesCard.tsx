import { FolderIcon } from "../../components/Icons";
import { USAGE_CATEGORIES } from "./dataCategoryRegistry";
import { DataPrivacyCard } from "./DataPrivacyCard";
import { formatBytes, type StorageScanResult } from "./dataPrivacyTypes";

interface DataCategoriesCardProps {
  scan: StorageScanResult | null;
  onViewAll: () => void;
}

export function DataCategoriesCard({ scan, onViewAll }: DataCategoriesCardProps) {
  return (
    <DataPrivacyCard title="Data categories">
      <ul className="data-categories-list">
        {USAGE_CATEGORIES.map((cat) => {
          const row = scan?.categories.find((c) => c.id === cat.id);
          const files = row?.fileCount ?? 0;
          const items = row?.itemCount;
          return (
            <li key={cat.id}>
              <span className={`data-cat-icon tone-${cat.tone}`} aria-hidden="true" />
              <div>
                <strong>{cat.displayName.replace(" & annotations", "").replace(" & raw audio", "").replace(" & agent logs", "").replace(" & caches", "")}</strong>
                <span>
                  {items != null
                    ? `${items.toLocaleString()} keys`
                    : files > 0
                      ? `${files.toLocaleString()} files`
                      : "—"}
                </span>
              </div>
              <em>{formatBytes(row?.bytes ?? 0)}</em>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn data-manage-all" onClick={onViewAll}>
        <FolderIcon size={14} />
        View all data
      </button>
    </DataPrivacyCard>
  );
}
