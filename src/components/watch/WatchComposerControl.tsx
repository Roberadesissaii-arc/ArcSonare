import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Binoculars } from "lucide-react";
import { buildRowGroups, runningRows, type AppRow } from "./watchRows";
import {
  toggleWatchScope,
  useWatchScope,
} from "../../features/watch/watchScopeStore";
import {
  useWatchSnapshot,
  watchApplication,
} from "../../features/watch/watchStore";
import { currentConversationId } from "../../features/conversation/conversationContext";

/**
 * The composer's Watch control.
 *
 * One control, in the fourth and last quick-action slot. It is a *status*
 * indicator and a switch — never a permanent row of application icons, which is
 * what the previous chip was and why it read as clutter in a bar meant for
 * composing.
 *
 * Inactive it is an ordinary icon button, the same size as its neighbours, and
 * ArcSonare behaves as it always does: no application context is attached to
 * anything. Active it expands just far enough to say which applications the
 * assistant may inspect — one name, or a count once there are several, because
 * a control that grows with the number of active applications would eventually
 * own the composer.
 */
export function WatchComposerControl(props: { disabled?: boolean }) {
  const snapshot = useWatchSnapshot();
  const scopeResult = useWatchScope();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const conversationId = currentConversationId();

  // In activation order, newest first. Rust owns the sequence; sorting it here
  // rather than re-deriving it is what keeps the card, the composer and the
  // dropdown showing the same first row.
  const activeIds = useMemo(
    () =>
      [...scopeResult.scope.entries]
        .sort((a, b) => (a.activatedSequence ?? 0) - (b.activatedSequence ?? 0))
        .map((e) => e.appCatalogId),
    [scopeResult],
  );

  // The same rows the Running Apps card shows, so selecting here and clicking
  // there are visibly the same act on the same set.
  const rows = useMemo(
    () => runningRows(buildRowGroups(snapshot.watched, snapshot.running, activeIds)),
    [snapshot, activeIds],
  );
  const active = rows.filter((r) => r.active);
  const others = rows.filter((r) => !r.active);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
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

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      // Above the composer: the composer sits at the bottom of the window, so a
      // popover below it would open off-screen.
      setAt({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
    }
    setOpen(true);
  };

  /** The same action as clicking the application's Running Apps row. */
  const toggleApplication = (row: AppRow) => {
    setBusy(row.appCatalogId);
    void (async () => {
      try {
        if (!row.watched) await watchApplication(row.appCatalogId);
        await toggleWatchScope(conversationId, row.appCatalogId);
      } catch (err) {
        console.error("[ArcSonare] watch toggle failed:", err);
      } finally {
        setBusy(null);
      }
    })();
  };

  /**
   * What the pill says, in three states and no more.
   *
   * None: nothing — the control is a plain circular button like its
   * neighbours. One: the application's name, because there is room for it and a
   * name is what a person recognises. Several: `Watch +N`, because three or
   * four names would eat the composer, and the count is the only part that
   * changes anyway. At most two icons in every case.
   */
  const label =
    active.length === 0
      ? null
      : active.length === 1
        ? active[0].displayName
        : `Watch +${active.length}`;

  return (
    <span className="watch-composer" ref={anchorRef}>
      <button
        type="button"
        className={`toggle-pill toggle-pill-watch${active.length > 0 ? " active" : ""}`}
        onClick={toggle}
        disabled={props.disabled}
        aria-pressed={active.length > 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          active.length === 0
            ? "Focus on running applications"
            : `Focused on ${active.map((r) => r.displayName).join(", ")}`
        }
      >
        <Binoculars size={14} />
        {/* Text only. No application artwork reaches the toolbar: a row of
            favicons beside the input is decoration competing with the thing the
            user is actually doing there. Icons belong in the dropdown, where a
            person is choosing between applications and needs to tell them
            apart. */}
        {label ? <span className="toggle-pill-label">{label}</span> : null}
      </button>

      {open && at
        ? createPortal(
            <div
              className="watch-composer-pop"
              role="dialog"
              aria-label="Applications ArcSonare may inspect"
              ref={popRef}
              style={{ bottom: at.bottom, left: at.left }}
            >
              <p className="watch-composer-note">
                {active.length === 0
                  ? "Pick a running application and ArcSonare may inspect and control it in this conversation."
                  : "ArcSonare may inspect and control these in this conversation."}
              </p>

              {active.length > 0 ? (
                <ul className="watch-composer-list">
                  {active.map((row) => (
                    <WatchOption
                      key={row.appCatalogId}
                      row={row}
                      busy={busy === row.appCatalogId}
                      onToggle={() => toggleApplication(row)}
                    />
                  ))}
                </ul>
              ) : null}

              {others.length > 0 ? (
                <>
                  <p className="watch-composer-heading">Also running</p>
                  <ul className="watch-composer-list">
                    {others.map((row) => (
                      <WatchOption
                        key={row.appCatalogId}
                        row={row}
                        busy={busy === row.appCatalogId}
                        onToggle={() => toggleApplication(row)}
                      />
                    ))}
                  </ul>
                </>
              ) : null}

              {rows.length === 0 ? (
                <p className="watch-composer-note">
                  Nothing ArcSonare recognises is running right now.
                </p>
              ) : null}

              {/* The same manager the Running Apps card's `All` opens. Watched
                  applications that are closed live only there, so the popover
                  needs a way to reach it rather than being a dead end. */}
              <button
                type="button"
                className="watch-composer-manage"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event("arcsonare://open-watch-manager"));
                }}
              >
                Open Running apps
              </button>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function WatchOption(props: {
  row: AppRow;
  busy: boolean;
  onToggle: () => void;
}) {
  const { row, busy, onToggle } = props;
  return (
    <li>
      <button
        type="button"
        className={`watch-composer-option${row.active ? " is-on" : ""}`}
        onClick={onToggle}
        disabled={busy}
        aria-pressed={row.active}
      >
        {row.iconSrc ? (
          <img src={row.iconSrc} alt="" width={18} height={18} draggable={false} />
        ) : (
          <span className="tool-tile-fallback" aria-hidden="true">
            {row.fallback}
          </span>
        )}
        <span className="watch-composer-option-name">{row.displayName}</span>
        <span
          className={`watch-dot watch-dot-${
            row.active ? "active" : row.watched ? "watched" : "unwatched"
          }`}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}
