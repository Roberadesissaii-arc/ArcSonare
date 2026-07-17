interface SettingsStatusProps {
  message: string | null;
  tone?: "success" | "error" | "info";
}

/** Temporary inline status for immediate-save feedback. */
export function SettingsStatus({ message, tone = "info" }: SettingsStatusProps) {
  if (!message) return null;
  return (
    <p className={`settings-status settings-status-${tone}`} role="status">
      {message}
    </p>
  );
}
