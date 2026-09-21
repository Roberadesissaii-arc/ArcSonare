import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useEscapeOwner } from "../../features/ui/escapeStack";

/**
 * A modal rendered through a portal on `document.body`.
 *
 * The reported failure: Details rendered inside the Running Apps card, which
 * lives in a narrow right-hand column with `overflow` clipping. The panel was
 * cut off by its own parent and unusable. No amount of z-index fixes that —
 * a clipped ancestor clips regardless of stacking — so the element has to
 * leave the subtree entirely.
 *
 * Everything else here is what a portal alone does not give you: Escape,
 * backdrop dismissal, a focus trap, and returning focus to the control that
 * opened it. Without the last one, closing Details drops keyboard focus to the
 * top of the document and a keyboard user loses their place in the list.
 */
export function WatchModal(props: {
  title: string;
  /** Rendered beside the title — an application icon, usually. */
  leading?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions. Kept out of the scrolling body so they stay reachable. */
  footer?: ReactNode;
}) {
  const { title, leading, subtitle, onClose, children, footer } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  /** The control that had focus when the modal opened. */
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    // Focus the close button rather than the panel: it is a real control, so
    // screen readers announce something actionable instead of a container.
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      // Returning focus is the part that is easy to forget and obvious when
      // missing — without it, Escape leaves a keyboard user at the document
      // root with no idea where the list went.
      openerRef.current?.focus?.();
    };
  }, []);

  // The page behind must not scroll while a modal is open, or the wheel moves
  // the dashboard underneath and the modal appears frozen.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /**
   * Escape, claimed through the shared stack rather than bound directly.
   *
   * Two earlier attempts failed for instructive reasons. A React `onKeyDown` on
   * the panel only fires for events originating inside it, so clicking any
   * non-focusable element in the modal silently broke it. A `document` capture
   * listener then lost to `GlobalTopOverlay`, which binds Escape on *window*
   * capture and calls `stopImmediatePropagation()` — window-capture runs first,
   * and registration order cannot help because the overlay mounts with the app.
   *
   * The stack makes ownership explicit: the innermost surface takes Escape and
   * the global handler stands down while anything holds it.
   */
  useEscapeOwner(true, onClose, useEffect);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      // Focus trap. Querying on each Tab rather than caching: the panel's
      // controls change as privacy toggles enable and disable.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return createPortal(
    <div
      className="watch-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // `mousedown` on the backdrop itself, so a drag that starts inside the
        // panel and ends outside it does not dismiss the work in progress.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="watch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="watch-modal-head">
          <div className="watch-modal-identity">
            {leading}
            <div className="watch-modal-titles">
              <h2 id={titleId}>{title}</h2>
              {subtitle ? <div className="watch-modal-subtitle">{subtitle}</div> : null}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="watch-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {/* The body scrolls; the header and footer do not, so Close and the
            primary actions stay reachable at every viewport height. */}
        <div className="watch-modal-body">{children}</div>

        {footer ? <footer className="watch-modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
