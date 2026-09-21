import type { ReactNode } from "react";

interface SettingsPageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

/**
 * Section header inside the right content card.
 * Matches Arceclaw tab headers: 16px bold title + 12px muted subtitle.
 */
export function SettingsPageHeader({
  title,
  description,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <header className="settings-page-header page-header">
      <div className="settings-page-header-text">
        <h2 className="page-title settings-page-title">{title}</h2>
        <p className="page-subtitle settings-page-subtitle">{description}</p>
      </div>
      {actions ? <div className="settings-page-header-actions">{actions}</div> : null}
    </header>
  );
}
