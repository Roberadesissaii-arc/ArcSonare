import { ArcSonareLogo } from "../brand/ArcSonareLogo";

/**
 * The central system core: the approved orbital ArcSonare logo inside a
 * smoked-glass circular container, wrapped by a breathing violet ring, a
 * soft atmospheric halo, and two tiny connected orbital nodes. This is the
 * intelligence core — the glass marble orb is reserved for voice mode.
 */
export function ArcSonareCore() {
  return (
    <div className="arc-core" aria-hidden="true">
      <span className="arc-core-halo" />
      <span className="arc-core-ring" />
      <span className="arc-core-glass">
        <ArcSonareLogo size={46} />
      </span>
      {/* Tiny satellite nodes with thin arcs, integrated with the core. */}
      <svg className="arc-core-satellites" viewBox="0 0 120 120">
        <path
          d="M 12 74 A 50 50 0 0 1 28 26"
          fill="none"
          stroke="rgba(192,145,255,0.34)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M 108 46 A 50 50 0 0 1 96 90"
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="22" cy="38" r="3" fill="#c8b2f5" opacity="0.9" />
        <circle cx="103" cy="78" r="2.3" fill="#9aa19d" opacity="0.8" />
        <circle cx="60" cy="6.5" r="1.8" fill="rgba(255,255,255,0.5)" />
      </svg>
    </div>
  );
}
