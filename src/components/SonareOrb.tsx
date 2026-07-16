/**
 * The ArcSonare orb: a calm, slowly breathing gradient sphere with a thin
 * rotating arc. Deliberately does not pulse like a recording indicator —
 * voice capture is not part of this phase.
 */
export function SonareOrb() {
  return (
    <div className="orb" aria-hidden="true">
      <div className="orb-core" />
      <div className="orb-arc" />
    </div>
  );
}
