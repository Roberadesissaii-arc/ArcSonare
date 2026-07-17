/** Screen Context shared types (frontend side). */

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
  | "redact";

export interface ScreenAnnotation {
  id: string;
  tool: Exclude<AnnotationTool, "pointer">;
  color: string;
  thickness: number;
  /** Pen/highlighter: polyline; shapes: [start, end]. Image-pixel coords. */
  points: { x: number; y: number }[];
}

export interface ScreenContextPackage {
  id: string;
  createdAt: string;
  source: "active-window" | "monitor" | "multi-monitor" | "region";
  monitorIds: string[];
  activeWindowTitle?: string;
  originalImagePath?: string;
  annotatedImagePath?: string;
  cropBounds?: { x: number; y: number; width: number; height: number };
  annotations: ScreenAnnotation[];
  retentionPolicy: string;
}
