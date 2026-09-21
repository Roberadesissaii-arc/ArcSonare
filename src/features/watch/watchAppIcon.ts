/**
 * Icon and label lookup for a watched application.
 *
 * One place, because the composer pill, the message badge, the Running Apps
 * card and the Details modal all show the same application and must show it
 * identically — a Discord row with the Discord icon next to a Discord badge
 * with a letter fallback reads as two different things.
 */
import {
  CONTEXT_APP_CATALOG,
  resolveContextAppIcon,
} from "../dashboard/contextAppCatalog";

export interface WatchAppVisual {
  appCatalogId: string;
  displayName: string;
  iconSrc?: string;
  /** Single character shown when there is no icon. Never empty. */
  fallback: string;
}

export function watchAppVisual(
  appCatalogId: string,
  displayNameHint?: string,
): WatchAppVisual {
  const def = CONTEXT_APP_CATALOG.find((d) => d.id === appCatalogId);
  const displayName = def?.displayName ?? displayNameHint ?? appCatalogId;
  return {
    appCatalogId,
    displayName,
    iconSrc: def ? resolveContextAppIcon(def) : undefined,
    fallback: (displayName.trim()[0] ?? "?").toUpperCase(),
  };
}

/**
 * Label for a row of applications.
 *
 * One application is named; several are counted, because three icons plus
 * three names does not fit a composer pill at 1280px and truncating the names
 * is worse than counting them.
 */
export function watchAppsLabel(
  apps: Array<{ appCatalogId: string; displayName: string }>,
): string {
  if (apps.length === 0) return "Watch";
  if (apps.length === 1) return apps[0].displayName;
  return `${apps.length} watched`;
}

/** "Discord + VS Code", or "Discord + 2 more" past two. */
export function watchAppsSummary(
  apps: Array<{ displayName: string }>,
): string {
  if (apps.length === 0) return "";
  if (apps.length === 1) return apps[0].displayName;
  if (apps.length === 2) return `${apps[0].displayName} + ${apps[1].displayName}`;
  return `${apps[0].displayName} + ${apps.length - 1} more`;
}
