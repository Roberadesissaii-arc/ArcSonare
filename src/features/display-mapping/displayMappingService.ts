/**
 * Talking to the display mapping wizard in Rust.
 *
 * Every coordinate in these types was produced by Rust and is in physical
 * desktop pixels. Nothing here recomputes one. That is the whole point of the
 * split: the wizard exists to check that ArcSonare's idea of where a point is
 * matches where the mouse actually goes, and a check that used the webview's own
 * arithmetic would be measuring the wrong thing — a browser event is in CSS
 * pixels, inside a window that may be on a different monitor entirely.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Where Rust announces a sample taken by the global Space shortcut.
 *
 * That press has no caller to return a value to — it happens while another
 * window has focus, which is the whole reason the shortcut is global.
 */
export const SAMPLE_EVENT = "arcsonare://display-mapping-sample";

export type DisplayProfileStatus =
  | "unconfigured"
  | "configuring"
  | "valid"
  | "stale"
  | "failed"
  | "ignored"
  | "disconnected";

export type WizardPhase = "identify" | "nine-point" | "random-validation" | "result";

/** The wizard's own step, which is broader than the Rust sampling phase. */
export type DisplayMappingWizardStep =
  | "intro"
  | "display-list"
  | "identify-display"
  | "nine-point"
  | "random-validation"
  | "result"
  | "complete";

export interface DisplayConfigurationSummary {
  /** The stable hardware identity — the id every command takes. */
  displayId: string;
  friendlyName: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  rotationDegrees: number;
  primary: boolean;
  orientation: string;
  connected: boolean;
  status: DisplayProfileStatus;
  averageErrorPx: number;
  maximumErrorPx: number;
  sampleCount: number;
  configuredAtMs: number;
  validatedAtMs: number;
  needsConfiguration: boolean;
  allowsVisualInteraction: boolean;
  /** Diagnostics only. Changes every run; never persisted. */
  runtimeDisplayId?: number;
}

export interface ActiveTarget {
  index: number;
  total: number;
  label: string;
  phase: WizardPhase;
  desktopX: number;
  desktopY: number;
  displayX: number;
  displayY: number;
}

export type AccuracyRating = "excellent" | "valid" | "failed";

export interface ValidationSummary {
  sampleCount: number;
  averageErrorPx: number;
  maximumErrorPx: number;
  wrongDisplayCount: number;
  outOfBoundsCount: number;
  rating: AccuracyRating;
  passed: boolean;
}

/** Why the fitted correction was kept or discarded. */
export interface CorrectionDecision {
  applied: unknown | null;
  identityAveragePx: number;
  candidateAveragePx: number;
  identityMaximumPx: number;
  candidateMaximumPx: number;
  improvement: number;
  reason: string;
}

/** The bars, stated so the result screen can show what it is judging against. */
export const ACCURACY_THRESHOLDS = {
  excellent: { average: 4, maximum: 8 },
  valid: { average: 6, maximum: 10 },
} as const;

export function ratingLabel(rating: AccuracyRating): string {
  switch (rating) {
    case "excellent":
      return "Excellent";
    case "valid":
      return "Valid";
    case "failed":
      return "Failed";
  }
}

/** What just happened to the most recent press. */
export interface SampleFeedback {
  accepted: boolean;
  distancePx: number;
  message: string;
}

export interface WizardStatus {
  sessionId: string;
  displayId: string;
  phase: WizardPhase;
  target: ActiveTarget | null;
  ninePointCount: number;
  validationCount: number;
  rejectedCount: number;
  outliersRemoved: number;
  /** Residual of the calibration fit — not the validation error. */
  calibrationResidualPx?: number;
  correctionDecision?: CorrectionDecision;
  lastSample?: SampleFeedback;
  summary?: ValidationSummary;
  correctionApplied?: boolean;
  finished: boolean;
}

export interface PendingConfiguration {
  displayCount: number;
  pendingCount: number;
  pendingDisplayIds: string[];
  anyConfigured: boolean;
}

export function getDisplays(): Promise<DisplayConfigurationSummary[]> {
  return invoke("get_display_configuration_summary");
}

export function getPendingConfiguration(): Promise<PendingConfiguration> {
  return invoke("display_mapping_needs_attention");
}

export function startSession(displayId: string): Promise<WizardStatus> {
  return invoke("start_display_mapping_session", { displayId });
}

export function identifyDisplay(sessionId: string, seconds?: number): Promise<WizardStatus> {
  return invoke("identify_display", { sessionId, seconds });
}

export function beginNinePoint(sessionId: string): Promise<WizardStatus> {
  return invoke("begin_nine_point", { sessionId });
}

export function showMappingTarget(sessionId: string): Promise<WizardStatus> {
  return invoke("show_mapping_target", { sessionId });
}

/**
 * Record where the cursor is *now*.
 *
 * Deliberately takes no coordinate. Rust reads `GetCursorPos` itself, so the
 * sample is a native physical point rather than something this side derived.
 */
export function recordMappingClick(sessionId: string): Promise<WizardStatus> {
  return invoke("record_mapping_click", { sessionId });
}

export function retryMappingSample(sessionId: string): Promise<WizardStatus> {
  return invoke("retry_mapping_sample", { sessionId });
}

export function runRandomValidation(sessionId: string): Promise<WizardStatus> {
  return invoke("run_random_validation", { sessionId });
}

export function completeMapping(sessionId: string): Promise<WizardStatus> {
  return invoke("complete_display_mapping", { sessionId });
}

export function cancelMapping(): Promise<void> {
  return invoke("cancel_display_mapping");
}

export function testDisplayOverlay(displayId: string, seconds = 3): Promise<void> {
  return invoke("test_display_overlay", { displayId, seconds });
}

export interface CursorTestResult {
  expected: [number, number];
  actual: [number, number];
  errorPx: number;
  onIntendedDisplay: boolean;
}

export function testDisplayCursor(displayId: string): Promise<CursorTestResult> {
  return invoke("test_display_cursor", { displayId });
}

export function ignoreDisplay(displayId: string): Promise<void> {
  return invoke("ignore_display", { displayId });
}

export function enableDisplay(displayId: string): Promise<void> {
  return invoke("enable_display", { displayId });
}

export function removeDisplayProfile(displayId: string): Promise<boolean> {
  return invoke("remove_display_profile", { displayId });
}

export function getDiagnostics(): Promise<Record<string, unknown>> {
  return invoke("get_display_mapping_diagnostics");
}

/** How a status should read in the interface. */
export function statusLabel(status: DisplayProfileStatus): string {
  switch (status) {
    case "valid":
      return "Verified";
    case "unconfigured":
      return "Not verified";
    case "configuring":
      return "Setup in progress";
    case "stale":
      return "Needs re-checking";
    case "failed":
      return "Failed";
    case "ignored":
      return "Ignored";
    case "disconnected":
      return "Disconnected";
  }
}

/**
 * What a status means, in words that do not overclaim.
 *
 * A verified mapping says ArcSonare can put a border where it means to. It says
 * nothing about whether the thing under that border was correctly identified —
 * those are separate questions and conflating them is how "the display is
 * calibrated" turns into "so the highlight must be right".
 */
export function statusExplanation(status: DisplayProfileStatus): string {
  switch (status) {
    case "valid":
      return "Coordinates on this display have been checked against the real cursor.";
    case "unconfigured":
      return "Not checked yet. Visual actions are held back on this display; everything else works.";
    case "configuring":
      return "Setup was started but not finished.";
    case "stale":
      return "This display changed since it was checked, so the old measurements no longer apply.";
    case "failed":
      return "The last check was outside tolerance. Visual actions stay blocked here.";
    case "ignored":
      return "You asked ArcSonare to leave this display alone.";
    case "disconnected":
      return "Not currently attached. Its measurements are kept for when it returns.";
  }
}

export function formatTimestamp(ms: number): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleString();
}

/**
 * Scale real monitor rectangles into a diagram box, preserving arrangement.
 *
 * Read-only: it shows where Windows says the monitors are. Negative origins are
 * normal — a monitor left of or above the primary one has them — so the bounding
 * box is computed rather than assumed to start at zero.
 */
export function arrangementLayout(
  displays: DisplayConfigurationSummary[],
  boxWidth: number,
  boxHeight: number,
  padding = 8,
): { displayId: string; left: number; top: number; width: number; height: number }[] {
  const attached = displays.filter((d) => d.connected);
  if (attached.length === 0) return [];

  const minX = Math.min(...attached.map((d) => d.x));
  const minY = Math.min(...attached.map((d) => d.y));
  const maxX = Math.max(...attached.map((d) => d.x + d.width));
  const maxY = Math.max(...attached.map((d) => d.y + d.height));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  // One scale for both axes, or the diagram would misrepresent shape — a
  // portrait monitor has to look portrait.
  const scale = Math.min((boxWidth - padding * 2) / spanX, (boxHeight - padding * 2) / spanY);
  const offsetX = (boxWidth - spanX * scale) / 2;
  const offsetY = (boxHeight - spanY * scale) / 2;

  return attached.map((d) => ({
    displayId: d.displayId,
    left: offsetX + (d.x - minX) * scale,
    top: offsetY + (d.y - minY) * scale,
    width: d.width * scale,
    height: d.height * scale,
  }));
}
