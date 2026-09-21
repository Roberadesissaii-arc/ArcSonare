/**
 * Which adapter serves which running instance.
 *
 * Resolution is by instance, not by catalog id, because the same catalog id can
 * be served by different adapters depending on what the instance actually is —
 * a browser window showing YouTube is a browser instance with a YouTube-aware
 * snapshot, not a separate application.
 */
import type { RunningAppInstance, WatchedApplication } from "../watchTypes";
import type { AdapterCapabilityReport, ApplicationAdapter } from "./adapterTypes";
import { browserAdapter } from "./browserAdapter";
import { discordAdapter } from "./discordAdapter";
import { spotifyAdapter } from "./spotifyAdapter";
import { vscodeAdapter } from "./vscodeAdapter";

export const ADAPTERS: readonly ApplicationAdapter[] = [
  spotifyAdapter,
  vscodeAdapter,
  discordAdapter,
  browserAdapter,
];

/** The adapter for this instance, or null when only metadata is available. */
export function adapterFor(
  instance: RunningAppInstance,
): ApplicationAdapter | null {
  return ADAPTERS.find((adapter) => adapter.discover(instance)) ?? null;
}

export function adapterById(id: string): ApplicationAdapter | null {
  return ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

/** Every catalog id that any adapter serves. */
export function adaptedApplicationIds(): string[] {
  const ids = new Set<string>();
  for (const adapter of ADAPTERS) {
    for (const id of adapter.applicationIds) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * What ArcSonare can read and do for one watched application, for the details
 * panel and for an honest refusal.
 *
 * Returns a report even with no adapter: "window metadata only" is a real
 * answer, and a blank panel would suggest the application is unsupported when
 * in fact it is watched and its identity is known.
 */
export function capabilityReportFor(
  application: WatchedApplication,
  instance: RunningAppInstance | null,
): AdapterCapabilityReport {
  const adapter = instance ? adapterFor(instance) : null;
  if (adapter && instance) return adapter.getCapabilities(instance);

  return {
    adapterId: "window-metadata",
    implementation: "METADATA_ONLY",
    readable: [
      {
        id: "appIdentity",
        label: "Which application it is, and whether it is running",
        source: "window-metadata",
        privacyClass: "app-identity",
        implemented: true,
      },
      {
        id: "windowTitle",
        label: "The window title",
        source: "window-metadata",
        privacyClass: "window-title",
        implemented: true,
      },
    ],
    unreadable: [
      {
        id: "contents",
        label: "Anything inside the application",
        source: "window-metadata",
        privacyClass: "visible-text",
        implemented: false,
        reason: `No adapter has been built for ${application.displayName}, so only its window is visible to ArcSonare.`,
      },
    ],
    actions: [
      {
        capabilityId: "applications.focus_watched",
        label: `Bring ${application.displayName} to the front`,
        source: "native-os-api",
        external: false,
        requiresConfirmation: false,
        implemented: true,
      },
      {
        capabilityId: "applications.get_window_context",
        label: "Read its window metadata",
        source: "window-metadata",
        external: false,
        requiresConfirmation: false,
        implemented: true,
      },
    ],
    unsupported: [
      {
        label: `Understand what is happening inside ${application.displayName}`,
        reason:
          "That needs an application adapter. Window titles are not a substitute — ArcSonare will say it does not know rather than infer.",
      },
    ],
    requiredPermissions: ["app-identity", "window-title"],
  };
}
