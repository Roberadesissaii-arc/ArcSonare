/**
 * Solid four-point intelligence sparkle for ArcSonare AI moments.
 */
interface SonareSparkleProps {
  size?: number;
  className?: string;
}

export function SonareSparkle({ size = 22, className }: SonareSparkleProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{
        filter: "drop-shadow(0 0 7px rgba(145, 104, 255, 0.36))",
      }}
    >
      <defs>
        <linearGradient id="sonareSparkleFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4B8FF" />
          <stop offset="45%" stopColor="#AA76FF" />
          <stop offset="100%" stopColor="#7042D0" />
        </linearGradient>
      </defs>
      <path
        d="M12 1.2C12.55 6.4 15.1 10.2 19.8 12C15.1 13.8 12.55 17.6 12 22.8C11.45 17.6 8.9 13.8 4.2 12C8.9 10.2 11.45 6.4 12 1.2Z"
        fill="url(#sonareSparkleFill)"
      />
    </svg>
  );
}
