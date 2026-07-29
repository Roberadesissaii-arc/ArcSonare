import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  compact?: boolean;
  children?: ReactNode;
}

/** Shared quiet placeholder: a bare icon, concise title, and supporting copy. */
export function EmptyState({
  icon,
  title,
  description,
  compact = false,
  children,
}: EmptyStateProps) {
  return (
    <div className={`sonare-empty-state${compact ? " is-compact" : ""}`}>
      <span className="sonare-empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="sonare-empty-state-title">{title}</p>
      <p className="sonare-empty-state-text">{description}</p>
      {children ? <div className="sonare-empty-state-actions">{children}</div> : null}
    </div>
  );
}
