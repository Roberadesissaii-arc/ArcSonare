# ArcSonare — Sonare Desktop (Phase 1)

ArcSonare is a Windows desktop assistant. Phase 1 delivers the **Sonare Desktop**
overlay: a background application with a system tray icon and a global keyboard
shortcut that summons a floating capsule at the top-center of the active monitor.

No voice, microphone, AI, or automation functionality is included in this phase.

## How it works

- **Rust** (`src-tauri/src/`) owns all native behavior: the global shortcut
  (`Ctrl + Shift + Space`), the system tray, monitor-aware positioning, and
  showing/hiding the single overlay window. It is the source of truth for the
  overlay's open/closed state.
- **React + TypeScript** (`src/`) owns only the visuals and the animation state
  machine (`hidden → opening → visible → closing`). Rust emits `sonare:open` /
  `sonare:close` events; the frontend animates and, after the closing animation
  finishes, calls the `overlay_hidden` command so Rust hides the native window.
  The window is never destroyed — it is reused for every open.
- `tauri-plugin-single-instance` ensures launching ArcSonare a second time just
  opens the overlay in the already-running instance instead of starting a
  duplicate process.

## Prerequisites

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://rustup.rs/) (stable, MSVC toolchain)
- Microsoft Visual Studio C++ Build Tools (Desktop development with C++)
- WebView2 Runtime (preinstalled on Windows 10/11)

## Setup

```powershell
npm install
```

## Development

```powershell
npm run tauri dev
```

This starts Vite and launches the native app. The app starts **hidden** — look
for the ArcSonare icon in the system tray, then press **Ctrl + Shift + Space**.

## Production build (Windows)

```powershell
npm run tauri build
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis/`, and
the standalone executable to `src-tauri/target/release/arcsonare.exe`.

## Manual test checklist

1. Launch the app — no normal desktop window appears.
2. An ArcSonare icon appears in the system tray.
3. Press `Ctrl + Shift + Space` while another app (e.g. Chrome) is focused —
   the overlay slides in at the top-center of the monitor under your cursor.
4. The overlay has no title bar and no taskbar entry, and stays on top.
5. Press `Ctrl + Shift + Space` again — the overlay animates out and hides.
6. Spam the shortcut rapidly — the animation stays consistent and only one
   window ever exists.
7. Click the ✕ button — the overlay hides.
8. Press `Escape` while the overlay is focused — it hides.
9. Tray menu → *Show ArcSonare* / *Hide ArcSonare* work; double-clicking the
   tray icon opens the overlay.
10. Tray menu → *Quit ArcSonare* fully terminates the process.
11. Launching the app a second time does not start a second instance; it opens
    the overlay in the running one.

## Error handling notes

- If `Ctrl + Shift + Space` is already registered by another application,
  ArcSonare logs an error and keeps running; the tray still opens the overlay.
- If the cursor's monitor can't be determined, the primary monitor is used,
  then the window's current monitor as a last resort.
- Show/hide/positioning failures are logged (`RUST_LOG=debug` for more detail)
  and never crash the app.

## Known limitations (Phase 1)

- Tauri 2 does not expose the Win32 `WS_EX_NOREDIRECTIONBITMAP` flag
  (`noRedirectionBitmap`) in its window configuration. Because the window is
  created hidden and its content loads before the first show, the classic
  transparent-window white flash does not occur in practice.
- The tray icon is a temporary generated ArcSonare orb; replace
  `app-icon.png` and re-run `npx tauri icon app-icon.png` to update branding.
