/**
 * Frame ownership, from the screenshot to the click.
 *
 * A capture records which display it came from at the moment that is known for
 * certain. Everything downstream carries that record unchanged — TypeScript
 * never regenerates a frame id, never picks a display, and never converts a
 * model coordinate into a desktop coordinate. Rust does the arithmetic, because
 * doing it in two places is how the two answers drifted apart.
 *
 * The model contributes geometry and a label. It does not get a vote on which
 * screen it was looking at.
 */
import { invoke } from "@tauri-apps/api/core";

/** What a capture tells us about itself. Produced by Rust, never by the model. */
export interface VisionFrameContext {
  frameId: string;
  displayId: string;
  topologyVersion: string;
  /** Size of the display's capture space, which a crop is measured against. */
  captureWidth: number;
  captureHeight: number;
  /** Size of the image actually handed to the model. */
  imageWidth: number;
  imageHeight: number;
}

/** Read the ownership block out of a `screen.capture` result. */
export function frameContextFrom(
  data: Record<string, unknown> | undefined,
): VisionFrameContext | null {
  if (!data) return null;
  const frameId = typeof data.frame_id === "string" ? data.frame_id : "";
  const displayId =
    typeof data.display_id === "string" ? data.display_id : String(data.display_id ?? "");
  const topologyVersion =
    typeof data.topology_version === "string" ? data.topology_version : "";
  // All three or nothing. A partial context is worse than none: it looks
  // actionable right up to the point where Rust refuses it.
  if (!frameId || !displayId || !topologyVersion) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    frameId,
    displayId,
    topologyVersion,
    captureWidth: num(data.capture_width),
    captureHeight: num(data.capture_height),
    imageWidth: num(data.image_width) || num(data.width),
    imageHeight: num(data.image_height) || num(data.height),
  };
}

/** Model geometry in its own normalised space, before it means anything. */
export interface ModelGeometry {
  /** Centre of the match, 0–`normalizedMax`. */
  x: number;
  y: number;
  normalizedMax: number;
  box?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  label?: string;
}

/**
 * What must be true after the action.
 *
 * A closed set, named by ArcSonare. The model that looks at the screen does not
 * get to choose how its own answer is checked — the whole point of verification
 * is that it is not the same judgement made twice.
 */
export type VisualExpectedOutcome =
  | { kind: "none" }
  | { kind: "region-changed"; minimumDifference?: number }
  | { kind: "window-appeared"; titlePattern?: string; processName?: string }
  | { kind: "window-disappeared"; titlePattern?: string }
  | { kind: "test-target-clicked"; expectedIncrement: number };

interface VisualTargetRequest {
  frameId: string;
  displayId: string;
  topologyVersion: string;
  x: number;
  y: number;
  normalizedMax: number;
  boxX?: number;
  boxY?: number;
  boxWidth?: number;
  boxHeight?: number;
  confidence?: number;
  label?: string;
  correlationId?: string;
  expectedOutcome?: VisualExpectedOutcome;
  skipFreshness?: boolean;
}

/** One id across capture, model call, execution and verification. */
export function newCorrelationId(): string {
  return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Bind model geometry to the frame it was found in.
 *
 * This is the only place a target is constructed, and it takes ownership from
 * the context rather than from anything the model returned — which is the whole
 * point: a model that hallucinated a display id would otherwise be believed.
 */
export interface VisualActionOptions {
  correlationId?: string;
  expectedOutcome?: VisualExpectedOutcome;
  /** Previews only: they change nothing, so a stale outline is cosmetic. */
  skipFreshness?: boolean;
}

export function buildVisualTarget(
  context: VisionFrameContext,
  geometry: ModelGeometry,
  options: VisualActionOptions = {},
): VisualTargetRequest {
  return {
    frameId: context.frameId,
    displayId: context.displayId,
    topologyVersion: context.topologyVersion,
    x: geometry.x,
    y: geometry.y,
    normalizedMax: geometry.normalizedMax,
    boxX: geometry.box?.x,
    boxY: geometry.box?.y,
    boxWidth: geometry.box?.width,
    boxHeight: geometry.box?.height,
    confidence: geometry.confidence,
    label: geometry.label,
    correlationId: options.correlationId,
    expectedOutcome: options.expectedOutcome,
    skipFreshness: options.skipFreshness,
  };
}

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CursorMoveResult {
  requested: [number, number];
  actual: [number, number] | null;
  errorDistancePx: number | null;
  displayId: number;
  success: boolean;
}

/**
 * How far the action got. `clickSent` and `verifiedSucceeded` are deliberately
 * different answers: one says input was injected, the other says something
 * happened. Anything from `clickSent` onwards may have had a side effect and
 * must never be followed by an automatic retry.
 */
export type VisualAttemptStatus =
  | "preview-succeeded"
  | "cursor-moved"
  | "click-sent"
  | "verified-succeeded"
  | "verification-failed"
  | "screen-changed-before-action"
  | "target-obscured"
  | "target-window-changed"
  | "cursor-position-mismatch"
  | "no-verifier-available";

export interface FreshnessCheckResult {
  frameId: string;
  displayId: string;
  similarityScore: number;
  threshold: number;
  isFresh: boolean;
  checkedAtMs: number;
  unavailableReason?: string;
}

export interface VerificationOutcome {
  verifierId: string;
  verified: boolean;
  unavailable: boolean;
  detail: string;
  measurements?: Record<string, unknown>;
}

export interface VisualActionResult {
  correlationId: string;
  frameId: string;
  displayId: number;
  point: [number, number];
  boxRect?: DesktopRect;
  cursor: CursorMoveResult | null;
  clicked: boolean;
  status: VisualAttemptStatus;
  /** True once the click was sent, whatever the verifier concluded. */
  sideEffectPossible: boolean;
  freshness?: FreshnessCheckResult;
  verification?: VerificationOutcome;
  label?: string;
  summary: string;
}

/** May the caller safely try a different route? */
export function allowsRetry(result: VisualActionResult): boolean {
  return !result.sideEffectPossible;
}

export interface VisualError {
  code: string;
  message: string;
  /** True when the right next step is a fresh screenshot, not a retry. */
  recapture: boolean;
}

export function isVisualError(e: unknown): e is VisualError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as VisualError).code === "string" &&
    typeof (e as VisualError).message === "string"
  );
}

/** Turn whatever came back from `invoke` into a readable refusal. */
export function describeVisualError(e: unknown): VisualError {
  if (isVisualError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return { code: "visual-failed", message, recapture: false };
}

/**
 * Validate a target and report where it lands. Changes nothing on screen.
 *
 * The rectangle comes back too, so an answer can be inspected before it is
 * drawn — a border round the wrong icon is indistinguishable from a border
 * round the right one, so the check has to happen while nothing is on screen.
 */
export function resolveVisualTarget(
  context: VisionFrameContext,
  geometry: ModelGeometry,
): Promise<{
  frameId: string;
  displayId: number;
  x: number;
  y: number;
  boxRect?: DesktopRect;
  label?: string;
}> {
  return invoke("resolve_visual_target_cmd", {
    request: buildVisualTarget(context, geometry),
  });
}

/** Outline the target. No cursor, no click. */
export function previewVisualTarget(
  context: VisionFrameContext,
  geometry: ModelGeometry,
  seconds?: number,
  options: VisualActionOptions = {},
): Promise<VisualActionResult> {
  return invoke("preview_visual_target", {
    // A preview changes nothing, so a slightly stale outline is a cosmetic
    // problem rather than a wrong action — and blocking "show me" on a screen
    // that moved would make the feature useless in a live window.
    request: buildVisualTarget(context, geometry, { skipFreshness: true, ...options }),
    seconds,
  });
}

/** Move the cursor to the target. Never clicks. */
export function moveToVisualTarget(
  context: VisionFrameContext,
  geometry: ModelGeometry,
  options: VisualActionOptions = {},
): Promise<VisualActionResult> {
  return invoke("move_to_visual_target", {
    request: buildVisualTarget(context, geometry, options),
  });
}

/**
 * Check the screen has not moved on, move, verify the cursor arrived, click,
 * then prove it did something.
 *
 * `expectedOutcome` defaults to a region-change check rather than to nothing:
 * an unverified click is the failure mode this whole path exists to remove.
 */
export function executeVisualTarget(
  context: VisionFrameContext,
  geometry: ModelGeometry,
  button: "left" | "right" | "double" = "left",
  options: VisualActionOptions = {},
): Promise<VisualActionResult> {
  return invoke("execute_visual_target", {
    request: buildVisualTarget(context, geometry, {
      expectedOutcome: { kind: "region-changed" },
      ...options,
    }),
    button,
  });
}

export function clearVisualOverlay(): Promise<void> {
  return invoke("clear_visual_overlay");
}
