import { useSyncExternalStore } from "react";
import type { AuthSnapshot, AuthRuntimeState, NetworkState } from "./authTypes";

let snapshot: AuthSnapshot = {
  state: "initializing",
  user: null,
  network: typeof navigator !== "undefined" && navigator.onLine ? "online" : "unknown",
  error: null,
  lastValidatedAt: null,
};

const listeners = new Set<() => void>();

function publish(next: Partial<AuthSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function getAuthSnapshot(): AuthSnapshot {
  return snapshot;
}

export function setAuthState(state: AuthRuntimeState, extra?: Partial<AuthSnapshot>) {
  publish({ state, ...extra });
}

export function setNetworkState(network: NetworkState) {
  publish({ network });
}

export function useAuthStore(): AuthSnapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => snapshot,
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setNetworkState("online"));
  window.addEventListener("offline", () => setNetworkState("offline"));
}
