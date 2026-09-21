import { useCallback, useEffect, useMemo, useState } from "react";
import { LayersIcon } from "../Icons";
import { EmptyState } from "../EmptyState";
import { WatchRow } from "../watch/WatchRow";
import { WatchManagerModal } from "../watch/WatchManagerModal";
import { WatchDetailsModal } from "../watch/WatchDetailsModal";
import { buildRowGroups, runningRows, type AppRow } from "../watch/watchRows";
import {
  focusWatchedInstance,
  listenForWatchChanges,
  onWatchEvent,
  refreshWatchSnapshot,
  stopWatchingApplication,
  useWatchSnapshot,
  watchApplication,
} from "../../features/watch/watchStore";
import {
  refreshWatchScope,
  toggleWatchScope,
  useWatchScope,
} from "../../features/watch/watchScopeStore";
import { currentConversationId } from "../../features/conversation/conversationContext";
import { PagedApplicationCard } from "./PagedApplicationCard";

/**
 * Running apps.
 *
 * This file owns rows and behaviour, nothing else. The frame, the header, the
 * subtitle, the two-row viewport and both chevrons come from
 * `PagedApplicationCard`, which the Applications card beside it renders through
 * as well — so the two cannot disagree about geometry, which is what they kept
 * doing while each drew its own.
 *
 * The list is *running applications only*. The card is called Running apps, so
 * a watched application that has been closed does not belong in it; it lives in
 * the manager's "Watched, not running" section, reached from `All`.
 *
 * Clicking a row toggles that application's membership of the conversation's
 * active set. It is a set, not a selection: activating Chrome does not
 * deactivate VS Code.
 */
export function RunningAppsCard() {
  const snapshot = useWatchSnapshot();
  const scopeResult = useWatchScope();
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const conversationId = currentConversationId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await listenForWatchChanges();
      await refreshWatchSnapshot();
      if (conversationId) await refreshWatchScope(conversationId);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Running state *and* active scope, together.
  //
  // Refreshing only the snapshot was not enough: Rust retires a closed
  // application from the conversation inside `active_scope`, which nothing
  // called while the row was simply absent. Discord closed, its row vanished —
  // and when it reopened it came back already active, because the retirement
  // had never run. The two reads belong together; either one alone gives a view
  // that disagrees with the other.
  useEffect(() => {
    const sync = async () => {
      await refreshWatchSnapshot();
      if (conversationId) await refreshWatchScope(conversationId);
    };
    const id = window.setInterval(() => void sync(), 10_000);
    const onFocus = () => void sync();
    // Instance changes arrive as Rust events; the interval is only the safety
    // net for a process that dies without one.
    const stop = onWatchEvent((event) => {
      if (
        event.kind === "app-instance-stopped" ||
        event.kind === "app-instance-rebound" ||
        event.kind === "watched-app-removed"
      ) {
        void sync();
      }
    });
    // The composer's Watch popover asks for the manager through this event
    // rather than owning a second copy of the modal.
    const openManager = () => setManageOpen(true);
    window.addEventListener("arcsonare://open-watch-manager", openManager);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("arcsonare://open-watch-manager", openManager);
      stop();
    };
  }, [conversationId]);

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

  const groups = useMemo(
    () => buildRowGroups(snapshot.watched, snapshot.running, activeIds),
    [snapshot, activeIds],
  );

  // Running only. Active first, then watched, then merely running.
  const rows = useMemo(() => runningRows(groups), [groups]);

  const run = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
    } catch (err) {
      console.error("[ArcSonare] watch action failed:", err);
    } finally {
      setBusy(null);
    }
  }, []);

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
    onDetails: () => setDetailsFor(row.appCatalogId),
    onWatch: () =>
      void run(row.appCatalogId, () => watchApplication(row.appCatalogId)),
    // One step for the common case: an application the user has just noticed is
    // running, wants ArcSonare to watch, and wants this conversation to be
    // about. Two separate menu items made that a two-trip errand.
    onWatchAndActivate: () =>
      void run(row.appCatalogId, async () => {
        await watchApplication(row.appCatalogId);
        // Toggle, not set: the active scope is a set owned by Rust, and rebuilding
        // it from a React-side list is how two sources of truth start to drift.
        await toggleWatchScope(conversationId, row.appCatalogId);
      }),
  });

  const detailsRow =
    [...groups.watching, ...groups.otherRunning].find(
      (r) => r.appCatalogId === detailsFor,
    ) ?? null;
  const detailsAbilities = scopeResult.abilities.find(
    (a) => a.appCatalogId === detailsFor,
  );

  return (
    <>
      <PagedApplicationCard
        label="Running apps"
        description="Apps ArcSonare can watch and control."
        variant="opened-apps-card"
        listLabel="Running applications"
        items={rows}
        keyOf={(row) => row.appCatalogId}
        // Any change to the active set reorders the rows, so the window goes
        // back to the top and the newly activated application is row 1.
        resetKey={activeIds.join(",")}
        onAll={() => setManageOpen(true)}
        renderRow={(row) => <WatchRow {...rowProps(row)} />}
        empty={
          <div className="tools-opened-empty-wrap">
            <EmptyState
              icon={<LayersIcon size={23} />}
              title={loading ? "Scanning…" : "No apps open"}
              description={
                loading
                  ? "Looking for applications ArcSonare recognises."
                  : "When Spotify, a browser, or your editor is running, it will show up here."
              }
              compact
            />
          </div>
        }
      />

      {manageOpen ? (
        <WatchManagerModal
          groups={groups}
          conversationId={conversationId}
          onClose={() => setManageOpen(false)}
          onDetails={(row) => {
            setManageOpen(false);
            setDetailsFor(row.appCatalogId);
          }}
        />
      ) : null}

      {detailsRow ? (
        <WatchDetailsModal
          appCatalogId={detailsRow.appCatalogId}
          displayName={detailsRow.displayName}
          watched={detailsRow.watched}
          instances={detailsRow.instances}
          abilities={detailsAbilities}
          activeInConversation={detailsRow.active}
          conversationId={conversationId}
          onClose={() => setDetailsFor(null)}
        />
      ) : null}
    </>
  );
}
