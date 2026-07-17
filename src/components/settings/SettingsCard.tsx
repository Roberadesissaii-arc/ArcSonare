import type { ReactNode } from "react";

interface SettingsCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "compact";
  disabled?: boolean;
  status?: ReactNode;
  className?: string;
}

/**
 * Smoked-titanium settings card: title, description, divider, rows.
 * Equal-height friendly for two-column grids (`align-items: stretch`).
 */
export function SettingsCard({
  title,
  description,
  icon,
  children,
  footer,
  size = "default",
  disabled = false,
  status,
  className = "",
}: SettingsCardProps) {
  return (
    <section
      className={`settings-card settings-group${size === "compact" ? " is-compact" : ""}${
        disabled ? " is-disabled" : ""
      } ${className}`.trim()}
      aria-disabled={disabled || undefined}
    >
      <div className="settings-card-shine" aria-hidden="true" />
      <div className="settings-group-head">
        <div className="settings-card-title-row">
          {icon ? <span className="settings-card-icon">{icon}</span> : null}
          <h2 className="settings-group-title">{title}</h2>
        </div>
        {description ? <p className="settings-group-desc">{description}</p> : null}
        {status ? <div className="settings-card-status">{status}</div> : null}
      </div>
      <div className="settings-group-body">{children}</div>
      {footer ? <div className="settings-card-footer">{footer}</div> : null}
    </section>
  );
}
