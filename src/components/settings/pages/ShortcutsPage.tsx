import type { Settings } from "../../../types";
import { shortcutKeys } from "../../../services/shortcutFormat";
import { SettingRow } from "../SettingRow";
import { ShortcutRecorder } from "../ShortcutRecorder";

interface ShortcutsPageProps {
  settings: Settings;
}

/** Future per-command shortcuts, shown honestly as not yet available. */
const UPCOMING_COMMANDS = [
  { label: "Ask ArcSonare", description: "Start a voice request instantly." },
  { label: "Repeat last action", description: "Run the previous command again." },
  { label: "Dictation", description: "Type anywhere with your voice." },
];

export function ShortcutsPage({ settings }: ShortcutsPageProps) {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Shortcuts</h1>
        <p className="page-subtitle">
          Open ArcSonare and, later, trigger commands from the keyboard.
        </p>
      </header>

      <SettingRow
        label="Show ArcSonare"
        description="The global shortcut that opens the overlay."
      >
        <ShortcutRecorder shortcut={settings.globalShortcut} />
      </SettingRow>

      <h2 className="section-heading">Command shortcuts</h2>
      {UPCOMING_COMMANDS.map((command) => (
        <SettingRow
          key={command.label}
          label={command.label}
          description={command.description}
          disabled
        >
          <span className="badge-muted">Coming later</span>
        </SettingRow>
      ))}

      <p className="field-help">
        Current shortcut:{" "}
        {shortcutKeys(settings.globalShortcut).join(" + ")}. Command shortcuts
        arrive with Sonare Voice in a later phase.
      </p>
    </div>
  );
}
