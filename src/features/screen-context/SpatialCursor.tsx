/** ArcSonare spatial cursor companion — decorative, never replaces the system cursor. */
export function SpatialCursor({ x, y }: { x: number; y: number }) {
  return (
    <span
      className="spatial-cursor"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      aria-hidden="true"
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path
          d="M5 3.5L5 22.5L11.2 16.8L15.8 24.2L18.6 22.6L14 15.2L21.5 15.2L5 3.5Z"
          fill="#F7F8FA"
          stroke="rgba(149,101,255,0.95)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="20.5" cy="20.5" r="3.2" fill="rgba(149,101,255,0.35)" stroke="#C49CFF" strokeWidth="1" />
      </svg>
    </span>
  );
}
