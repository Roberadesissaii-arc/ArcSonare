/**
 * Discord desktop adapter.
 *
 * ArcSonare stores a Discord credential and has no working Discord connector
 * behind it. This adapter does not use that credential and does not reach
 * Discord's API. Everything it knows comes from the running window: the title,
 * which genuinely names the server and channel, and — when the window exposes
 * an accessibility tree — the names of its controls.
 *
 * The honest position on message bodies: a stock Electron build does not
 * publish an accessibility tree unless accessibility support is switched on, so
 * most of the time messages are simply not readable. That is reported, not
 * worked around with a screenshot.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../../capabilities/capabilityTypes";
import type {
  AdapterCapabilityReport,
  AdapterSnapshot,
  AdapterValidation,
  ApplicationAdapter,
  ContextField,
} from "./adapterTypes";

export interface DiscordLocation {
  server?: string;
  channel?: string;
  directMessageWith?: string;
  unread: boolean;
  source: string;
}

const READABLE: ContextField[] = [
  {
    id: "location",
    label: "Current server and channel",
    source: "window-metadata",
    privacyClass: "window-title",
    implemented: true,
  },
  {
    id: "unread",
    label: "Whether there are unread messages",
    source: "window-metadata",
    privacyClass: "app-identity",
    implemented: true,
  },
  {
    id: "controls",
    label: "Names of visible controls",
    source: "ui-automation",
    privacyClass: "visible-controls",
    implemented: true,
  },
  {
    id: "messages",
    label: "Visible message text",
    source: "ui-automation",
    privacyClass: "message-content",
    implemented: true,
  },
];

export const discordAdapter: ApplicationAdapter = {
  id: "discord-desktop",
  applicationIds: ["discord"],
  implementation: "PARTIAL",

  discover(instance) {
    return instance.appCatalogId === "discord";
  },

  getCapabilities(_instance): AdapterCapabilityReport {
    return {
      adapterId: "discord-desktop",
      implementation: "PARTIAL",
      readable: READABLE,
      unreadable: [],
      actions: [
        {
          capabilityId: "discord_desktop.get_current_location",
          label: "Read the current channel",
          source: "window-metadata",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "discord_desktop.get_visible_controls",
          label: "List visible controls",
          source: "ui-automation",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "discord_desktop.get_visible_messages",
          label: "Read visible messages",
          source: "ui-automation",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "discord_desktop.prepare_message",
          label: "Prepare a message for confirmation",
          source: "window-metadata",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
        {
          capabilityId: "discord_desktop.send_message",
          label: "Send the approved message",
          source: "native-os-api",
          external: true,
          requiresConfirmation: true,
          implemented: true,
        },
        {
          capabilityId: "applications.focus_watched",
          label: "Bring Discord to the front",
          source: "native-os-api",
          external: false,
          requiresConfirmation: false,
          implemented: true,
        },
      ],
      unsupported: [
        {
          label: "Anything through Discord's API",
          reason:
            "ArcSonare has no working Discord connector. The stored credential is not used here — everything comes from the running window.",
        },
        {
          label: "Read message history or other channels",
          reason:
            "Only what the open window is currently showing can be read, and only through the accessibility tree.",
        },
        {
          label: "Join, leave or manage servers",
          reason: "Not implemented, and not something a spoken sentence should reach.",
        },
      ],
      requiredPermissions: ["window-title", "visible-controls", "message-content"],
    };
  },

  async getSnapshot(instance, request): Promise<AdapterSnapshot> {
    const capturedAt = new Date().toISOString();
    const policy = request.application.privacyPolicy;
    const limitations: string[] = [];
    const facts: Record<string, unknown> = {};

    if (!policy.windowTitle) {
      // Discord's title *is* the channel, so withholding titles withholds
      // location. Saying that is better than silently returning nothing.
      return {
        adapterId: "discord-desktop",
        instanceKey: instance.instanceKey,
        capturedAt,
        facts: {},
        sources: {},
        summary: "Discord is running. Its channel is hidden by this application's privacy settings.",
        limitations: [
          "Window titles are turned off for Discord, and the channel comes from the title.",
        ],
      };
    }

    const location = await runCapability("discord_desktop.get_current_location", {
      instance_key: instance.instanceKey,
    });
    let summary = "Discord is running.";
    if (location?.data) {
      const parsed = (location.data as { location?: DiscordLocation }).location;
      facts.location = parsed;
      summary = location.summary;
      if (location.status === "partial") {
        limitations.push("The window title does not name a channel right now.");
      }
    }

    if (policy.messageContent) {
      const messages = await runCapability("discord_desktop.get_visible_messages", {
        instance_key: instance.instanceKey,
      });
      if (messages?.status === "success") {
        facts.visibleMessages = messages.data;
      } else {
        limitations.push(
          messages?.summary ??
            "Message text could not be read from this Discord window.",
        );
      }
    } else {
      limitations.push(
        "Message content is not shared — turn it on in this application's privacy settings if you want it read.",
      );
    }

    return {
      adapterId: "discord-desktop",
      instanceKey: instance.instanceKey,
      capturedAt,
      facts,
      sources: { location: "window-metadata", visibleMessages: "ui-automation" },
      summary,
      limitations,
    };
  },

  async validate(instance): Promise<AdapterValidation> {
    const result = await runCapability("discord_desktop.get_current_location", {
      instance_key: instance.instanceKey,
    });
    if (!result) {
      return { ok: false, health: "unavailable", message: "Discord could not be read." };
    }
    if (result.status === "success") return { ok: true, health: "healthy" };
    if (result.status === "partial") {
      return {
        ok: true,
        health: "degraded",
        message: "Discord is running but its window title does not name a channel.",
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
