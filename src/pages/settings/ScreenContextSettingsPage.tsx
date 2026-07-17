import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import { AnnotationToolsCard } from "../../features/screen-context/AnnotationToolsCard";
import { CaptureTargetCard } from "../../features/screen-context/CaptureTargetCard";
import { CaptureWorkspaceCard } from "../../features/screen-context/CaptureWorkspaceCard";
import { LiveCapturePreviewCard } from "../../features/screen-context/LiveCapturePreviewCard";
import { PrivacyHistoryCard } from "../../features/screen-context/PrivacyHistoryCard";
import { ScreenContextPreview } from "../../features/screen-context/ScreenContextPreview";
import { ScreenContextStatusHero } from "../../features/screen-context/ScreenContextStatusHero";
import {
  captureAndAnnotate,
  startScreenContext,
  stopScreenContext,
  useScreenContext,
} from "../../features/screen-context/screenContextStore";
import type { CaptureMeta } from "../../features/screen-context/types";

export function ScreenContextSettingsPage() {
  const prefs = usePrefs();
  const sc = prefs.screenContext;
  const status = useScreenContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<CaptureMeta[]>([]);
  const [preview, setPreview] = useState<CaptureMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const setSc = (patch: Partial<typeof sc>) => patchPrefs("screenContext", patch);
  const setAnnotation = (patch: Partial<typeof sc.annotation>) =>
    updatePrefs((p) => ({
      ...p,
      screenContext: {
        ...p.screenContext,
        annotation: { ...p.screenContext.annotation, ...patch },
      },
    }));
  const setPrivacy = (patch: Partial<typeof sc.privacy>) =>
    updatePrefs((p) => ({
      ...p,
      screenContext: {
        ...p.screenContext,
        privacy: { ...p.screenContext.privacy, ...patch },
      },
    }));

  const refreshCaptures = useCallback(() => {
    invoke<CaptureMeta[]>("list_captures")
      .then(setCaptures)
      .catch(() => setCaptures([]));
  }, []);

  useEffect(refreshCaptures, [refreshCaptures]);

  const runAction = (action: () => Promise<void>, options?: { capture?: boolean }) => {
    setBusy(true);
    if (options?.capture) setCapturing(true);
    setActionError(null);
    action()
      .then(() => refreshCaptures())
      .catch((err) =>
        setActionError(typeof err === "string" ? err : "The action failed."),
      )
      .finally(() => {
        setBusy(false);
        setCapturing(false);
      });
  };

  const [pendingCapture, setPendingCapture] = useState(false);

  const ensureEnabled = () => {
    if (!sc.enabled) {
      patchPrefs("screenContext", { enabled: true });
    }
  };

  const handleStart = () => {
    runAction(async () => {
      ensureEnabled();
      await startScreenContext();
    });
  };

  const handleStop = () => {
    runAction(async () => {
      await stopScreenContext();
    });
  };

  const runCaptureAnnotate = () => {
    runAction(async () => {
      if (!status.active) {
        ensureEnabled();
        await startScreenContext();
      }
      await captureAndAnnotate();
    }, { capture: true });
  };

  const handleCaptureAnnotate = () => {
    // Never use window.confirm (shows “localhost says”). Prefer in-app confirm.
    if (sc.requireConfirmation && !pendingCapture) {
      setPendingCapture(true);
      setActionError(null);
      return;
    }
    setPendingCapture(false);
    runCaptureAnnotate();
  };

  const handleConfirmCapture = () => {
    setPendingCapture(false);
    runCaptureAnnotate();
  };

  const handleCancelCapture = () => {
    setPendingCapture(false);
  };

  const handleScChange = (patch: Partial<typeof sc>) => {
    setSc(patch);
    if (patch.enabled === true && !status.active) {
      void startScreenContext().catch((err) =>
        setActionError(
          typeof err === "string" ? err : "Could not start Screen Context.",
        ),
      );
    }
    if (patch.enabled === false && status.active) {
      void stopScreenContext();
    }
  };

  return (
    <div className="screen-context-page page">
      <SettingsPageHeader
        title="Screen Context"
        description="Understand what’s on your screen. Capture context, annotate important details, and tell ArcSonare exactly what to look at."
      />

      <ScreenContextStatusHero
        active={status.active}
        busy={busy}
        enabled={sc.enabled}
        capturing={capturing}
        error={actionError}
        pendingCapture={pendingCapture}
        onStart={handleStart}
        onStop={handleStop}
        onCaptureAnnotate={handleCaptureAnnotate}
        onConfirmCapture={handleConfirmCapture}
        onCancelCapture={handleCancelCapture}
      />

      <div className="screen-context-workspace-grid">
        <CaptureWorkspaceCard sc={sc} onChange={handleScChange} />
        <CaptureTargetCard
          defaultTarget={sc.defaultTarget}
          selectedMonitorIds={sc.selectedMonitorIds}
          onTargetChange={(defaultTarget) => setSc({ defaultTarget })}
          onSelectedMonitorsChange={(selectedMonitorIds) =>
            setSc({ selectedMonitorIds })
          }
        />
        <AnnotationToolsCard
          annotation={sc.annotation}
          onAnnotationChange={setAnnotation}
        />
        <LiveCapturePreviewCard sc={sc} onChange={setSc} />
        <PrivacyHistoryCard
          privacy={sc.privacy}
          captures={captures}
          busy={busy}
          onPrivacyChange={setPrivacy}
          onClearHistory={() =>
            runAction(async () => {
              await invoke("clear_capture_history");
            })
          }
          onOpenCapture={setPreview}
          onDeleteCapture={(meta) =>
            runAction(async () => {
              await invoke("delete_capture", { id: meta.id });
            })
          }
        />
      </div>

      {preview ? (
        <ScreenContextPreview
          meta={preview}
          onClose={() => setPreview(null)}
          onDelete={() => {
            invoke("delete_capture", { id: preview.id })
              .then(() => {
                setPreview(null);
                refreshCaptures();
              })
              .catch(() => setPreview(null));
          }}
        />
      ) : null}
    </div>
  );
}
