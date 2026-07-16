import type { VoiceStatus } from "../../stores/voiceStore";

interface SonareMarbleOrbProps {
  status?: VoiceStatus;
  size?: number;
}

/**
 * The ArcSonare AI orb: a luminous black-violet glass marble built from five
 * stacked layers — outer halo, glass sphere, incomplete luminous ring, dark
 * internal core and a curved upper-left glass highlight (see voice.css).
 * Never an eye, a planet, or a flat circle. Used for every voice surface.
 */
export function SonareMarbleOrb({ status = "idle", size = 48 }: SonareMarbleOrbProps) {
  return (
    <span
      className={`marble-orb morb-${status}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="morb-halo" />
      <span className="morb-sphere" />
      <span className="morb-ring" />
      <span className="morb-core" />
      <span className="morb-highlight" />
    </span>
  );
}
