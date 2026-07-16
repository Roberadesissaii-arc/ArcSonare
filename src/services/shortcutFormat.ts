/**
 * Helpers for turning stored shortcut strings ("Ctrl+Shift+Space",
 * "Ctrl+Alt+KeyA") into display-friendly key labels.
 */

const SPECIAL_LABELS: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Del",
  Escape: "Esc",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Insert: "Ins",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  super: "Win",
  meta: "Win",
  cmd: "Win",
  command: "Win",
};

export function keyLabel(token: string): string {
  const modifier = MODIFIER_LABELS[token.toLowerCase()];
  if (modifier) return modifier;
  if (token.startsWith("Key") && token.length === 4) return token.slice(3);
  if (token.startsWith("Digit") && token.length === 6) return token.slice(5);
  if (token.startsWith("Numpad")) return `Num ${token.slice(6)}`;
  return SPECIAL_LABELS[token] ?? token;
}

/** "Ctrl+Shift+Space" -> ["Ctrl", "Shift", "Space"] */
export function shortcutKeys(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(keyLabel);
}

/** "Ctrl+Alt+KeyA" -> "Ctrl + Alt + A" */
export function shortcutDisplay(shortcut: string): string {
  return shortcutKeys(shortcut).join(" + ");
}
