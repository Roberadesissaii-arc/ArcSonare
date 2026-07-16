/**
 * The approved ArcSonare mark: an orbital intelligence symbol.
 * Two tilted elliptical orbits with a heavier lower-left sweep, one large
 * node on the upper-left and two smaller nodes on the right. Monochrome,
 * rounded caps, readable from 16px up. Uses `currentColor` so surfaces
 * choose the ink (#F4F6F8 on dark, #111419 on light).
 */

interface ArcSonareLogoProps {
  size?: number;
  /** Accessible name; omitted = decorative (aria-hidden). */
  title?: string;
}

export function ArcSonareLogo({ size = 48, title }: ArcSonareLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <g transform="rotate(-17 32 32)">
        {/* Outer orbit */}
        <ellipse
          cx="32"
          cy="32"
          rx="24"
          ry="13"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Inner orbit */}
        <ellipse
          cx="32"
          cy="32"
          rx="17"
          ry="8"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Heavier lower-left sweep of the outer orbit */}
        <path
          d="M24.58 44.36 A24 13 0 0 1 8.23 33.81"
          stroke="currentColor"
          strokeWidth="3.6"
          strokeLinecap="round"
        />
        {/* Primary node — upper left */}
        <circle cx="9.91" cy="26.92" r="4.4" fill="currentColor" />
        {/* Secondary nodes — right side */}
        <circle cx="52.35" cy="25.11" r="2.9" fill="currentColor" />
        <circle cx="45.4" cy="36.93" r="2.3" fill="currentColor" />
      </g>
    </svg>
  );
}
