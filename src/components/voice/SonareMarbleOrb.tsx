import type { VoiceStatus } from "../../stores/voiceStore";

/** Character / accent tints for the glass marble (default = ArcSonare violet). */
export type MarbleTint = "violet" | "warm" | "blue" | "teal" | "rose";

interface SonareMarbleOrbProps {
  status?: VoiceStatus;
  size?: number;
  /** Optional accent for voice characters; defaults to violet. */
  tint?: MarbleTint;
}

/**
 * The ArcSonare AI orb: a luminous black-violet glass marble built from five
 * stacked layers — outer halo, glass sphere, incomplete luminous ring, dark
 * internal core and a curved upper-left glass highlight (see voice.css).
 * Never an eye, a planet, or a flat circle. Used for every voice surface.
 */
export function SonareMarbleOrb({
  status = "idle",
  size = 48,
  tint = "violet",
}: SonareMarbleOrbProps) {
  return (
    <span
      className={`marble-orb morb-${status} marble-tint-${tint}`}
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
