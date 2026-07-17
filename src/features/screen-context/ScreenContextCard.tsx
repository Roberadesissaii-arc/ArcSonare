import type { ReactNode } from "react";

interface ScreenContextCardProps {
  number: 1 | 2 | 3 | 4 | 5;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Shared smoked-titanium card for the Screen Context settings workspace. */
export function ScreenContextCard({
  number,
  title,
  description,
  action,
  children,
  className,
}: ScreenContextCardProps) {
  return (
    <section
      className={`screen-context-card${className ? ` ${className}` : ""}`}
    >
      <header className="screen-context-card-head">
        <div className="screen-context-card-title-row">
          <span className="screen-context-badge" aria-hidden="true">
            {number}
          </span>
          <div className="screen-context-card-titles">
            <h2 className="screen-context-card-title">{title}</h2>
            {description ? (
              <p className="screen-context-card-desc">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? (
          <div className="screen-context-card-action">{action}</div>
        ) : null}
      </header>
      <div className="screen-context-card-body">{children}</div>
    </section>
  );
}
