import type { ComponentType } from "react";

interface OrbitActionChipProps {
  icon: ComponentType<{ size?: number }>;
  label: string;
  status: string;
  /** True when the chip travels an orbit path inside the map SVG. */
  orbiting?: boolean;
}

/** Floating smoked-titanium capsule attached to an orbit point. */
export function OrbitActionChip({
  icon: Icon,
  label,
  status,
  orbiting,
}: OrbitActionChipProps) {
  return (
    <div className={`orbit-chip${orbiting ? " orbit-chip-orbiting" : ""}`}>
      <span className="orbit-chip-icon">
        <Icon size={14} />
      </span>
      <span className="orbit-chip-texts">
        <span className="orbit-chip-label">{label}</span>
        <span className="orbit-chip-status">{status}</span>
      </span>
    </div>
  );
}
