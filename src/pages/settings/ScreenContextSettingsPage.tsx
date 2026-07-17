import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { Slider } from "../../components/settings/Slider";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import {
  captureAndAnnotate,
  startScreenContext,
  stopScreenContext,
  useScreenContext,
} from "../../features/screen-context/screenContextStore";
import { MonitorSelector } from "../../features/screen-context/MonitorSelector";
import { ScreenContextPreview } from "../../features/screen-context/ScreenContextPreview";
import type { CaptureMeta } from "../../features/screen-context/types";
import type { CaptureTarget, ScreenRetention } from "../../config/prefs";

export function ScreenContextSettingsPage() {
  const prefs = usePrefs();
  const sc = prefs.screenContext;
  const status = useScreenContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<CaptureMeta[]>([]);
  const [preview, setPreview] = useState<CaptureMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<typeof sc>) => patchPrefs("screenContext", patch);
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

  const runAction = (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    action()
      .then(() => refreshCaptures())
      .catch((err) =>
        setActionError(typeof err === "string" ? err : "The action failed."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Screen Context</h1>
        <p className="page-subtitle">
          Let ArcSonare temporarily view a screen, window or region and collect
          visual context. Captures stay local — no model analyzes them in this
          build.
        </p>
      </header>

      <SettingsGroup title="Status">
        <SettingRow
          label={status.active ? "Screen Context is active" : "Screen Context is off"}
          description={
            status.active
              ? `Indicating ${status.monitorIds.length} monitor(s). The violet edge marks every viewed screen.`
              : "Start to show the edge indicator on the configured monitors."
          }
        >
          <div className="sc-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !sc.enabled}
              onClick={() =>
                runAction(status.active ? stopScreenContext : startScreenContext)
              }
            >
              {status.active ? "Stop" : "Start"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !sc.enabled}
              onClick={() => runAction(() => captureAndAnnotate())}
            >
              Capture &amp; annotate
            </button>
          </div>
        </SettingRow>
        {!sc.enabled ? (
          <p className="field-help">Enable Screen Context below to use these actions.</p>
        ) : null}
        {actionError ? (
          <p className="field-error" role="alert">
            {actionError}
          </p>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Master controls">
        <SettingRow label="Enable Screen Context">
          <Toggle
            checked={sc.enabled}
            onChange={(enabled) => {
              set({ enabled });
              if (!enabled && status.active) void stopScreenContext();
            }}
            label="Enable Screen Context"
          />
        </SettingRow>
        <SettingRow label="Require confirmation before capture">
          <Toggle
            checked={sc.requireConfirmation}
            onChange={(requireConfirmation) => set({ requireConfirmation })}
            label="Require confirmation before capture"
            disabled={!sc.enabled}
          />
        </SettingRow>
        <SettingRow label="Show capture indicator" description="The violet screen edge while active.">
          <Toggle
            checked={sc.showIndicator}
            onChange={(showIndicator) => set({ showIndicator })}
            label="Show capture indicator"
            disabled={!sc.enabled}
          />
        </SettingRow>
        <SettingRow label="Play capture sound">
          <Toggle
            checked={sc.playCaptureSound}
            onChange={(playCaptureSound) => set({ playCaptureSound })}
            label="Play capture sound"
            disabled={!sc.enabled}
          />
        </SettingRow>
        <SettingRow label="Include mouse pointer" description="Pointer capture is not supported by the capture backend yet.">
          <Toggle
            checked={sc.includePointer}
            onChange={(includePointer) => set({ includePointer })}
            label="Include mouse pointer"
            disabled
          />
        </SettingRow>
        <SettingRow label="Include window shadows">
          <Toggle
            checked={sc.includeShadows}
            onChange={(includeShadows) => set({ includeShadows })}
            label="Include window shadows"
            disabled={!sc.enabled}
          />
        </SettingRow>
        <SettingRow
          label="Hide ArcSonare windows from captures"
          description="ArcSonare windows are excluded while a capture is taken (Windows 10 2004+)."
        >
          <Toggle
            checked={sc.hideArcSonareWindows}
            onChange={(hideArcSonareWindows) => set({ hideArcSonareWindows })}
            label="Hide ArcSonare windows from captures"
            disabled={!sc.enabled}
          />
        </SettingRow>
        <SettingRow label="Automatically delete temporary captures">
          <Toggle
            checked={sc.autoDeleteTemp}
            onChange={(autoDeleteTemp) => set({ autoDeleteTemp })}
            label="Automatically delete temporary captures"
            disabled={!sc.enabled}
          />
        </SettingRow>
        <SettingRow label="Ask before sending captures to cloud providers">
          <Toggle
            checked={sc.askBeforeCloud}
            onChange={(askBeforeCloud) => set({ askBeforeCloud })}
            label="Ask before sending captures to cloud providers"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Default capture target">
        <SettingRow label="Capture target">
          <Dropdown<CaptureTarget>
            options={[
              { value: "active-window", label: "Active window" },
              { value: "mouse-monitor", label: "Monitor containing the mouse" },
              { value: "primary-monitor", label: "Primary monitor" },
              { value: "selected-monitor", label: "Selected monitor" },
              { value: "all-monitors", label: "All monitors" },
              { value: "region", label: "User-selected region" },
            ]}
            value={sc.defaultTarget}
            onChange={(defaultTarget) => set({ defaultTarget })}
            ariaLabel="Default capture target"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Monitors"
        description="Real monitors on this system. Selected monitors show the edge indicator and are used by the “Selected monitor” target."
      >
        <MonitorSelector
          selectedIds={sc.selectedMonitorIds}
          onChange={(selectedMonitorIds) => set({ selectedMonitorIds })}
        />
      </SettingsGroup>

      <SettingsGroup title="Indicator">
        <SettingRow label="Show “ArcSonare Screen Context” label">
          <Toggle
            checked={sc.showLabel}
            onChange={(showLabel) => set({ showLabel })}
            label="Show Screen Context label"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Annotation">
        <SettingRow label="Freehand pen">
          <Toggle checked={sc.annotation.pen} onChange={(pen) => setAnnotation({ pen })} label="Freehand pen" />
        </SettingRow>
        <SettingRow label="Rectangle tool">
          <Toggle checked={sc.annotation.rectangle} onChange={(rectangle) => setAnnotation({ rectangle })} label="Rectangle tool" />
        </SettingRow>
        <SettingRow label="Ellipse tool">
          <Toggle checked={sc.annotation.ellipse} onChange={(ellipse) => setAnnotation({ ellipse })} label="Ellipse tool" />
        </SettingRow>
        <SettingRow label="Arrow tool">
          <Toggle checked={sc.annotation.arrow} onChange={(arrow) => setAnnotation({ arrow })} label="Arrow tool" />
        </SettingRow>
        <SettingRow label="Highlighter">
          <Toggle checked={sc.annotation.highlighter} onChange={(highlighter) => setAnnotation({ highlighter })} label="Highlighter" />
        </SettingRow>
        <SettingRow label="Blur or redact tool">
          <Toggle checked={sc.annotation.redact} onChange={(redact) => setAnnotation({ redact })} label="Blur or redact tool" />
        </SettingRow>
        <SettingRow label="Annotation thickness">
          <Slider
            value={sc.annotation.thickness}
            min={1}
            max={10}
            onChange={(thickness) => setAnnotation({ thickness })}
            label="Annotation thickness"
            format={(v) => `${v}px`}
          />
        </SettingRow>
        <SettingRow label="Show annotation toolbar">
          <Toggle
            checked={sc.annotation.showToolbar}
            onChange={(showToolbar) => setAnnotation({ showToolbar })}
            label="Show annotation toolbar"
          />
        </SettingRow>
        <SettingRow label="Keep annotation after capture">
          <Toggle
            checked={sc.annotation.keepAfterCapture}
            onChange={(keepAfterCapture) => setAnnotation({ keepAfterCapture })}
            label="Keep annotation after capture"
          />
        </SettingRow>
        <SettingRow label="Automatically crop to annotations">
          <Toggle
            checked={sc.annotation.autoCrop}
            onChange={(autoCrop) => setAnnotation({ autoCrop })}
            label="Automatically crop to annotations"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <SettingRow label="Save Screen Context history">
          <Toggle
            checked={sc.privacy.saveHistory}
            onChange={(saveHistory) => setPrivacy({ saveHistory })}
            label="Save Screen Context history"
          />
        </SettingRow>
        <SettingRow label="Retention">
          <Dropdown<ScreenRetention>
            options={[
              { value: "none", label: "Do not save" },
              { value: "15m", label: "15 minutes" },
              { value: "1h", label: "1 hour" },
              { value: "1d", label: "1 day" },
              { value: "7d", label: "7 days" },
            ]}
            value={sc.privacy.retention}
            onChange={(retention) => setPrivacy({ retention })}
            ariaLabel="Screen capture retention"
          />
        </SettingRow>
        <SettingRow label="Store locally only" description="Captures never leave this computer in this build.">
          <Toggle
            checked={sc.privacy.localOnly}
            onChange={(localOnly) => setPrivacy({ localOnly })}
            label="Store locally only"
          />
        </SettingRow>
        <SettingRow label="Remove captures after processing">
          <Toggle
            checked={sc.privacy.removeAfterProcessing}
            onChange={(removeAfterProcessing) => setPrivacy({ removeAfterProcessing })}
            label="Remove captures after processing"
          />
        </SettingRow>
        <SettingRow
          label="Exclude password fields where detectable"
          description="Field detection requires the accessibility integration, which is not built yet."
        >
          <Toggle
            checked={sc.privacy.excludePasswordFields}
            onChange={(excludePasswordFields) => setPrivacy({ excludePasswordFields })}
            label="Exclude password fields"
          />
        </SettingRow>
        <SettingRow label="Clear screen-capture history" description="Deletes every stored capture file.">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              runAction(async () => {
                await invoke("clear_capture_history");
              })
            }
          >
            Clear history
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Capture history"
        description="Captures currently stored under the ArcSonare data folder."
      >
        {captures.length === 0 ? (
          <p className="field-help">No captures are stored.</p>
        ) : (
          <ul className="capture-list">
            {captures.map((meta) => (
              <li key={meta.id} className="capture-row">
                <button
                  type="button"
                  className="capture-open"
                  onClick={() => setPreview(meta)}
                >
                  <span className="capture-title">
                    {meta.source === "active-window"
                      ? (meta.activeWindowTitle ?? "Active window")
                      : `Monitor capture ${meta.width}×${meta.height}`}
                    {meta.annotated ? " · annotated" : ""}
                  </span>
                  <span className="capture-time">
                    {new Date(meta.createdAt * 1000).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>

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
