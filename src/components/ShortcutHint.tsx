interface ShortcutHintProps {
  keys: string[];
}

export function ShortcutHint({ keys }: ShortcutHintProps) {
  return (
    <div className="shortcut-hint" aria-label={`Shortcut: ${keys.join(" + ")}`}>
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </div>
  );
}
