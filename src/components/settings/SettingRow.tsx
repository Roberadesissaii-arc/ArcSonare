import type { ReactNode } from "react";

interface SettingRowProps {
  label: string;
  description?: string;
  children?: ReactNode;
  disabled?: boolean;
}

/** A standard settings row: label + optional description, control at right. */
export function SettingRow({
  label,
  description,
  children,
  disabled = false,
}: SettingRowProps) {
  return (
    <div className={`setting-row${disabled ? " is-disabled" : ""}`}>
      <div className="setting-meta">
        <div className="setting-label">{label}</div>
        {description ? (
          <div className="setting-desc">{description}</div>
        ) : null}
      </div>
      {children ? <div className="setting-control">{children}</div> : null}
    </div>
  );
}
