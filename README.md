# ArcSonare — Sonare Desktop (Phase 2)

ArcSonare is a Windows desktop assistant. Phase 2 delivers the full desktop
shell: an edge-attached top overlay, a settings window, global-shortcut
customization, and a custom tray quick menu — all in a dark monochrome design.

No voice, microphone, AI, or automation functionality is included yet.

## Windows

| Label              | Purpose                                   | Shown by                                        |
| ------------------ | ----------------------------------------- | ----------------------------------------------- |
| `sonare-overlay`   | Top-edge capsule (logo, wave, shortcut)   | Global shortcut, tray, quick menu               |
| `sonare-settings`  | Settings (shortcut, startup, theme, …)    | Overlay gear button, tray menu, quick menu      |
| `sonare-quick-menu`| Custom tray popover                       | Left-clicking the tray icon                     |

All three are created hidden at launch and are only ever shown/hidden — never
destroyed — so exactly one instance of each exists. Closing any of them (even
Alt+F4) hides it; ArcSonare keeps running in the tray.

## Architecture

- **Rust** owns all native behavior and is the source of truth: the global
  shortcut (customizable; a new shortcut is registered *before* the old one is
  unregistered so a failure never loses the previous one), settings
  persistence (`%APPDATA%\com.arcsonare.desktop\settings.json`, validated on
  load), autostart (official `tauri-plugin-autostart`), monitor-aware
  positioning (DPI, negative coordinates, top-center/left/right), the tray,
  and the quick-menu placement near the notification area.
- **React + TypeScript** renders the three windows (routed by window label),
  runs the overlay animation state machine (`hidden → opening → visible →
  closing`), and edits settings through commands. Every settings change is
  broadcast to all windows via `sonare:settings-changed`.
- Design tokens live in `src/styles/tokens.css` (dark charcoal monochrome;
  light theme is a functional neutral variant; System follows Windows).

## Prerequisites

- Windows 10 or 11, Node.js 18+, Rust (stable MSVC), VS C++ Build Tools

## Commands

```powershell
npm install          # once
npm run tauri dev    # development (app starts hidden — check the tray)
npm run tauri build  # Windows installer -> src-tauri/target/release/bundle/nsis/
```

## Manual test checklist

1. Launch — no window appears; the tray icon does.
2. Press the global shortcut (default `Ctrl+Shift+Space`) — the capsule slides
   down from the top edge of the monitor under your cursor.
3. The overlay shows the ArcSonare logo, “● Ready”, the seven-bar wave, the
   current shortcut and a gear button; pressing the shortcut again hides it;
   Escape also hides it.
4. The gear opens Settings (General: Global Shortcut, Startup, Theme,
   Position, Sound). Escape or ✕ hides Settings.
5. “Change” records a new shortcut (needs a modifier); a rejected registration
   keeps the old shortcut and shows the error; the overlay hint updates
   immediately on success.
6. Startup, theme, position, sound, notification and motion preferences
   persist across restarts.
7. Left-clicking the tray icon opens the quick menu near the notification
   area; clicking elsewhere dismisses it; right-click shows the native menu.
8. Quit (tray or quick menu) fully exits.

## Known limitations (Phase 2)

- The **Fn key cannot be used as a shortcut** — it is handled by keyboard
  firmware and never reaches Windows, so no application can register it.
- “Check for updates”, “Send feedback” and “Help” honestly report that these
  arrive in a later phase — there is no update server yet.
- Tauri 2 does not expose `WS_EX_NOREDIRECTIONBITMAP`; in practice no white
  flash occurs because windows are created hidden and content loads first.
- The logo is a temporary vector mark, isolated in `SonareLogo.tsx` so the
  final ArcSonare character can replace it in one place.
