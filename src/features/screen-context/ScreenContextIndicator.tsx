import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { usePrefs } from "../../stores/settingsStore";
import { listMonitors } from "./screenContextStore";
import { SpatialCursor } from "./SpatialCursor";
import { CursorTrail } from "./CursorTrail";
import type { MonitorInfo } from "./types";

interface CursorSample {
  timestamp: number;
  virtualX: number;
  virtualY: number;
  buttons: { left: boolean; right: boolean; middle: boolean };
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/**
 * Rendered inside each `sonare-edge-*` window: violet perimeter, corner
 * brackets, optional label, and a click-through spatial cursor companion with
 * a short fading trail. The native window never intercepts input.
 */
export function ScreenContextIndicator() {
  const prefs = usePrefs();
  const sc = prefs.screenContext;
  const alpha = Math.max(0.2, Math.min(1, sc.edgeIntensity / 100));
  const monitorId = useMemo(() => {
    const label = getCurrentWindow().label;
    return label.startsWith("sonare-edge-") ? label.slice("sonare-edge-".length) : "";
  }, []);

  const [monitor, setMonitor] = useState<MonitorInfo | null>(null);
  const [local, setLocal] = useState<{ x: number; y: number } | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [dwell, setDwell] = useState(false);
  const lastMoveRef = useRef(0);
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    listMonitors()
      .then((mons) => setMonitor(mons.find((m) => m.id === monitorId) ?? null))
      .catch(() => setMonitor(null));
  }, [monitorId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<CursorSample>("sonare:cursor-sample", (event) => {
      const sample = event.payload;
      if (!monitor) return;
      const onThis =
        sample.virtualX >= monitor.x &&
        sample.virtualX < monitor.x + monitor.width &&
        sample.virtualY >= monitor.y &&
        sample.virtualY < monitor.y + monitor.height;
      if (!onThis) {
        setLocal(null);
        setDwell(false);
        return;
      }
      const x = sample.virtualX - monitor.x;
      const y = sample.virtualY - monitor.y;
      setLocal({ x, y });
      lastMoveRef.current = sample.timestamp;
      if (sc.cursorTrailEnabled !== false && !reducedMotion) {
        setTrail((prev) => {
          const next = [...prev, { x, y, t: sample.timestamp }];
          const cutoff = sample.timestamp - 480;
          return next.filter((p) => p.t >= cutoff).slice(-16);
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [monitor, sc.cursorTrailEnabled, reducedMotion]);

  // Pointer dwell focus pulse (~650ms stationary).
  useEffect(() => {
    if (!local || reducedMotion) {
      setDwell(false);
      return;
    }
    const id = window.setInterval(() => {
      setDwell(Date.now() - lastMoveRef.current > 650);
    }, 120);
    return () => window.clearInterval(id);
  }, [local, reducedMotion]);

  // Fade trail even when stationary.
  useEffect(() => {
    if (reducedMotion || sc.cursorTrailEnabled === false) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setTrail((prev) => prev.filter((p) => now - p.t < 480));
    }, 50);
    return () => window.clearInterval(id);
  }, [reducedMotion, sc.cursorTrailEnabled]);

  const showCompanion = sc.cursorCompanionEnabled !== false && local;

  return (
    <div
      className={`edge-root edge-style-${sc.edgeStyle}`}
      style={{ "--edge-alpha": alpha } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="edge-line edge-top" />
      <span className="edge-line edge-bottom" />
      <span className="edge-line edge-left" />
      <span className="edge-line edge-right" />
      <span className="edge-corner edge-tl" />
      <span className="edge-corner edge-tr" />
      <span className="edge-corner edge-bl" />
      <span className="edge-corner edge-br" />
      <span className="edge-glow" />
      {sc.showLabel ? (
        <span className="edge-label">ArcSonare Screen Context</span>
      ) : null}
      {showCompanion && local ? (
        <>
          {sc.cursorTrailEnabled !== false && !reducedMotion ? (
            <CursorTrail points={trail} />
          ) : null}
          <SpatialCursor x={local.x} y={local.y} />
          {dwell ? (
            <span
              className="spatial-dwell"
              style={{ transform: `translate(${local.x}px, ${local.y}px)` }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
