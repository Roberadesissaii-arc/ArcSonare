# Display-profile enforcement — audit

Date: 2026-08-01
Branch: `master`
HEAD: `a8c1787`
Working tree: modified, uncommitted (no commits made — none were requested)

Status vocabulary: COMPLETE / PARTIAL / NOT STARTED / BLOCKED

---

## Summary

Enforcement was wired last session but none of its refusals had ever been
exercised. They now are — 21 tests, every refusal path, against isolated
in-memory stores that never touch the user's two verified profiles.

Two real defects were found doing it, and both are fixed.

---

## Update — native backend verified physically on both monitors

Every enforcement test to this point used `RecordingSideEffects`. Those prove the
*decisions*, but a recorder answers identically whether `NativeSideEffects` is
wired correctly or not wired at all. The existing `safe_physical_click` did not
close that gap either — it calls `input::click_at_point` directly and never
touches the new backend.

### Native backend physical regression — COMPLETE

**File:** `src-tauri/src/display/native_backend_test.rs`
**Test:** `display::native_backend_test::native_backend_physical`
**Command:** `cargo test --lib native_backend_physical -- --nocapture --ignored`

Exercises `NativeSideEffects` itself and reads every result back out of Windows.

| Display | Operation | Requested | Actual (Win32 readback) | Error |
| --- | --- | --- | --- | --- |
| A 3840×1080 @ (0,0) | overlay | (960, 270) 200×140 | (960, 270) 200×140 | **0.00 px** |
| B 1080×1920 @ (−1080,−661) | overlay | (−810, −181) 200×140 | (−810, −181) 200×140 | **0.00 px** |
| A | cursor | (1920, 540) | (1920, 540) | **0.00 px** |
| B | cursor | (−540, 299) | (−540, 299) | **0.00 px** |
| A | click | button (1921, 597) | clicks 0 → 1 | — |
| B | click | button (−539, 356) | clicks 0 → 1 | — |

Asserted at each step: exactly one overlay visible while shown, zero after
`hide_overlay`, the overlay centre inside the monitor it was drawn for, the
cursor untouched by a preview, and the click counter incrementing exactly once.
Negative-origin coordinates survive the real backend intact on all three
operations.

### Outside-display refusal, physically — COMPLETE

**Test:** `display::native_backend_test::native_backend_refuses_a_point_outside_every_display`

```
point      (100000, 100000)
refusal    "That point is not on any connected display…"
cursor     (-539, 356) -> (-539, 356)     unchanged
clicks     0 -> 0                          unchanged
overlays   unchanged
```

### Recording vs native semantics — COMPLETE, no divergence

| Operation | Recorded expectation | Native observed |
| --- | --- | --- |
| Preview | overlay 1, cursor 0, click 0 | overlay drawn, cursor asserted unchanged |
| Cursor | overlay 0, cursor 1, click 0 | cursor moved to 0.00 px, overlay count asserted 0 |
| Click | cursor 1, click 1 | cursor landed on button, counter +1 exactly |
| Raw click | one click, uncorrected | point reached Windows unmoved |

No difference to report.

**Note on `perform_click`:** the native click path glides the cursor to the
target before pressing, so a `click()` call moves the pointer as well. That is
existing production behaviour, not something the abstraction introduced, and the
recorder's `click` counter deliberately counts button presses rather than the
glide. Worth knowing when reading counts: `click == 1` does not mean the pointer
never moved.

### Regressions after the physical run

| Command | Result |
| --- | --- |
| `cargo test --lib` | **364 passed**, 0 failed, 9 ignored |
| `native_backend_physical` | ok — both monitors |
| `native_backend_refuses_a_point_outside_every_display` | ok |
| `planner_highlight_real_books_folder` | (0,789) 74×70, 0.00 px, IoU 1.0000, 0 neighbours, vision false |
| `npx tsc --noEmit` / `npm run build` | clean |
| 10 npm suites | all pass |
| `cargo fmt` (scoped) | clean |
| `cargo clippy` | **unavailable** |

**Profiles unchanged by the physical tests** — verified immediately after:
A `valid 3.205/4.337 IDENTITY`, B `valid 1.542/2.186 IDENTITY`.

### Cleanup verified

Zero overlays after every operation, test window hidden and counter reset, no
button left down (the backend's click sends down+up as one call), no pending
timer, and the global Space shortcut untouched — the wizard registers it only
during a mapping session, and none ran here.

---

## Update — side effects measured, coordinate space mandatory

### VisualSideEffects abstraction — COMPLETE

**File:** `src-tauri/src/display/side_effects.rs`
**Types:** `VisualSideEffects` (trait), `NativeSideEffects`, `RecordingSideEffects`,
`SideEffectTotals`, `DesktopPoint`, `DesktopRect`, `MouseButton`

Three native operations — overlay, cursor, click — now go through one trait.
Production (`NativeSideEffects`) forwards to the functions that were already
being called at each site, so wiring it in changed no behaviour. The gate, frame
ownership, freshness and verification are untouched: the trait sits strictly
*below* all of them, and there is no mock-only execution path.

**Injection sites** (all downstream of `resolve()`, i.e. after the profile gate):

| Site | Operation |
| --- | --- |
| `visual_commands.rs` preview | `show_overlay` |
| `visual_commands.rs` `move_cursor_verified` | `move_cursor` + `read_cursor` |
| `visual_commands.rs` execute | `click` |

`side_effects()` returns the native backend in production and a recorder when a
test has installed one.

**Deliberate exclusion:** `hide_overlay` is not counted by `nothing_happened()`.
Tidying up after a refusal is not a side effect on the user's screen, and
forbidding it would push cleanup out of the failure paths.

### Zero-side-effect proof — COMPLETE

**Test:** `display::enforcement_test::no_refusal_produces_any_native_side_effect`
**Command:** `cargo test --lib display::enforcement_test`

Table-driven across every refusal: missing profile, no store, failed, ignored,
disconnected, corrupt, unsupported version, stale (changed monitor),
out-of-display, and the portrait display. Each asserts
`overlay_show == 0`, `cursor_move == 0`, `click == 0`.

This replaces the earlier "returns before the call, therefore cannot happen"
argument — the reasoning that missed two ungated overlay paths.

### Valid-path call counts — COMPLETE

**Tests:** `a_permitted_operation_produces_exactly_one_of_each_side_effect`,
`a_permitted_raw_click_lands_on_the_point_it_was_given`

| Operation | overlay | cursor | click |
| --- | --- | --- | --- |
| Preview | 1 | 0 | 0 |
| Cursor move | 0 | 1 | 0 |
| Click | 0 | 1 | 1 |

Without these the zero-assertions would also pass on a recorder wired to nothing.
The raw-click test additionally asserts the point reaches the backend **unmoved**
even when the display carries a correction.

### Mandatory coordinate space — COMPLETE

**Files:** `capabilities/input.rs` (`InputCoordinateSpace`, `ClickAtArgs`),
`src/features/capabilities/capabilityRegistry.ts`

`coordinate_space` is now **required** in both the Rust struct and the model-facing
JSON schema, with a single accepted value `physical-virtual-desktop`. Any other
space fails deserialisation rather than being reinterpreted.

**Caller migration — COMPLETE.** There is exactly one caller: the model, through
the registry schema. `capabilityEngine.ts:162` and `capabilityResponseComposer.ts:262`
match on the id for status text only and pass no arguments;
`statusSanitize.ts`, `naturalReply.ts` and `realtimeTools.ts` likewise. No caller
was supplying screenshot, display-local, CSS or normalised coordinates, so none
needed rerouting through the canonical mapper.

**Tests:** `a_click_without_a_coordinate_space_is_refused_before_it_reaches_windows`,
`only_physical_virtual_desktop_pixels_are_accepted` (rejects screenshot,
display-local, css, logical, model-normalized).

### Bypass impossible from a payload — PARTIAL

**Test:** `a_payload_cannot_request_a_bypass`

`deny_unknown_fields` means a forged `skip_profile_check`, `authority` or
`session_id` fails to deserialise rather than being silently ignored. That is the
property that matters, and it is now tested.

**However, the typed `VisualExecutionAuthority` enum was not built.** The wizard's
exemption is still enforced by module boundary — its overlay calls go direct to
`native_overlay` and never touch the gate — rather than by an authority value
validated at the side-effect boundary. Functionally closed, structurally weaker
than asked for.

### Regressions

| Command | Result |
| --- | --- |
| `cargo test --lib` | **364 passed**, 0 failed, 7 ignored (352 before) |
| `planner_highlight_real_books_folder` | (0,789) 74×70, 0.00 px, IoU 1.0000, 0 neighbours, vision false |
| `npx tsc --noEmit` / `npm run build` | clean |
| 10 npm suites | all pass |
| `cargo fmt` (scoped) | clean |
| `cargo clippy` | **unavailable** |

Real profiles verified unchanged after the whole run: A `valid 3.205/4.337 IDENTITY`,
B `valid 1.542/2.186 IDENTITY`.

### Not done this pass

| Item | Status |
| --- | --- |
| Typed `VisualExecutionAuthority` | NOT STARTED — see PARTIAL note above |
| Planner refusal → typed user actions | PARTIAL |
| Frontend blocked-action UX | PARTIAL — `describe_profile_refusal` tested, not surfaced |
| Settings runtime compatibility status | NOT STARTED |
| Physical preview / click on both displays | NOT STARTED |
| Raw click safe physical test | NOT STARTED |
| Topology-change cancellation | NOT STARTED |
| Stale-process diagnostics | NOT STARTED |
| Startup diagnostics | NOT STARTED |
| Final restart regression | NOT STARTED |

---

## Update — raw `click_at` closed, full input audit

### Native input audit — COMPLETE

Every capability that can move the cursor or inject mouse input:

| Capability | Moves cursor | Injects mouse | Coordinate-based | Gated |
| --- | --- | --- | --- | --- |
| `input.click_at` | yes (`SetCursorPos`) | yes (`mouse_event`) | yes — raw x/y | **now gated** |
| `input.scroll` | no | wheel only | **no** — acts at the current cursor, supplies no point | n/a |
| `input.type_text` | no | no | no | n/a |
| `input.press_keys` | no | no | no | n/a |
| `input::set_cursor_position` | yes | no | yes | internal; only `visual_commands` calls it, which is gated |
| `input::click_at_point` | yes | yes | yes | internal; only `visual_commands` calls it, which is gated |
| `agent_pointer::agent_set_cursor_pos` | yes | no | yes | wizard `test_display_cursor` only — deliberate |

There is no `drag`, `mouse_down`, `mouse_up`, `double_click` or `right_click`
capability: the double and right variants are `button` values on `click_at`, and
are covered by its gate. `input.scroll` takes a direction and an amount and acts
wherever the pointer already is, so it names no display and cannot be aimed.

**`input.click_at` was the hole.** It took raw `i32` x/y straight from a
capability payload, declared no coordinate space, and never resolved which
display contained the point before injecting input.

### `click_at` enforcement — COMPLETE

**File:** `src-tauri/src/capabilities/input.rs` — `click_at()`
**Gate:** `display::wizard::require_verified_display_at()`

Order: validate button → validate coordinate space → resolve the display
*containing* the point → profile gate → inject. Never the primary monitor, never
the monitor under the cursor, never the nearest, never clamped.

### Coordinate-space contract — PARTIAL

`InputCoordinateSpace::PhysicalVirtualDesktop` is now declarable on the payload
and any other value is rejected rather than converted. It is `Option` so existing
callers keep working — they already send final desktop pixels — so an omitted
field is accepted rather than refused. **Making it mandatory is not done**; that
needs the existing callers migrated first.

### Raw-click correction policy — COMPLETE

A raw desktop point is **gated but never corrected**. The affine correction is
applied by `visual_commands::resolve` while turning a model answer into a desktop
point; a caller of `click_at` is handing over an already-final coordinate, so
correcting again would move the click a second time.

**Test:** `a_raw_desktop_point_is_gated_but_never_corrected` — asserts the gate
returns the correction (for the resolver's use) while the raw path clicks exactly
where told, and that the two differ.

### New refusal tests — COMPLETE

**Command:** `cargo test --lib display::enforcement_test`

| Test | Covers |
| --- | --- |
| `a_raw_click_resolves_the_display_that_contains_the_point` | negative coordinates resolve to Display B, not the primary |
| `a_raw_click_outside_every_display_is_refused` | `TARGET_OUTSIDE_CONNECTED_DISPLAY`, incl. the exclusive far edge (3840, 1080) |
| `a_raw_click_is_refused_for_every_invalid_profile_state` | failed / ignored / unconfigured / corrupt / missing |
| `a_raw_click_on_a_verified_display_is_allowed` | both displays, incl. negative origin |
| `a_raw_click_cannot_borrow_a_verified_neighbours_profile` | B verified, A not — A still refused |
| `a_raw_desktop_point_is_gated_but_never_corrected` | no double correction |

`TARGET_OUTSIDE_CONNECTED_DISPLAY` was added as a distinct code — a point on no
monitor is its own failure, not an identity mismatch.

**Result:** `cargo test --lib` → **352 passed**, 0 failed, 7 ignored (346 before).
Books regression unchanged: (0,789) 74×70, 0.00 px, IoU 1.0000, vision false.
tsc/build clean, 10 npm suites pass, rustfmt clean, clippy unavailable.
Real profiles verified unchanged: A `valid 3.205/4.337 IDENTITY`,
B `valid 1.542/2.186 IDENTITY`.

### Still not done

| Item | Status |
| --- | --- |
| Mandatory coordinate space | PARTIAL — optional field, callers not yet migrated |
| `VisualSideEffects` observer + invocation counts | NOT STARTED |
| Internal bypass authority type | NOT STARTED — the wizard's exemption is by module boundary, not a typed authority |
| Planner refusal → typed user actions | PARTIAL |
| Blocked-action frontend UX | PARTIAL — `describe_profile_refusal` tested, not surfaced |
| Settings runtime compatibility column | NOT STARTED |
| Safe physical preview / cursor / click on both displays | NOT STARTED |
| Topology-change cancellation | NOT STARTED |
| Stale-process diagnostics | NOT STARTED |

---

## Gate audit

| Route | Gated? |
| --- | --- |
| `resolve_visual_target_cmd` | yes, via `resolve()` |
| `preview_visual_target` | yes, via `resolve()` |
| `move_to_visual_target` | yes, via `resolve()` |
| `execute_visual_target` | yes, via `resolve()` |
| `interaction::executor::highlight_desktop_item` | **was not — now gated** |
| `agent_highlight::agent_highlight_show` | **was not — now gated** |
| `wizard`: calibration targets, `identify_display`, `test_display_overlay`, `test_display_cursor` | deliberately not — the wizard *establishes* the profile, and gating it would deadlock setup |

**Two ungated overlay paths were found.** The structured Desktop highlight — the
books-folder route — drew an overlay with no profile check at all, and so did the
frontend's direct `agent_highlight_show`. Both now call
`wizard::require_verified_display_at()`, which finds the monitor *containing* the
point (not one sharing its origin) and refuses before anything is drawn.

`capabilities::input::click_at` remains ungated and is listed under **Not done**.

---

## Defects found and fixed

**1. An unsupported store version reported as corrupt.** `migrate()` rejects a
newer-than-supported store, `load_from` turns that into `Recovered`, and the
version check downstream was therefore unreachable. "Written by a newer
ArcSonare" and "the bytes are damaged" need different advice, and only one of
them is fixed by re-checking the display. The gate now reads the version before
parsing.

**2. Two overlay routes bypassed the gate entirely** — see above.

---

## Isolated fixtures — COMPLETE

**File:** `src-tauri/src/display/enforcement_test.rs`
**Function under test:** `wizard::evaluate_profile_gate(raw: Option<&str>, identity: &MonitorIdentity)`

The gate was refactored to take the raw store contents rather than an
`AppHandle`, so every case constructs its own JSON. No temporary directories, no
environment variables, nothing shared — parallel tests cannot race, and the
user's real `display-mappings.json` is never opened.

**Verified untouched after the whole run:**

```
3840x1080  status=valid  avg=3.205  max=4.337  correction=IDENTITY
1080x1920  status=valid  avg=1.542  max=2.186  correction=IDENTITY
```

---

## Refusals — COMPLETE

**Command:** `cargo test --lib display::enforcement_test`

| Item | Test | Result |
| --- | --- | --- |
| Missing profile | `a_display_with_no_profile_is_refused` | `DISPLAY_NOT_CONFIGURED` |
| Missing/empty store | `a_missing_store_is_refused_as_unconfigured_not_corrupt` | `DISPLAY_NOT_CONFIGURED` |
| Failed profile | `a_failed_profile_is_refused` | `DISPLAY_PROFILE_FAILED` |
| Ignored profile | `an_ignored_profile_is_refused` | `DISPLAY_IGNORED` |
| Stale — resolution | `a_resolution_change_makes_the_profile_stale` | `DISPLAY_PROFILE_STALE` |
| Stale — rotation | `a_rotation_change_makes_the_profile_stale` | `DISPLAY_PROFILE_STALE` |
| Corrupt store | `a_corrupt_store_is_refused_rather_than_partly_believed` | `DISPLAY_PROFILE_CORRUPT` |
| Newer version | `a_newer_store_is_reported_as_unsupported_not_corrupt` | `DISPLAY_PROFILE_VERSION_UNSUPPORTED` |
| Disconnected status | `a_disconnected_profile_does_not_authorise_a_present_monitor` | `DISPLAY_NOT_CONFIGURED` |
| No refusal reads as permission | `no_refusal_can_be_mistaken_for_permission` | all `Err`, never `Ok(None)` |
| Every code explains itself | `every_refusal_explains_itself` | no generic fallbacks |

**Documented policy — position is not staleness.** `moving_a_monitor_does_not_make_its_profile_stale`
pins it: everything downstream reads live bounds, so dragging a monitor in
Windows Display Settings invalidates nothing the nine-point run measured.
Re-asking would train the user to click through the wizard, and then through a
real failure. `another_monitor_appearing_does_not_disturb_this_one` pins that a
new monitor only affects itself.

### Identity — COMPLETE

`a_same_sized_monitor_cannot_borrow_another_profile` builds two monitors with the
same resolution *and* the same friendly name, one verified and one not. Matching
on resolution, name, or "first profile in the file" would hand the unverified
twin the verified one's profile. It is refused.

---

## Correction — COMPLETE

| Item | Test |
| --- | --- |
| Identity changes nothing | `an_identity_correction_leaves_every_point_exactly_alone` |
| Applied in display-local space | `correction_in_display_local_space_differs_from_desktop_space_on_a_negative_origin` |
| Applied exactly once | `applying_the_correction_twice_is_detectable_and_does_not_happen` |
| Off-display result detectable | `a_correction_that_throws_the_point_off_its_display_is_detectable` |

The space test uses a 1% scale on Display B at (−1080, −661), where the two
orderings differ by more than 10 px — asserted, so the test cannot silently stop
proving anything. The double-application test uses a deliberately large
(+40, −25) translation so a second pass is unmissable.

**File:** `mapping::apply_correction_display_local()`,
`visual_commands::correct_desktop_point()`.

---

## Regressions — COMPLETE

| Command | Result |
| --- | --- |
| `cargo test --lib` | **346 passed**, 0 failed, 7 ignored (325 before) |
| `planner_highlight_real_books_folder` | (0,789) 74×70, 0.00 px, IoU 1.0000, 0 neighbours, vision false |
| `display_mapping_native_targets` | ok |
| `overlay_windows_do_not_accumulate` | ok |
| `npx tsc --noEmit` / `npm run build` | clean |
| 10 npm suites | all pass |
| `cargo fmt` (scoped) | clean |
| `cargo clippy` | **unavailable** — not installed for `stable-x86_64-pc-windows-msvc` |

The books-folder highlight still passes **with its route now gated**, which is
the meaningful result: enforcement was added to that path and it still works
because Display A is verified.

---

## Not done

| Item | Status | Note |
| --- | --- | --- |
| `capabilities::input::click_at` gating | NOT STARTED | a raw click capability that does not consult a profile |
| Zero-side-effect assertions via mocks | PARTIAL | refusals are proven to return `Err` before any draw call, but no mock counts overlay/cursor/click invocations |
| Planner refusal mapping | PARTIAL | `DISPLAY_NOT_VERIFIED` returns `NotReady` with no side effect; the per-code user-action mapping is not built |
| Settings blocked-action UX | PARTIAL | `describe_profile_refusal()` exists and is tested; not surfaced in the settings page |
| Runtime compatibility column | NOT STARTED | |
| Safe physical cursor/click on both displays | NOT STARTED | |
| Topology-change cancellation | NOT STARTED | |
| Stale-process diagnostics | NOT STARTED | see note |
| `npm run test:display-enforcement` | NOT ADDED | the logic is Rust; a TS script would test nothing the Rust suite does not |

**Stale-process note.** Last session established that `open_application "ArcSonare"`
does *not* spawn a second copy — single-instance forwards to the running debug
build. A stale `LocalCache` copy was found running again at the start of this
session and stopped. The mechanism starting it is still unidentified; it is not
`npm run tauri dev` handing off.

---

# Round 4 — the production command path, and permission as a type

Two things were unproven at the end of round 3, and one was worth building.

## 1. Every physical test so far skipped the command under test

`click_test::safe_physical_click` resolves a target and then calls
`input::set_cursor_position` and `input::click_at_point` itself.
`native_backend_test` calls `NativeSideEffects` directly. Neither enters
`execute_visual_target`, so neither exercised the profile gate, the correction,
the freshness check, the ownership re-check or the verifier. They could all pass
while the command a user's words actually reach was broken.

`display/production_path_test.rs` now calls the real `#[tauri::command]`
functions, on a Tauri app built from the real `tauri.conf.json` with Tauri's
mock **window** backend. Nothing else is stubbed: the identifier is the real one,
so `app_config_dir()` resolves to the same folder the installed build uses and
the gate consults the profile the wizard actually wrote. The store is only ever
read.

Two obstacles were worth recording.

**`AppHandle` is `AppHandle<Wry>`.** The commands could not accept a
mock-runtime handle. Across the whole visual path, `app` is used for exactly two
things — `app_config_dir()` and `app_data_dir()` — and `verification.rs` does not
use it at all (`let _ = app;`). So the callee chain was made generic over
`R: Runtime`. Generics widen rather than break: every existing `AppHandle<Wry>`
caller still compiles unchanged, and the shipped binary is byte-identical in
behaviour.

**The test binary would not start.** Referencing the Tauri app builder pulls
`SetWindowSubclass`, `DefSubclassProc`, `RemoveWindowSubclass` and
`TaskDialogIndirect` into the import table. Those exist only in comctl32 **v6**.
The shipped executable gets v6 from the manifest `tauri-build` embeds; a
`cargo test` binary has no manifest, so Windows bound v5.82 and the process died
at load with `STATUS_ENTRYPOINT_NOT_FOUND` before a single test ran — including
all 373 that had nothing to do with this work. A `.drectve` linker directive in
the `#[cfg(test)]` module asks for the v6 assembly. Nothing about the release
build changes.

### Measured result, both monitors

Counting is done by a backend that forwards to Win32 *and* counts, so the click
that lands is the production one and the count is exact.

```
display 65767   3840x1080 @ (0,0)      \?\DISPLAY#...
  button centre (1921, 597)  ->  model (500.3, 552.8) of 1000
  resolved (1921, 597)   correction identity   freshness 1.000
  cursor requested (1921, 597)  actual (1921, 597)  error 0.00 px
  native move calls 1   native click calls 1 at [(1921, 597)]
  clicks 0 -> 1         status VerifiedSucceeded

display 131154  1080x1920 @ (-1080,-661)
  button centre (-539, 356)  ->  model (500.9, 529.7) of 1000
  resolved (-539, 356)   correction identity   freshness 1.000
  cursor requested (-539, 356)  actual (-539, 356)  error 0.00 px
  native move calls 1   native click calls 1 at [(-539, 356)]
  clicks 0 -> 1         status VerifiedSucceeded
```

21/21 checks pass, including frame ownership, exactly-one-of-each side effect,
the production verifier's own confirmation, zero off-target clicks, and the
negative origin surviving on Display B.

## 2. `input.click_at` through its real schema

Arguments go in as `serde_json::Value` and through the real deserialisation, so
`deny_unknown_fields`, the mandatory `coordinate_space` and its one-variant enum
are all exercised rather than bypassed by a direct helper call. 10/10:

| Case | Result |
| --- | --- |
| Display A, `physical-virtual-desktop` | Success, counter 0 → 1 |
| Display B, `physical-virtual-desktop` | Success, counter 0 → 1 |
| no `coordinate_space` | Error `invalid-arguments`, zero native input |
| (100000, 100000) | Error, cursor unchanged, counter 0 → 0 |

**Finding.** The outside-display refusal reports `display-not-verified`, not the
typed code. `require_verified_display_at` returns a `String`, so
`TARGET_OUTSIDE_CONNECTED_DISPLAY` and every other typed code collapse into one
kebab-case string at the capability boundary. This is the missing half of
planner refusal mapping and is left for that work.

## 3. `VisualExecutionAuthority`

The gate now returns a capability instead of advice. `display/authority.rs`:

- `VisualExecutionAuthority` — private fields, constructor `pub(super)`, minted
  in exactly one place: `profile_gate`, after `profile_for_bounds` approves.
- `AuthorizedPoint` / `AuthorizedRect` — no public constructor. The only way to
  obtain one is to ask an authority to vouch for a coordinate.
- `VisualSideEffects::{show_overlay, move_cursor, click}` take nothing else.

That last line is the enforcement. A future command that forgets the gate does
not misbehave at runtime — it cannot name a value the backend will accept.
`hide_overlay` and `read_cursor` stay unauthorized: cleanup must remain available
on every refusal path, and reading changes nothing.

Each authorization re-checks the three things that can change between the
decision and the click:

| Check | Refusal | Code |
| --- | --- | --- |
| issued > 2 s ago | `Expired` | `VISUAL_AUTHORITY_EXPIRED` |
| arrangement changed | `TopologyChanged` | `DISPLAY_IDENTITY_MISMATCH` |
| point not on the authorized display | `WrongDisplay` | `TARGET_OUTSIDE_CONNECTED_DISPLAY` |

The topology version compared against is re-read live at each authorization.
Passing the authority its own remembered version would always agree, which is
not a check — that mistake was made and fixed here.

## Not done — and this layer is not complete

| Item | Status | Note |
| --- | --- | --- |
| `agent_highlight.rs`, `interaction/executor.rs` | GATED, NOT TYPED | both call `require_verified_display_at` then `native_overlay::show_highlight` directly, so they are correct today by discipline rather than by the compiler |
| Planner refusal mapping | PARTIAL | typed codes still collapse to `display-not-verified` at the capability boundary |
| Frontend blocked-action UX | NOT STARTED | |
| Settings runtime compatibility | NOT STARTED | |
| Topology-change cancellation | PARTIAL | an in-flight authority now expires; nothing cancels a running action |
| Stale-process diagnostics | NOT STARTED | |
| Final restart regression | NOT STARTED | |
