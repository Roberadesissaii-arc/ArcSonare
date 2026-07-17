interface SettingsPageHeaderProps {
  title: string;
  description: string;
}

/** Content-area title + one-sentence description for every Settings section. */
export function SettingsPageHeader({ title, description }: SettingsPageHeaderProps) {
  return (
    <header className="settings-page-header page-header">
      <h1 className="page-title settings-page-title">{title}</h1>
      <p className="page-subtitle settings-page-subtitle">{description}</p>
    </header>
  );
}
