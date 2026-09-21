import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck } from "lucide-react";
import { DotsIcon } from "../Icons";
import { rowDetail, type AppRow } from "./watchRows";

/**
 * One application row, built from the Applications card's own markup.
 *
 * Same `tools-list-row` button, same 40px `tools-list-icon` container, same
 * 28px artwork, same `tools-list-copy` / `tools-list-title` / `tools-list-desc`.
 * Nothing here invents a Watch-specific row: the two cards sit side by side and
 * any difference in row height or icon size reads as a mistake.
 *
 * One status mark, and one only. The row previously carried four — a purple
 * check on the icon, a green dot, an eye button and an overflow button — which
 * is three more than a person can interpret at a glance.
 *
 * The row itself is the activation control. Requiring the overflow menu to
 * activate an application made the primary action the least discoverable thing
 * on the card: a person looking at a list of applications reaches for the
 * application, not for a menu beside it.
 */
export function WatchRow(props: {
  row: AppRow;
  busy?: boolean;
  /**
   * Toggle this application's membership of the conversation's active set.
   *
   * Unwatched → watched *and* active, because clicking the row is the explicit
   * authorization. Active → inactive, keeping the watch permission: leaving a
   * conversation is not the same as revoking consent, and conflating them means
   * a person cannot put an application down without giving it up.
   */
  onToggleActive?: () => void;
  onStopWatching?: () => void;
  onFocus?: () => void;
  onDetails?: () => void;
  onWatch?: () => void;
  onWatchAndActivate?: () => void;
  /** Compact card rows are not interactive beyond the overflow menu. */
  compact?: boolean;
}) {
  const {
    row,
    busy,
    compact,
    onToggleActive,
    onStopWatching,
    onFocus,
    onDetails,
    onWatch,
    onWatchAndActivate,
  } = props;
  const running = row.instances.length > 0;
  // Watching an application that is not running would bind nothing. Those rows
  // exist only in the manager, and there the row explains rather than acts.
  const activate = running ? (row.watched ? onToggleActive : onWatchAndActivate) : undefined;

  // No `<li>` here: the row is placed by whatever list is showing it — the
  // shared `PagedApplicationCard` or the manager — so it cannot assume one.
  return (
      <div
        className={`tools-list-row watch-row${
          activate ? " is-watch-clickable" : ""
        }`}
        role={activate ? "button" : undefined}
        tabIndex={activate ? 0 : undefined}
        aria-pressed={activate ? row.active : undefined}
        aria-label={
          activate
            ? row.active
              ? `${row.displayName}, active in this conversation. Remove it`
              : `${row.displayName}. Make it active in this conversation`
            : undefined
        }
        onClick={activate && !busy ? activate : undefined}
        onKeyDown={
          activate && !busy
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                activate();
              }
            : undefined
        }
      >
        <span className="tools-list-icon tools-list-icon-app">
          {row.iconSrc ? (
            <img
              src={row.iconSrc}
              alt=""
              width={28}
              height={28}
              draggable={false}
            />
          ) : (
            <span className="tool-tile-fallback" aria-hidden="true">
              {row.fallback}
            </span>
          )}
          {/* The Applications card's own connected badge, in the accent the
              composer sparkle uses. Same element, same class, same geometry —
              it is absolutely positioned on the icon container, so adding it
              cannot change the row's height. */}
          {row.active ? (
            <span
              className="tools-list-status is-watch-active"
              aria-hidden="true"
              title="Active in this conversation"
            >
              <BadgeCheck size={14} strokeWidth={2.25} />
            </span>
          ) : null}
        </span>

        <span className="tools-list-copy">
          <strong className="tools-list-title">{row.displayName}</strong>
          <span className="tools-list-desc">
            <WatchStatusDot row={row} />
            {rowDetail(row)}
          </span>
        </span>

        <span className="watch-row-actions">
          {compact ? null : (
            <RowMenu
              displayName={row.displayName}
              watched={Boolean(row.watched)}
              active={row.active}
              running={running}
              busy={busy}
              onToggleActive={onToggleActive}
              onFocus={onFocus}
              onDetails={onDetails}
              onStopWatching={onStopWatching}
              onWatch={onWatch}
              onWatchAndActivate={onWatchAndActivate}
            />
          )}
        </span>
      </div>
  );
}

/**
 * The single status mark.
 *
 * Four states, one symbol, in the description line beside the words that
 * explain it — never on top of the application artwork, where it obscured the
 * thing it was annotating.
 */
function WatchStatusDot({ row }: { row: AppRow }) {
  const running = row.instances.length > 0;
  const kind = !row.watched
    ? "unwatched"
    : row.active
      ? "active"
      : running
        ? "watched"
        : "offline";
  return <span className={`watch-dot watch-dot-${kind}`} aria-hidden="true" />;
}

/**
 * Overflow menu.
 *
 * Every action lives here rather than as a row of unlabelled icons, and every
 * one is a text label — the eye icon it replaces meant nothing without a
 * tooltip. This menu is the *only* way a normal user starts or stops watching
 * now that the composer chip is gone, so the item that applies to the row's
 * current state is always first:
 *
 *   running, not watched → Watch · Make active and watch · Focus
 *   watched, not active  → Make active in this conversation · Stop watching · Focus
 *   active               → Remove from this conversation · Stop watching · Focus
 */
function RowMenu(props: {
  displayName: string;
  watched: boolean;
  active: boolean;
  running: boolean;
  busy?: boolean;
  onToggleActive?: () => void;
  onFocus?: () => void;
  onDetails?: () => void;
  onStopWatching?: () => void;
  onWatch?: () => void;
  onWatchAndActivate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stopped here so one Escape dismisses one thing: the menu, not the
      // modal behind it.
      event.stopPropagation();
      setOpen(false);
    };
    // The card scrolls with the rail; a menu anchored to a stale rect would
    // float away from its row.
    const onMove = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  /**
   * Open the menu, anchored to the button in viewport coordinates.
   *
   * The popup is portalled to `document.body` because both surfaces that host a
   * row clip it otherwise: the compact card is `.tools-card-stretch`, which is
   * `overflow: hidden`, and it swallowed the menu whole — the only way a normal
   * user can now start watching an application silently did nothing.
   */
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setAt({
        // Flip above the row when there is no room below, so a row near the
        // bottom of the rail still shows its whole menu.
        top: below < 160 ? rect.top - 4 - 160 : rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
  };

  const item = (label: string, action?: () => void, danger = false, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className={danger ? "is-danger" : undefined}
      disabled={disabled || props.busy}
      onClick={() => {
        setOpen(false);
        action?.();
      }}
    >
      {label}
    </button>
  );

  return (
    // The row behind this is itself a toggle. Every pointer event that lands on
    // the menu stops here, or opening the menu would also activate or
    // deactivate the application the menu is about.
    <span
      className="watch-row-menu"
      ref={ref}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="watch-row-btn"
        title={`More for ${props.displayName}`}
        aria-label={`More for ${props.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.busy}
        onClick={toggle}
      >
        <DotsIcon size={14} />
      </button>
      {open && at
        ? createPortal(
        <div
          className="watch-row-menu-pop"
          role="menu"
          ref={popRef}
          style={{ top: at.top, right: at.right }}
        >
          {props.watched ? (
            <>
              {item(
                props.active
                  ? "Remove from this conversation"
                  : "Make active in this conversation",
                props.onToggleActive,
              )}
              {item("Focus application", props.onFocus, false, !props.running)}
              {item("Details", props.onDetails)}
              {item("Stop watching", props.onStopWatching, true)}
            </>
          ) : (
            <>
              {item("Watch and make active", props.onWatchAndActivate)}
              {item("Watch only", props.onWatch)}
              {item("Focus application", props.onFocus, false, !props.running)}
              {item("Details", props.onDetails)}
            </>
          )}
        </div>,
            document.body,
          )
        : null}
    </span>
  );
}
