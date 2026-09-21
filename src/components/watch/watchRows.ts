/**
 * Folding running instances and watched applications into displayable rows.
 *
 * Shared by the compact card and the management modal so the two cannot
 * disagree about what is watched, what is merely running, or what state a row
 * is in — the card is a preview *of* the manager, not a second implementation.
 */
import { adapterFor } from "../../features/watch/adapters/adapterRegistry";
import { watchAppVisual } from "../../features/watch/watchAppIcon";
import {
  rowState,
  type RunningAppInstance,
  type WatchRowState,
  type WatchedApplication,
} from "../../features/watch/watchTypes";

export interface AppRow {
  appCatalogId: string;
  displayName: string;
  watched?: WatchedApplication;
  instances: RunningAppInstance[];
  state: WatchRowState;
  /** Active in the current conversation. */
  active: boolean;
  iconSrc?: string;
  fallback: string;
}

export interface RowGroups {
  /** Applications the user added to Watch. Always first. */
  watching: AppRow[];
  /** Detected, not watched. Identity and running state only. */
  otherRunning: AppRow[];
}

/**
 * Build the two sections.
 *
 * The separation is the product requirement and also the privacy boundary: an
 * `otherRunning` row carries the application's identity and nothing from its
 * window, so nothing downstream can accidentally render an unwatched title.
 */
export function buildRowGroups(
  watched: WatchedApplication[],
  running: RunningAppInstance[],
  /**
   * The conversation's active applications, **most recently activated first**.
   *
   * Order matters and comes from Rust's `activatedSequence`. The card shows two
   * rows; an application the user just activated has to be one of them, or they
   * are left paging to find the thing they only just chose.
   */
  activeIds: readonly string[],
): RowGroups {
  const byApp = new Map<string, RunningAppInstance[]>();
  for (const instance of running) {
    const list = byApp.get(instance.appCatalogId) ?? [];
    list.push(instance);
    byApp.set(instance.appCatalogId, list);
  }
  const active = new Set(activeIds);

  const watching: AppRow[] = watched.map((application) => {
    const instances = byApp.get(application.appCatalogId) ?? [];
    const visual = watchAppVisual(application.appCatalogId, application.displayName);
    return {
      appCatalogId: application.appCatalogId,
      displayName: visual.displayName,
      watched: application,
      instances,
      state: rowState(
        application,
        instances.length > 0,
        instances.some((i) => adapterFor(i) !== null),
      ),
      active: active.has(application.appCatalogId),
      iconSrc: visual.iconSrc,
      fallback: visual.fallback,
    };
  });

  const watchedIds = new Set(watched.map((w) => w.appCatalogId));
  const otherRunning: AppRow[] = [...byApp.entries()]
    .filter(([id]) => !watchedIds.has(id))
    .map(([appCatalogId, instances]) => {
      const visual = watchAppVisual(appCatalogId, instances[0]?.executableName);
      return {
        appCatalogId,
        displayName: visual.displayName,
        instances,
        state: "running" as WatchRowState,
        active: false,
        iconSrc: visual.iconSrc,
        fallback: visual.fallback,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Active first — in activation order, newest first — then running, then
  // closed. Sorting the active ones alphabetically was the bug: activating
  // VS Code with Chrome already active put Chrome first, so the application
  // the user had just chosen was on the next page.
  const recency = new Map(activeIds.map((id, index) => [id, index]));
  watching.sort((a, b) => {
    const rank = (row: AppRow) =>
      row.active ? 0 : row.instances.length > 0 ? 1 : 2;
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    if (a.active && b.active) {
      return (
        (recency.get(a.appCatalogId) ?? 0) - (recency.get(b.appCatalogId) ?? 0)
      );
    }
    return a.displayName.localeCompare(b.displayName);
  });

  return { watching, otherRunning };
}

/**
 * Rows for the compact Running Apps card: applications that are running now.
 *
 * The card is called Running apps, so a watched application that has been
 * closed does not belong in it — showing "Watched · not running" there was the
 * card contradicting its own title, and it kept a dead Spotify row on screen
 * long after Spotify had quit. Closed watched applications live in the
 * manager's "Watched, not running" section instead.
 *
 * Order: active in this conversation, then watched, then merely running.
 */
export function runningRows(groups: RowGroups): AppRow[] {
  const live = groups.watching.filter((row) => row.instances.length > 0);
  return [...live, ...groups.otherRunning];
}

/**
 * The one line under a row's name.
 *
 * A watched row may describe its own window. An unwatched row may not — it gets
 * the count of windows and nothing else, because a title is content.
 */
export function rowDetail(row: AppRow): string {
  if (!row.watched) {
    return row.instances.length > 1
      ? `${row.instances.length} windows · not watched`
      : "Running · not watched";
  }
  // The active row says what it is, once. The badge on the icon carries the
  // same fact visually; the words are what a screen reader and a hurried eye
  // both get. Everything else about the row stays neutral.
  if (row.active && row.instances.length > 0) return "Active in this conversation";
  switch (row.state) {
    case "closed":
      return "Watched · not running";
    case "paused":
      return "Watching paused";
    case "needs-permission":
      return "Needs permission to read anything";
    case "adapter-unavailable":
      return row.watched.adapterMessage ?? "No adapter available";
    case "error":
      return row.watched.adapterMessage ?? "Adapter error";
    default:
      break;
  }
  if (row.instances.length > 1) {
    const identities = row.instances
      .map((i) => i.workspaceIdentity)
      .filter((w): w is string => Boolean(w));
    return identities.length > 0
      ? `${row.instances.length} windows · ${identities.slice(0, 2).join(", ")}`
      : `${row.instances.length} windows`;
  }
  const identity = row.instances[0]?.workspaceIdentity;
  if (identity) return identity;
  return "Watching";
}
