import type { ReactNode } from "react";
import { SettingsCard } from "./SettingsCard";

interface SettingsGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
}

/** @deprecated Prefer SettingsCard — kept as a thin alias for existing pages. */
export function SettingsGroup({ title, description, children, footer, icon }: SettingsGroupProps) {
  return (
    <SettingsCard title={title} description={description} footer={footer} icon={icon}>
      {children}
    </SettingsCard>
  );
}
