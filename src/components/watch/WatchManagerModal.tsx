import { useCallback, useState } from "react";
import { WatchModal } from "./WatchModal";
import { WatchRow } from "./WatchRow";
import type { AppRow, RowGroups } from "./watchRows";
import {
  focusWatchedInstance,
  stopWatchingApplication,
  watchApplication,
} from "../../features/watch/watchStore";
import { toggleWatchScope } from "../../features/watch/watchScopeStore";

/**
 * The full management surface.
 *
 * Four sections, because "active in this chat", "watched", "merely running" and
 * "watched but closed" are different things and presenting them in one list is
 * what made unrelated applications look like part of the Watch context. Other
 * running apps are collapsed by default: they are an inventory, not a working
 * list.
 *
 * The list scrolls *here*, inside a modal sized to the viewport — never inside
 * the small dashboard card, which is a preview and cannot hold a scroll region
 * without becoming the nested-unusable-scrolling problem.
 */
export function WatchManagerModal(props: {
  groups: RowGroups;
  conversationId: string;
  onClose: () => void;
  onDetails: (row: AppRow) => void;
}) {
  const { groups, conversationId, onClose, onDetails } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  const run = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setBusy(id);
      try {
        await fn();
      } catch (err) {
        console.error("[ArcSonare] watch action failed:", err);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const rowProps = (row: AppRow) => ({
    row,
    busy: busy === row.appCatalogId,
    onToggleActive: () =>
      void run(row.appCatalogId, () =>
        toggleWatchScope(conversationId, row.appCatalogId),
      ),
    onStopWatching: () =>
      void run(row.appCatalogId, () => stopWatchingApplication(row.appCatalogId)),
    onFocus: () =>
      void run(row.appCatalogId, () =>
        focusWatchedInstance(row.instances[0]?.instanceKey ?? ""),
      ),
    onDetails: () => onDetails(row),
    onWatch: () =>
      void run(row.appCatalogId, () => watchApplication(row.appCatalogId)),
    // Watching and activating in one step. Two menu items for what is usually
    // one intention made the common case a two-trip errand.
    onWatchAndActivate: () =>
      void run(row.appCatalogId, async () => {
        await watchApplication(row.appCatalogId);
        await toggleWatchScope(conversationId, row.appCatalogId);
      }),
  });

  // Four sections, in the order a person cares about them: what this chat is
  // about, what else is available, what is waiting to reopen, and what is
  // merely running.
  const sections = {
    active: groups.watching.filter((r) => r.active),
    watchedIdle: groups.watching.filter(
      (r) => !r.active && r.instances.length > 0,
    ),
    watchedClosed: groups.watching.filter(
      (r) => !r.active && r.instances.length === 0,
    ),
  };

  return (
    <WatchModal
      title="Running apps"
      subtitle={
        <span>
          Choose which applications ArcSonare may watch and which one is active
          in this conversation.
        </span>
      }
      onClose={onClose}
    >
      <section className="watch-section">
        <h3>
          Active in this conversation
          <span className="watch-count">{sections.active.length}</span>
        </h3>
        {sections.active.length === 0 ? (
          <p className="watch-note">
            Nothing selected. Pick a watched application and ArcSonare answers
            about it — &ldquo;play the current song&rdquo;, &ldquo;what can you
            do?&rdquo; — without you naming it every time.
          </p>
        ) : (
          <ul className="watch-rows">
            {sections.active.map((row) => (
              <li key={row.appCatalogId}>
                <WatchRow {...rowProps(row)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {sections.watchedIdle.length > 0 ? (
        <section className="watch-section">
          <h3>
            Watched
            <span className="watch-count">{sections.watchedIdle.length}</span>
          </h3>
          <ul className="watch-rows">
            {sections.watchedIdle.map((row) => (
              <li key={row.appCatalogId}>
                <WatchRow {...rowProps(row)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="watch-section">
        <h3>
          <button
            type="button"
            className="watch-section-toggle"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
          >
            Running, not watched
            <span className="watch-count">{groups.otherRunning.length}</span>
            <span aria-hidden="true">{showOthers ? "▾" : "▸"}</span>
          </button>
        </h3>
        <p className="watch-note">
          ArcSonare knows these are running and nothing else about them — no
          window titles, no pages, no content.
        </p>
        {showOthers ? (
          groups.otherRunning.length === 0 ? (
            <p className="watch-note">Nothing else recognised is running.</p>
          ) : (
            <ul className="watch-rows">
              {groups.otherRunning.map((row) => (
                <li key={row.appCatalogId}>
                <WatchRow {...rowProps(row)} />
              </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      {sections.watchedClosed.length > 0 ? (
        <section className="watch-section">
          <h3>
            Watched, not running
            <span className="watch-count">{sections.watchedClosed.length}</span>
          </h3>
          <p className="watch-note">
            Kept as watched. When one of these reopens, ArcSonare picks it up
            again automatically.
          </p>
          <ul className="watch-rows">
            {sections.watchedClosed.map((row) => (
              <li key={row.appCatalogId}>
                <WatchRow {...rowProps(row)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </WatchModal>
  );
}
