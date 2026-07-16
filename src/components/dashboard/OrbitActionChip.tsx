import type { ComponentType, CSSProperties } from "react";

interface OrbitActionChipProps {
  icon: ComponentType<{ size?: number }>;
  label: string;
  status: string;
  style?: CSSProperties;
}

/** Floating smoked-titanium capsule attached to an orbit point. */
export function OrbitActionChip({ icon: Icon, label, status, style }: OrbitActionChipProps) {
  return (
    <div className="orbit-chip" style={style}>
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
