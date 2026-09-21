/**
 * Turning a typed display refusal into something a person can act on.
 *
 * Every one of these used to arrive as `display-not-verified` with a sentence
 * attached, so the UI had nothing to branch on and showed the same "capability
 * failed" for eleven genuinely different situations — a display that has never
 * been checked, a display the user deliberately ignored, and a point that is on
 * no monitor at all are not the same problem and do not have the same fix.
 *
 * One mapper, shared by everything that can receive a refusal, so the wording
 * and the offered action cannot drift between the chat surface, the overlay and
 * Settings.
 *
 * The Rust side is the source of truth for the codes: see
 * `src-tauri/src/display/interaction_error.rs`.
 */

export type DisplayInteractionErrorCode =
  | "DISPLAY_NOT_CONFIGURED"
  | "DISPLAY_PROFILE_STALE"
  | "DISPLAY_PROFILE_FAILED"
  | "DISPLAY_IGNORED"
  | "DISPLAY_IDENTITY_MISMATCH"
  | "DISPLAY_PROFILE_CORRUPT"
  | "DISPLAY_PROFILE_VERSION_UNSUPPORTED"
  | "TARGET_OUTSIDE_CONNECTED_DISPLAY"
  | "AUTHORITY_EXPIRED"
  | "AUTHORITY_TOPOLOGY_CHANGED"
  | "AUTHORITY_DISPLAY_MISMATCH";

export const DISPLAY_INTERACTION_ERROR_CODES: DisplayInteractionErrorCode[] = [
  "DISPLAY_NOT_CONFIGURED",
  "DISPLAY_PROFILE_STALE",
  "DISPLAY_PROFILE_FAILED",
  "DISPLAY_IGNORED",
  "DISPLAY_IDENTITY_MISMATCH",
  "DISPLAY_PROFILE_CORRUPT",
  "DISPLAY_PROFILE_VERSION_UNSUPPORTED",
  "TARGET_OUTSIDE_CONNECTED_DISPLAY",
  "AUTHORITY_EXPIRED",
  "AUTHORITY_TOPOLOGY_CHANGED",
  "AUTHORITY_DISPLAY_MISMATCH",
];

export interface GeometrySnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  rotationDegrees: number;
}

export interface DisplayInteractionErrorDetails {
  displayName?: string;
  currentGeometry?: GeometrySnapshot;
  savedGeometry?: GeometrySnapshot;
  changedProperties?: string[];
  averageErrorPx?: number;
  maximumErrorPx?: number;
  lastCheckedMs?: number;
}

/** The payload Rust serialises. `codeStr` is what to switch on. */
export interface DisplayInteractionError {
  codeStr: DisplayInteractionErrorCode | string;
  message: string;
  displayId?: string;
  stableIdentity?: string;
  details?: DisplayInteractionErrorDetails;
  recommendedAction?: string;
  allowsAutomaticRetry?: boolean;
  sideEffectOccurred?: boolean;
}

export interface RefusalAction {
  /** Stable id the caller wires to a handler; never shown to the user. */
  id:
    | "verify-display"
    | "recheck-display"
    | "review-measurements"
    | "run-again"
    | "re-enable-display"
    | "retry";
  label: string;
}

export interface RenderedRefusal {
  code: DisplayInteractionErrorCode;
  /** One sentence, naming the display where one is known. */
  headline: string;
  /** Supporting lines — what changed, what the measurements were. */
  facts: string[];
  actions: RefusalAction[];
  /** True when nothing reached the screen, which is worth saying plainly. */
  reassurance?: string;
}

/**
 * How to name the monitor.
 *
 * Falls back to "this display" rather than printing a device path — an EDID
 * interface path is diagnostics, not something to put in a sentence.
 */
function displayName(error: DisplayInteractionError): string {
  const name = error.details?.displayName?.trim() || error.displayId?.trim();
  return name && !name.startsWith("\\\\") ? name : "this display";
}

/** The same name, for the start of a sentence. */
function displayNameCapitalized(error: DisplayInteractionError): string {
  const name = displayName(error);
  return name === "this display" ? "This display" : name;
}

function isKnown(code: string): code is DisplayInteractionErrorCode {
  return (DISPLAY_INTERACTION_ERROR_CODES as string[]).includes(code);
}

/** Is this something the display mapper should handle at all? */
export function isDisplayInteractionError(
  value: unknown,
): value is DisplayInteractionError {
  if (!value || typeof value !== "object") return false;
  const code = (value as { codeStr?: unknown }).codeStr;
  return typeof code === "string" && isKnown(code);
}

function percent(scale: number | undefined): string | null {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return null;
  return `${Math.round(scale * 100)}%`;
}

/**
 * What actually changed, in the user's terms.
 *
 * Reports only properties that genuinely differ, and says nothing at all when
 * the store could not be read — an empty list is honest, an invented one is not.
 */
function changeFacts(details?: DisplayInteractionErrorDetails): string[] {
  if (!details?.savedGeometry || !details.currentGeometry) return [];
  const saved = details.savedGeometry;
  const now = details.currentGeometry;
  const facts: string[] = [];
  for (const property of details.changedProperties ?? []) {
    if (property === "resolution") {
      facts.push(
        `Resolution ${saved.width}×${saved.height} → ${now.width}×${now.height}`,
      );
    } else if (property === "scale") {
      const before = percent(saved.scaleFactor);
      const after = percent(now.scaleFactor);
      if (before && after) facts.push(`Scale ${before} → ${after}`);
    } else if (property === "rotation") {
      facts.push(
        `Rotation ${saved.rotationDegrees}° → ${now.rotationDegrees}°`,
      );
    }
  }
  return facts;
}

function accuracyFacts(details?: DisplayInteractionErrorDetails): string[] {
  const facts: string[] = [];
  if (typeof details?.averageErrorPx === "number") {
    facts.push(`Average error: ${details.averageErrorPx.toFixed(2)} px`);
  }
  if (typeof details?.maximumErrorPx === "number") {
    facts.push(`Maximum error: ${details.maximumErrorPx.toFixed(2)} px`);
  }
  return facts;
}

const NOTHING_HAPPENED = "No cursor movement or click was performed.";

/**
 * The one place a typed refusal becomes English.
 *
 * Never returns a generic message: an unrecognised code is reported as such,
 * with the backend's own sentence, rather than being smoothed into "capability
 * failed" — a code this mapper does not know about is a bug worth seeing.
 */
export function renderDisplayRefusal(
  error: DisplayInteractionError,
): RenderedRefusal {
  const name = displayName(error);
  const sentenceName = displayNameCapitalized(error);
  const code = isKnown(error.codeStr)
    ? error.codeStr
    : ("DISPLAY_NOT_CONFIGURED" as DisplayInteractionErrorCode);
  const reassurance = error.sideEffectOccurred ? undefined : NOTHING_HAPPENED;

  switch (code) {
    case "DISPLAY_NOT_CONFIGURED":
      return {
        code,
        headline: `Visual interaction is unavailable on ${name} because it has not been verified.`,
        facts: [],
        actions: [{ id: "verify-display", label: "Verify display" }],
        reassurance,
      };

    case "DISPLAY_PROFILE_STALE":
      return {
        code,
        headline: `${sentenceName} changed since it was last verified.`,
        facts: changeFacts(error.details),
        actions: [{ id: "recheck-display", label: "Re-check display" }],
        reassurance,
      };

    case "DISPLAY_PROFILE_FAILED":
      return {
        code,
        headline: `${sentenceName}’s last verification did not meet the accuracy requirement.`,
        facts: accuracyFacts(error.details),
        actions: [
          { id: "review-measurements", label: "Review measurements" },
          { id: "run-again", label: "Run again" },
        ],
        reassurance,
      };

    case "DISPLAY_IGNORED":
      return {
        code,
        headline: `Visual interaction is disabled on ${name}.`,
        facts: [],
        actions: [{ id: "re-enable-display", label: "Re-enable" }],
        reassurance,
      };

    case "DISPLAY_IDENTITY_MISMATCH":
      return {
        code,
        headline: `${sentenceName} is no longer the display ArcSonare measured.`,
        facts: changeFacts(error.details),
        actions: [{ id: "recheck-display", label: "Re-check display" }],
        reassurance,
      };

    case "DISPLAY_PROFILE_CORRUPT":
      return {
        code,
        headline: "The stored display measurements could not be read.",
        facts: ["The damaged file was kept alongside the store for diagnosis."],
        actions: [{ id: "verify-display", label: "Verify display" }],
        reassurance,
      };

    case "DISPLAY_PROFILE_VERSION_UNSUPPORTED":
      return {
        code,
        headline:
          "The stored display measurements were written by a newer version of ArcSonare.",
        // Deliberately no action: rewriting a newer store would discard
        // measurements this build cannot understand.
        facts: ["They have been left untouched."],
        actions: [],
        reassurance,
      };

    case "TARGET_OUTSIDE_CONNECTED_DISPLAY":
      return {
        code,
        headline: "The requested point is outside every connected display.",
        facts: [],
        actions: [],
        reassurance: NOTHING_HAPPENED,
      };

    case "AUTHORITY_EXPIRED":
      return {
        code,
        headline: "The display target expired before ArcSonare could act.",
        facts: [],
        actions: [{ id: "retry", label: "Try again" }],
        reassurance,
      };

    case "AUTHORITY_TOPOLOGY_CHANGED":
      return {
        code,
        headline:
          "The display arrangement changed while ArcSonare was acting, so it stopped.",
        facts: [],
        actions: [{ id: "recheck-display", label: "Re-check display" }],
        reassurance,
      };

    case "AUTHORITY_DISPLAY_MISMATCH":
      return {
        code,
        headline: `The requested point is not on ${name}, which is the display that was checked.`,
        facts: [],
        actions: [],
        reassurance,
      };
  }
}
