import { useCallback, useEffect, useRef, useState, type AnimationEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { EVENT_CLOSE, EVENT_OPEN, type OverlayPhase } from "../types";

/**
 * Safety net: if the CSS `animationend` event never fires (e.g. the window
 * lost visibility mid-animation), force-complete the close after this delay.
 * Must be comfortably longer than the CSS closing animation (190ms).
 */
const CLOSE_FALLBACK_MS = 450;

/**
 * Drives the overlay animation state machine:
 *
 *   hidden -> opening -> visible -> closing -> hidden
 *
 * Rust emits `sonare:open` after showing the native window and `sonare:close`
 * when the overlay should animate out. The native window is only hidden after
 * the closing animation completes (via the `overlay_hidden` command), so the
 * exit animation is never cut short.
 */
export function useOverlayLifecycle() {
  const [phase, setPhase] = useState<OverlayPhase>("hidden");
  const closeFallback = useRef<number | null>(null);
  const phaseRef = useRef<OverlayPhase>("hidden");
  phaseRef.current = phase;

  const clearCloseFallback = useCallback(() => {
    if (closeFallback.current !== null) {
      window.clearTimeout(closeFallback.current);
      closeFallback.current = null;
    }
  }, []);

  /** Completes a close: tells Rust to hide the native window. */
  const finishClose = useCallback(() => {
    clearCloseFallback();
    setPhase((prev) => {
      // Only complete if we are still closing. If the user re-opened the
      // overlay mid-animation, `opening` has already taken over.
      if (prev !== "closing") {
        return prev;
      }
      invoke("overlay_hidden").catch((err) =>
        console.error("[ArcSonare] failed to hide native window:", err),
      );
      return "hidden";
    });
  }, [clearCloseFallback]);

  /** Force-hide even if phase never reached `closing` (stuck Cancelled). */
  const forceClose = useCallback(() => {
    clearCloseFallback();
    setPhase("hidden");
    invoke("overlay_hidden").catch((err) =>
      console.error("[ArcSonare] failed to force-hide native window:", err),
    );
  }, [clearCloseFallback]);

  const armCloseFallback = useCallback(() => {
    clearCloseFallback();
    closeFallback.current = window.setTimeout(() => {
      // Prefer the normal closing path; otherwise force-hide so we never stick.
      if (phaseRef.current === "closing") {
        finishClose();
      } else if (phaseRef.current !== "hidden") {
        forceClose();
      }
    }, CLOSE_FALLBACK_MS);
  }, [clearCloseFallback, finishClose, forceClose]);

  useEffect(() => {
    const unlistenOpen = listen(EVENT_OPEN, () => {
      // Cancel any in-flight close so rapid toggling never strands the UI.
      clearCloseFallback();
      setPhase("opening");
    });

    const unlistenClose = listen(EVENT_CLOSE, () => {
      setPhase((prev) => (prev === "hidden" ? prev : "closing"));
      armCloseFallback();
    });

    return () => {
      unlistenOpen.then((f) => f());
      unlistenClose.then((f) => f());
      clearCloseFallback();
    };
  }, [armCloseFallback, clearCloseFallback]);

  /** Asks Rust to close the overlay (close button, Escape key). */
  const requestClose = useCallback(() => {
    // Arm locally first — if emit_to fails or the event never arrives, we
    // still hide instead of freezing on “Cancelled”.
    setPhase((prev) => (prev === "hidden" ? prev : "closing"));
    armCloseFallback();
    invoke("request_close").catch((err) => {
      console.error("[ArcSonare] failed to request close:", err);
      forceClose();
    });
  }, [armCloseFallback, forceClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  /**
   * Attached to the capsule element; advances the state machine.
   * Ignore bubbled events from marble/waveform infinite animations — those
   * were prematurely finishing open/close and stranding the window.
   */
  const handleAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (phase === "opening") {
        setPhase("visible");
      } else if (phase === "closing") {
        finishClose();
      }
    },
    [phase, finishClose],
  );

  return { phase, requestClose, forceClose, handleAnimationEnd };
}
