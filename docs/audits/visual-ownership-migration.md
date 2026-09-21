# Production Visual Ownership Migration

**Date:** 2026-07-31
**Branch:** `master` · **HEAD at start:** `a8c17873d68b7b87d4a31a75274ed07759a36641`
**Scope:** the contiguous change from "work out afterwards which monitor this
screenshot came from" to "the display is chosen first and travels with the
frame". Follows [planner-integration.md](planner-integration.md).

---

## 1. What was wrong, precisely

`CaptureMeta` recorded a screenshot's *size* but not its *position*, so
`capture_origin()` reconstructed the origin afterwards by matching image
dimensions against the live monitor list. Two monitors at the same resolution
made that a coin flip. When it produced nothing usable, `frontendExecutors.ts`
fell back to `input.mouse_monitor_bounds` — the monitor under the **cursor** —
as the coordinate origin for an image captured from some other monitor. The
final model-coordinate → desktop-pixel conversion then happened in TypeScript,
in `clickPointFromDetection`, with that origin added on.

Three independent ways to be confidently wrong about which screen you are
looking at. All three are now gone.

## 2. The shape it has now

```
requested display
  → DisplayTopology (one read, version-stamped)
  → xcap monitor matched by stable identity, geometry cross-checked
  → capture
  → CapturedFrame { frame_id, display_id, topology_version, bounds, crop }
  → registered in the process-wide VisualRuntime
  → frame_id + display_id + topology_version returned to TypeScript
  → model returns geometry only, in its own 0–1000 space
  → buildVisualTarget() attaches ownership from the capture, not the model
  → resolve_visual_target() in Rust: frame → display → desktop pixels
  → native overlay / cursor / click
```

TypeScript never computes a desktop coordinate and never invents a frame id.

---

## 3. Status

| Item | Status |
| --- | --- |
| Production FrameRegistry state | COMPLETE |
| Production display selection before capture | COMPLETE |
| Production CapturedFrame registration | COMPLETE |
| Capture metadata returned to TypeScript | COMPLETE |
| Frame ownership propagated through model request | COMPLETE |
| VisualTarget constructed from authoritative context | COMPLETE |
| `capture_origin` active call sites removed | COMPLETE |
| Resolution-matching origin inference removed | COMPLETE |
| Monitor-under-mouse ownership removed | COMPLETE |
| Primary-monitor visual fallback removed | COMPLETE |
| Canonical resolver exposed to production | COMPLETE |
| Overlay integration | COMPLETE |
| Cursor integration | COMPLETE |
| Cursor-position verification | COMPLETE |
| Click integration | COMPLETE |
| Post-click verification | PARTIAL |
| Frame freshness protection | PARTIAL |
| Visual migration gate opened | COMPLETE |
| Planner visual execution connected | PARTIAL |
| Same-resolution production test | COMPLETE |
| Negative-origin production test | COMPLETE |
| Missing-frame rejection | COMPLETE |
| Expired-frame rejection | COMPLETE |
| Topology-change rejection | COMPLETE |
| Highlight-only integration test | COMPLETE |
| Native-action isolation tests | COMPLETE |
| Live production capture test | COMPLETE |
| Physical overlay test | COMPLETE |
| Physical cursor test | COMPLETE |
| Safe physical click test | NOT STARTED |
| DPI awareness | NOT STARTED |
| First-run Display Mapping wizard | NOT STARTED |

---

## 4. Detail for every COMPLETE item

### Production FrameRegistry state
- **File:** `src-tauri/src/display/runtime.rs` → `VisualRuntime`
- Registered once in `lib.rs` via `.manage(display::runtime::VisualRuntime::new())`.
  One registry for the whole process; capture writes to it, overlay/cursor/click
  read from it. `topology()` invalidates frames from any other arrangement on
  every read — comparing versions costs a string compare and cannot be missed
  the way a monitor-change event can.
- **Tests:** `rearranging_the_monitors_discards_frames_captured_before_it`,
  `an_unchanged_arrangement_keeps_its_frames`

### Production display selection before capture · frame registration
- **Files:** `src-tauri/src/display/production_capture.rs`
  (`capture_display`, `capture_region`, `capture_window`, `resolve_display`,
  `monitor_for`), `src-tauri/src/capabilities/screenshots.rs` (`finish_capture`)
- The xcap monitor is found by **identity**, then its geometry is cross-checked
  against the topology before a pixel is read. The frame is registered only
  after the saved image is proven to decode.
- **Tests:** `a_selector_naming_a_display_resolves_to_exactly_that_display`,
  `a_disconnected_display_is_refused_rather_than_substituted`,
  `primary_is_the_display_at_the_desktop_origin_not_the_first_listed`,
  `a_cropped_frame_maps_a_model_point_back_to_the_right_desktop_pixel`

### Capture metadata returned to TypeScript
- **File:** `screenshots.rs` → `ownership_json()`
- Returns `frame_id`, `display_id`, `topology_version`, `captured_at_ms`,
  `capture_width/height`, `image_width/height`, `display_bounds`,
  `scale_factor`, `rotation_degrees`, `cropped`.
- Window and region captures set `capture_width/height` to the **full display**
  and record the crop as `preprocessing`, because undoing a crop lands in
  full-capture pixels; recording the cropped size instead would scale every
  coordinate by the ratio of the crop to the screen.

### Ownership propagated · VisualTarget from authoritative context
- **File:** `src/services/visualTarget.ts` → `frameContextFrom`,
  `buildVisualTarget`
- A capture missing any of the three ownership fields returns `null` and the
  executor refuses. There is deliberately no partial context: it looks
  actionable right up to the point Rust rejects it.
- **Test:** `npx tsx scripts/check-frame-ownership.mts` — including
  *"ownership fields in the model's own output are discarded"*, which feeds a
  hostile model response carrying its own `frameId`/`displayId` and asserts the
  capture's values win.

### capture_origin removed · resolution matching removed · cursor-monitor removed · primary fallback removed
- `capture_origin()` is deleted. Repository search for the string now returns
  **three comment lines only**, all in `interaction/strategy.rs` (the migration
  gate's own documentation). No function, no call sites.
- `input.mouse_monitor_bounds` is deleted from `capabilities/input.rs`, from the
  `capability_execute` dispatch and risk table, and from
  `capabilityRegistry.ts`. Each site carries a comment saying what was there and
  why it cannot be fixed rather than removed.
- `clickPointFromDetection` / `imagePointToScreen` are renamed
  `diagnosticClickPointFromDetection` / `diagnosticImagePointToScreen` and
  documented as test-only. `geminiClickPointFromImage` and
  `openaiClickPointFromImage` — the two dead TypeScript entry points that
  composed a screen point from a caller-supplied origin — are deleted.
- `resolve_display` has no nearest-monitor or primary fallback: a cursor that is
  on no display is an error, not a reason to photograph a neighbour.
- **Guard:** `check-frame-ownership.mts` reads `frontendExecutors.ts` and fails
  if it mentions any of `diagnosticClickPointFromDetection`,
  `diagnosticImagePointToScreen`, `mouse_monitor_bounds`, `origin_x`, `originX`.

### Canonical resolver · overlay · cursor · click · cursor verification
- **File:** `src-tauri/src/display/visual_commands.rs`
- Commands: `resolve_visual_target_cmd`, `preview_visual_target`,
  `move_to_visual_target`, `execute_visual_target`, `clear_visual_overlay`.
- The bounding box is resolved by mapping **both corners** through the same
  chain as the point; mapping the centre and scaling the size would reintroduce
  the assumption that capture pixels and display pixels are the same size.
- `execute_visual_target` moves, reads the cursor back, and **refuses to click**
  with `cursor-did-not-arrive` if the error exceeds 2px. `SetCursorPos` lands
  short when another process is grabbing input, and clicking anyway means
  clicking whatever is under wherever the cursor actually is.
- The purple pointer animation moved into Rust (`animate_pointer_to`), since the
  frontend no longer knows desktop coordinates.
- **Tests:** `a_target_from_the_right_twin_lands_on_the_right_twin`,
  `a_frame_that_was_never_registered_is_refused`,
  `a_target_claiming_a_different_display_than_its_frame_is_refused`,
  `a_frame_from_a_previous_arrangement_is_refused`,
  `a_negative_origin_display_keeps_its_negative_coordinates`,
  `a_non_finite_coordinate_is_refused`,
  `a_point_past_the_edge_of_its_display_is_refused_not_clamped`,
  `a_display_id_that_is_not_a_number_is_refused_before_anything_runs`

### Visual migration gate opened
- **File:** `src-tauri/src/interaction/strategy.rs` → `VisualMigrationState::current()`
- All six flags are now `true`, and each carries a comment naming the production
  code and the test that makes it true.
- **Tests:** `the_ownership_migration_is_recorded_as_complete`,
  `five_of_six_prerequisites_still_leaves_visual_interaction_disabled` (drops
  **each** flag in turn, not only the last — a gate that opens when one specific
  step is missing is a gate that never had to be satisfied),
  `the_gate_opens_only_when_every_step_is_done`

### Highlight-only integration test
- `preview_visual_target` draws an outline and returns; it never calls
  `move_cursor_verified` or `click_at_point`. `plan()` now computes
  `requires_cursor` as `strategy.moves_cursor() && intent != HighlightTarget`,
  so "show me" no longer claims it needs the mouse.
- **Tests:** `show_me_uses_vision_but_only_to_highlight`,
  `a_show_me_request_plans_visually_and_asks_for_no_cursor`, plus the source
  guard *"preview outlines the target and never moves the cursor"*.

### Live production capture test
- **File:** `src-tauri/src/capabilities/screenshot_live_test.rs` → `screenshot_live`
- **Command:** `cargo test --lib screenshot_live -- --nocapture`
- **Result on this machine — 10/10 passed:**
```
virtual desktop: left=-1080 top=-661 4920x1920
topology 248975325:3840x1080@0,0s1.000r0|717163523:1080x1920@-1080,-661s1.000r90

display 248975325  bounds (0,0) 3840x1080     capture 3840x1080
  centre resolves (1920, 540)  -> display 248975325  OK
display 717163523  bounds (-1080,-661) 1080x1920  capture 1080x1920
  centre resolves (-540, 299)  -> display 717163523  OK
REFUSED (correct) display 717164522: Display 717164522 is not connected.
```

### Physical overlay + cursor test
- **File:** `src-tauri/src/display/physical_test.rs` → `physical_overlay_and_cursor`
- **Command:** `cargo test --lib physical_overlay_and_cursor -- --nocapture --ignored`
- Nine probes per display (corners, edges, centre), each one: resolve → draw an
  outline → move the cursor → read it back. No clicks. The cursor is restored
  afterwards.
- **Result — 18/18 passed, cursor error 0.0px on every probe.** The portrait
  monitor resolved to negative coordinates throughout (`-972` … `-108` across,
  `-469` … `1067` down) and every point landed on the display its frame named.

### Same-resolution · negative-origin · missing / expired / topology-changed
- Same-resolution twins are unit-tested (`a_target_from_the_right_twin_lands_on_the_right_twin`,
  `identical_twins_produce_different_answers_from_identical_images`) because
  this machine's two monitors have *different* resolutions — the hardware cannot
  exercise that case, so the assertion lives where it can be forced.
- Negative origin is proven **both** ways: unit test and the physical run above.
- Missing / expired / mismatched / stale-topology frames are each refused with a
  distinct typed error carrying a `recapture` hint.

---

## 5. Verification commands and their real results

| Command | Result |
| --- | --- |
| `cargo test --lib` | **133 passed, 0 failed, 1 ignored** (was 111) |
| `cargo test --lib screenshot_live -- --nocapture` | 10/10 production capture checks |
| `cargo test --lib physical_overlay_and_cursor -- --nocapture --ignored` | 18/18 physical probes, 0.0px cursor error |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run test:planner` | 13/13 |
| `npm run test:ownership` | 19/19 (new) |
| `npm run test:pointer` | all passed |
| `npm run test:vision` | all passed |
| `rustfmt --check` on the nine changed Rust files | clean |
| `npm run tauri dev` | builds and launches; the new process handed off to the instance already running from earlier in the session (documented single-instance behaviour), so the rebuilt UI was not displayed |
| `cargo clippy` | **NOT RUN** — `cargo-clippy` is not installed for the `stable-x86_64-pc-windows-msvc` toolchain |

The one ignored test is `physical_overlay_and_cursor`: it moves the pointer and
draws on screen, so it runs only when asked for explicitly.

---

## 6. What is PARTIAL or NOT STARTED, and why

**Post-click verification — PARTIAL.** The cursor is verified to have arrived
*before* the click, and the click's own return code is checked. What is not
implemented is verifying that the click *changed* something — comparing the
target region before and after, or reading back window state. Without it, a
click that landed on a disabled control reports success.

**Frame freshness protection — PARTIAL.** In place: a 30s TTL, an opportunistic
sweep on every registry write, and topology-version invalidation. Not in place:
pre-action recapture, target-region similarity checks, and window-identity
checks. A coordinate can still be arithmetically correct and 25 seconds stale.

**Planner visual execution connected — PARTIAL.** The gate is open and the
planner routes visual intents correctly, but the native planner does not run
vision itself — finding something on screen needs a model call, which lives in
the assistant loop. `visual_attempt()` returns `VISUAL_EXECUTION_VIA_CAPABILITY`
and the request is served by `screen.click_target` / `screen.highlight_target`,
which use the migrated executor. Growing a second, blinder copy of the vision
pipeline inside the planner would be worse than saying so.

**Safe physical click test — NOT STARTED.** This needs an ArcSonare-owned test
window with a harmless button to click and read back. The cursor half of the
pipeline is proven to land at 0.0px error on both monitors, but no automated
click has been performed on real hardware.

**DPI awareness — NOT STARTED**, deliberately and unchanged. The process is
still DPI-unaware; both monitors run at 100% so Win32 and xcap agree, and DPI is
not the cause of the inaccuracy this work fixed. `display/dpi.rs` and
`ensure_per_monitor_v2()` are untouched.

**First-run Display Mapping wizard — NOT STARTED**, as instructed. Its
prerequisites are now met.

---

## 7. Behaviour that changed for the user

- `screen.capture` results carry ownership. A capture that cannot name its
  display is refused rather than acted on.
- A visual click now refuses in cases it previously guessed through: expired
  screenshot, rearranged monitors, target outside its display, cursor that did
  not arrive. Each refusal says whether a fresh screenshot would help.
- "Show me X" outlines and stops. It no longer reports that it needs the cursor.
- The purple pointer still animates to the target; it is drawn from Rust now.
- Out-of-bounds targets are refused, never clamped. A clamped point is a click
  somewhere the user did not ask for, and it looks like success.
