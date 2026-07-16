import { useCallback, useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    const unlistenOpen = listen(EVENT_OPEN, () => {
      // Cancel any in-flight close so rapid toggling never strands the UI.
      clearCloseFallback();
      setPhase("opening");
    });

    const unlistenClose = listen(EVENT_CLOSE, () => {
      setPhase((prev) => (prev === "hidden" ? prev : "closing"));
      clearCloseFallback();
      closeFallback.current = window.setTimeout(finishClose, CLOSE_FALLBACK_MS);
    });

    return () => {
      unlistenOpen.then((f) => f());
      unlistenClose.then((f) => f());
      clearCloseFallback();
    };
  }, [clearCloseFallback, finishClose]);

  /** Asks Rust to close the overlay (close button, Escape key). */
  const requestClose = useCallback(() => {
    invoke("request_close").catch((err) =>
      console.error("[ArcSonare] failed to request close:", err),
    );
  }, []);

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

  /** Attached to the capsule element; advances the state machine. */
  const handleAnimationEnd = useCallback(() => {
    if (phase === "opening") {
      setPhase("visible");
    } else if (phase === "closing") {
      finishClose();
    }
  }, [phase, finishClose]);

  return { phase, requestClose, handleAnimationEnd };
}
