/**
 * Watched-browser adapter, and the browser/YouTube hybrid.
 *
 * Two sources cooperate here, and the split is deliberate:
 *
 *  - **The browser window** answers *where the user is* and *what to do with
 *    the window*: which page it shows, focus it, go back, go forward.
 *  - **The connected YouTube integration** answers *what the thing is*: channel
 *    metadata, uploads, publish dates, thumbnails.
 *
 * Neither can do the other's job. The window has no structured data about a
 * channel; the Data API has no idea which window the user is looking at. The
 * failure this replaces is "show me the channel" opening a fresh browser search
 * — which used the wrong source for both halves of the question.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../../capabilities/capabilityTypes";
import {
  youtubeChannelVideos,
  youtubeFindChannel,
  type YouTubeItem,
} from "../../capabilities/youtubeAdapter";
import type {
  AdapterCapabilityReport,
  AdapterSnapshot,
  AdapterValidation,
  ApplicationAdapter,
  ContextField,
} from "./adapterTypes";

const READABLE: ContextField[] = [
  {
    id: "pageIdentity",
    label: "The page the window title names",
    source: "window-metadata",
    privacyClass: "window-title",
    implemented: true,
  },
  {
    id: "site",
    label: "Which known site the page belongs to",
    source: "window-metadata",
    privacyClass: "window-title",
    implemented: true,
  },
];

const UNREADABLE = [
  {
    id: "url",
    label: "The page address",
    source: "browser-extension" as const,
    privacyClass: "document-identity" as const,
    implemented: false,
    reason:
      "Reading the address bar needs a browser extension. The window title is all that is available.",
  },
  {
    id: "tabs",
    label: "The list of open tabs",
    source: "browser-extension" as const,
    privacyClass: "document-identity" as const,
    implemented: false,
    reason:
      "Windows exposes one title per window, not per tab. Only the active tab is visible, through the title.",
  },
];

/**
 * Strip a site suffix so the page identity is the thing, not the site.
 *
 * "Rick Astley - Never Gonna Give You Up - YouTube" is a video called
 * "Rick Astley - Never Gonna Give You Up", and the trailing " - YouTube" is
 * noise for a channel lookup.
 */
export function pageSubject(pageIdentity: string, site: string | null): string {
  let subject = pageIdentity.trim();
  if (site === "youtube") {
    subject = subject.replace(/\s*[-–—|]\s*YouTube\s*$/i, "").trim();
  }
  return subject;
}

export const browserAdapter: ApplicationAdapter = {
  id: "browser-window",
  applicationIds: ["chrome", "edge", "firefox", "brave", "youtube", "netflix", "amazon"],
  implementation: "PARTIAL",

  discover(instance) {
    return browserAdapter.applicationIds.includes(instance.appCatalogId);
  },

  getCapabilities(_instance): AdapterCapabilityReport {
    return {
      adapterId: "browser-window",
      implementation: "PARTIAL",
      readable: READABLE,
      unreadable: UNREADABLE,
      actions: [
        {
          capabilityId: "browser.get_page_context",
          label: "Read which page this window shows",
          source: "window-metadata",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "browser.navigate",
          label: "Go back, forward or reload",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "applications.focus_watched",
          label: "Bring this browser window to the front",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
      ],
      unsupported: [
        {
          label: "Read or set the address bar",
          reason: "That needs a browser extension, which is not installed.",
        },
        {
          label: "Switch between tabs",
          reason:
            "Windows exposes one title per window, so individual tabs are not addressable without an extension.",
        },
        {
          label: "Read page content",
          reason:
            "Nothing here reads the page. Content questions go through the connected integration for that site, or through an explicit page fetch the user asks for.",
        },
      ],
      requiredPermissions: ["window-title"],
    };
  },

  async getSnapshot(instance, request): Promise<AdapterSnapshot> {
    const capturedAt = new Date().toISOString();
    const limitations = UNREADABLE.map((f) => f.reason);

    if (!request.application.privacyPolicy.windowTitle) {
      return {
        adapterId: "browser-window",
        instanceKey: instance.instanceKey,
        capturedAt,
        facts: {},
        sources: {},
        summary: `${instance.executableName} is running. Its page is hidden by this application's privacy settings.`,
        limitations: ["Window titles are turned off for this application."],
      };
    }

    const result = await runCapability("browser.get_page_context", {
      instance_key: instance.instanceKey,
    });
    const data = (result?.data ?? {}) as { pageIdentity?: string; site?: string | null };
    const pageIdentity = data.pageIdentity ?? "";
    const site = data.site ?? null;

    return {
      adapterId: "browser-window",
      instanceKey: instance.instanceKey,
      capturedAt,
      facts: {
        browser: instance.appCatalogId,
        pageIdentity,
        site,
        subject: pageSubject(pageIdentity, site),
      },
      sources: { pageIdentity: "window-metadata", site: "window-metadata" },
      summary:
        result?.summary ??
        `${instance.executableName} is running but its page could not be read.`,
      limitations,
    };
  },

  async validate(instance): Promise<AdapterValidation> {
    const result = await runCapability("browser.get_page_context", {
      instance_key: instance.instanceKey,
    });
    return result?.status === "success"
      ? { ok: true, health: "healthy" }
      : {
          ok: false,
          health: "degraded",
          message: result?.summary ?? "The browser window could not be read.",
        };
  },
};

// ---------------------------------------------------------------------------
// The hybrid: watched browser + connected YouTube
// ---------------------------------------------------------------------------

export interface YouTubeChannelContext {
  /** What the window said the user is looking at. */
  subject: string;
  channel: YouTubeItem | null;
  latestVideos: YouTubeItem[];
  /** Why the integration half is missing, when it is. */
  unavailableReason?: string;
}

/**
 * Resolve the channel behind the page the watched browser is showing.
 *
 * The window supplies the subject; the integration supplies the facts. When
 * YouTube is not connected this returns the subject with a reason and **no
 * invented metadata** — the caller reports what it knows and what it does not,
 * rather than falling back to a web search that looks like an answer.
 */
export async function youtubeContextForWatchedBrowser(
  snapshot: AdapterSnapshot,
): Promise<YouTubeChannelContext | null> {
  const site = snapshot.facts.site;
  if (site !== "youtube") return null;

  const subject = String(snapshot.facts.subject ?? "").trim();
  if (!subject) {
    return {
      subject: "",
      channel: null,
      latestVideos: [],
      unavailableReason:
        "The browser window title does not name a video or channel right now.",
    };
  }

  const found = await youtubeFindChannel(subject);
  if (!found.ok) {
    return {
      subject,
      channel: null,
      latestVideos: [],
      unavailableReason:
        found.reason === "not-connected"
          ? "YouTube is not connected, so I can't look up channel details — I only know the page title."
          : found.message,
    };
  }

  // `youtubeFindChannel` returns ranked candidates. The best one is taken, and
  // nothing is fabricated when the list comes back empty.
  const channel = found.value[0];
  if (!channel) {
    return {
      subject,
      channel: null,
      latestVideos: [],
      unavailableReason: `YouTube has no channel matching "${subject}".`,
    };
  }

  const videos = await youtubeChannelVideos(channel.sourceId, 6);
  return {
    subject,
    channel,
    latestVideos: videos.ok ? videos.value : [],
    unavailableReason: videos.ok ? undefined : videos.message,
  };
}

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
