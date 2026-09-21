import { useEffect, useRef, useSyncExternalStore } from "react";
import { dispatchEscape, escapeIsClaimed } from "../ui/escapeStack";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOverlayLifecycle } from "../../hooks/useOverlayLifecycle";
import { useSettings } from "../../hooks/useSettings";
import { useAppearance } from "../../hooks/useTheme";
import { OverlayHeader } from "./OverlayHeader";
import { OverlayExpandedPanel } from "./OverlayExpandedPanel";
import {
  activateOverlayListening,
  cancelOverlaySession,
  collapseOverlayWindow,
  commitOverlayTranscript,
  debugSetOverlayState,
  endOverlaySession,
  OVERLAY_COMMAND_EVENT,
  resizeOverlayWindow,
  startOverlaySession,
} from "./overlayActions";
import {
  getOverlayState,
  patchOverlay,
  setOverlayPhase,
  toggleOverlayTranscriptPanel,
  useOverlayStore,
  overlayModeToLegacyVoiceStatus,
} from "./overlayStore";
import { OVERLAY_CAPSULE_HEIGHT, OVERLAY_EXPANDED_MAX, OVERLAY_EXPANDED_MIN } from "./overlayTypes";
import {
  startSpeechListening,
  stopSpeechListening,
} from "../../services/SpeechRecognitionService";
import { getPrefs } from "../../stores/settingsStore";
import {
  setVoiceStatus,
  voiceSessionEnded,
} from "../../stores/voiceStore";
import {
  realtimeOverlayActive,
  subscribeRealtimeOwnership,
} from "./realtimeOverlay";

/**
 * Global top-edge overlay window (`sonare-overlay`): floating smoked-titanium
 * capsule with marble, status, waveform, and state-dependent action icon.
 * Expanded panels grow the same native window downward.
 */
export function GlobalTopOverlay() {
  const { phase, requestClose, forceClose, handleAnimationEnd } = useOverlayLifecycle();
  const { settings } = useSettings();
  const overlay = useOverlayStore();
  useAppearance(settings, { applyTheme: false });

  const prevPhase = useRef(phase);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    return () => document.documentElement.classList.remove("overlay-window");
  }, []);

  useEffect(() => {
    setOverlayPhase(phase);
    if (prevPhase.current !== "opening" && phase === "opening") {
      void startOverlaySession();
      import("../overlay-log/overlayLogService").then((m) => {
        void m.startOverlayLogSession("voice-overlay");
        m.logOverlayOpened();
      });
    }
    if (prevPhase.current !== "hidden" && phase === "hidden") {
      endOverlaySession();
      voiceSessionEnded();
      import("../overlay-log/overlayLogService").then((m) => {
        m.logOverlayClosed();
      });
    }
    prevPhase.current = phase;
  }, [phase]);

  // Commands from the main-window composer (and other windows).
  useEffect(() => {
    const unlisten = listen<{ transcript: string }>(OVERLAY_COMMAND_EVENT, (event) => {
      const text = event.payload.transcript?.trim();
      if (!text) return;
      void commitOverlayTranscript(text);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Keep legacy voiceStore in sync for header Voice button + Voice Action card.
  useEffect(() => {
    const legacy = overlayModeToLegacyVoiceStatus(overlay.mode);
    setVoiceStatus(
      legacy,
      overlay.mode === "success" ? overlay.status : "",
    );
  }, [overlay.mode, overlay.status]);

  // Realtime ownership flips when the voice session connects/disconnects.
  const realtimeOwnsMic = useSyncExternalStore(
    subscribeRealtimeOwnership,
    realtimeOverlayActive,
    () => false,
  );

  // Local STT only when Realtime is NOT owning the mic. Running both caused a
  // dual path: voice said “Gmail is connected” while STT re-ran the text path
  // and flashed “isn’t connected” in the capsule/dropdown.
  useEffect(() => {
    const listenModes =
      overlay.mode === "listening" ||
      overlay.mode === "entering" ||
      overlay.mode === "drafting-email" ||
      overlay.mode === "confirmation";
    const listening = phase === "visible" && listenModes;
    if (!listening || realtimeOwnsMic) {
      stopSpeechListening();
      return;
    }
    const prefs = getPrefs();
    if (prefs.voice.sttEngine === "cloud") {
      return;
    }
    const drafting =
      overlay.mode === "drafting-email" || overlay.mode === "confirmation";
    startSpeechListening({
      onFinal: (text) => {
        // Hard gate — Realtime may have claimed the mic mid-utterance.
        if (realtimeOverlayActive()) return;
        void commitOverlayTranscript(text);
      },
      onPartial: (text) => {
        if (realtimeOverlayActive()) return;
        // Don't overwrite “Draft ready…” with interim speech while reviewing.
        if (!drafting) {
          patchOverlay({ transcript: text, status: text }, false);
        }
      },
      onError: (message) => {
        if (message === "not-allowed") {
          patchOverlay({
            status: "Microphone permission needed",
          });
        }
      },
    });
    return () => stopSpeechListening();
  }, [phase, overlay.mode, realtimeOwnsMic]);

  // Escape: confirmation first, then cancel/close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A modal or other dismissible surface in front of the overlay owns
      // Escape while it is open. Without this the overlay's handler — which
      // runs first, on window capture, and calls `stopImmediatePropagation` —
      // swallows the key and hides the whole window instead of closing the
      // thing the user is actually looking at.
      if (escapeIsClaimed()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEscape();
        return;
      }
      event.preventDefault();
      const current = getOverlayState();
      if (current.requiresConfirmation && current.mode === "confirmation") {
        event.stopImmediatePropagation();
        patchOverlay({
          requiresConfirmation: false,
          mode: current.actionPayload?.type === "email" ? "drafting-email" : current.mode,
          status:
            current.actionPayload?.type === "email"
              ? "Drafting email..."
              : current.status,
          pendingConfirmAction: undefined,
        });
        return;
      }
      event.stopImmediatePropagation();
      if (current.mode === "closing" || phase === "closing") {
        forceClose();
        endOverlaySession();
        voiceSessionEnded();
        return;
      }
      cancelOverlaySession();
      requestClose();
    };
    // useOverlayLifecycle already binds Escape → requestClose; this listener
    // runs in capture to handle confirmation dismissal first.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [requestClose, forceClose, phase]);

  // Dev state keys for visual QA.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      debugSetOverlayState(event.key);
      // Typed demo commands: press Enter after typing in a future input;
      // shortcut: Ctrl+Shift+O then paste — for now support Ctrl+Enter commit.
      if (event.key === "Enter" && event.ctrlKey) {
        void commitOverlayTranscript(
          window.prompt("Overlay command") ?? "",
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // When expanded flag changes, ensure native height matches.
  useEffect(() => {
    if (phase === "hidden") return;
    if (!overlay.expanded) {
      void collapseOverlayWindow();
    }
  }, [overlay.expanded, phase]);

  const showExpanded =
    overlay.expanded &&
    phase !== "hidden" &&
    (overlay.actionPayload || overlay.error || overlay.result || overlay.transcript);

  // Fit the native window to the real dropdown height so long error/notice
  // panels never clip the bottom radius or action buttons.
  useEffect(() => {
    if (!showExpanded) return;
    const shell = shellRef.current;
    if (!shell) return;

    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const header = shell.querySelector(".overlay-header") as HTMLElement | null;
        const headerH = header?.offsetHeight ?? OVERLAY_CAPSULE_HEIGHT;
        const contentH = Math.ceil(shell.scrollHeight - headerH);
        const clamped = Math.min(
          OVERLAY_EXPANDED_MAX,
          Math.max(OVERLAY_EXPANDED_MIN, contentH + 8),
        );
        void resizeOverlayWindow(clamped);
      });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(shell);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [
    showExpanded,
    overlay.mode,
    overlay.error,
    overlay.actionPayload,
    overlay.result,
  ]);

  const cancel = () => {
    // Second click while already Cancelled force-hides so it never sticks.
    if (getOverlayState().mode === "closing" || phase === "closing") {
      forceClose();
      endOverlaySession();
      voiceSessionEnded();
      return;
    }
    cancelOverlaySession();
    requestClose();
  };

  return (
    <div className={`overlay-root phase-${phase}${overlay.expanded ? " is-expanded" : ""}`}>
      <div
        ref={shellRef}
        className={`voice-overlay-shell${overlay.expanded ? " is-expanded" : ""}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <OverlayHeader
          mode={overlay.mode === "hidden" || overlay.mode === "entering" ? "listening" : overlay.mode}
          status={overlay.status}
          applicationId={overlay.applicationId}
          applicationIcon={overlay.applicationIcon}
          waveformLevels={overlay.waveformLevels}
          onCancel={cancel}
          onActivateListening={activateOverlayListening}
          onToggleTranscript={toggleOverlayTranscriptPanel}
          expanded={Boolean(showExpanded)}
        />
        {showExpanded ? (
          <>
            <div className="overlay-panel-separator" aria-hidden="true" />
            <OverlayExpandedPanel
              payload={overlay.actionPayload}
              error={overlay.error}
              result={
                overlay.result ??
                (overlay.transcript
                  ? { title: overlay.transcript, summary: "" }
                  : undefined)
              }
              requiresConfirmation={overlay.requiresConfirmation}
              onCancel={cancel}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** @deprecated Use GlobalTopOverlay — kept as alias for App.tsx imports. */
export const GlobalVoiceOverlay = GlobalTopOverlay;

// Ensure request_close path can collapse height before hide.
export async function prepareOverlayHide() {
  await collapseOverlayWindow();
  try {
    await invoke("resize_overlay", { contentHeight: 0 });
  } catch {
    // ignore
  }
}
