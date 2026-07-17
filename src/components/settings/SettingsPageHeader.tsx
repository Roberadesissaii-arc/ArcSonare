import type { ReactNode } from "react";

interface SettingsPageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

/** Content-area title + one-sentence description for every Settings section. */
export function SettingsPageHeader({
  title,
  description,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <header className="settings-page-header page-header">
      <div className="settings-page-header-text">
        <h1 className="page-title settings-page-title">{title}</h1>
        <p className="page-subtitle settings-page-subtitle">{description}</p>
      </div>
      {actions ? <div className="settings-page-header-actions">{actions}</div> : null}
    </header>
  );
}
