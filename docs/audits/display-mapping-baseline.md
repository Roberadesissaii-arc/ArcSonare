# Display Mapping & Interaction — Baseline and Audit

**Status:** Phase 0 (baseline) and Phase 1 (audit) complete. Phases 2–24 not implemented.
**Date:** 2026-07-31

---

## 1. Baseline

| Item | Value |
| --- | --- |
| Repository | `C:\Users\rober\Desktop\ArcSonare` |
| Branch | `master` |
| HEAD | `a8c17873d68b7b87d4a31a75274ed07759a36641` |
| Last commit | `a8c1787 Fix Gmail connection bug, voice sync, Agent/Tasks page layout issues` |
| Working tree | **Dirty** — 139 modified, 895 deleted, 99 untracked |
| OS | Windows 11 Pro 10.0.26200 |
| Framework | Tauri 2 (Rust) + React 19 + TypeScript + Vite |
| Package manager | npm |
| Capture library | `xcap` (Rust) |
| Input | Raw `user32` FFI — `SetCursorPos`, `mouse_event`, `keybd_event`, `SendInput` |
| Overlay | Native Win32 layered windows (`src-tauri/src/native_overlay.rs`) |
| Vision | Gemini (`gemini-2.5-flash`) primary, OpenAI vision fallback |
| Build | `npm run tauri build` · Typecheck `npx tsc --noEmit` · Rust `cargo test --lib` |

### Working-tree risk

The tree contains a large amount of uncommitted work unrelated to display mapping
(Google Docs/Gmail write APIs, web grounding, spatial context, voice fixes). The
895 deletions are bulk `ICO/` asset removals from an earlier cleanup.

**`src-tauri/src/native_overlay.rs` is untracked and has never been committed.**
It is ~700 lines of Win32 code with no version-control safety net. It was
truncated once during this session and rebuilt by hand. Committing it should
precede any further work in that file.

No destructive Git commands were run. No commit was made.

---

## 2. Current pipeline

```
xcap::Monitor capture
  -> storage::CaptureMeta { width, height, monitor_ids }   [origin NOT stored]
  -> capture_origin(meta)  -- reconstructs origin from the LIVE monitor list
  -> get_capture_data_url(id) -> PNG data URL              [no transform record]
  -> geminiLocateClickTarget(dataUrl, target)
  -> box_2d [ymin,xmin,ymax,xmax] normalised 0..1000
  -> box2dToPixels(box, imageWidth, imageHeight)
  -> clickPointFromDetection(..., originX, originY)
  -> pointAndClick -> input.click_at -> SetCursorPos + mouse_event
```

---

## 3. Confirmed root causes

### RC1 — The process never declares DPI awareness *(confirmed, highest impact)*

A repository-wide search for `dpiAware`, `PerMonitorV2`, `SetProcessDpiAwareness`
and `dpi_aware` across `src-tauri/` returns **nothing**. No manifest, no
initialisation call, no Tauri config entry.

Without Per-Monitor-V2, Windows virtualises coordinates for a non-aware or
System-DPI-aware process. `SetCursorPos`, `GetCursorPos` and `GetSystemMetrics`
then operate in a scaled coordinate space that does not match the physical
pixels `xcap` reports. On a mixed-scaling setup the click lands offset by the
ratio between the two displays' scale factors, and the offset grows with
distance from the origin — which matches the reported symptom that borders and
clicks are "not that much accurate".

**Affected:** process startup, `capabilities/input.rs`, `native_overlay.rs`,
`agent_pointer.rs`, `screenshots.rs`.

### RC2 — Capture origin is reconstructed by guessing, after the fact *(confirmed)*

`src-tauri/src/capabilities/screenshots.rs::capture_origin` — the doc comment
states the problem outright: *"CaptureMeta records which monitors were captured
but not their position, so resolve it from the live monitor list."*

Three fallbacks, in order:

1. Match by monitor id.
2. **Match by image size** — with two monitors at the same resolution this
   selects an arbitrary one. Wrong-display clicks by construction.
3. Otherwise assume the whole virtual desktop.

It also resolves against the **live** monitor list at read time, not the
topology at capture time. Any change between capture and click silently
produces a wrong origin.

### RC3 — Origin falls back to the monitor under the mouse *(confirmed)*

`src/features/capabilities/frontendExecutors.ts` — when `captureOrigin` is
absent it calls `input.mouse_monitor_bounds`, i.e. the monitor under the
**cursor**, not the one that was captured. An in-code comment records that this
used to run unconditionally. If the user moves the mouse between capture and
click, the result maps to the wrong screen.

### RC4 — No model-image transform is recorded anywhere *(confirmed)*

Nothing captures `resizeMode`, `scaleX/scaleY`, crop offsets or padding. Today
this is survivable for the coarse path only because Gemini returns `box_2d`
normalised 0–1000, which is resize-invariant.

It is **already broken** for the crop path added this session:
`get_capture_region_data_url` crops with a hardcoded 24px margin and returns the
crop with **no transform record**, so a coordinate found in that crop cannot be
mapped back to the desktop. Any coarse-to-fine targeting will be wrong.

### RC5 — One overlay window spans the whole virtual desktop *(confirmed)*

`native_overlay.rs` creates the draw overlay at
`GetSystemMetrics(SM_CXVIRTUALSCREEN/SM_CYVIRTUALSCREEN)` — a single window
across all monitors, inheriting one DPI context. The pointer and highlight
windows are positioned in virtual-desktop physical pixels but are likewise not
display-bound. There is no per-display overlay and no `displayId` anywhere in
the overlay API.

### RC6 — No display topology service *(confirmed)*

There is no stable display identity, no fingerprint, no topology version, no
change listener, no persisted profile, and no validation. Displays are resolved
ad hoc via `xcap::Monitor::all()` at each call site. `input.mouse_monitor_bounds`
and `system.list_displays` are separate, unrelated readers.

Consequently a frame cannot be bound to a display, and no code can detect that
the topology changed between capture and action.

### RC7 — Click executor performs no validation *(confirmed)*

`capabilities/input.rs::click_at` calls `SetCursorPos` then `mouse_event`. There
is no check that the point is finite, inside the intended display, or that the
frame is still current. `SetCursorPos` expects physical virtual-desktop
coordinates, which is correct *only* under Per-Monitor-V2 — see RC1.

### Suspected, not confirmed

- **Rotation is never handled.** No rotation term appears in any transform. The
  portrait display is currently at rotation 0, so this is latent rather than
  active.
- **Capture resolution is assumed equal to physical resolution.**
  `box2dToPixels` maps normalised coordinates against the *image* dimensions and
  the result is treated as display-physical. Untested where they differ.

---

## 4. Why prior fixes did not resolve it

Two accuracy fixes were made earlier in this session — a column-strip rejection
in `visionCoords.ts` and a confidence gate in `frontendExecutors.ts`. Both
address the *model choosing the wrong object*. Neither touches the coordinate
transformation, which is where RC1–RC3 live. That is consistent with the
report that accuracy is still poor after those changes.

---

## 5. Files that will require modification

| File | Reason |
| --- | --- |
| `src-tauri/tauri.conf.json` / build manifest | Declare Per-Monitor-V2 (RC1) |
| `src-tauri/src/capabilities/screenshots.rs` | Store origin/topology at capture (RC2) |
| `src-tauri/src/screen_context/capture.rs` | Frame metadata, crop transform (RC4) |
| `src-tauri/src/capabilities/input.rs` | Validated executor (RC7) |
| `src-tauri/src/native_overlay.rs` | Per-display overlays (RC5) |
| `src/services/visionCoords.ts` | Typed coordinate spaces (Phase 2) |
| `src/features/capabilities/frontendExecutors.ts` | Remove mouse-origin fallback (RC3) |
| *new* display topology service (Rust) | RC6 |
| *new* canonical coordinate mapper | Phases 2/6 |

---

## 6. Recommended order

RC1 first — it is a one-line-of-configuration change with the largest single
effect, and every measurement taken before it is fixed is untrustworthy. Then
RC2/RC3 (bind frames to a display at capture time), then the topology service,
then the mapper, then the wizard.

Building the configuration wizard before RC1–RC3 would calibrate against a
moving target and bake the error into a saved profile.
