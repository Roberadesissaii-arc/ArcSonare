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
import type { AnnotationTool, ScreenAnnotation } from "./types";

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
    // Stale requests (>5 min) are ignored.
    if (Date.now() - parsed.at > 5 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  a: ScreenAnnotation,
  glow: boolean,
) {
  if (a.points.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = a.thickness;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  if (glow && a.tool !== "redact" && a.tool !== "highlighter") {
    ctx.shadowColor = "rgba(165, 118, 255, 0.55)";
    ctx.shadowBlur = 7;
  }
  const [first] = a.points;
  const last = a.points[a.points.length - 1];

  switch (a.tool) {
    case "pen": {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case "highlighter": {
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = Math.max(a.thickness * 5, 14);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case "rectangle": {
      ctx.strokeRect(
        Math.min(first.x, last.x),
        Math.min(first.y, last.y),
        Math.abs(last.x - first.x),
        Math.abs(last.y - first.y),
      );
      break;
    }
    case "redact": {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0A0D12";
      ctx.fillRect(
        Math.min(first.x, last.x),
        Math.min(first.y, last.y),
        Math.abs(last.x - first.x),
        Math.abs(last.y - first.y),
      );
      break;
    }
    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(
        (first.x + last.x) / 2,
        (first.y + last.y) / 2,
        Math.abs(last.x - first.x) / 2,
        Math.abs(last.y - first.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      const angle = Math.atan2(last.y - first.y, last.x - first.x);
      const head = Math.max(12, a.thickness * 4);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - head * Math.cos(angle - Math.PI / 6),
        last.y - head * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - head * Math.cos(angle + Math.PI / 6),
        last.y - head * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Fullscreen annotation surface inside the `sonare-annotate` window: the
 * frozen capture, a compact floating toolbar and vector drawing. Confirm
 * stores the annotated PNG + a local context package; no model analyzes
 * anything — the completion message says so explicitly.
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

  // Load the capture image.
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

  // Redraw on every change.
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
    // Slight dim so annotations pop without obscuring content.
    ctx.fillStyle = "rgba(5, 9, 12, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const a of annotations) drawAnnotation(ctx, a, true);
    if (draft) drawAnnotation(ctx, draft, true);
  }, [annotations, draft, imageReady]);

  // Keyboard: Escape cancels, Ctrl+Z / Ctrl+Y undo/redo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      else if (e.ctrlKey && e.key.toLowerCase() === "z") undo();
      else if (e.ctrlKey && e.key.toLowerCase() === "y") redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancel, annotations, redoStack]);

  const toCanvasPoint = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "pointer" || !imageReady) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e);
    setDraft({
      id: `ann-${Date.now().toString(36)}`,
      tool: tool as ScreenAnnotation["tool"],
      color: tool === "redact" ? "#0A0D12" : color,
      thickness: annotationPrefs.thickness,
      points: [p, p],
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = toCanvasPoint(e);
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.tool === "pen" || prev.tool === "highlighter") {
        return { ...prev, points: [...prev.points, p] };
      }
      return { ...prev, points: [prev.points[0], p] };
    });
  };

  const onPointerUp = () => {
    if (!draft) return;
    setAnnotations((prev) => [...prev, draft]);
    setRedoStack([]);
    setDraft(null);
  };

  const undo = () => {
    setAnnotations((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setAnnotations((a) => [...a, last]);
      return prev.slice(0, -1);
    });
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

      // Region mode: the last rectangle becomes the crop bounds.
      const lastRect = [...annotations]
        .reverse()
        .find((a) => a.tool === "rectangle");
      const cropBounds =
        pending.mode === "region" && lastRect
          ? {
              x: Math.round(Math.min(lastRect.points[0].x, lastRect.points[1].x)),
              y: Math.round(Math.min(lastRect.points[0].y, lastRect.points[1].y)),
              width: Math.round(Math.abs(lastRect.points[1].x - lastRect.points[0].x)),
              height: Math.round(Math.abs(lastRect.points[1].y - lastRect.points[0].y)),
            }
          : undefined;

      savePackage({
        id: pending.captureId,
        createdAt: new Date().toISOString(),
        source: pending.mode === "region" ? "region" : "monitor",
        monitorIds: [],
        cropBounds,
        annotations,
        retentionPolicy: getPrefs().screenContext.privacy.retention,
      });
      playEventSound("annotation-confirmed");
      // Tell the main window (separate webview) about the new package.
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

  const tools: { id: AnnotationTool; label: string; icon: React.ReactNode; enabled: boolean }[] = [
    { id: "pointer", label: "Pointer", icon: <CursorIcon size={15} />, enabled: true },
    { id: "pen", label: "Freehand pen", icon: <PenIcon size={15} />, enabled: annotationPrefs.pen },
    { id: "rectangle", label: "Rectangle", icon: <SquareIcon size={15} />, enabled: annotationPrefs.rectangle },
    { id: "ellipse", label: "Ellipse", icon: <CircleIcon size={15} />, enabled: annotationPrefs.ellipse },
    { id: "arrow", label: "Arrow", icon: <ArrowUpRightIcon size={15} />, enabled: annotationPrefs.arrow },
    { id: "highlighter", label: "Highlighter", icon: <HighlighterIcon size={15} />, enabled: annotationPrefs.highlighter },
    { id: "redact", label: "Redact", icon: <BlurIcon size={15} />, enabled: annotationPrefs.redact },
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
          <button type="button" className="annotate-tool" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={annotations.length === 0}>
            <UndoIcon size={15} />
          </button>
          <button type="button" className="annotate-tool" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={redo} disabled={redoStack.length === 0}>
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
          <button type="button" className="annotate-tool annotate-cancel" aria-label="Cancel" title="Cancel (Esc)" onClick={cancel}>
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
