/**
 * The ArcSonare mark: a flat monochrome circular sonar/eye symbol with thick
 * geometric strokes, small openings in the outer ring and a solid core.
 * Deliberately isolated so a custom ArcSonare character can replace it later.
 */

interface SonareLogoProps {
  size?: number;
}

export function SonareLogo({ size = 48 }: SonareLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      {/* Outer ring with two small openings */}
      <circle
        cx="24"
        cy="24"
        r="19"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="49.7 10"
        transform="rotate(-56 24 24)"
      />
      {/* Middle ring */}
      <circle cx="24" cy="24" r="10.5" stroke="currentColor" strokeWidth="3.4" />
      {/* Core */}
      <circle cx="24" cy="24" r="4" fill="currentColor" />
    </svg>
  );
}
