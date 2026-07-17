interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** Soft violet fading trail behind the spatial cursor companion. */
export function CursorTrail({ points }: { points: TrailPoint[] }) {
  if (points.length < 2) return null;
  const now = points[points.length - 1]?.t ?? Date.now();
  return (
    <svg className="cursor-trail" aria-hidden="true">
      {points.map((p, i) => {
        const age = Math.min(1, (now - p.t) / 450);
        const opacity = (1 - age) * 0.55;
        const size = 5 - age * 3.5;
        if (opacity <= 0.02) return null;
        return (
          <circle
            key={`${p.t}-${i}`}
            cx={p.x}
            cy={p.y}
            r={Math.max(1.2, size)}
            fill={`rgba(149, 101, 255, ${opacity})`}
          />
        );
      })}
    </svg>
  );
}
