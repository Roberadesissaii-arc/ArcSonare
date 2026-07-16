import { useEffect, useRef } from "react";
import { useOverlayLifecycle } from "../../hooks/useOverlayLifecycle";
import { useSettings } from "../../hooks/useSettings";
import { useAppearance } from "../../hooks/useTheme";
import { playOpenSound } from "../../services/sound";
import {
  cancelVoiceSession,
  setVoiceStatus,
  startVoiceSession,
  useVoiceState,
  voiceSessionEnded,
  type VoiceStatus,
} from "../../stores/voiceStore";
import { CloseIcon } from "../Icons";
import { SonareMarbleOrb } from "./SonareMarbleOrb";
import { SonareLiveWaveform } from "./SonareLiveWaveform";
import { VoiceStatusText } from "./VoiceStatusText";

// Development-only state test keys (never active in production builds).
const DEV_STATE_KEYS: Record<string, VoiceStatus> = {
  "1": "listening",
  "2": "thinking",
  "3": "responding",
  "4": "success",
  "5": "error",
};

/**
 * The global top-edge voice overlay window (`sonare-overlay`): marble orb,
 * "ArcSonare" + live status, thin divider, violet live waveform, close.
 * Opened by the global shortcut over any application; slides down from the
 * physical top edge of the active monitor. One reused native window.
 */
export function GlobalVoiceOverlay() {
  const { phase, requestClose, handleAnimationEnd } = useOverlayLifecycle();
  const { settings } = useSettings();
  const { status, resultMessage } = useVoiceState();
  // Always the dark design; only the reduced-motion preference applies.
  useAppearance(settings, { applyTheme: false });

  // Session lifecycle: opening starts a (simulated) listening session; a
  // fully-hidden overlay resets the shared state to idle.
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== "opening" && phase === "opening") {
      startVoiceSession();
      if (settings?.uiSounds) playOpenSound();
    }
    if (prevPhase.current !== "hidden" && phase === "hidden") {
      voiceSessionEnded();
    }
    prevPhase.current = phase;
  }, [phase, settings?.uiSounds]);

  // Success briefly shows its result, then the overlay slides away.
  useEffect(() => {
    if (status !== "success" || phase === "hidden") return;
    const timer = window.setTimeout(requestClose, 1500);
    return () => window.clearTimeout(timer);
  }, [status, phase, requestClose]);

  // Escape is handled by useOverlayLifecycle (requestClose); mark the
  // session cancelled when a close begins while still active.
  useEffect(() => {
    if (
      phase === "closing" &&
      (status === "listening" || status === "thinking" || status === "responding")
    ) {
      cancelVoiceSession();
    }
  }, [phase, status]);

  // Dev-only: number keys force each visual state for testing.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const next = DEV_STATE_KEYS[event.key];
      if (next) setVoiceStatus(next, next === "success" ? "Task created" : "");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const cancel = () => {
    cancelVoiceSession();
    requestClose();
  };

  return (
    <div className={`overlay-root phase-${phase}`}>
      <div className="voice-overlay" onAnimationEnd={handleAnimationEnd}>
        <SonareMarbleOrb status={status} size={48} />
        <VoiceStatusText status={status} resultMessage={resultMessage} />
        <span className="voice-overlay-divider" aria-hidden="true" />
        <div className="voice-overlay-wave">
          <SonareLiveWaveform variant={status} width={214} height={36} bars={46} />
        </div>
        <button
          type="button"
          className="voice-overlay-close"
          onClick={cancel}
          aria-label="Cancel voice command"
          title="Cancel"
        >
          <CloseIcon size={17} />
        </button>
      </div>
    </div>
  );
}
