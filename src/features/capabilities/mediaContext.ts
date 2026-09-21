/**
 * Short-lived context for media follow-ups like “open the second video”.
 * Filled when YouTube is opened or searched so the next ordinal request
 * can resolve a real video instead of applications.open("the second video").
 */

export type MediaSite = "youtube";

export interface MediaContext {
  site: MediaSite;
  /** Last YouTube search query, if any. */
  searchQuery?: string;
  /** When we last opened/searched this site. */
  at: number;
}

let current: MediaContext | null = null;
const TTL_MS = 30 * 60 * 1000;

export function rememberYoutubeOpen(searchQuery?: string): void {
  current = {
    site: "youtube",
    searchQuery: searchQuery?.trim() || current?.searchQuery,
    at: Date.now(),
  };
}

export function rememberYoutubeSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  current = { site: "youtube", searchQuery: q, at: Date.now() };
}

export function getMediaContext(): MediaContext | null {
  if (!current) return null;
  if (Date.now() - current.at > TTL_MS) {
    current = null;
    return null;
  }
  return current;
}

export function clearMediaContext(): void {
  current = null;
}
