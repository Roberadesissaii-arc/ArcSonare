# Books-folder production lifecycle, display mapping, voice — audit

Date: 2026-07-31
Branch: `master`
HEAD: `a8c1787`
Working tree: modified, uncommitted (no commits made — none were requested)

Status vocabulary: COMPLETE / PARTIAL / NOT STARTED / BLOCKED

---

## Summary

"Show me the books folder on my Desktop" now travels a route with **no model in
it**. The planner recognises a named Desktop item as a lookup, asks Windows for
the icon's rectangle, and outlines exactly that. Measured end to end: centre
distance **0.00 px**, IoU **1.0000**, neighbouring icon centres inside the
border **0**, screenshot **not taken**, cursor **not moved**.

Two gaps in the previous session's work were found and closed this session — the
planner and the frontend bridge were both still describing this request as a
recognition problem. A third bug was caught by a test written here.

The Display Mapping wizard UI and the physical voice test remain outstanding.

---

## 1. Build identity

| Item | Status |
| --- | --- |
| Running build identity | COMPLETE |

Process count before launch: **0** — the stale installed binary was not running
and did not affect any measurement.

| Field | Value |
| --- | --- |
| PID | 17316 |
| Executable | `C:\Users\rober\Desktop\ArcSonare\src-tauri\target\debug\arcsonare.exe` |
| Modified | 2026-07-31 19:08:19 (built this session) |
| Started | 2026-07-31 19:08:25 |
| Git HEAD | `a8c1787` (master) |
| Stale installed binary | `%LOCALAPPDATA%\ArcSonare\ArcSonare.exe`, 12:39 PM — **not running** |

**Precision about what executed the request.** The lifecycle test runs in the
test-harness binary (`target\debug\deps\arcsonare_lib-*.exe`), compiled from this
tree in this session — the same code as PID 17316, but **not that process**.
Driving the app's own composer needs UI automation of the user's live session,
which was not performed. This is stated rather than glossed: the completion
definition asks that "the current debug binary processed the request", and what
is proven is that *the current debug build's code* did.

---

## 2. Structured lookup and the production command

| Item | Status |
| --- | --- |
| Books structured lookup | COMPLETE |
| Books production planner command | COMPLETE (see caveat in §1) |
| Vision bypass when structured lookup succeeds | COMPLETE |
| Exact target bounds | COMPLETE |
| Overlay bounds | COMPLETE |
| Overlay overlap measurement | COMPLETE |
| Neighbour-icon exclusion | COMPLETE |
| Planner physical highlight test | COMPLETE |

**Test:** `interaction::planner_highlight_live_test::planner_highlight_real_books_folder`
**File:** `src-tauri/src/interaction/planner_highlight_live_test.rs`
**Command:**

```bash
cargo test --lib planner_highlight_real_books_folder -- --nocapture --ignored
```

**Result — full trace:**

| Field | Value |
| --- | --- |
| request_id | `req-books-live` |
| plan_id | `plan-1785539729863-0` |
| correlation | plan_id + request_id (`vision_request_for`, unused on this route) |
| user intent | `HighlightTarget` → **`HighlightDesktopItem`** |
| selected strategy | **`InternalCapability`** (fallback `VisualInteraction`) |
| rationale | `STRUCTURED_DESKTOP_LOOKUP_AVAILABLE` |
| structured lookup used | **true** |
| **vision_called** | **false** |
| screenshot taken | false |
| cursor moved / clicked | false / false |
| requested item name | `books` |
| resolved path | `C:\Users\rober\Desktop\books` |
| item kind | folder (`Some(true)`) |
| lookup source | `ShellListView` |
| item rectangle | **(0, 789) 74×70** |
| overlay rectangle | **(0, 789) 74×70** — read back via `GetWindowRect` |
| target centre | (37, 824) |
| overlay centre | (37, 824) |
| centre distance | **0.00 px** |
| intersection | 5180 px² |
| **IoU** | **1.0000** |
| neighbour centres inside | **0** |
| plan status | Succeeded, `verified: true`, method `shell-list-view` |
| display / monitor identity | primary 3840×1080 @ (0,0), `\\?\DISPLAY#LHC9019#…UID4358#{…}` |

**Why IoU is exactly 1.0, stated plainly:** there is no model in this path. The
rectangle comes from Windows and is drawn verbatim, so this measures that the
overlay lands where it was told — not that a recogniser was accurate. The
measurement is still meaningful because it is a **readback**: `highlight_target_rect()`
asks Windows where the overlay window actually is, so `SetWindowPos` clamping or
DPI virtualisation would show up as drift. It did not.

### Two gaps closed this session

The previous session's structured lookup only existed **below** the planner. Two
layers above it were still describing the request as a recognition problem:

1. **`interaction/strategy.rs`** routed every `HighlightTarget` to
   `VisualInteraction` with `requires_screen_capture: true`. Added
   `ActionIntent::HighlightDesktopItem` and the `desktop_items` capability;
   `effective_intent()` in `executor.rs` narrows the intent from the target
   shape, keeping `plan()` a pure intent→strategy function. Execution is
   `highlight_desktop_item()`, which refuses rather than degrades.
   `live_capabilities()` **probes** the shell rather than declaring it, so a
   locked session falls back to vision instead of promising a lookup.

2. **`features/capabilities/plannerBridge.ts`** built a `visual-description`
   target for *every* highlight request, so the planner could never have seen a
   Desktop path. New `highlightTarget()` sends a named Desktop item as a
   `path` target with `knownFolder: "desktop"`.

### Bug found by a test written here

`desktopItemName("my desktop")` returned `"desktop"` — the strip rule required a
preposition (`on my desktop`), so a bare mention survived and ArcSonare would
have hunted for an icon literally named "desktop". Fixed in
`src/services/desktopIconGuard.ts`; covered by
*"naming only the desktop does not invent an item to look up"*.

---

## 3. Open versus show

| Item | Status |
| --- | --- |
| Open-books native routing | COMPLETE |
| Show-books highlight routing | COMPLETE |

**File:** `src-tauri/src/interaction/executor.rs` (tests module)
**Command:** `cargo test --lib interaction::executor`

| Test | Result |
| --- | --- |
| `open_books_and_show_books_take_different_routes` | ok — `NativeOs` vs `InternalCapability` |
| `neither_books_route_needs_the_screen_or_the_cursor` | ok |
| `showing_a_desktop_item_keeps_vision_as_a_fallback_not_the_plan` | ok |
| `without_a_shell_icon_list_showing_falls_back_to_vision` | ok |
| `a_described_target_is_not_diverted_into_the_desktop_lookup` | ok |
| `opening_a_folder_never_touches_the_screen_or_cursor` (pre-existing) | ok |
| `open_and_show_me_route_differently_for_the_same_object` (pre-existing) | ok |

Command A ("Open the books folder") plans `NativeOs` → `filesystem::open_item`,
verified by a filesystem postcondition. No capture, no model, no overlay, no
cursor, no click. Command B ("Show me…") plans `InternalCapability` → shell
lookup → overlay only. Neither shares a strategy with the other.

---

## 4. Failure behaviour

| Item | Status |
| --- | --- |
| Missing target handling | COMPLETE |
| Ambiguous target handling | COMPLETE |
| Multi-icon box rejection | COMPLETE |
| Label mismatch rejection | COMPLETE |

| Case | Where | Test | Outcome |
| --- | --- | --- | --- |
| Missing item | `interaction/executor.rs` | `a_desktop_item_that_is_not_there_is_reported_rather_than_drawn` | `TARGET_NOT_FOUND`, `NotFound`, nothing drawn, `verified: false` |
| Ambiguous item | `capabilities/desktop_items.rs` | `two_equally_good_matches_are_a_question_not_a_guess` | `MatchFailure::Ambiguous` → `AMBIGUOUS_TARGET` / `NeedsConfirmation`, neither highlighted |
| Hidden-extension collision | `capabilities/desktop_items.rs` | `a_folder_and_a_same_named_archive_are_not_told_apart_by_guessing` | kind unknown → ambiguous, not guessed |
| Four-icon box (the original) | `scripts/check-desktop-targeting.mts` | *"a box spanning four icons is refused, not drawn"* | `TARGET_NOT_VERIFIED`, no overlay |
| Label mismatch (books/Trip) | `scripts/check-desktop-targeting.mts` | *"asking for books and being handed Trip is refused"* | `TARGET_NOT_VERIFIED`, no overlay |

Note on the fallback policy: when the user says "desktop" and the shell lookup
finds nothing, `highlightDesktopItem` returns the refusal rather than falling
through to a vision guess. Vision is reached only when the request was never a
Desktop request, or when the shell list is unreadable.

---

## 5. Stable monitor identity

| Item | Status |
| --- | --- |
| Stable monitor identity | COMPLETE |
| New-monitor detection | COMPLETE (logic + tests) |
| Profile persistence | PARTIAL — model and triggers COMPLETE, disk store NOT STARTED |

**Files:** `src-tauri/src/display/identity.rs`, `src-tauri/src/display/profile.rs`
**Command:** `cargo test --lib display_identity_live -- --nocapture`

| Friendly name | Slot | Bounds | Stable key | Runtime xcap id |
| --- | --- | --- | --- | --- |
| Generic PnP Monitor (primary) | `\\.\DISPLAY1` | 3840×1080 @ (0,0) | `\\?\DISPLAY#LHC9019#5&2a33d992&0&UID4358#{e6f07b5f…}` | 332927975 |
| Generic PnP Monitor | `\\.\DISPLAY2` | 1080×1920 @ (−1080,−661) | `\\?\DISPLAY#GSM5BB1#5&2a33d992&0&UID4356#{e6f07b5f…}` | 2101988 |

Unchanged from the previous session and re-verified. Profiles are never keyed on
the runtime ids above.

---

## 6. Display Mapping wizard

| Item | Status |
| --- | --- |
| First-run wizard | NOT STARTED |
| Display identification | NOT STARTED |
| Nine-point test | NOT STARTED |
| Random validation | NOT STARTED |
| Profile persistence to disk | NOT STARTED |
| Settings interface | NOT STARTED |

Step 9 gated this on the books-folder test passing, which it now does — so this
is unblocked, not blocked. It was not started in this session because it is a
five-step interactive UI plus a settings screen with eight actions plus a disk
store, and beginning it without finishing it would leave a half-built wizard in
the tree. The decision logic it needs (§5) is complete and tested:
`configuration_need()`, `monitors_needing_configuration()`, `passes()` with the
4 px / 8 px thresholds, and the nine `display::profile` tests covering first run,
valid profile, new monitor, rotation, scaling, resolution, ignored, previously
failed, and runtime-id change.

**`npm run test:display-mapping` was not added.** Its subject matter is entirely
`display::profile` and `display::identity`, already covered by `cargo test --lib`.
A script re-testing the same pure functions through a second harness would be
duplicate coverage, not verification. It should be added with the wizard.

---

## 7. Voice

| Item | Status |
| --- | --- |
| Voice shared state | COMPLETE (pre-existing, verified) |
| Voice echo suppression logic | COMPLETE (pre-existing, verified) |
| Voice speaker/microphone test | BLOCKED |

`cargo test --lib voice_session` — 13 tests pass, unchanged and not rewritten.
`npm run test:voice` — all turn-taking checks pass.

**BLOCKED.** The procedure in Step 10 requires playing TTS through real speakers,
capturing it on a real microphone, and observing recogniser events — a person at
the machine with live audio hardware. It cannot be performed from this session.
No playback ID, recogniser state, self-transcript count or cooldown measurement
is reported, because none was observed.

**Physical echo suppression is therefore not claimed.** The passing tests prove
the state machine, not the room.

---

## 8. Annotated screenshot

| Item | Status |
| --- | --- |
| Developer-only annotated screenshot | NOT STARTED |

Step 5 asked for one temporary annotated capture. It was not produced. The
overlay rectangle was instead verified by reading the window's real position back
out of Windows (`GetWindowRect`), which is a stronger check than a visual one and
required no image. Worth adding if a human-eyeball artefact is wanted.

---

## 9. Regression status

| Command | Result |
| --- | --- |
| `cargo build` | exit 0 |
| `cargo test --lib` | **248 passed, 0 failed**, 4 ignored (241 at session start) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:planner` | All planner routing checks passed |
| `npm run test:ownership` | All frame ownership checks passed |
| `npm run test:files` | All file intent checks passed |
| `npm run test:pointer` | all passed |
| `npm run test:vision` | all passed |
| `npm run test:visual-dispatch` | All visual dispatch checks passed |
| `npm run test:voice` | All voice turn-taking checks passed |
| `npm run test:desktop-targeting` | all passed (16 checks) |
| `npm run test:planner-highlight` | all passed (**new**, 12 checks) |
| `npm run test:intent` | PASSED 16/16 |
| `npm run test:routing` | 14/14 routed correctly |
| `cargo fmt -- --check` (scoped to changed modules) | exit 0 |
| `cargo clippy` | **NOT AVAILABLE** — `cargo-clippy.exe` is not installed for `stable-x86_64-pc-windows-msvc`. Install with `rustup component add clippy`. |

---

## 10. Completion definition — honest scoring

### Books targeting

| Requirement | Status |
| --- | --- |
| Current debug binary processed the request | PARTIAL — current debug **build's code** did, in the test harness, not PID 17316 |
| Real user command went through the planner | COMPLETE |
| Structured Shell lookup found the books folder | COMPLETE |
| Vision not called when structured lookup succeeded | COMPLETE |
| Border contained the books icon centre | COMPLETE (distance 0.00 px) |
| Border excluded every unrelated neighbour centre | COMPLETE (0 neighbours) |
| Open books used native filesystem opening | COMPLETE |
| Wrong vision boxes rejected | COMPLETE |

### Display mapping

NOT STARTED — no wizard appeared, nothing persisted, no nine-point or random run.

### Voice

BLOCKED — no physical audio test was performed.

---

## Files changed this session

| File | Change |
| --- | --- |
| `src-tauri/src/interaction/strategy.rs` | `HighlightDesktopItem` intent, `desktop_items` capability, structured-lookup planning rule, cursor rule |
| `src-tauri/src/interaction/executor.rs` | `effective_intent()`, `highlight_desktop_item()`, Path targets for highlight, 7 tests |
| `src-tauri/src/interaction/commands.rs` | probes the shell for `desktop_items` |
| `src-tauri/src/interaction/planner_highlight_live_test.rs` | **new** — production lifecycle + overlay measurement |
| `src-tauri/src/interaction/mod.rs` | registered the live test |
| `src-tauri/src/native_overlay.rs` | `highlight_target_rect()` readback, `WinRect` (fixes a clashing extern declaration) |
| `src/features/capabilities/plannerBridge.ts` | `highlightTarget()` — Desktop items leave as paths |
| `src/services/desktopIconGuard.ts` | bare-"desktop" strip fix |
| `scripts/check-planner-highlight.mts` | **new** |
| `package.json` | `test:planner-highlight` |

Formatting applied scoped to the modules touched. No commits were made.
Unrelated working-tree changes were preserved.
