import { useEffect, useRef } from "react";
import { useOverlayLifecycle } from "../../hooks/useOverlayLifecycle";
import { useSettings } from "../../hooks/useSettings";
import { useAppearance } from "../../hooks/useTheme";
import { playOpenSound } from "../../services/sound";
import { ArcSonareLogo } from "../brand/ArcSonareLogo";
import { SonareWave } from "./SonareWave";
import { OverlaySettingsButton } from "./OverlaySettingsButton";

export function SonareOverlay() {
  const { phase, handleAnimationEnd } = useOverlayLifecycle();
  const { settings } = useSettings();
  // The overlay capsule is always the dark charcoal design; only the
  // reduced-motion preference is applied here.
  useAppearance(settings, { applyTheme: false });

  // Optional, very subtle open sound.
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (
      prevPhase.current === "hidden" &&
      phase === "opening" &&
      settings?.uiSounds
    ) {
      playOpenSound();
    }
    prevPhase.current = phase;
  }, [phase, settings?.uiSounds]);

  return (
    <div className={`overlay-root phase-${phase}`}>
      <div className="overlay-capsule" onAnimationEnd={handleAnimationEnd}>
        <div className="overlay-identity">
          <span className="overlay-logo">
            <ArcSonareLogo size={46} />
          </span>
          <div className="overlay-titles">
            <span className="overlay-title">ArcSonare</span>
            <span className="overlay-status">
              <span className="status-dot" aria-hidden="true" />
              Ready
            </span>
          </div>
        </div>

        <SonareWave state="idle" />

        <div className="overlay-actions">
          <OverlaySettingsButton />
        </div>
      </div>
    </div>
  );
}
