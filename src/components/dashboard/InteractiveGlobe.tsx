import { useCallback, useEffect, useRef } from "react";

interface InteractiveGlobeProps {
  /** Canvas CSS size in pixels. */
  size?: number;
  className?: string;
  autoRotateSpeed?: number;
  /** Faster spin + active rim when voice / system is busy. */
  active?: boolean;
  /** Pause auto-rotation (chip hover, reduced motion, etc.). */
  paused?: boolean;
}

const DOT = "rgba(168, 176, 186, ALPHA)";

function motionPausedGlobal(): boolean {
  return (
    document.documentElement.classList.contains("reduce-motion") ||
    Boolean(document.querySelector(".app-shell.app-paused")) ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Canvas dotted globe for the orbital command map core.
 * Dots only — no arcs, markers, or traveling “thought” nodes.
 */
export function InteractiveGlobe({
  size = 168,
  className = "",
  autoRotateSpeed = 0.002,
  active = false,
  paused = false,
}: InteractiveGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotYRef = useRef(0.45);
  const rotXRef = useRef(0.28);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startRotY: 0,
    startRotX: 0,
  });
  const animRef = useRef(0);
  const timeRef = useRef(0);
  const dotsRef = useRef<[number, number, number][]>([]);
  const activeRef = useRef(active);
  const pausedRef = useRef(paused);
  const speedRef = useRef(autoRotateSpeed);

  activeRef.current = active;
  pausedRef.current = paused;
  speedRef.current = autoRotateSpeed;

  useEffect(() => {
    const dots: [number, number, number][] = [];
    const numDots = 980;
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    for (let i = 0; i < numDots; i++) {
      const theta = (2 * Math.PI * i) / goldenRatio;
      const phi = Math.acos(1 - (2 * (i + 0.5)) / numDots);
      dots.push([
        Math.cos(theta) * Math.sin(phi),
        Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
      ]);
    }
    dotsRef.current = dots;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) {
      animRef.current = requestAnimationFrame(draw);
      return;
    }

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;
    const fov = 520;
    const isActive = activeRef.current;
    const halt = pausedRef.current || motionPausedGlobal();

    if (!dragRef.current.active && !halt) {
      const base = speedRef.current * (isActive ? 2.4 : 1);
      rotYRef.current += base;
    }

    if (!halt) timeRef.current += isActive ? 0.028 : 0.012;
    const time = timeRef.current;

    ctx.clearRect(0, 0, w, h);

    // Clip everything to a circle so the canvas never shows a square edge.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.08, 0, Math.PI * 2);
    ctx.clip();

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius * 1.05);
    glow.addColorStop(0, isActive ? "rgba(145, 110, 255, 0.07)" : "rgba(145, 110, 255, 0.03)");
    glow.addColorStop(1, "rgba(145, 110, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = isActive
      ? `rgba(194, 155, 255, ${0.14 + Math.sin(time * 3) * 0.06})`
      : "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const ry = rotYRef.current;
    const rx = rotXRef.current;

    for (const dot of dotsRef.current) {
      let [x, y, z] = dot;
      x *= radius;
      y *= radius;
      z *= radius;

      // rotateX
      {
        const cos = Math.cos(rx);
        const sin = Math.sin(rx);
        const ny = y * cos - z * sin;
        const nz = y * sin + z * cos;
        y = ny;
        z = nz;
      }
      // rotateY
      {
        const cos = Math.cos(ry);
        const sin = Math.sin(ry);
        const nx = x * cos + z * sin;
        const nz = -x * sin + z * cos;
        x = nx;
        z = nz;
      }

      if (z > 0) continue;

      const scale = fov / (fov + z);
      const sx = x * scale + cx;
      const sy = y * scale + cy;
      const depthAlpha = Math.max(0.12, 1 - (z + radius) / (2 * radius));
      const pulse = isActive ? 1 + Math.sin(time * 4 + x) * 0.08 : 1;
      const dotSize = (0.85 + depthAlpha * 0.85) * pulse;

      ctx.beginPath();
      ctx.arc(sx, sy, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = DOT.replace("ALPHA", (depthAlpha * (isActive ? 1.15 : 1)).toFixed(2));
      ctx.fill();
    }

    ctx.restore();

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startRotY: rotYRef.current,
      startRotX: rotXRef.current,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    rotYRef.current = dragRef.current.startRotY + dx * 0.005;
    rotXRef.current = Math.max(
      -1,
      Math.min(1, dragRef.current.startRotX + dy * 0.005),
    );
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`interactive-globe${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      width={size}
      height={size}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      aria-label="Interactive ArcSonare globe — drag to rotate"
      role="img"
    />
  );
}
