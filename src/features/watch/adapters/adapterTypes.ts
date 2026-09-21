/**
 * The application-adapter contract.
 *
 * One contract for every watched application, so the honest answer to "what can
 * ArcSonare read from Discord?" is computed from the adapter rather than
 * asserted in prose. An adapter that cannot read message bodies says so, and
 * the capability list the model sees shrinks accordingly — instead of the model
 * being offered a tool that will fail and then having to explain it away.
 */
import type { RunningAppInstance, WatchedApplication } from "../watchTypes";

/** How complete an adapter is. Mirrors `ConnectorImplementation` deliberately. */
export type AdapterImplementation =
  | "COMPLETE"
  | "PARTIAL"
  | "METADATA_ONLY"
  | "NOT_IMPLEMENTED";

/**
 * Where a piece of context came from.
 *
 * Carried on every snapshot field group so a claim can be traced. "Discord is
 * in #general" means something different when it came from an accessibility
 * tree than when it was parsed out of a window title, and the model must be
 * able to tell the difference before asserting it.
 */
export type ContextSource =
  | "application-bridge"
  | "native-os-api"
  | "ui-automation"
  | "accessibility-tree"
  | "browser-extension"
  | "companion-extension"
  | "window-metadata"
  | "visual-fallback";

export type PrivacyClass =
  | "app-identity"
  | "window-title"
  | "visible-controls"
  | "visible-text"
  | "document-identity"
  | "message-content"
  | "terminal-output"
  | "source-code"
  | "screenshot";

/** One thing an adapter can read, with its provenance and its permission. */
export interface ContextField {
  id: string;
  label: string;
  source: ContextSource;
  privacyClass: PrivacyClass;
  /** Present only when the adapter genuinely implements it right now. */
  implemented: boolean;
}

/** One thing an adapter can do, with what it costs to do it. */
export interface AdapterAction {
  /** Capability id the model will be offered, e.g. `spotify.play`. */
  capabilityId: string;
  label: string;
  source: ContextSource;
  /** External side effect — leaves this machine or reaches another person. */
  external: boolean;
  requiresConfirmation: boolean;
  implemented: boolean;
}

export interface AdapterCapabilityReport {
  adapterId: string;
  implementation: AdapterImplementation;
  /** Fields this adapter can read on this instance, right now. */
  readable: ContextField[];
  /** Fields the adapter knows about but cannot read here, and why. */
  unreadable: Array<ContextField & { reason: string }>;
  actions: AdapterAction[];
  /** Actions explicitly not offered, with the honest reason. */
  unsupported: Array<{ label: string; reason: string }>;
  /** Privacy permissions that must be granted before `readable` is complete. */
  requiredPermissions: PrivacyClass[];
}

/** A point-in-time read of one instance. */
export interface AdapterSnapshot {
  adapterId: string;
  instanceKey: string;
  capturedAt: string;
  /** Facts, already filtered by the privacy policy. */
  facts: Record<string, unknown>;
  /** Where each fact group came from, keyed by fact key. */
  sources: Partial<Record<string, ContextSource>>;
  /** Human sentence for the prompt. Never speculative. */
  summary: string;
  /** What the adapter could not read for this snapshot. */
  limitations: string[];
}

export interface AdapterEvent {
  adapterId: string;
  instanceKey: string;
  kind: string;
  summary: string;
  at: string;
}

export interface AdapterValidation {
  ok: boolean;
  health: "healthy" | "degraded" | "unavailable" | "error";
  message?: string;
}

export interface SnapshotRequest {
  /** Fields the caller wants. An adapter must not read more than it was asked. */
  fields?: string[];
  /** Effective privacy policy for this application. */
  application: WatchedApplication;
}

/**
 * What every application adapter implements.
 *
 * `discover` is separate from `getSnapshot` because deciding whether an adapter
 * applies must be cheap: it runs for every instance on every refresh, whereas a
 * snapshot may cost a UI Automation walk.
 */
export interface ApplicationAdapter {
  readonly id: string;
  /** Catalog ids this adapter serves. */
  readonly applicationIds: readonly string[];
  readonly implementation: AdapterImplementation;

  /** Does this adapter apply to this instance? Cheap, metadata only. */
  discover(instance: RunningAppInstance): boolean;

  /** What this adapter can read and do on this instance, honestly. */
  getCapabilities(instance: RunningAppInstance): AdapterCapabilityReport;

  /** Read the instance. Must respect `request.application.privacyPolicy`. */
  getSnapshot(
    instance: RunningAppInstance,
    request: SnapshotRequest,
  ): Promise<AdapterSnapshot>;

  /** Subscribe to change events. Returns an unsubscribe function. */
  subscribe?(
    instance: RunningAppInstance,
    sink: (event: AdapterEvent) => void,
  ): () => void;

  /** Is this adapter working against this instance right now? */
  validate(instance: RunningAppInstance): Promise<AdapterValidation>;

  /** Release anything held for this instance. */
  dispose?(instance: RunningAppInstance): void;
}

/** Which privacy permission gates a context field. */
export function permissionFor(field: ContextField): PrivacyClass {
  return field.privacyClass;
}

/**
 * Whether the policy permits reading this class.
 *
 * The single gate. Adapters call it rather than reading policy booleans
 * directly, so adding a permission cannot leave one adapter checking the old
 * shape — that is how a consent gate silently stops applying.
 */
export function policyAllows(
  application: WatchedApplication,
  privacyClass: PrivacyClass,
): boolean {
  const p = application.privacyPolicy;
  switch (privacyClass) {
    case "app-identity":
      return p.appIdentity;
    case "window-title":
      return p.windowTitle;
    case "visible-controls":
      return p.visibleControls;
    case "visible-text":
      return p.visibleText;
    case "document-identity":
      return p.documentIdentity;
    case "message-content":
      return p.messageContent;
    case "terminal-output":
      return p.terminalOutput;
    case "source-code":
      return p.sourceCode;
    case "screenshot":
      return p.screenshots;
  }
}

/** Fields this policy currently permits, out of everything the adapter offers. */
export function permittedFields(
  application: WatchedApplication,
  fields: ContextField[],
): ContextField[] {
  return fields.filter(
    (f) => f.implemented && policyAllows(application, f.privacyClass),
  );
}

export const SOURCE_LABEL: Record<ContextSource, string> = {
  "application-bridge": "the application's own extension",
  "native-os-api": "a Windows API",
  "ui-automation": "Windows UI Automation",
  "accessibility-tree": "the accessibility tree",
  "browser-extension": "the browser extension",
  "companion-extension": "the ArcSonare companion extension",
  "window-metadata": "window metadata only",
  "visual-fallback": "a screen reading",
};
