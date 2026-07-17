import type { ReactNode } from "react";

interface VoiceSettingsCardProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Shared smoked-titanium card for the Voice settings workspace. */
export function VoiceSettingsCard({
  icon,
  title,
  description,
  action,
  children,
  className,
}: VoiceSettingsCardProps) {
  return (
    <section className={`voice-settings-card${className ? ` ${className}` : ""}`}>
      <header className="voice-settings-card-head">
        <div className="voice-settings-card-title-row">
          <span className="voice-settings-icon-tile" aria-hidden="true">
            {icon}
          </span>
          <div className="voice-settings-card-titles">
            <h2 className="voice-settings-card-title">{title}</h2>
            {description ? (
              <p className="voice-settings-card-desc">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="voice-settings-card-action">{action}</div> : null}
      </header>
      <div className="voice-settings-card-body">{children}</div>
    </section>
  );
}
