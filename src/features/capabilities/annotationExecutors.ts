/**
 * The production path from "draw a border around the person on the left" to a
 * shape on screen.
 *
 * The manager, the window pool and the ids all live in Rust; this is the part
 * that turns a model tool call into a call on them. It resolves the target
 * through the *existing* vision path — capture, locate, `resolve_visual_target`
 * — so annotations get the same monitor mapping, negative-origin handling and
 * authority gate as clicking does, and no coordinate arithmetic happens here.
 *
 * Two rules the shape of this file enforces:
 *
 *   - Rust owns identity. Nothing here invents an annotation id, and every
 *     update or removal names one that came back from Rust.
 *   - A native failure is a failed result. There is no path that reports
 *     success from a call that did not draw anything, which is the failure mode
 *     the durable-write work exists to prevent in the task system and is
 *     exactly as available here.
 */

import { invoke } from "@tauri-apps/api/core";
import * as annotationService from "../../services/annotationService";
import type {
  Annotation,
  AnnotationScope,
  AnnotationShape,
} from "../../services/annotationService";
import { frameContextFrom, type VisionFrameContext } from "../../services/visualTarget";
import {
  getConversationContext,
  rememberEntity,
} from "../conversation/conversationContext";
import type { ToolResult } from "./capabilityTypes";

/** Below this the model is guessing, and a guessed border is worse than none. */
const MIN_CONFIDENCE = 0.45;

/**
 * A person's box has to be a person-shaped part of the picture.
 *
 * A vision model asked for "the person on the left" will sometimes return the
 * whole frame. Drawing that is not a border around anyone — it is a box around
 * the image — so anything covering most of the capture is refused rather than
 * drawn.
 */
const MAX_TARGET_AREA_FRACTION = 0.8;

/** The locator's coordinate space: Gemini's 0–1000 box convention. */
const NORMALIZED_MAX = 1000;

export interface AnnotationExecutorDeps {
  /** Capture the active display. The real one in production, a fake in tests. */
  capture: (appHint?: string) => Promise<ToolResult>;
  /** Ask the vision model where something is, in normalised coordinates. */
  locate: (
    dataUrl: string,
    target: string,
    within?: { x: number; y: number; width: number; height: number },
  ) => Promise<{
    found: boolean;
    confidence?: number;
    x?: number;
    y?: number;
    boxX?: number;
    boxY?: number;
    boxWidth?: number;
    boxHeight?: number;
    candidates?: number;
    label?: string;
    /** Diagnostics. Names, categories and counts only — never a payload. */
    provider?: string;
    providerStatus?: string;
    locatorFunction?: string;
    responseShape?: string[];
    centresX?: number[];
    fallbackReason?: string;
  }>;
  /** Debug-only trace sink. Absent in release, where the command does not exist. */
  writeTrace?: (trace: Record<string, unknown>) => void;
  /**
   * Which window the picture is in, if one is in front.
   *
   * Passed to the capture so the model sees the picture rather than the desktop
   * around it. Undefined falls back to the active display, which is right when
   * the subject really is the whole screen.
   */
  sourceWindowHint?: () => Promise<string | undefined>;
  /** Capture one specific window, by the id `windows.list` reported. */
  captureWindow?: (windowId: string) => Promise<ToolResult>;
  /** Read a capture back as a data URL for the vision call. */
  dataUrl: (captureId: string) => Promise<string>;
  scope: () => AnnotationScope;
  requestId: () => string;
  /**
   * The manager itself. Injected rather than imported so a test can drive these
   * executors against a fake that enforces the same rules, without a window
   * server — and so nothing here can quietly reach past it.
   */
  service: Pick<
    typeof annotationService,
    | "annotateResolved"
    | "annotationCensus"
    | "clearConversationAnnotations"
    | "listAnnotations"
    | "removeAnnotation"
    | "updateAnnotation"
  >;
  /** Where conversation references are kept. */
  memory: {
    read: () => Array<{ ref: string; meta?: Record<string, unknown> }>;
    write: (ref: string, label: string, annotationId: string, extra?: Record<string, unknown>) => void;
  };
}

/** The default wiring. Split out so tests can drive the same code with fakes. */
export function productionDeps(
  capture: AnnotationExecutorDeps["capture"],
  locate: AnnotationExecutorDeps["locate"],
): AnnotationExecutorDeps {
  return {
    capture,
    locate,
    dataUrl: (id) => invoke<string>("get_capture_data_url", { id, annotated: false }),
    scope: () => {
      const context = getConversationContext();
      return {
        accountId: context.accountId ?? "local",
        conversationId: context.conversationId ?? "default",
      };
    },
    requestId: () => {
      const context = getConversationContext();
      // One id per user turn: two shapes drawn for one sentence belong to the
      // same request, which is what makes "clear this request" meaningful and
      // what the duplicate guard keys on.
      return `req-${context.conversationId ?? "default"}-${context.recentTurns.length}`;
    },
    sourceWindowHint: foregroundPictureWindow,
    captureWindow: (windowId) =>
      invoke<ToolResult>("capability_execute", {
        capabilityId: "screen.capture",
        args: { target: "window", window_id: windowId },
        runId: `annotate-capture-${Date.now().toString(36)}`,
        userRequestSummary: "annotation capture",
        confirmationToken: null,
      }),
    writeTrace: (trace) => {
      void invoke("locate_trace_write", { trace }).catch(() => undefined);
    },
    service: annotationService,
    memory: {
      read: () => getConversationContext().recentEntities,
      write: (ref, label, annotationId, extra = {}) =>
        void rememberEntity({
          type: "visual-target",
          label,
          sourceTool: "screen.annotate",
          confidence: 1,
          ref,
          meta: { annotationId, ...(extra as Record<string, string | number | boolean | null>) },
        }),
    },
  };
}


/**
 * Is the capture a picture, or a black rectangle?
 *
 * Reads the data URL's own byte distribution rather than decoding the image:
 * decoding needs a canvas, and the question is only "is there anything here".
 * A blank capture and a real miss produce the same message otherwise, and the
 * first is our bug while the second is not.
 */

/**
 * The window the picture is most likely in.
 *
 * Asking "what is in front" answers "ArcSonare" — the user just typed into it —
 * so this takes the topmost visible window that is not us. Returning undefined
 * falls back to the active display, which is the right answer when the subject
 * really is the whole screen.
 */
async function foregroundPictureWindow(): Promise<string | undefined> {
  try {
    const listed = await invoke<{
      data?: { windows?: Array<{ title?: string; window_id?: string; app_name?: string }> };
    }>("capability_execute", {
      capabilityId: "windows.list",
      args: {},
      runId: `annotate-window-${Date.now().toString(36)}`,
      userRequestSummary: "annotation source window",
      confirmationToken: null,
    });
    const windows = listed?.data?.windows ?? [];
    // The *id*, not the title.
    //
    // Resolving by title asked `screen.capture` to match a name, and a machine
    // with two windows whose titles both contain "Claude" produced "which one
    // should I look at?" — a disambiguation question about the wrong thing
    // entirely, since the user asked about a picture. An id identifies exactly
    // one window and cannot be ambiguous.
    const candidate = windows.find((w) => {
      const title = w.title?.trim() ?? "";
      return Boolean(w.window_id) && title.length > 0 && !/^arcsonare$/i.test(title);
    });
    return candidate?.window_id;
  } catch {
    return undefined;
  }
}

function inspectCapture(dataUrl: string): { nonEmptyRatio: number; mostlyBlack: boolean } {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (payload.length < 512) return { nonEmptyRatio: 0, mostlyBlack: true };
  // A PNG of a flat black screen compresses to almost nothing; a real
  // screenshot does not. Bytes per pixel is a crude but honest proxy.
  const bytes = Math.floor((payload.length * 3) / 4);
  return {
    nonEmptyRatio: Math.min(1, bytes / 200_000),
    mostlyBlack: bytes < 20_000,
  };
}

function fail(
  capabilityId: string,
  startedAt: string,
  summary: string,
  code: string,
): ToolResult {
  return {
    callId: `${capabilityId}-${Date.now()}`,
    capabilityId,
    status: "error",
    summary,
    evidence: { verified: false, method: "not-verifiable" },
    error: { code, message: summary, recoverable: true },
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

function ok(
  capabilityId: string,
  startedAt: string,
  summary: string,
  data: Record<string, unknown>,
): ToolResult {
  return {
    callId: `${capabilityId}-${Date.now()}`,
    capabilityId,
    status: "success",
    summary,
    // The native manager confirmed it: the id came back from Rust, and the
    // census is read from the window pool rather than assumed.
    evidence: { verified: true, method: "native-overlay" },
    data,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

/** Entity refs, so a follow-up resolves without re-reading the assistant's prose. */
const PERSON_ENTITY = "annotation:person";
const FACE_ENTITY = "annotation:face";
const LAST_ENTITY = "annotation:last";

/** The annotation id a remembered entity points at, if it is still live. */
function rememberedId(deps: AnnotationExecutorDeps, ref: string): string | null {
  const entity = deps.memory.read().find((e) => e.ref === ref);
  const id = entity?.meta?.annotationId;
  return typeof id === "string" ? id : null;
}

/**
 * Which annotation a phrase like "the circle" means.
 *
 * Resolution order is deliberate: an explicit id from the model wins, then the
 * shape the user named among live annotations, then the most recent one. It
 * never parses the assistant's previous sentence — that text is generated and
 * can say anything.
 */
export async function resolveAnnotationReference(
  deps: AnnotationExecutorDeps,
  explicitId: string | null,
  phrase: string,
): Promise<{ id: string } | { ambiguous: string[] } | null> {
  const scope = deps.scope();
  const live = await deps.service.listAnnotations(scope);
  if (live.length === 0) return null;

  if (explicitId) {
    return live.some((a) => a.id === explicitId) ? { id: explicitId } : null;
  }

  const said = phrase.toLowerCase();
  const wantsShape: AnnotationShape | null = /\bcircle|ring\b/.test(said)
    ? "circle"
    : /\bborder|box|rectangle|outline\b/.test(said)
      ? "rectangle"
      : null;

  if (wantsShape) {
    const matching = live.filter((a) => a.shape === wantsShape);
    if (matching.length === 1) return { id: matching[0].id };
    if (matching.length > 1) {
      // Newest wins only when the user said "the": two circles and no way to
      // tell them apart is a question, not a guess.
      return { ambiguous: matching.map((a) => a.id) };
    }
  }

  const remembered = rememberedId(deps, LAST_ENTITY);
  if (remembered && live.some((a) => a.id === remembered)) return { id: remembered };
  return live.length === 1 ? { id: live[0].id } : { ambiguous: live.map((a) => a.id) };
}

async function counts(
  deps: AnnotationExecutorDeps,
  scope: AnnotationScope,
): Promise<{ annotationCount: number; overlayCount: number; ids: string[] }> {
  const [live, census] = await Promise.all([
    deps.service.listAnnotations(scope),
    deps.service.annotationCensus(),
  ]);
  return {
    annotationCount: census.annotations,
    overlayCount: census.trackedWindows,
    ids: live.map((a) => a.id),
  };
}

// ---------------------------------------------------------------------------
// screen.annotate
// ---------------------------------------------------------------------------

export async function executeAnnotate(
  deps: AnnotationExecutorDeps,
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const id = "screen.annotate";
  const target = String(args.target ?? "").trim();
  if (!target) {
    return fail(id, startedAt, "What should I draw around?", "invalid-arguments");
  }
  const shape = (String(args.shape ?? "rectangle") as AnnotationShape) ?? "rectangle";

  // A pronoun is not a description of anything.
  //
  // The model passed `target: "that"` for "draw a border around the person on
  // the left", and the locator dutifully went looking for the word — which can
  // only fail. What the user meant is the thing already under discussion, so it
  // is resolved from memory; if there is nothing there, ask rather than search.
  const PRONOUN = /^(that|it|this|them|those|these|him|her|the one)$/i;
  if (PRONOUN.test(target)) {
    const known = rememberedId(deps, PERSON_ENTITY) ?? rememberedId(deps, LAST_ENTITY);
    if (!known) {
      return fail(
        id,
        startedAt,
        "What should I draw around?",
        "ambiguous-target",
      );
    }
    const live = await deps.service.listAnnotations(deps.scope());
    const existing = live.find((a) => a.id === known);
    if (existing) {
      // Already drawn. Returning it rather than drawing a second shape on the
      // same thing is the same rule the duplicate guard applies.
      const { annotationCount, overlayCount } = await counts(deps, deps.scope());
      return ok(id, startedAt, "That's already outlined.", {
        outcome: "success",
        annotationId: existing.id,
        annotationType: existing.shape,
        targetId: existing.targetId,
        parentTargetId: existing.parentTargetId ?? null,
        sourceWindowId: existing.sourceWindowId,
        monitorId: existing.monitorId,
        geometry: existing.geometry,
        style: existing.style,
        annotationCount,
        overlayCount,
      });
    }
    return fail(id, startedAt, "What should I draw around?", "ambiguous-target");
  }
  const colour = typeof args.colour === "string" ? args.colour : undefined;
  const scope = deps.scope();

  // "their face" is searched inside the person, never across the screen.
  //
  // An unrestricted face search picks whichever face the model likes best,
  // which for a photo of two people is a coin flip — and drawing a circle on
  // the wrong person's face after bordering the right one is the specific
  // failure this constraint exists to prevent.
  const parentId =
    typeof args.parent === "string" && args.parent
      ? args.parent
      : /\btheir|his|her|that person'?s\b/i.test(target)
        ? rememberedId(deps, PERSON_ENTITY)
        : null;

  let parent: Annotation | null = null;
  if (parentId) {
    const live = await deps.service.listAnnotations(scope);
    parent = live.find((a) => a.id === parentId) ?? null;
    if (!parent) {
      return fail(
        id,
        startedAt,
        "I've lost track of who you meant — tell me again which person.",
        "parent-gone",
      );
    }
  }

  const isFaceRequest = Boolean(parentId);

  // Photograph the window the picture is in, not the whole desktop.
  //
  // The first version captured the active display: 3840×1080 of desktop, other
  // windows and wallpaper, with the two figures a small fraction of it. Gemini
  // returned found=false at confidence 1.0 — a confident "not present" for
  // someone plainly on screen, because at that scale they nearly weren't.
  // Capturing the source window puts the subject back at a size the model can
  // actually see, and removes the surrounding interface it was told to ignore.
  const windowId = await deps.sourceWindowHint?.();
  const captured = windowId && deps.captureWindow
    ? await deps.captureWindow(windowId)
    : await deps.capture();
  if (captured.status !== "success") {
    return fail(
      id,
      startedAt,
      captured.summary || "I couldn't see the screen to draw on it.",
      "capture-failed",
    );
  }
  const context = frameContextFrom(captured.data as Record<string, unknown> | undefined);
  if (!context) {
    return fail(
      id,
      startedAt,
      "That screenshot didn't record which display it came from, so I won't draw on it.",
      "frame-ownership-missing",
    );
  }

  const dataUrl = await deps.dataUrl(context.frameId);
  // Capture sanity before the provider is blamed. A black or blank rectangle
  // produces exactly the same "couldn't find them" as a real miss.
  const capturePixels = inspectCapture(dataUrl);
  const trace: Record<string, unknown> = {
    at: new Date().toISOString(),
    requestedTarget: String(args.target ?? ""),
    resolvedTarget: target,
    locatorMode: isFaceRequest ? "face-within-parent" : "visual-content",
    imageAttached: dataUrl.length > 128,
    imageWidth: context.captureWidth,
    imageHeight: context.captureHeight,
    monitorId: context.displayId,
    promptCategory: "content-locator",
    captureNonEmptyRatio: capturePixels.nonEmptyRatio,
    captureMostlyBlack: capturePixels.mostlyBlack,
  };

  const detection = await deps.locate(
    dataUrl,
    target,
    parent
      ? // The search region, in the same normalised space the locator returns.
        normalisedRegion(parent, context)
      : undefined,
  );

  Object.assign(trace, {
    provider: detection.provider ?? "unknown",
    providerStatus: detection.providerStatus ?? "unknown",
    locatorFunction: detection.locatorFunction ?? "unknown",
    responseShape: detection.responseShape ?? [],
    candidateCount: detection.candidates ?? (detection.found ? 1 : 0),
    boxFormat: detection.found ? "box_2d-0-1000" : "none",
    confidence: detection.confidence ?? null,
    candidateCentresX: detection.centresX ?? [],
    selectedIndex: detection.found ? 0 : null,
    fallbackReason: detection.fallbackReason ?? null,
  });
  const emit = (reason: string | null) =>
    void deps.writeTrace?.({ ...trace, rejectionReason: reason });

  if (!detection.found) {
    emit(detection.providerStatus === "available" ? "no-candidates" : "provider-unavailable");
    return fail(
      id,
      startedAt,
      parent
        ? "I couldn't make out a face on that person, so I haven't drawn anything."
        : `I couldn't find ${target} on screen.`,
      "target-not-found",
    );
  }
  if (typeof detection.confidence === "number" && detection.confidence < MIN_CONFIDENCE) {
    emit("low-confidence");
    return fail(
      id,
      startedAt,
      `I'm not confident enough about which one is ${target} to draw around it.`,
      "low-confidence",
    );
  }
  if ((detection.candidates ?? 1) > 1 && !parent) {
    emit("ambiguous-target");
    return fail(
      id,
      startedAt,
      `There's more than one match for ${target} — which one do you mean?`,
      "ambiguous-target",
    );
  }

  const box = {
    x: detection.boxX ?? 0,
    y: detection.boxY ?? 0,
    width: detection.boxWidth ?? 0,
    height: detection.boxHeight ?? 0,
  };
  if (box.width <= 0 || box.height <= 0) {
    emit("empty-box");
    return fail(
      id,
      startedAt,
      `I could see roughly where ${target} is, but not a clear area to draw around.`,
      "undrawable",
    );
  }
  // The locator answers in a 0–`NORMALIZED_MAX` square, not in image pixels,
  // so the area is compared in that space. Comparing against the image's own
  // dimensions made the check meaningless at one scale and impossible at
  // another.
  const max = NORMALIZED_MAX * NORMALIZED_MAX * MAX_TARGET_AREA_FRACTION;
  if (box.width * box.height > max) {
    emit("box-covers-image");
    return fail(
      id,
      startedAt,
      `That would put a border around most of the picture rather than around ${target}.`,
      "target-too-large",
    );
  }

  const isFace = Boolean(parent);
  const targetId = isFace ? `face:${parent!.targetId}` : `person:${slug(target)}`;

  // Centre plus box, in the model's own normalised space. The mapping to
  // desktop pixels — including which monitor and any negative origin — is
  // `resolve_visual_target`'s job, not this file's.
  const geometry = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    normalizedMax: NORMALIZED_MAX,
    box,
    confidence: detection.confidence,
    label: detection.label ?? target,
  };

  const created = await deps.service.annotateResolved(scope, context, geometry, {
    requestId: deps.requestId(),
    targetId,
    parentTargetId: parent?.targetId,
    shape,
    colour,
  });

  if (!created.ok || !created.annotation) {
    emit(created.error ?? "native-refused");
    // Native said no. Reporting success here is the one thing this must never
    // do — the user would be told about a shape nobody can see.
    return fail(
      id,
      startedAt,
      created.message ?? "I couldn't draw that on screen.",
      created.error ?? "annotation-failed",
    );
  }

  const annotation = created.annotation;
  deps.memory.write(isFace ? FACE_ENTITY : PERSON_ENTITY, target, annotation.id, {
    shape: annotation.shape,
    parent: parent?.id ?? null,
  });
  deps.memory.write(LAST_ENTITY, target, annotation.id, { shape: annotation.shape });

  emit(null);
  const { annotationCount, overlayCount } = await counts(deps, scope);
  return ok(
    id,
    startedAt,
    isFace ? `Circled their face.` : `Drew a border around ${target}.`,
    {
      outcome: "success",
      annotationId: annotation.id,
      annotationType: annotation.shape,
      targetId: annotation.targetId,
      parentTargetId: annotation.parentTargetId ?? null,
      sourceWindowId: annotation.sourceWindowId,
      monitorId: annotation.monitorId,
      geometry: annotation.geometry,
      style: annotation.style,
      annotationCount,
      overlayCount,
    },
  );
}

/** A parent's box in the normalised space the locator speaks. */
function normalisedRegion(
  parent: Annotation,
  context: VisionFrameContext,
): { x: number; y: number; width: number; height: number } {
  // Desktop pixels back into the locator's normalised square. The parent's
  // geometry is in desktop coordinates because that is what Rust returned; the
  // locator only understands its own 0–1000 space.
  const scaleX = NORMALIZED_MAX / Math.max(context.captureWidth, 1);
  const scaleY = NORMALIZED_MAX / Math.max(context.captureHeight, 1);
  return {
    x: parent.geometry.x * scaleX,
    y: parent.geometry.y * scaleY,
    width: parent.geometry.width * scaleX,
    height: parent.geometry.height * scaleY,
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "target";
}

// ---------------------------------------------------------------------------
// screen.update_annotation
// ---------------------------------------------------------------------------

export async function executeUpdateAnnotation(
  deps: AnnotationExecutorDeps,
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const id = "screen.update_annotation";
  const scope = deps.scope();
  const explicit = typeof args.annotation_id === "string" ? args.annotation_id : null;
  const reference = await resolveAnnotationReference(
    deps,
    explicit,
    String(args.annotation_id ?? ""),
  );

  if (!reference) {
    return fail(id, startedAt, "There's nothing drawn to change.", "not-found");
  }
  if ("ambiguous" in reference) {
    return fail(
      id,
      startedAt,
      "There's more than one shape on screen — which should I change?",
      "ambiguous-annotation",
    );
  }

  const colour = typeof args.colour === "string" ? args.colour : undefined;
  const thickness = typeof args.thickness === "number" ? args.thickness : undefined;
  if (!colour && thickness === undefined) {
    return fail(id, startedAt, "What should I change about it?", "invalid-arguments");
  }

  const updated = await deps.service.updateAnnotation(scope, reference.id, { colour, thickness });
  if (!updated.ok || !updated.annotation) {
    return fail(
      id,
      startedAt,
      updated.message ?? "I couldn't change that.",
      updated.error ?? "update-failed",
    );
  }

  deps.memory.write(LAST_ENTITY, colour ? `${colour} shape` : "shape", updated.annotation.id, {
    shape: updated.annotation.shape,
  });
  const { annotationCount, overlayCount } = await counts(deps, scope);
  return ok(id, startedAt, colour ? `Made it ${colour}.` : "Updated it.", {
    outcome: "success",
    annotationId: updated.annotation.id,
    changedFields: [colour ? "colour" : null, thickness !== undefined ? "thickness" : null].filter(
      Boolean,
    ),
    style: updated.annotation.style,
    annotationCount,
    overlayCount,
  });
}

// ---------------------------------------------------------------------------
// screen.remove_annotation
// ---------------------------------------------------------------------------

export async function executeRemoveAnnotation(
  deps: AnnotationExecutorDeps,
  args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const id = "screen.remove_annotation";
  const scope = deps.scope();
  const explicit = typeof args.annotation_id === "string" ? args.annotation_id : null;
  const reference = await resolveAnnotationReference(
    deps,
    explicit,
    String(args.annotation_id ?? ""),
  );

  if (!reference) {
    return fail(id, startedAt, "There's nothing drawn to remove.", "not-found");
  }
  if ("ambiguous" in reference) {
    return fail(
      id,
      startedAt,
      "There's more than one shape on screen — which should I take off?",
      "ambiguous-annotation",
    );
  }

  const removed = await deps.service.removeAnnotation(scope, reference.id);
  if (!removed.ok) {
    return fail(
      id,
      startedAt,
      removed.message ?? "I couldn't remove that.",
      removed.error ?? "remove-failed",
    );
  }

  const { annotationCount, overlayCount, ids } = await counts(deps, scope);
  return ok(id, startedAt, "Taken off. The rest is still there.", {
    outcome: "success",
    removedAnnotationId: reference.id,
    remainingAnnotationIds: ids,
    annotationCount,
    overlayCount,
  });
}

// ---------------------------------------------------------------------------
// screen.clear_annotations
// ---------------------------------------------------------------------------

export async function executeClearAnnotations(
  deps: AnnotationExecutorDeps,
  _args: Record<string, unknown>,
  startedAt: string,
): Promise<ToolResult> {
  const id = "screen.clear_annotations";
  const scope = deps.scope();
  const before = await deps.service.listAnnotations(scope);
  const cleared = await deps.service.clearConversationAnnotations(scope.conversationId);
  const { annotationCount, overlayCount } = await counts(deps, scope);

  // The census is the assertion, not the count the clear returned: a manager
  // that reported three removals while a window survived is exactly the leak
  // this is here to catch.
  if (annotationCount !== 0 || overlayCount !== 0) {
    return fail(
      id,
      startedAt,
      "I cleared what I could, but something is still on screen.",
      "census-disagreement",
    );
  }

  return ok(
    id,
    startedAt,
    cleared > 0 ? "Cleared." : "There was nothing on screen to clear.",
    {
      outcome: "success",
      clearedAnnotationIds: before.map((a) => a.id),
      annotationCount: 0,
      overlayCount: 0,
    },
  );
}

/** Everything a follow-up might refer to, for the tests and the trace. */
export async function annotationReferences(deps: AnnotationExecutorDeps): Promise<{
  person: string | null;
  face: string | null;
  last: string | null;
  active: string[];
}> {
  const scope = deps.scope();
  const live = await deps.service.listAnnotations(scope);
  return {
    person: rememberedId(deps, PERSON_ENTITY),
    face: rememberedId(deps, FACE_ENTITY),
    last: rememberedId(deps, LAST_ENTITY),
    active: live.map((a) => a.id),
  };
}
