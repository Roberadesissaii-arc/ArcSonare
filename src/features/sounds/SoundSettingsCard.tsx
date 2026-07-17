import type { ReactNode } from "react";

interface SoundSettingsCardProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

/** Shared smoked-titanium card for the Sounds settings workspace. */
export function SoundSettingsCard({
  icon,
  title,
  description,
  children,
  className,
  action,
}: SoundSettingsCardProps) {
  return (
    <section className={`sound-settings-card${className ? ` ${className}` : ""}`}>
      <header className="sound-settings-card-head">
        <div className="sound-settings-card-title-row">
          <span className="sound-settings-icon-tile" aria-hidden="true">
            {icon}
          </span>
          <div className="sound-settings-card-titles">
            <h2 className="sound-settings-card-title">{title}</h2>
            {description ? (
              <p className="sound-settings-card-desc">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="sound-settings-card-action">{action}</div> : null}
      </header>
      <div className="sound-settings-card-body">{children}</div>
    </section>
  );
}
