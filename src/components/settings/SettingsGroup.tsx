import type { ReactNode } from "react";

interface SettingsGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** A refined smoked-titanium section card grouping related settings rows. */
export function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <section className="settings-group">
      <div className="settings-group-head">
        <h2 className="settings-group-title">{title}</h2>
        {description ? (
          <p className="settings-group-desc">{description}</p>
        ) : null}
      </div>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
