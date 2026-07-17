/** Screen Context shared types (frontend side). */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationStyle {
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

/** Richer monitor descriptor used by Capture Target cards. */
export type MonitorDescriptor = MonitorInfo & {
  selected: boolean;
  physicalPosition: { x: number; y: number };
  physicalSize: { width: number; height: number };
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  refreshRate?: number;
};

export interface CaptureMeta {
  id: string;
  createdAt: number;
  source: string;
  monitorIds: string[];
  activeWindowTitle: string | null;
  width: number;
  height: number;
  annotated: boolean;
}

export type AnnotationTool =
  | "pointer"
  | "pen"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "highlighter"
  | "blur"
  | "redact";

export type ScreenAnnotation =
  | {
      id: string;
      type: "freehand";
      points: Point[];
      style: AnnotationStyle;
      createdAt: string;
    }
  | {
      id: string;
      type: "rectangle";
      bounds: Bounds;
      style: AnnotationStyle;
      createdAt: string;
    }
  | {
      id: string;
      type: "ellipse";
      bounds: Bounds;
      style: AnnotationStyle;
      createdAt: string;
    }
  | {
      id: string;
      type: "arrow";
      start: Point;
      end: Point;
      style: AnnotationStyle;
      createdAt: string;
    }
  | {
      id: string;
      type: "highlighter";
      points: Point[];
      style: AnnotationStyle;
      createdAt: string;
    }
  | {
      id: string;
      type: "blur";
      bounds: Bounds;
      blurRadius: number;
      createdAt: string;
    }
  | {
      id: string;
      type: "redact";
      bounds: Bounds;
      createdAt: string;
    }
  | {
      id: string;
      type: "focus-point";
      point: Point;
      radius: number;
      createdAt: string;
    };

export type ScreenContextModelStatus =
  | "not-requested"
  | "not-configured"
  | "waiting-for-consent"
  | "processing"
  | "completed"
  | "error";

export interface ScreenContextPackage {
  id: string;
  createdAt: string;
  source:
    | "active-window"
    | "monitor"
    | "multi-monitor"
    | "entire-desktop"
    | "region";
  monitorIds: string[];
  activeWindow?: {
    title?: string;
    processName?: string;
    applicationId?: string;
    bounds?: Bounds;
  };
  capture: {
    originalImagePath?: string;
    annotatedImagePath?: string;
    thumbnailPath?: string;
    width: number;
    height: number;
    scaleFactor: number;
    format: "png" | "webp";
  };
  region?: Bounds;
  pointer?: {
    point: Point;
    normalizedPoint: Point;
  };
  annotations: ScreenAnnotation[];
  focusRegions: Bounds[];
  userRequest?: {
    transcript?: string;
    text?: string;
  };
  privacy: {
    localOnly: boolean;
    cloudConsentRequired: boolean;
    cloudConsentGranted: boolean;
    retentionPolicy: string;
    expiresAt?: string;
  };
  modelStatus: ScreenContextModelStatus;
  modelResult?: {
    provider?: string;
    model?: string;
    summary?: string;
    createdAt?: string;
  };
}

/** Map annotation tool id → structured annotation `type`. */
export function toolToAnnotationType(
  tool: Exclude<AnnotationTool, "pointer">,
): ScreenAnnotation["type"] {
  if (tool === "pen") return "freehand";
  return tool;
}
