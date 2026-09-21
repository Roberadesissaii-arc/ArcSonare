/**
 * Who Escape belongs to right now.
 *
 * The problem this solves, found in a physical test: the Watch Details modal
 * would not close on Escape, and pressing it hid the entire window instead.
 *
 * `GlobalTopOverlay` binds Escape with `window.addEventListener(..., true)` and
 * calls `stopImmediatePropagation()`. Window-capture runs before
 * document-capture, and before any React handler, so *whatever* a modal
 * registers, the overlay's handler wins and swallows the event. Registration
 * order cannot fix it either: the overlay mounts with the app and every modal
 * mounts later.
 *
 * So Escape ownership becomes explicit rather than a race. The innermost
 * dismissible surface takes the top of the stack; the global handler stands
 * down while anything is on it. That is the behaviour a person expects from
 * nested surfaces — Escape closes the thing in front, not the thing behind it.
 */

type EscapeHandler = () => void;

const stack: Array<{ id: symbol; handler: EscapeHandler }> = [];

/**
 * Claim Escape. Returns a release function.
 *
 * Idempotent on release, so a double-unmount cannot pop someone else's entry.
 */
export function pushEscapeOwner(handler: EscapeHandler): () => void {
  const entry = { id: Symbol("escape-owner"), handler };
  stack.push(entry);
  return () => {
    const index = stack.findIndex((e) => e.id === entry.id);
    if (index !== -1) stack.splice(index, 1);
  };
}

/** True when some surface has claimed Escape. */
export function escapeIsClaimed(): boolean {
  return stack.length > 0;
}

/**
 * Bind Escape for a surface, and only act when it is the innermost one.
 *
 * The listener lives with the surface rather than with a global dispatcher,
 * because there is no single global dispatcher: `GlobalTopOverlay` mounts only
 * in the `sonare-overlay` webview, so a main-window modal that waited to be
 * dispatched to would wait forever. That was a real bug — the first version of
 * this stack removed the modal's own listener and nothing in the main window
 * ever called `dispatchEscape`.
 *
 * Window capture, so it beats bubble-phase listeners; the stack check is what
 * keeps two open surfaces from both reacting.
 */
export function useEscapeOwner(
  isOpen: boolean,
  onEscape: EscapeHandler,
  useEffectImpl: (effect: () => void | (() => void), deps: unknown[]) => void,
): void {
  useEffectImpl(() => {
    if (!isOpen) return;
    const release = pushEscapeOwner(onEscape);
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only the innermost claimant reacts. Without this, opening Details from
      // the manager modal would close both.
      if (stack[stack.length - 1]?.handler !== onEscape) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    };
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
      release();
    };
  }, [isOpen, onEscape]);
}

/**
 * Give Escape to the innermost claimant.
 *
 * Returns true when it was handled, so the caller knows to stop. The global
 * handler calls this first and returns early on true.
 */
export function dispatchEscape(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.handler();
  return true;
}

/** Test seam. Never called in production. */
export function __resetEscapeStack(): void {
  stack.length = 0;
}
