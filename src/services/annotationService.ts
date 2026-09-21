/**
 * The frontend's view of the annotation manager.
 *
 * Thin on purpose: every decision — identity, ownership, lifecycle, the window
 * pool — lives in `src-tauri/src/annotations`. This is the boundary that
 * converts a resolved visual target into desktop geometry and carries the scope
 * along, so an annotation can never be created without one.
 *
 * Resolution is the existing path (`resolve_visual_target_cmd`), unchanged: the
 * model reports a box in its own normalised space, Rust maps it to desktop
 * pixels for the right monitor including negative origins, and nothing here
 * does coordinate arithmetic.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  resolveVisualTarget,
  type ModelGeometry,
  type VisionFrameContext,
} from "./visualTarget";

export type AnnotationShape = "highlight" | "rectangle" | "circle" | "arrow" | "label";

export type AnnotationLifecycle = "active" | "hidden" | "stale" | "removed";

export interface AnnotationGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: string;
  accountId: string;
  conversationId: string;
  requestId: string;
  sourceProcessId: number;
  sourceWindowId: string;
  monitorId: string;
  targetId: string;
  parentTargetId?: string;
  shape: AnnotationShape;
  geometry: AnnotationGeometry;
  style: { colour: string; thickness: number; opacity: number; text?: string | null };
  zIndex: number;
  lifecycle: AnnotationLifecycle;
  createdAt: number;
  updatedAt: number;
  temporary: boolean;
}

export interface AnnotationScope {
  accountId: string;
  conversationId: string;
}

export interface AnnotationResult {
  ok: boolean;
  annotation?: Annotation;
  error?: string;
  message?: string;
}

export interface AnnotationCensus {
  annotations: number;
  active: number;
  hidden: number;
  stale: number;
  trackedWindows: number;
  nativeWindows: number;
  conversations: number;
}

/**
 * Resolve a box the model found, then draw a shape around it.
 *
 * Resolution and drawing are one call because they must not drift: a box
 * resolved against one frame and drawn after another capture is a shape around
 * the wrong thing.
 */
export async function annotateResolved(
  scope: AnnotationScope,
  context: VisionFrameContext,
  geometry: ModelGeometry,
  options: {
    requestId: string;
    targetId: string;
    parentTargetId?: string;
    shape: AnnotationShape;
    colour?: string;
    sourceWindowId?: string;
    sourceProcessId?: number;
  },
): Promise<AnnotationResult> {
  const resolved = await resolveVisualTarget(context, geometry);
  if (!resolved.boxRect) {
    // A point with no extent is not something to draw around. Saying so beats
    // inventing a box of arbitrary size around a guessed centre.
    return {
      ok: false,
      error: "undrawable",
      message: "I could see roughly where that is, but not a clear area to draw around.",
    };
  }

  return invoke<AnnotationResult>("annotation_create", {
    request: {
      accountId: scope.accountId,
      conversationId: scope.conversationId,
      requestId: options.requestId,
      sourceProcessId: options.sourceProcessId ?? 0,
      sourceWindowId: options.sourceWindowId ?? "",
      monitorId: String(resolved.displayId),
      targetId: options.targetId,
      parentTargetId: options.parentTargetId,
      shape: options.shape,
      geometry: {
        x: resolved.boxRect.x,
        y: resolved.boxRect.y,
        width: resolved.boxRect.width,
        height: resolved.boxRect.height,
      },
      style: options.colour ? { colour: options.colour } : {},
      temporary: true,
    },
  });
}

export function updateAnnotation(
  scope: AnnotationScope,
  id: string,
  change: { colour?: string; thickness?: number; geometry?: AnnotationGeometry },
): Promise<AnnotationResult> {
  return invoke<AnnotationResult>("annotation_update", { id, scope, change });
}

export function removeAnnotation(
  scope: AnnotationScope,
  id: string,
): Promise<AnnotationResult> {
  return invoke<AnnotationResult>("annotation_remove", { id, scope });
}

export function listAnnotations(scope: AnnotationScope): Promise<Annotation[]> {
  return invoke<Annotation[]>("annotation_list", { scope });
}

/** Annotations on one target, newest first — how "the circle" is resolved. */
export function annotationsForTarget(
  scope: AnnotationScope,
  targetId: string,
): Promise<Annotation[]> {
  return invoke<Annotation[]>("annotation_by_target", { scope, targetId });
}

export function clearConversationAnnotations(conversationId: string): Promise<number> {
  return invoke<number>("annotation_clear_conversation", { conversationId });
}

export function clearAllTemporaryAnnotations(): Promise<number> {
  return invoke<number>("annotation_clear_all_temporary");
}

export function annotationCensus(): Promise<AnnotationCensus> {
  return invoke<AnnotationCensus>("annotation_census");
}
