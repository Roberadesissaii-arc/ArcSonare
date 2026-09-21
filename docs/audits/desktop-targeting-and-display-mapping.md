# Desktop targeting, display mapping and voice echo — audit

Date: 2026-07-31
Branch: `master`
HEAD at start: `a8c1787`
Working tree: modified, uncommitted (no commits made — none were requested)

Status vocabulary: COMPLETE / PARTIAL / NOT STARTED / BLOCKED

---

## Summary

The books-folder failure is **fixed at its cause**. The cause was not geometry:
every coordinate layer was already correct and none of them could have caught
the fault, because the answer being mapped was wrong before it arrived. Windows
is now asked where the icon is instead of a vision model being asked to find it,
and when vision *is* used its answer is checked against the shell's real icon
rectangles before anything is drawn.

The Display Mapping wizard's **foundation** is built and proven on the real
hardware — including the stable monitor identity that the previous xcap-id
approach got wrong. The **wizard UI and settings screen are not built**.

The physical voice test and the physical books-folder overlay test were **not
run**: both need a person at the machine. See BLOCKED items.

---

## 1. Build identity

| Item | Status |
| --- | --- |
| Current build verified | COMPLETE |

At session start **no ArcSonare process was running**, so the stale-binary trap
did not apply to this session's measurements. Recorded for the record:

| Path | Modified | Size |
| --- | --- | --- |
| `C:\Users\rober\AppData\Local\ArcSonare\ArcSonare.exe` (installed, stale) | 7/31 12:39 PM | 33,892,352 |
| `src-tauri\target\release\arcsonare.exe` | 7/31 5:55 PM | 34,106,880 |
| `src-tauri\target\debug\arcsonare.exe` | 7/31 6:24 PM → **rebuilt this session** | 33,635,840 |

Command: `cargo build` → `BUILD_EXIT=0`. The debug build is the newest artifact
and contains every change in this report.

**All measurements below come from live Rust tests run against the real machine
in-process, not from the installed binary.** That is a stronger guarantee than
"the right exe was launched", because there is no exe in the loop at all.

---

## 2. Books-folder diagnosis

| Item | Status |
| --- | --- |
| Books-folder production trace | COMPLETE |
| Correct Desktop screenshot | COMPLETE (not required — no screenshot is taken) |
| Raw model target inspected | COMPLETE (trace stages exist and are emitted) |
| Failure classification | COMPLETE |

**Classification: `WRONG_MODEL_TARGET`.**

Evidence, from `cargo test --lib desktop_items_live -- --nocapture` against the
live shell:

- The real folder is `C:\Users\rober\Desktop\books`, icon rect **`(0, 789) 74×70`**.
- The four mis-boxed labels are real, *separate* icons at different grid cells:
  `File`, `New folder`, `ridetrip-devop` `(300, 495)`, `Trip` `(300, 593)`.
- Icon pitch is 75 px across, 98 px down; icons are 74×70. A rectangle covering
  four of them cannot be a rounding error — it is a different answer.
- Every rectangle the shell reports covers exactly one icon (asserted).

So the capture, frame ownership, coordinate mapping and overlay were all
behaving. The model's answer was wrong. **No X/Y offsets were added.**

Correlation trace stages are emitted through `visualTrace.ts`
(`beginTrace`/`traceStage`): `model-raw` (raw label, raw `box_2d`, confidence),
`model-parsed`, **`target-verified`** (new), `resolved` (frame id, display id,
resolved rect). No screenshot bytes are logged.

---

## 3. Structured Desktop lookup

| Item | Status |
| --- | --- |
| Structured Desktop lookup | COMPLETE |
| Shell or UI Automation implementation | COMPLETE (Shell list-view) |
| Exact-name verification | COMPLETE |
| Native open-folder routing | COMPLETE (pre-existing, verified) |

**File:** `src-tauri/src/capabilities/desktop_items.rs`

Method: `Progman` → `SHELLDLL_DefView` → `SysListView32`, falling back to a
`WorkerW` walk when a wallpaper slideshow interposes one. `LVM_GETITEMRECT`
(`LVIR_SELECTBOUNDS`) and `LVM_GETITEMTEXTW` are issued cross-process via
`VirtualAllocEx`/`WriteProcessMemory`/`ReadProcessMemory`, since the list-view
writes its answers through a pointer in explorer's address space. Rectangles are
converted to virtual-desktop pixels with `ClientToScreen` at the source, so
nothing downstream converts anything.

UI Automation was not needed: the list-view answers directly, with no COM and no
accessibility tree. Vision is not reached for a Desktop item that resolves.

Types: `DesktopItem`, `PhysicalRect`, `DesktopItemKind`, `DesktopItemSource`,
`MatchFailure`. Entry points: `enumerate_desktop_items()`, `match_item()`,
`find_item()`, **`list_items()`** (new).

Matching is case-insensitive, tiered exact → prefix → substring, kind-filtered,
and returns `Ambiguous` rather than picking when two items tie.

### Defect found and fixed this session

`resolve_label()` (new). Explorer hides known extensions, so the old code
resolved a label by exact filename only. Consequences on the real Desktop:

- ~30 files resolved to **no path at all** (`amazon` never matched `amazon.pdf`).
- Worse: `ridetrip-devop.zip` and the folder `ridetrip-devop` share a label, and
  the archive's row **claimed `is_folder = true` and the folder's path**. Same
  for the `elegant-photo-slideshow…` folder/zip pair.

`is_folder` is now `Option<bool>`. A label matching entries of differing kinds
reports kind **unknown** instead of guessing, and `match_item` keeps unknown-kind
items eligible for both queries so the result is a question, not a silent wrong
pick. Verified live: those two now print `?`, ~30 files now resolve
(`amazon → amazon.pdf`, `prime_finder → prime_finder.py`), `books` unchanged.

### Open vs show

Pre-existing and verified by `cargo test --lib interaction::strategy`:

- `opening_a_folder_never_touches_the_screen_or_cursor` — ok
- `open_and_show_me_route_differently_for_the_same_object` — ok
- `show_me_uses_vision_but_only_to_highlight` — ok
- `no_native_intent_ever_requests_the_cursor` — ok

Frontend order (`frontendExecutors.ts`, `screen.highlight_target`):
`highlightDesktopItem()` is called **before** any capture; vision is reached only
if it returns null.

---

## 4. Vision fallback validation

| Item | Status |
| --- | --- |
| Multi-icon box rejection | COMPLETE |
| Vision fallback verification | COMPLETE |
| Overlay overlap measurement | COMPLETE (in test); PARTIAL (not physically observed) |

**File:** `src/services/desktopIconGuard.ts` — `verifyDesktopIconTarget()`,
`iconsCentredIn()`, `iconsTouchedBy()`, `labelsAgree()`.

**Ordering change (the important part):** the target is now resolved with
`resolveVisualTarget` — which draws nothing — then validated, and only then
passed to `previewVisualTarget`. Validation happens while the screen is still
clean, because once a border is drawn the user cannot tell a correct one from a
confident wrong one.

`resolveVisualTarget`'s TypeScript signature was under-declared and now returns
the `boxRect` Rust already produced.

Ground truth comes from the new `desktop.list_items` capability, so "does this
box contain two icon centres" is answered exactly rather than heuristically.

Rejections (each returns `TARGET_NOT_VERIFIED`, nothing drawn):
`spans-multiple-icons`, `covers-no-icon`, `wider-than-one-icon`,
`taller-than-one-icon`, `implausible-aspect`, `label-mismatch`, `empty-box`.

With no icon list (target inside an application window) the guard degrades to
the checks that stand alone rather than blocking every highlight.

---

## 5. Stable monitor identity

| Item | Status |
| --- | --- |
| Stable monitor identity | COMPLETE |
| New-monitor detection | COMPLETE (logic + tests) |
| Profile persistence | PARTIAL — model and triggers COMPLETE, disk store NOT STARTED |

**Files:** `src-tauri/src/display/identity.rs`, `src-tauri/src/display/profile.rs`

`EnumDisplayMonitors` → `GetMonitorInfoW` → `EnumDisplayDevicesW` with
`EDD_GET_DEVICE_INTERFACE_NAME` yields the EDID-derived device interface path.
Measured live on this machine:

| Friendly name | Slot | Bounds | Stable key | Runtime xcap id |
| --- | --- | --- | --- | --- |
| Generic PnP Monitor (primary) | `\\.\DISPLAY1` | 3840×1080 @ (0,0) | `\\?\DISPLAY#LHC9019#5&2a33d992&0&UID4358#{e6f07b5f…}` | 332927975 |
| Generic PnP Monitor | `\\.\DISPLAY2` | 1080×1920 @ (−1080,−661) | `\\?\DISPLAY#GSM5BB1#5&2a33d992&0&UID4356#{e6f07b5f…}` | 2101988 |

This is the direct evidence for the requirement: the runtime ids are opaque
per-process numbers; the stable keys encode manufacturer, model and connector
`UID`, so two identical monitors on different ports still differ.

`pair_with_topology()` rebuilds stable-key → runtime-id **on every run and never
stores it**, which is the invariant that keeps the two spaces from mixing.

`profile.rs` holds `DisplayProfile`, `ValidationSample`, `ProfileStatus`,
`ConfigurationNeed`, `configuration_need()`, `monitors_needing_configuration()`,
`summarise()`, `passes()` with `MAX_AVERAGE_ERROR = 4.0`,
`MAX_SINGLE_ERROR = 8.0`. Position deliberately does **not** trigger
reconfiguration — every consumer reads live bounds, and re-asking on a drag
would train the user to click through the wizard.

**Not built:** writing profiles to disk. The model is serde-ready; nothing
persists it yet.

---

## 6. Display Mapping wizard

| Item | Status |
| --- | --- |
| First-run Display Mapping wizard | NOT STARTED |
| Display identification (Step 2) | NOT STARTED |
| Nine-point test (Step 3) | NOT STARTED |
| Random validation (Step 4) | NOT STARTED |
| Settings interface | NOT STARTED |

The decision logic that governs *when* the wizard appears is complete and tested
(§5). The user-facing wizard — five steps, per-monitor identification borders,
nine-point and random target runs, and the
Settings → Desktop Interaction → Display Mapping screen with its eight actions —
is not built. This is the largest single piece of remaining work.

Existing groundwork it should build on: `display/physical_test.rs` (overlay and
cursor on real monitors, including the negative-origin portrait display),
`display/verification.rs`, `native_overlay.rs`, `agent_pointer.rs`.

---

## 7. Voice

| Item | Status |
| --- | --- |
| Voice shared state | COMPLETE (pre-existing, verified) |
| Voice echo suppression | COMPLETE in logic (pre-existing, verified) |
| Physical speaker/microphone test | BLOCKED |

`cargo test --lib voice_session` — 13 tests, all pass, including
`a_transcript_arriving_while_arcsonare_talks_is_not_a_user_request`,
`the_echo_tail_right_after_playback_is_also_rejected`,
`cancelled_playback_still_serves_its_cooldown`,
`genuinely_different_speech_after_playback_is_accepted`,
`the_state_is_shared_rather_than_per_surface`.
`npm run test:voice` passes. Nothing here was rewritten.

**BLOCKED — physical audio test.** Playing TTS through real speakers, capturing
it on a real microphone and confirming the recogniser stays suppressed requires a
person at the machine with audio hardware live. It cannot be performed from this
session, and the logic tests above are **not** a substitute: they prove the state
machine, not that the room's acoustics and the device's echo cancellation behave
as assumed. **The echo problem is not claimed to be physically solved.**

---

## 8. Physical Desktop test

| Item | Status |
| --- | --- |
| Planner books highlight (end-to-end, on screen) | BLOCKED |

What *was* verified live, in-process, against the real machine:

- The shell returns `books` at `(0, 789) 74×70` → `C:\Users\rober\Desktop\books`.
- No other icon's centre falls inside that rectangle (asserted).
- Every enumerated rectangle covers exactly one icon (asserted).
- The exact four-icon rectangle from the bug report is **refused** by the guard.
- Target source for this path: **shell** (`DesktopItemSource::ShellListView`).

What was **not** done: launching the app, typing the sentence into the composer,
and photographing the resulting border. That needs control of the user's live
desktop session. Per the completion definition, **success is not declared** for
this item.

---

## 9. Regression status

All green, after every change in this report.

| Command | Result |
| --- | --- |
| `cargo build` | exit 0 |
| `cargo test --lib` | **241 passed, 0 failed**, 3 ignored (was 218 at session start) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:planner` | All planner routing checks passed |
| `npm run test:ownership` | All frame ownership checks passed |
| `npm run test:files` | All file intent checks passed |
| `npm run test:pointer` | all passed |
| `npm run test:vision` | all passed |
| `npm run test:visual-dispatch` | All visual dispatch checks passed |
| `npm run test:voice` | All voice turn-taking checks passed |
| `npm run test:desktop-targeting` | all passed (**new**) |
| `npm run test:intent` | PASSED 16/16 |
| `npm run test:routing` | 14/14 routed correctly |

### Tests added this session

Rust (`cargo test --lib`), 23 new:

- `desktop_items::tests::a_folder_and_a_same_named_archive_are_not_told_apart_by_guessing`
- `desktop_items::tests::a_hidden_extension_still_resolves_to_its_file`
- `desktop_items::tests::same_stem_files_are_still_known_to_be_files`
- `desktop_items::tests::an_unknown_kind_makes_a_folder_query_ambiguous_rather_than_wrong`
- `display::identity::tests::a_profile_is_filed_under_the_hardware_path_not_a_slot`
- `display::identity::tests::two_identical_monitors_are_still_told_apart`
- `display::identity::tests::without_an_interface_path_the_key_falls_back_to_geometry`
- `display::profile::tests::a_first_run_asks_for_configuration`
- `display::profile::tests::a_valid_profile_is_left_alone`
- `display::profile::tests::a_profile_survives_the_runtime_display_id_changing`
- `display::profile::tests::only_the_new_monitor_is_asked_about`
- `display::profile::tests::an_ignored_monitor_stays_ignored`
- `display::profile::tests::changing_the_{resolution,scaling}_invalidates_*`
- `display::profile::tests::rotating_a_monitor_invalidates_it`
- `display::profile::tests::moving_a_monitor_does_not_re_ask`
- `display::profile::tests::a_failed_measurement_is_asked_about_again`
- `display::profile::tests::one_wild_miss_fails_the_run_even_with_a_good_average`
- `display::profile::tests::landing_on_the_wrong_display_fails_regardless_of_error`
- `display::profile::tests::{a_perfect_run_passes, a_run_with_no_samples_is_not_a_pass, errors_are_reported_per_axis_and_as_a_distance}`
- `display::identity_live_test::display_identity_live` (live hardware)

TypeScript — `npm run test:desktop-targeting`
(`scripts/check-desktop-targeting.mts`), 16 checks including the reported
four-icon rectangle, label mismatch, wrong-icon landing, column strips,
oversized boxes, empty desktop, and acceptance of the real `books` rectangle.

`npm run test:display-mapping` was **not** added: with no wizard and no disk
store, its subject matter is fully covered by `display::profile` and
`display::identity` under `cargo test --lib`. Adding a script that re-tests the
same pure functions through a second harness would be duplicate coverage.

---

## Completion definition — honest scoring

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Latest build definitely handled the request | COMPLETE (in-process live tests; no stale exe involved) |
| 2 | Production planner highlights the actual books folder | PARTIAL — shell returns the exact rect; on-screen draw not observed |
| 3 | Border excludes unrelated icons | COMPLETE (asserted live) |
| 4 | Wrong model targets rejected rather than shown | COMPLETE |
| 5 | Open books uses native folder opening | COMPLETE |
| 6 | First-run wizard appears when no profile exists | PARTIAL — decision logic COMPLETE, UI NOT STARTED |
| 7 | Stable monitor identity is used | COMPLETE |
| 8 | Nine-point and random validation pass on both monitors | NOT STARTED |
| 9 | ArcSonare ignores its own TTS in a physical audio test | BLOCKED |
| 10 | Existing planner/file/visual/freshness/click tests still pass | COMPLETE |

**Completion is not declared.** Items 2, 6, 8 and 9 are outstanding.

---

## Files changed

| File | Change |
| --- | --- |
| `src-tauri/src/capabilities/desktop_items.rs` | `resolve_label`, `desktop_entries`, `list_items`, `is_folder: Option<bool>`, 4 tests |
| `src-tauri/src/capabilities/desktop_items_live_test.rs` | updated for three-state kind |
| `src-tauri/src/capabilities/executor.rs` | routed + risk-classified `desktop.list_items` |
| `src-tauri/src/display/identity.rs` | **new** — stable monitor identity |
| `src-tauri/src/display/identity_live_test.rs` | **new** — live hardware proof |
| `src-tauri/src/display/profile.rs` | **new** — profiles, thresholds, triggers |
| `src-tauri/src/display/mod.rs` | registered the new modules |
| `src/services/desktopIconGuard.ts` | **new** — box sanity + label checks; hosts `desktopItemName`/`mentionsDesktop` |
| `src/services/visualTarget.ts` | `resolveVisualTarget` now returns `boxRect`/`label` |
| `src/features/capabilities/frontendExecutors.ts` | verify-before-draw, `verifyAgainstDesktopIcons`, imports |
| `scripts/check-desktop-targeting.mts` | **new** |
| `package.json` | `test:desktop-targeting` |

No commits were made. Unrelated working-tree changes were preserved.
