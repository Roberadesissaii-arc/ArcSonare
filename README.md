# ArcSonare — Command Center (Phase 3)

ArcSonare is a voice-first AI operating environment for Windows. Phase 3
turns the settings-only utility into a full desktop Command Center: a main
native window with Dashboard, Tasks, Agent and Connect, an in-app voice
console, an orbital command map, a command composer, and a Ctrl+K palette —
all in the smoked-titanium design language with the orbital ArcSonare mark.

No real microphone, AI model, or OAuth integration is connected yet. Voice
states are a clearly-local simulation; tasks, activity and agent toggles are
local state (persisted to `localStorage`); integrations honestly show
“Not connected / Coming soon”.

## Windows

| Label               | Purpose                                     | Shown by                                     |
| ------------------- | ------------------------------------------- | -------------------------------------------- |
| `main`              | Command Center (Dashboard/Tasks/Agent/Connect/Settings) | Launch, tray quick menu, second app launch |
| `sonare-overlay`    | Top-edge voice capsule                      | Global shortcut (when main is not focused)   |
| `sonare-quick-menu` | Custom tray popover                         | Left-clicking the tray icon                  |

Settings is a page inside the main window (header gear, tray "Settings" and
the quick menu all show the main window and navigate to it) — there is no
separate settings window.

Windows are only ever shown/hidden — never destroyed. Closing the main
window (red traffic light, Alt+F4) hides ArcSonare to the tray; only
**Quit ArcSonare** exits.

## Global shortcut routing

- Main window visible **and** focused → the shortcut toggles the in-app
  voice console (`sonare:voice-toggle` event).
- Otherwise → the shortcut toggles the top-screen overlay, as before.
- Both surfaces share the voice-state store and design tokens.

## Architecture

- **Rust** owns all native behavior: global shortcut (register-new-before-
  unregister-old), settings persistence (`%APPDATA%\com.arcsonare.desktop`),
  autostart, monitor-aware positioning, tray, and window show/hide commands
  (`panels.rs`).
- **React + TypeScript** renders the four windows routed by label
  (`App.tsx`). Main-window state lives in small `useSyncExternalStore`
  stores (`src/stores/`): `voiceStore` (shared voice states), `taskStore`
  (persisted tasks), `appStore` (page, palette, activity log).
- Design tokens: `src/styles/tokens.css` (smoked titanium — graphite
  surfaces, restrained violet AI accent). The orbital logo is
  `src/components/brand/ArcSonareLogo.tsx`; app icons were generated from it
  (`src-tauri/icons`).
- Icon mapping: `src/config/iconRegistry.ts`. Integration logos were
  extracted from the local `ICO/` library (highest-resolution PNG frame)
  into `src/assets/icons/integrations/` and keep their brand colors.

## Commands

```powershell
npm install          # once
npm run tauri dev    # development — opens the Command Center
npm run tauri build  # Windows installer -> src-tauri/target/release/bundle/nsis/
```

## Known limitations (Phase 3)

- Voice is simulated (listening → processing → speaking) — no microphone.
- Up Next events, Focus card, agents and connected tools are demo data
  (`src/data/demoData.ts`); tasks marked “Demo” were seeded once.
- Command submissions are recorded to the local activity log only.
- The ICO library has no Asana or Microsoft Calendar icon, so those two
  integrations are not listed.
- The Fn key cannot be a shortcut (keyboard firmware).
