/**
 * The connected YouTube adapter.
 *
 * Before this, "YouTube is connected" meant exactly one thing: a credential
 * existed in Windows Credential Manager. Nothing read it. Every YouTube request
 * therefore opened a browser search, because a browser search was the only
 * thing the app could actually do — and then said the results were open, which
 * was true but not what "connected" implies.
 *
 * This reads the stored Data API key and returns structured results, so the
 * assistant can show them in chat and act on them by id. The browser is no
 * longer the default answer to a YouTube question.
 *
 * Failure is reported as failure. A connected integration that errors must not
 * quietly become a browser search dressed up as success.
 */

import { invoke } from "@tauri-apps/api/core";
import { integrationSecureKey } from "../../config/integrationCatalog";
import { readCredentialBlob, redactSecrets } from "./credentialParse";

const API = "https://www.googleapis.com/youtube/v3";

export interface YouTubeItem {
  kind: "video" | "channel" | "playlist";
  /** YouTube's own id — the durable identity for follow-up actions. */
  sourceId: string;
  title: string;
  channelTitle?: string;
  publishedAt?: string;
  description?: string;
  thumbnail?: string;
  url: string;
}

export type YouTubeOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not-connected" | "unauthorized" | "quota" | "network" | "empty"; message: string };

/**
 * The API key the user saved in Connect, or null when there is none.
 *
 * Goes through `readCredentialBlob` rather than `JSON.parse` directly: the
 * parser embeds its input in the exception it throws, so a malformed blob would
 * put the key into an error message. The earlier version of this function also
 * fell back to returning the raw blob as the key, which would then have been
 * interpolated into a request URL.
 */
async function readApiKey(): Promise<string | null> {
  try {
    const raw = await invoke<string | null>("secure_storage_get", {
      key: integrationSecureKey("youtube"),
    });
    const handle = readCredentialBlob(raw);
    return handle.reveal("apiKey") ?? handle.reveal("key") ?? handle.reveal("token");
  } catch {
    // The invoke failed. Its error may quote the stored value, so it is not
    // inspected, logged, or re-thrown.
    return null;
  }
}

function thumbnailOf(snippet: Record<string, unknown> | undefined): string | undefined {
  const thumbs = snippet?.thumbnails as
    | Record<string, { url?: string } | undefined>
    | undefined;
  return thumbs?.medium?.url ?? thumbs?.default?.url ?? undefined;
}

/**
 * Watch/channel URLs are built from ids we received, never from free text.
 *
 * A url the model composed is a url nobody validated, and this one ends up in
 * the user's browser.
 */
function urlFor(kind: YouTubeItem["kind"], id: string): string {
  if (kind === "channel") return `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
  if (kind === "playlist") return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

async function call(
  path: string,
  params: Record<string, string>,
): Promise<YouTubeOutcome<Record<string, unknown>>> {
  const key = await readApiKey();
  if (!key) {
    return {
      ok: false,
      reason: "not-connected",
      message: "YouTube isn't connected yet.",
    };
  }
  const query = new URLSearchParams({ ...params, key }).toString();
  try {
    const response = await fetch(`${API}/${path}?${query}`);
    if (response.status === 401 || response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { errors?: Array<{ reason?: string }> };
      };
      const reason = body.error?.errors?.[0]?.reason ?? "";
      if (/quota/i.test(reason)) {
        return {
          ok: false,
          reason: "quota",
          message: "The YouTube connection has hit its daily quota.",
        };
      }
      return {
        ok: false,
        reason: "unauthorized",
        message: "The saved YouTube key was rejected.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: "network",
        message: `YouTube returned ${response.status}.`,
      };
    }
    return { ok: true, value: (await response.json()) as Record<string, unknown> };
  } catch (err) {
    // A fetch failure can name the URL it tried, and the URL carries the key.
    return {
      ok: false,
      reason: "network",
      message: redactSecrets(
        err instanceof Error ? err.message : "Could not reach YouTube.",
      ),
    };
  }
}

type SearchEntry = {
  id?: { kind?: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet?: Record<string, unknown>;
};

function toItem(entry: SearchEntry): YouTubeItem | null {
  const snippet = entry.snippet ?? {};
  const kind = entry.id?.videoId
    ? "video"
    : entry.id?.channelId
      ? "channel"
      : entry.id?.playlistId
        ? "playlist"
        : null;
  const sourceId = entry.id?.videoId ?? entry.id?.channelId ?? entry.id?.playlistId;
  if (!kind || !sourceId) return null;
  return {
    kind,
    sourceId,
    title: String(snippet.title ?? "Untitled"),
    channelTitle:
      typeof snippet.channelTitle === "string" ? snippet.channelTitle : undefined,
    publishedAt:
      typeof snippet.publishedAt === "string" ? snippet.publishedAt : undefined,
    description:
      typeof snippet.description === "string" && snippet.description.trim()
        ? String(snippet.description).slice(0, 240)
        : undefined,
    thumbnail: thumbnailOf(snippet),
    url: urlFor(kind, sourceId),
  };
}

export async function youtubeSearch(
  query: string,
  options: { limit?: number; type?: "video" | "channel" | "playlist" } = {},
): Promise<YouTubeOutcome<YouTubeItem[]>> {
  const result = await call("search", {
    part: "snippet",
    q: query,
    maxResults: String(Math.min(Math.max(options.limit ?? 5, 1), 10)),
    type: options.type ?? "video",
    safeSearch: "moderate",
  });
  if (!result.ok) return result;
  const items = ((result.value.items as SearchEntry[]) ?? [])
    .map(toItem)
    .filter((i): i is YouTubeItem => i !== null);
  if (items.length === 0) {
    return { ok: false, reason: "empty", message: `No YouTube results for “${query}”.` };
  }
  return { ok: true, value: items };
}

export async function youtubeFindChannel(
  name: string,
): Promise<YouTubeOutcome<YouTubeItem[]>> {
  return youtubeSearch(name, { type: "channel", limit: 3 });
}

/**
 * A channel's newest uploads, newest first.
 *
 * `search` ordered by date is used rather than the uploads playlist: it is one
 * request instead of two, and ordering is the whole point of the question.
 */
export async function youtubeChannelVideos(
  channelId: string,
  limit = 5,
): Promise<YouTubeOutcome<YouTubeItem[]>> {
  const result = await call("search", {
    part: "snippet",
    channelId,
    order: "date",
    type: "video",
    maxResults: String(Math.min(Math.max(limit, 1), 10)),
  });
  if (!result.ok) return result;
  const items = ((result.value.items as SearchEntry[]) ?? [])
    .map(toItem)
    .filter((i): i is YouTubeItem => i !== null);
  if (items.length === 0) {
    return { ok: false, reason: "empty", message: "That channel has no visible uploads." };
  }
  return { ok: true, value: items };
}
