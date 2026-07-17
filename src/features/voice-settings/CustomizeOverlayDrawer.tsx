import { useEffect, useRef } from "react";
import { CloseIcon, SparkleIcon } from "../../components/Icons";
import { Slider } from "../../components/settings/Slider";
import { Toggle } from "../../components/settings/Toggle";
import { SonareLiveWaveform } from "../../components/voice/SonareLiveWaveform";
import { SonareMarbleOrb } from "../../components/voice/SonareMarbleOrb";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";

interface CustomizeOverlayDrawerProps {
  onClose: () => void;
}

/** Centered smoked-titanium modal for overlay customization (not a side sheet). */
export function CustomizeOverlayDrawer({ onClose }: CustomizeOverlayDrawerProps) {
  const prefs = usePrefs();
  const appearance = prefs.appearance;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  return (
    <div className="voice-modal-backdrop" role="presentation">
      <div
        ref={panelRef}
        className="voice-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Customize overlay"
      >
        <header className="voice-modal-head">
          <div className="voice-modal-title-row">
            <span className="voice-settings-icon-tile" aria-hidden="true">
              <SparkleIcon size={15} />
            </span>
            <div>
              <h2>Customize overlay</h2>
              <p>Tune the floating assistant preview and global overlay.</p>
            </div>
          </div>
          <button type="button" className="voice-device-refresh" aria-label="Close" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </header>

        <div
          className="voice-overlay-preview voice-modal-preview"
          aria-hidden="true"
        >
          <span className="voice-overlay-preview-marble">
            <SonareMarbleOrb status="idle" size={44} />
          </span>
          <span className="voice-overlay-preview-status">
            <span className="voice-overlay-preview-name">ArcSonare</span>
            <span className="voice-overlay-preview-line">
              Tap to speak or type a command...
            </span>
          </span>
          <span className="voice-overlay-preview-divider" />
          <span className="voice-overlay-preview-wave">
            <SonareLiveWaveform variant="idle" width={160} height={32} bars={40} />
          </span>
        </div>

        <div className="voice-modal-grid">
          <section className="voice-modal-section">
            <h3>Layout</h3>
            <label className="voice-field-label">Distance from top</label>
            <Slider
              value={appearance.overlayOffset}
              min={0}
              max={64}
              onChange={(overlayOffset) => patchPrefs("appearance", { overlayOffset })}
              label="Overlay offset from top"
              format={(v) => `${v}px`}
            />
            <label className="voice-field-label" style={{ marginTop: 12 }}>
              Overlay scale
            </label>
            <Slider
              value={appearance.overlayScale}
              min={85}
              max={115}
              onChange={(overlayScale) => patchPrefs("appearance", { overlayScale })}
              label="Overlay scale"
              format={(v) => `${v}%`}
            />
          </section>

          <section className="voice-modal-section">
            <h3>Motion</h3>
            <div className="voice-toggle-row">
              <div className="voice-toggle-copy">
                <span className="voice-toggle-label">Disable glow</span>
                <span className="voice-toggle-desc">Reduce marble and accent glow.</span>
              </div>
              <Toggle
                checked={appearance.disableGlow}
                onChange={(disableGlow) => patchPrefs("appearance", { disableGlow })}
                label="Disable glow"
              />
            </div>
            <div className="voice-toggle-row">
              <div className="voice-toggle-copy">
                <span className="voice-toggle-label">Disable waveform</span>
                <span className="voice-toggle-desc">Keep the waveform static.</span>
              </div>
              <Toggle
                checked={appearance.disableWaveform}
                onChange={(disableWaveform) =>
                  patchPrefs("appearance", { disableWaveform })
                }
                label="Disable waveform animation"
              />
            </div>
          </section>
        </div>

        <footer className="voice-modal-foot">
          <p className="voice-help">
            Changes apply to the global overlay. This preview does not open the microphone.
          </p>
          <button type="button" className="voice-solid-btn" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
