export type AuthRuntimeState =
  | "initializing"
  | "signed-out"
  | "needs-sign-in"
  | "locked"
  | "signing-in"
  | "signed-in"
  | "offline-authenticated"
  | "refreshing"
  | "expired"
  | "error";

export type NetworkState = "online" | "offline" | "limited" | "unknown";

export interface AuthUserSummary {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthSnapshot {
  state: AuthRuntimeState;
  user: AuthUserSummary | null;
  network: NetworkState;
  error: string | null;
  lastValidatedAt: string | null;
}
