/**
 * Short-lived content cache (separate from connection state).
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export const CONTENT_TTL_MS = {
  calendarList: 60_000,
  calendarNext: 30_000,
  latestEmail: 25_000,
  unreadCount: 30_000,
  driveList: 45_000,
} as const;

const REFRESH_HINT =
  /\b(latest|right\s+now|new|just\s+received|current|refresh|check\s+again)\b/i;

export function shouldBypassContentCache(utterance: string): boolean {
  return REFRESH_HINT.test(utterance);
}

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateContentCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function contentCacheKey(
  service: string,
  operation: string,
  accountId = "default",
): string {
  return `${service}:${operation}:${accountId}`;
}
