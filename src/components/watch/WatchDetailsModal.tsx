import { useCallback, useState } from "react";
import { WatchModal } from "./WatchModal";
import { watchAppVisual } from "../../features/watch/watchAppIcon";
import {
  focusWatchedInstance,
  stopWatchingApplication,
} from "../../features/watch/watchStore";
import type {
  RunningAppInstance,
  WatchedApplication,
} from "../../features/watch/watchTypes";
import type { ApplicationAbilities } from "../../features/watch/watchAbilityTypes";
import { afterReopening, availableNow } from "../../features/watch/watchAbilityTypes";
import { toggleWatchScope } from "../../features/watch/watchScopeStore";

/**
 * What one watched application is, in plain terms.
 *
 * Deliberately short. The previous version listed every unsupported operation
 * with its technical reason, every instance with its process state, and eleven
 * privacy switches — information that did not help anyone finish the thing they
 * opened it to do. What a person needs here is: what is it, is it watched, is
 * it running, what can ArcSonare do with it, and how do I stop.
 *
 * Diagnostics have their own place; they are not the normal way to understand
 * Watch.
 */
export function WatchDetailsModal(props: {
  appCatalogId: string;
  displayName: string;
  watched?: WatchedApplication;
  instances: RunningAppInstance[];
  abilities?: ApplicationAbilities;
  activeInConversation: boolean;
  conversationId: string;
  onClose: () => void;
}) {
  const {
    appCatalogId,
    displayName,
    watched,
    instances,
    abilities,
    activeInConversation,
    conversationId,
    onClose,
  } = props;
  const [busy, setBusy] = useState(false);
  const visual = watchAppVisual(appCatalogId, displayName);
  const running = instances.length > 0;

  const withBusy = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error("[ArcSonare] watch action failed:", err);
    } finally {
      setBusy(false);
    }
  }, []);

  const now = abilities ? availableNow(abilities) : [];
  const later = abilities ? afterReopening(abilities) : [];

  const state = !watched
    ? "Not watched"
    : watched.state === "paused"
      ? "Watching paused"
      : running
        ? activeInConversation
          ? "Watching · active in this chat"
          : "Watching"
        : "Watched · not running";

  return (
    <WatchModal
      title={displayName}
      leading={
        visual.iconSrc ? (
          <span className="tools-list-icon tools-list-icon-app">
            <img src={visual.iconSrc} alt="" width={28} height={28} />
          </span>
        ) : null
      }
      subtitle={
        <span className="watch-modal-subtitle">
          <span
            className={`watch-dot watch-dot-${
              !watched ? "unwatched" : activeInConversation ? "active" : running ? "watched" : "offline"
            }`}
            aria-hidden="true"
          />
          {state}
        </span>
      }
      onClose={onClose}
      footer={
        watched ? (
          <>
            <button
              type="button"
              className="watch-btn"
              disabled={busy}
              onClick={() =>
                void withBusy(() => toggleWatchScope(conversationId, appCatalogId))
              }
            >
              {activeInConversation ? "Remove from this chat" : "Use in this chat"}
            </button>
            <button
              type="button"
              className="watch-btn"
              disabled={busy || !running}
              onClick={() =>
                void withBusy(() =>
                  focusWatchedInstance(instances[0]?.instanceKey ?? ""),
                )
              }
            >
              Bring to the front
            </button>
            <button
              type="button"
              className="watch-btn watch-btn-danger"
              disabled={busy}
              onClick={() =>
                void withBusy(async () => {
                  await stopWatchingApplication(appCatalogId);
                  onClose();
                })
              }
            >
              Stop watching
            </button>
          </>
        ) : null
      }
    >
      {!watched ? (
        <p className="watch-note">
          {displayName} is running but not watched. Watch it to let ArcSonare
          read it and act on it in this conversation.
        </p>
      ) : null}

      {abilities ? (
        <section className="watch-section">
          <h3>What ArcSonare can do</h3>
          {now.length > 0 ? (
            <ul className="watch-list">
              {now.map((ability) => (
                <li key={ability.label}>{ability.label}</li>
              ))}
            </ul>
          ) : (
            <p className="watch-note">
              Nothing right now — {displayName} isn&rsquo;t running.
            </p>
          )}
          {later.length > 0 ? (
            <>
              <h3>When {displayName} is open again</h3>
              <ul className="watch-list watch-list-muted">
                {later.map((ability) => (
                  <li key={ability.label}>{ability.label}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {instances.length > 1 ? (
        <section className="watch-section">
          <h3>Windows</h3>
          <p className="watch-note">
            {instances.length} windows are open, so ArcSonare will ask which you
            mean before acting on this application.
          </p>
        </section>
      ) : null}
    </WatchModal>
  );
}
