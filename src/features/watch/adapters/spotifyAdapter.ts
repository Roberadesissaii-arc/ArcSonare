/**
 * Spotify desktop adapter.
 *
 * Source of truth is the Windows Global System Media Transport Controls
 * session, not the window title. Titles are a fallback that goes wrong in
 * exactly the cases people ask about: Spotify's title is the literal string
 * "Spotify" while paused, and an advertisement replaces the track entirely.
 *
 * Nothing here follows, unfollows, edits playlists, or touches the account.
 * The transport set is closed on purpose — those are the operations a spoken
 * sentence should never be able to reach.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../../capabilities/capabilityTypes";
import type { RunningAppInstance } from "../watchTypes";
import type {
  AdapterCapabilityReport,
  AdapterSnapshot,
  AdapterValidation,
  ApplicationAdapter,
  ContextField,
  SnapshotRequest,
} from "./adapterTypes";

export interface MediaSessionFacts {
  sourceAppId: string;
  playbackStatus: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  canPlay: boolean;
  canPause: boolean;
  canSkipNext: boolean;
  canSkipPrevious: boolean;
  isCurrent: boolean;
}

const READABLE: ContextField[] = [
  {
    id: "playbackStatus",
    label: "Playing / paused",
    source: "native-os-api",
    privacyClass: "app-identity",
    implemented: true,
  },
  {
    id: "track",
    label: "Track title, artist and album",
    source: "native-os-api",
    privacyClass: "window-title",
    implemented: true,
  },
  {
    id: "transportControls",
    label: "Which transport controls are available",
    source: "native-os-api",
    privacyClass: "visible-controls",
    implemented: true,
  },
];

/**
 * Volume is deliberately absent from `readable` and present in `unsupported`.
 *
 * Windows exposes a per-application volume through the audio session API, but
 * that is the system mixer's idea of Spotify's volume, not Spotify's own
 * in-app slider. Offering it as "Spotify volume" would be a claim the source
 * does not support.
 */
export const spotifyAdapter: ApplicationAdapter = {
  id: "spotify-desktop",
  applicationIds: ["spotify"],
  implementation: "PARTIAL",

  discover(instance) {
    return instance.appCatalogId === "spotify";
  },

  getCapabilities(_instance): AdapterCapabilityReport {
    return {
      adapterId: "spotify-desktop",
      implementation: "PARTIAL",
      readable: READABLE,
      unreadable: [],
      actions: [
        {
          capabilityId: "spotify.get_playback",
          label: "Read what is playing",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "spotify.play",
          label: "Play",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "spotify.pause",
          label: "Pause",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "spotify.next",
          label: "Next track",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "spotify.previous",
          label: "Previous track",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "applications.focus_watched",
          label: "Bring Spotify to the front",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
      ],
      unsupported: [
        {
          label: "Set the volume",
          reason:
            "Windows exposes the system mixer level for the process, not Spotify's own volume slider.",
        },
        {
          label: "Search, queue or change playlists",
          reason: "The media session API has no library access.",
        },
        {
          label: "Follow, unfollow or change the account",
          reason: "Account changes are never exposed to the assistant.",
        },
      ],
      requiredPermissions: [],
    };
  },

  async getSnapshot(
    instance: RunningAppInstance,
    request: SnapshotRequest,
  ): Promise<AdapterSnapshot> {
    const capturedAt = new Date().toISOString();
    const limitations: string[] = [];
    let facts: Record<string, unknown> = {};
    let summary: string;

    const result = await runCapability("spotify.get_playback", {
      instance_key: instance.instanceKey,
    });

    if (result?.status === "success" && result.data) {
      const session = result.data as MediaSessionFacts;
      // Track metadata is the media session's, but it is still the name of
      // something the user is consuming; treat it under the title permission.
      const allowTrack = request.application.privacyPolicy.windowTitle;
      facts = {
        playbackStatus: session.playbackStatus,
        title: allowTrack ? session.title : undefined,
        artist: allowTrack ? session.artist : undefined,
        album: allowTrack ? session.album : undefined,
        canPlay: session.canPlay,
        canPause: session.canPause,
        canSkipNext: session.canSkipNext,
        canSkipPrevious: session.canSkipPrevious,
      };
      if (!allowTrack) {
        limitations.push(
          "Track names are hidden by this application's privacy settings.",
        );
      }
      summary = allowTrack ? result.summary : `Spotify is ${session.playbackStatus}.`;
    } else {
      // Not an error: Spotify can be open with nothing loaded.
      summary =
        result?.summary ??
        "Spotify is running but is not reporting a media session right now.";
      limitations.push(
        "No media session is registered, so there is no track information to read.",
      );
    }

    return {
      adapterId: "spotify-desktop",
      instanceKey: instance.instanceKey,
      capturedAt,
      facts,
      sources: {
        playbackStatus: "native-os-api",
        title: "native-os-api",
        artist: "native-os-api",
        album: "native-os-api",
      },
      summary,
      limitations,
    };
  },

  async validate(instance): Promise<AdapterValidation> {
    const result = await runCapability("spotify.get_playback", {
      instance_key: instance.instanceKey,
    });
    if (!result) {
      return { ok: false, health: "unavailable", message: "Could not reach the media session API." };
    }
    if (result.status === "success") return { ok: true, health: "healthy" };
    if (result.status === "not-found") {
      return {
        ok: true,
        health: "degraded",
        message: "Spotify is running but nothing is loaded, so playback cannot be read yet.",
      };
    }
    return { ok: false, health: "error", message: result.summary };
  },
};

async function runCapability(
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<ToolResult | null> {
  try {
    return await invoke<ToolResult>("capability_execute", {
      capabilityId,
      args,
      runId: null,
      userRequestSummary: "watched application context",
      confirmationToken: null,
    });
  } catch (err) {
    console.error(`[ArcSonare] ${capabilityId} failed:`, err);
    return null;
  }
}
