/**
 * Connected-service registry + in-memory connection state cache.
 * Non-secret metadata only. OAuth tokens stay in the secure store when wired.
 *
 * Honest default: no accounts are connected until Connect/OAuth lands.
 */

import type {
  ConnectedAccount,
  ConnectedServiceKind,
  ConnectionStatus,
} from "./IntentContract";

const META_KEY = "arcsonare.connectionMeta.v1";
const PREFS_KEY = "arcsonare.serviceAccountPrefs.v1";

/** Freshness window for “recently validated” (~15 minutes). */
export const CONNECTION_FRESH_MS = 15 * 60 * 1000;

export type ServiceAccountPreference = {
  service: ConnectedServiceKind;
  defaultAccountId?: string;
  includeAccountIds?: string[];
  queryMode: "default-only" | "all-enabled" | "ask";
};

export type ResolveInput = {
  service: ConnectedServiceKind;
  providerPreference?: string | null;
  requiredScopes?: string[];
  allowMultipleAccounts?: boolean;
};

export type ResolveOutput = {
  status:
    | "ready"
    | "not-connected"
    | "missing-scope"
    | "authentication-required"
    | "ambiguous-account"
    | "temporarily-unavailable";
  accountIds: string[];
  provider: string | null;
  missingScopes: string[];
  message: string;
};

type MetaSnapshot = {
  accounts: ConnectedAccount[];
  updatedAt: string;
};

let memory: MetaSnapshot = { accounts: [], updatedAt: new Date().toISOString() };
let prefs: ServiceAccountPreference[] = [];
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MetaSnapshot;
      if (Array.isArray(parsed.accounts)) memory = parsed;
    }
  } catch {
    memory = { accounts: [], updatedAt: new Date().toISOString() };
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) prefs = JSON.parse(raw) as ServiceAccountPreference[];
  } catch {
    prefs = [];
  }
}

function persist(): void {
  memory.updatedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(memory));
  } catch {
    // Best-effort.
  }
}

function persistPrefs(): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort.
  }
}

export function getConnectionSnapshot(): ConnectedAccount[] {
  load();
  return memory.accounts.map((a) => ({ ...a }));
}

export function upsertAccount(account: ConnectedAccount): void {
  load();
  const idx = memory.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) memory.accounts[idx] = account;
  else memory.accounts.push(account);
  persist();
  emitConnectionEvent("arcsonare://connection-updated", account);
}

export function removeAccount(accountId: string): void {
  load();
  const prev = memory.accounts.find((a) => a.id === accountId);
  memory.accounts = memory.accounts.filter((a) => a.id !== accountId);
  persist();
  if (prev) emitConnectionEvent("arcsonare://connection-disconnected", prev);
}

export function markAuthRequired(accountId: string, message: string): void {
  load();
  const acc = memory.accounts.find((a) => a.id === accountId);
  if (!acc) return;
  acc.status = "authentication-required";
  acc.error = { code: "auth_required", message, recoverable: true };
  persist();
  emitConnectionEvent("arcsonare://connection-expired", acc);
}

export function markRequestSuccess(accountId: string): void {
  load();
  const acc = memory.accounts.find((a) => a.id === accountId);
  if (!acc) return;
  const now = new Date().toISOString();
  acc.lastSuccessfulRequestAt = now;
  acc.lastValidatedAt = now;
  acc.validationExpiresAt = new Date(Date.now() + CONNECTION_FRESH_MS).toISOString();
  if (acc.status === "error") acc.status = "connected";
  acc.error = undefined;
  persist();
  emitConnectionEvent("arcsonare://connection-validated", acc);
}

export function setServicePreference(pref: ServiceAccountPreference): void {
  load();
  const idx = prefs.findIndex((p) => p.service === pref.service);
  if (idx >= 0) prefs[idx] = pref;
  else prefs.push(pref);
  persistPrefs();
}

export function getServicePreference(
  service: ConnectedServiceKind,
): ServiceAccountPreference | undefined {
  load();
  return prefs.find((p) => p.service === service);
}

type ConnectionEventName =
  | "arcsonare://connection-added"
  | "arcsonare://connection-updated"
  | "arcsonare://connection-validated"
  | "arcsonare://connection-expired"
  | "arcsonare://connection-disconnected"
  | "arcsonare://connection-error"
  | "arcsonare://connection-scope-changed";

function emitConnectionEvent(name: ConnectionEventName, account: ConnectedAccount): void {
  try {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail: {
          accountId: account.id,
          provider: account.provider,
          services: account.services,
          status: account.status,
          changedAt: new Date().toISOString(),
          errorCode: account.error?.code,
        },
      }),
    );
  } catch {
    // Non-browser / SSR ignore.
  }
}

function isFresh(account: ConnectedAccount): boolean {
  if (account.status === "authentication-required" || account.status === "disconnected") {
    return false;
  }
  if (account.status !== "connected" && account.status !== "connected-limited") {
    return false;
  }
  const ts = account.validationExpiresAt || account.lastValidatedAt;
  if (!ts) return true; // Connected without TTL — trust until a request fails.
  return Date.parse(ts) > Date.now();
}

/**
 * Resolve which account can serve a service request.
 * Uses cache only — no network health probe.
 */
export function resolveConnection(input: ResolveInput): ResolveOutput {
  load();
  const candidates = memory.accounts.filter(
    (a) =>
      a.services.includes(input.service) &&
      (input.providerPreference
        ? a.provider === input.providerPreference
        : true),
  );

  if (candidates.length === 0) {
    return {
      status: "not-connected",
      accountIds: [],
      provider: null,
      missingScopes: input.requiredScopes ?? [],
      message: `${labelService(input.service)} isn’t connected, so I can’t access that data yet.`,
    };
  }

  const authNeeded = candidates.filter((a) => a.status === "authentication-required");
  const ready = candidates.filter(
    (a) =>
      (a.status === "connected" || a.status === "connected-limited") &&
      isFresh(a),
  );
  const degraded = candidates.filter((a) => a.status === "error");

  if (ready.length === 0 && authNeeded.length > 0) {
    return {
      status: "authentication-required",
      accountIds: authNeeded.map((a) => a.id),
      provider: authNeeded[0].provider,
      missingScopes: [],
      message: `Your ${labelService(input.service)} connection has expired. Reconnect it to continue.`,
    };
  }

  if (ready.length === 0 && degraded.length > 0) {
    return {
      status: "temporarily-unavailable",
      accountIds: degraded.map((a) => a.id),
      provider: degraded[0].provider,
      missingScopes: [],
      message: `${labelService(input.service)} is temporarily unavailable. Your connection still appears active.`,
    };
  }

  if (ready.length === 0) {
    return {
      status: "not-connected",
      accountIds: [],
      provider: null,
      missingScopes: input.requiredScopes ?? [],
      message: `${labelService(input.service)} isn’t connected, so I can’t access that data yet.`,
    };
  }

  const required = input.requiredScopes ?? [];
  const withScopes = ready.filter((a) =>
    required.every((s) => a.scopes.includes(s) || a.scopes.includes("*")),
  );
  if (required.length && withScopes.length === 0) {
    return {
      status: "missing-scope",
      accountIds: ready.map((a) => a.id),
      provider: ready[0].provider,
      missingScopes: required,
      message: `${labelService(input.service)} is connected, but ArcSonare doesn’t have permission to ${permissionPhrase(input.service)}.`,
    };
  }

  const pool = withScopes.length ? withScopes : ready;
  const pref = getServicePreference(input.service);
  if (pref?.defaultAccountId) {
    const hit = pool.find((a) => a.id === pref.defaultAccountId);
    if (hit) {
      return {
        status: "ready",
        accountIds: [hit.id],
        provider: hit.provider,
        missingScopes: [],
        message: "Ready",
      };
    }
  }

  if (pool.length > 1 && !input.allowMultipleAccounts && pref?.queryMode === "ask") {
    return {
      status: "ambiguous-account",
      accountIds: pool.map((a) => a.id),
      provider: pool[0].provider,
      missingScopes: [],
      message: `Which ${labelService(input.service)} account should I use?`,
    };
  }

  return {
    status: "ready",
    accountIds: [pool[0].id],
    provider: pool[0].provider,
    missingScopes: [],
    message: "Ready",
  };
}

function labelService(service: ConnectedServiceKind): string {
  switch (service) {
    case "email":
      return "Email";
    case "calendar":
      return "Calendar";
    case "drive":
      return "Google Drive";
    case "contacts":
      return "Contacts";
    case "chat":
      return "Chat";
    case "tasks":
      return "Tasks";
    default:
      return service;
  }
}

function permissionPhrase(service: ConnectedServiceKind): string {
  switch (service) {
    case "email":
      return "read your email";
    case "calendar":
      return "read your events";
    case "drive":
      return "list your files";
    default:
      return "access this service";
  }
}

/** Compact snapshot for model context — no secrets. */
export function sessionCapabilitySnapshot(
  services: ConnectedServiceKind[],
): Record<string, unknown> {
  load();
  const available: Record<string, unknown> = {};
  for (const service of services) {
    const resolved = resolveConnection({ service });
    const accounts = memory.accounts.filter((a) => a.services.includes(service));
    available[service] = {
      status: statusForSnapshot(resolved.status, accounts[0]?.status),
      provider: resolved.provider,
      account_count: accounts.length,
      capabilities: capabilitiesFor(service, resolved.status),
    };
  }
  return { available_services: available };
}

function statusForSnapshot(
  resolveStatus: ResolveOutput["status"],
  accountStatus?: ConnectionStatus,
): string {
  if (resolveStatus === "ready") return "connected";
  if (resolveStatus === "authentication-required") return "authentication-required";
  if (resolveStatus === "missing-scope") return "connected-limited";
  if (resolveStatus === "temporarily-unavailable") return "error";
  return accountStatus ?? "disconnected";
}

function capabilitiesFor(
  service: ConnectedServiceKind,
  status: ResolveOutput["status"],
): string[] {
  if (status !== "ready" && status !== "missing-scope") {
    return service === "email" || service === "calendar" || service === "drive"
      ? ["open_ui"]
      : [];
  }
  switch (service) {
    case "email":
      return ["read", "draft", "send", "open_ui"];
    case "calendar":
      return ["read", "create", "update", "open_ui"];
    case "drive":
      return ["read", "open_ui"];
    default:
      return ["read"];
  }
}
