/**
 * Capability learning memory: user app-alias preferences and recent
 * successful capabilities. Learned only after verified success; never stores
 * shell commands — only registry target ids.
 */
import type { ApplicationAliasMemory } from "./capabilityTypes";

const ALIAS_KEY = "arcsonare.capabilities.appAliases.v1";
const RECENT_KEY = "arcsonare.capabilities.recentSuccess.v1";
const MAX_ALIASES = 100;

function loadAliases(): ApplicationAliasMemory[] {
  try {
    const raw = window.localStorage.getItem(ALIAS_KEY);
    if (raw) return JSON.parse(raw) as ApplicationAliasMemory[];
  } catch (err) {
    console.error("[ArcSonare] failed to load alias memory:", err);
  }
  return [];
}

function saveAliases(aliases: ApplicationAliasMemory[]) {
  try {
    window.localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases.slice(0, MAX_ALIASES)));
  } catch (err) {
    console.error("[ArcSonare] failed to persist alias memory:", err);
  }
}

function normalizeRequest(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** A target id may only be a registry/index id — never a path or command. */
function safeTargetId(targetId: string): boolean {
  return /^[a-z0-9][a-z0-9\-_.]{0,80}$/i.test(targetId);
}

export function getAliasPreference(request: string): ApplicationAliasMemory | null {
  const key = normalizeRequest(request);
  if (!key) return null;
  const hit = loadAliases().find(
    (a) => a.normalizedRequest === key && a.confirmedByUser && a.failedLaunches < 3,
  );
  return hit ?? null;
}

/** Record a verified successful resolution. Learning requires verification. */
export function recordAliasSuccess(
  request: string,
  targetId: string,
  targetType: ApplicationAliasMemory["targetType"],
  confirmedByUser: boolean,
) {
  if (!safeTargetId(targetId)) return;
  const key = normalizeRequest(request);
  if (!key) return;
  const aliases = loadAliases();
  const existing = aliases.find((a) => a.normalizedRequest === key);
  if (existing) {
    existing.successfulLaunches += 1;
    existing.lastUsedAt = new Date().toISOString();
    existing.targetId = targetId;
    existing.targetType = targetType;
    if (confirmedByUser) existing.confirmedByUser = true;
  } else {
    aliases.unshift({
      normalizedRequest: key,
      targetId,
      targetType,
      confirmedByUser,
      successfulLaunches: 1,
      failedLaunches: 0,
      lastUsedAt: new Date().toISOString(),
    });
  }
  saveAliases(aliases);
}

/** Failure decay — never learn from a failed launch. */
export function recordAliasFailure(request: string) {
  const key = normalizeRequest(request);
  const aliases = loadAliases();
  const existing = aliases.find((a) => a.normalizedRequest === key);
  if (existing) {
    existing.failedLaunches += 1;
    saveAliases(aliases);
  }
}

export function forgetAlias(request: string): boolean {
  const key = normalizeRequest(request);
  const aliases = loadAliases();
  const next = aliases.filter((a) => a.normalizedRequest !== key && a.targetId !== key);
  const removed = next.length !== aliases.length;
  if (removed) saveAliases(next);
  return removed;
}

export function listAliases(): ApplicationAliasMemory[] {
  return loadAliases();
}

export function clearAllAliases() {
  saveAliases([]);
}

// ---------------------------------------------------------------------------
// Recent-success boost for retrieval scoring
// ---------------------------------------------------------------------------

interface RecentSuccess {
  capabilityId: string;
  at: number;
}

function loadRecent(): RecentSuccess[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw) as RecentSuccess[];
  } catch {
    // Best-effort.
  }
  return [];
}

export function recordCapabilitySuccess(capabilityId: string) {
  try {
    const recent = loadRecent().filter((r) => Date.now() - r.at < 7 * 86_400_000);
    recent.unshift({ capabilityId, at: Date.now() });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 50)));
  } catch {
    // Best-effort.
  }
}

export function recentSuccessBoost(capabilityId: string): number {
  const recent = loadRecent();
  const hits = recent.filter((r) => r.capabilityId === capabilityId).length;
  return Math.min(hits, 3);
}
