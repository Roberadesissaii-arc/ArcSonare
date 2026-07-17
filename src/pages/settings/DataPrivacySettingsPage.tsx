import { useCallback, useEffect, useState } from "react";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { ShieldIcon } from "../../components/Icons";
import {
  DEFAULT_PREFS,
  type DataRetention,
  type RetentionDataType,
} from "../../config/prefs";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import { CategoryManagerDrawer } from "../../features/data-privacy/CategoryManagerDrawer";
import { DataActionsCard } from "../../features/data-privacy/DataActionsCard";
import { DataCategoriesCard } from "../../features/data-privacy/DataCategoriesCard";
import { DataLocationCard } from "../../features/data-privacy/DataLocationCard";
import { DeleteAllDataDialog } from "../../features/data-privacy/DeleteAllDataDialog";
import { ExportDataDrawer } from "../../features/data-privacy/ExportDataDrawer";
import { PrivacyAtGlanceCard } from "../../features/data-privacy/PrivacyAtGlanceCard";
import { PrivacyControlsCard } from "../../features/data-privacy/PrivacyControlsCard";
import { PrivacyGuideDrawer } from "../../features/data-privacy/PrivacyGuideDrawer";
import {
  recommendedRetention,
  RetentionControlsCard,
} from "../../features/data-privacy/RetentionControlsCard";
import { UsageOverviewCard } from "../../features/data-privacy/UsageOverviewCard";
import { scanStorage } from "../../features/data-privacy/dataPrivacyActions";
import type { StorageScanResult } from "../../features/data-privacy/dataPrivacyTypes";

/** Premium Data & Privacy workspace inside Settings. */
export function DataPrivacySettingsPage() {
  const prefs = usePrefs();
  const dp = prefs.dataPrivacy;
  const [scan, setScan] = useState<StorageScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manageCategory, setManageCategory] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const refresh = useCallback(() => {
    setScanning(true);
    setScanError(null);
    scanStorage()
      .then(setScan)
      .catch((err) =>
        setScanError(
          typeof err === "string" ? err : "Storage usage unavailable.",
        ),
      )
      .finally(() => setScanning(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setDp = (patch: Partial<typeof dp>) => patchPrefs("dataPrivacy", patch);

  const setRetention = (id: RetentionDataType, value: DataRetention) =>
    updatePrefs((p) => ({
      ...p,
      dataPrivacy: {
        ...p.dataPrivacy,
        retention: { ...p.dataPrivacy.retention, [id]: value },
      },
    }));

  const folderReady = scan?.folderStatus === "ready";

  return (
    <div className="page data-privacy-page">
      <SettingsPageHeader
        title="Data & Privacy"
        description="Manage where your data lives, how it’s used, and how long it’s kept."
        actions={
          <button
            type="button"
            className="btn data-privacy-guide-btn"
            onClick={() => setGuideOpen(true)}
          >
            <ShieldIcon size={14} />
            Privacy guide
          </button>
        }
      />

      {scanError ? (
        <p className="data-privacy-error" role="alert">
          {scanError}{" "}
          <button type="button" className="btn btn-small" onClick={refresh}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="data-privacy-layout">
        <div className="data-privacy-main">
          <DataLocationCard
            scan={scan}
            scanning={scanning}
            onRefresh={refresh}
          />
          <UsageOverviewCard
            scan={scan}
            scanning={scanning}
            onRefresh={refresh}
            onManage={(id) => setManageCategory(id)}
          />
          <RetentionControlsCard
            retention={dp.retention}
            onChange={setRetention}
            onReset={() =>
              updatePrefs((p) => ({
                ...p,
                dataPrivacy: {
                  ...p.dataPrivacy,
                  retention: recommendedRetention(),
                },
              }))
            }
          />
          <PrivacyControlsCard dataPrivacy={dp} onChange={setDp} />
          <DataActionsCard
            onExport={() => setExportOpen(true)}
            onDeleteAll={() => setDeleteOpen(true)}
            onCleared={refresh}
          />
        </div>

        <aside className="data-privacy-rail">
          <PrivacyAtGlanceCard
            dataPrivacy={dp}
            folderReady={folderReady}
            onManageAll={() => setManagerOpen(true)}
          />
          <DataCategoriesCard
            scan={scan}
            onViewAll={() => setManagerOpen(true)}
          />
        </aside>
      </div>

      {manageCategory ? (
        <CategoryManagerDrawer
          categoryId={manageCategory}
          scan={scan}
          onClose={() => setManageCategory(null)}
          onCleared={refresh}
        />
      ) : null}

      {managerOpen ? (
        <CategoryManagerDrawer
          categoryId="screen-captures"
          scan={scan}
          onClose={() => setManagerOpen(false)}
          onCleared={refresh}
        />
      ) : null}

      {guideOpen ? (
        <PrivacyGuideDrawer
          dataPrivacy={dp}
          onClose={() => setGuideOpen(false)}
        />
      ) : null}

      {exportOpen ? (
        <ExportDataDrawer onClose={() => setExportOpen(false)} />
      ) : null}

      {deleteOpen ? (
        <DeleteAllDataDialog
          scan={scan}
          onClose={() => setDeleteOpen(false)}
          onDone={() => {
            refresh();
            // Restore in-memory prefs after clear_local_data.
            updatePrefs(() => ({ ...DEFAULT_PREFS }));
          }}
        />
      ) : null}
    </div>
  );
}
