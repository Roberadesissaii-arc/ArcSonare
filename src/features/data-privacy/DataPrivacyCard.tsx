import type { ReactNode } from "react";

export function DataPrivacyCard({
  title,
  description,
  children,
  className = "",
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`data-privacy-card ${className}`.trim()}>
      <header className="data-privacy-card-head">
        <div>
          <h2 className="data-privacy-card-title">{title}</h2>
          {description ? (
            <p className="data-privacy-card-desc">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="data-privacy-card-actions">{actions}</div> : null}
      </header>
      <div className="data-privacy-card-body">{children}</div>
    </section>
  );
}
