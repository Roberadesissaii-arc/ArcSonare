import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  ArrowUpRightIcon,
  BlurIcon,
  CheckIcon,
  CircleIcon,
  CloseIcon,
  CursorIcon,
  HighlighterIcon,
  PenIcon,
  RedoIcon,
  SquareIcon,
  TrashIcon,
  UndoIcon,
} from "../../components/Icons";
import { getPrefs, usePrefs } from "../../stores/settingsStore";
import { playEventSound } from "../../services/SoundService";
import { PENDING_ANNOTATION_KEY, savePackage } from "./screenContextStore";
import { focusRegionsFromAnnotations } from "./focusRegions";
import type {
  AnnotationTool,
  Point,
  ScreenAnnotation,
} from "./types";

const COLORS = ["#A576FF", "#FFFFFF", "#E56C73", "#E7AD54", "#59D999", "#6696E4"];

interface Pending {
  captureId: string;
  mode: "annotate" | "region";
}

function readPending(): Pending | null {
  try {
    const raw = window.localStorage.getItem(PENDING_ANNOTATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending & { at: number };
    if (Date.now() - parsed.at > 5 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function boundsFromPoints(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  a: ScreenAnnotation,
  glow: boolean,
) {
  ctx.save();
  if (a.type !== "blur" && a.type !== "redact" && a.type !== "focus-point") {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = a.style.strokeWidth;
    ctx.strokeStyle = a.style.color;
    ctx.fillStyle = a.style.color;
    ctx.globalAlpha = a.style.opacity;
    if (glow && a.type !== "highlighter") {
      ctx.shadowColor = "rgba(165, 118, 255, 0.55)";
      ctx.shadowBlur = 7;
    }
  }

  switch (a.type) {
    case "freehand": {
      if (a.points.length === 0) break;
      ctx.beginPath();
      ctx.moveTo(a.points[0].x, a.points[0].y);
      for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case "highlighter": {
      if (a.points.length === 0) break;
      ctx.globalAlpha = Math.min(0.4, a.style.opacity);
      ctx.lineWidth = Math.max(a.style.strokeWidth * 5, 14);
      ctx.beginPath();
      ctx.moveTo(a.points[0].x, a.points[0].y);
      for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case "rectangle": {
      ctx.strokeRect(a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height);
      break;
    }
    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(
        a.bounds.x + a.bounds.width / 2,
        a.bounds.y + a.bounds.height / 2,
        a.bounds.width / 2,
        a.bounds.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(a.start.x, a.start.y);
      ctx.lineTo(a.end.x, a.end.y);
      ctx.stroke();
      const angle = Math.atan2(a.end.y - a.start.y, a.end.x - a.start.x);
      const head = Math.max(12, a.style.strokeWidth * 4);
      ctx.beginPath();
      ctx.moveTo(a.end.x, a.end.y);
      ctx.lineTo(
        a.end.x - head * Math.cos(angle - Math.PI / 6),
        a.end.y - head * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(a.end.x, a.end.y);
      ctx.lineTo(
        a.end.x - head * Math.cos(angle + Math.PI / 6),
        a.end.y - head * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }
    case "redact": {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0A0D12";
      ctx.fillRect(a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height);
      break;
    }
    case "blur": {
      // Approximate privacy blur as a frosted violet-tinted block in-export.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = "rgba(18, 22, 30, 0.82)";
      ctx.fillRect(a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height);
      ctx.strokeStyle = "rgba(149, 101, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height);
      break;
    }
    case "focus-point": {
      ctx.strokeStyle = "rgba(149, 101, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.point.x, a.point.y, a.radius, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Fullscreen annotation surface inside the `sonare-annotate` window.
 * Stores structured vector annotations separately from the exported PNG.
 */
export function ScreenAnnotationCanvas() {
  const prefs = usePrefs();
  const annotationPrefs = prefs.screenContext.annotation;
  const pending = useMemo(readPending, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<AnnotationTool>(
    pending?.mode === "region" ? "rectangle" : "pen",
  );
  const [color, setColor] = useState(annotationPrefs.color || "#A576FF");
  const [annotations, setAnnotations] = useState<ScreenAnnotation[]>([]);
  const [redoStack, setRedoStack] = useState<ScreenAnnotation[]>([]);
  const [draft, setDraft] = useState<ScreenAnnotation | null>(null);
  const [busy, setBusy] = useState(false);
  const draftStart = useRef<Point | null>(null);

  const close = useCallback(() => {
    invoke("close_annotation").catch(() => undefined);
  }, []);

  const cancel = useCallback(() => {
    const retention = getPrefs().screenContext.privacy.retention;
    if (pending && (retention === "none" || !getPrefs().dataPrivacy.storeCaptures)) {
      invoke("delete_capture", { id: pending.captureId }).catch(() => undefined);
    }
    close();
  }, [pending, close]);

  useEffect(() => {
    if (!pending) {
      setError("No pending capture was found for annotation.");
      return;
    }
    invoke<string>("get_capture_data_url", {
      id: pending.captureId,
      annotated: false,
    })
      .then((dataUrl) => {
        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          setImageReady(true);
        };
        img.onerror = () => setError("The capture image could not be loaded.");
        img.src = dataUrl;
      })
      .catch((err) =>
        setError(typeof err === "string" ? err : "The capture could not be loaded."),
      );
  }, [pending]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageReady) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = "rgba(5, 9, 12, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const a of annotations) drawAnnotation(ctx, a, true);
    if (draft) drawAnnotation(ctx, draft, true);
  }, [annotations, draft, imageReady]);

  const undo = useCallback(() => {
    setAnnotations((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setAnnotations((a) => [...a, last]);
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      else if (e.ctrlKey && e.key.toLowerCase() === "z") undo();
      else if (e.ctrlKey && e.key.toLowerCase() === "y") redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, undo, redo]);

  const toCanvasPoint = (e: React.PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const style = () => ({
    color: tool === "redact" ? "#0A0D12" : color,
    strokeWidth: annotationPrefs.thickness,
    opacity: 1,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "pointer" || !imageReady) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e);
    draftStart.current = p;
    const createdAt = new Date().toISOString();
    const id = `ann-${Date.now().toString(36)}`;
    switch (tool) {
      case "pen":
        setDraft({ id, type: "freehand", points: [p], style: style(), createdAt });
        break;
      case "highlighter":
        setDraft({ id, type: "highlighter", points: [p], style: style(), createdAt });
        break;
      case "rectangle":
        setDraft({
          id,
          type: "rectangle",
          bounds: { x: p.x, y: p.y, width: 0, height: 0 },
          style: style(),
          createdAt,
        });
        break;
      case "ellipse":
        setDraft({
          id,
          type: "ellipse",
          bounds: { x: p.x, y: p.y, width: 0, height: 0 },
          style: style(),
          createdAt,
        });
        break;
      case "arrow":
        setDraft({ id, type: "arrow", start: p, end: p, style: style(), createdAt });
        break;
      case "blur":
        setDraft({
          id,
          type: "blur",
          bounds: { x: p.x, y: p.y, width: 0, height: 0 },
          blurRadius: 12,
          createdAt,
        });
        break;
      case "redact":
        setDraft({
          id,
          type: "redact",
          bounds: { x: p.x, y: p.y, width: 0, height: 0 },
          createdAt,
        });
        break;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft || !draftStart.current) return;
    const p = toCanvasPoint(e);
    const start = draftStart.current;
    setDraft((prev) => {
      if (!prev) return prev;
      switch (prev.type) {
        case "freehand":
        case "highlighter":
          return { ...prev, points: [...prev.points, p] };
        case "rectangle":
        case "ellipse":
        case "blur":
        case "redact":
          return { ...prev, bounds: boundsFromPoints(start, p) };
        case "arrow":
          return { ...prev, end: p };
        default:
          return prev;
      }
    });
  };

  const onPointerUp = () => {
    if (!draft) return;
    setAnnotations((prev) => [...prev, draft]);
    setRedoStack([]);
    setDraft(null);
    draftStart.current = null;
  };

  const confirm = async () => {
    if (!pending || !canvasRef.current || busy) return;
    setBusy(true);
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      await invoke("save_annotated_capture", {
        id: pending.captureId,
        pngBase64: base64,
      });

      const img = imageRef.current;
      const width = img?.naturalWidth ?? 0;
      const height = img?.naturalHeight ?? 0;
      const lastRect = [...annotations]
        .reverse()
        .find((a) => a.type === "rectangle");
      const cropBounds =
        pending.mode === "region" && lastRect && lastRect.type === "rectangle"
          ? { ...lastRect.bounds }
          : undefined;

      const privacy = getPrefs().screenContext.privacy;
      savePackage({
        id: pending.captureId,
        createdAt: new Date().toISOString(),
        source: pending.mode === "region" ? "region" : "monitor",
        monitorIds: [],
        capture: {
          width,
          height,
          scaleFactor: 1,
          format: "png",
          annotatedImagePath: undefined,
        },
        region: cropBounds,
        annotations,
        focusRegions: focusRegionsFromAnnotations(annotations, width, height),
        privacy: {
          localOnly: privacy.localOnly,
          cloudConsentRequired: getPrefs().screenContext.askBeforeCloud,
          cloudConsentGranted: false,
          retentionPolicy: privacy.retention,
        },
        modelStatus: "not-configured",
      });
      playEventSound("annotation-confirmed");
      await emit("sonare:context-captured", {
        captureId: pending.captureId,
        message: "Screen context captured. Model analysis is not configured yet.",
      }).catch(() => undefined);
      close();
    } catch (err) {
      setError(typeof err === "string" ? err : "The annotation could not be saved.");
      setBusy(false);
    }
  };

  const tools: {
    id: AnnotationTool;
    label: string;
    icon: React.ReactNode;
    enabled: boolean;
  }[] = [
    { id: "pointer", label: "Pointer", icon: <CursorIcon size={15} />, enabled: true },
    { id: "pen", label: "Freehand pen", icon: <PenIcon size={15} />, enabled: annotationPrefs.pen },
    {
      id: "rectangle",
      label: "Rectangle",
      icon: <SquareIcon size={15} />,
      enabled: annotationPrefs.rectangle,
    },
    {
      id: "ellipse",
      label: "Ellipse",
      icon: <CircleIcon size={15} />,
      enabled: annotationPrefs.ellipse,
    },
    {
      id: "arrow",
      label: "Arrow",
      icon: <ArrowUpRightIcon size={15} />,
      enabled: annotationPrefs.arrow,
    },
    {
      id: "highlighter",
      label: "Highlighter",
      icon: <HighlighterIcon size={15} />,
      enabled: annotationPrefs.highlighter,
    },
    {
      id: "blur",
      label: "Blur",
      icon: <BlurIcon size={15} />,
      enabled: annotationPrefs.redact,
    },
    {
      id: "redact",
      label: "Redact",
      icon: <BlurIcon size={15} />,
      enabled: annotationPrefs.redact,
    },
  ];

  return (
    <div className="annotate-root">
      {error ? (
        <div className="annotate-error">
          <p>{error}</p>
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="annotate-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

      {annotationPrefs.showToolbar && !error ? (
        <div className="annotate-toolbar" role="toolbar" aria-label="Annotation tools">
          {pending?.mode === "region" ? (
            <span className="annotate-hint">Draw a rectangle around the region</span>
          ) : null}
          {tools
            .filter((t) => t.enabled)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`annotate-tool${tool === t.id ? " active" : ""}`}
                aria-label={t.label}
                title={t.label}
                aria-pressed={tool === t.id}
                onClick={() => setTool(t.id)}
              >
                {t.icon}
              </button>
            ))}
          <span className="annotate-divider" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`annotate-color${color === c ? " active" : ""}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
          <span className="annotate-divider" />
          <button
            type="button"
            className="annotate-tool"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={annotations.length === 0}
          >
            <UndoIcon size={15} />
          </button>
          <button
            type="button"
            className="annotate-tool"
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            onClick={redo}
            disabled={redoStack.length === 0}
          >
            <RedoIcon size={15} />
          </button>
          <button
            type="button"
            className="annotate-tool"
            aria-label="Clear all annotations"
            title="Clear"
            onClick={() => {
              setAnnotations([]);
              setRedoStack([]);
            }}
            disabled={annotations.length === 0}
          >
            <TrashIcon size={15} />
          </button>
          <span className="annotate-divider" />
          <button
            type="button"
            className="annotate-tool annotate-cancel"
            aria-label="Cancel"
            title="Cancel (Esc)"
            onClick={cancel}
          >
            <CloseIcon size={15} />
          </button>
          <button
            type="button"
            className="annotate-tool annotate-confirm"
            aria-label="Confirm"
            title="Confirm"
            onClick={() => void confirm()}
            disabled={busy || !imageReady}
          >
            <CheckIcon size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
