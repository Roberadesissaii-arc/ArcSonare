# Visual Click Reliability

**Date:** 2026-07-31
**Branch:** `master` · **HEAD at start:** `a8c17873d68b7b87d4a31a75274ed07759a36641`
**Scope:** the four gaps left open by
[visual-ownership-migration.md](visual-ownership-migration.md) — proving a click
did something, noticing the screen moved on, one traceable lifecycle, and a real
click against a real target.

---

## 1. What was missing

Aiming was solved. Hitting was not. A click reported success because input had
been injected, which is true of a click on a disabled button, a covered control,
the wrong control inside the right box, or a window that ignored it entirely.
And a coordinate could be arithmetically perfect but describe a screen that had
scrolled away twenty seconds ago.

## 2. The shape it has now

```
plan → RequiresVision(correlation_id, target_description, expected_outcome)
     → assistant loop captures + asks the model
     → geometry bound to the frame
     → freshness: re-photograph the target's surroundings, compare
     → window identity: is the same thing still on top?
     → cursor moves, position read back
     → window identity re-checked (hover menus open on move)
     → click
     → verifier runs
     → status: verified-succeeded | verification-failed | no-verifier-available
```

Every refusal happens *before* the click. Everything from the click onwards sets
`sideEffectPossible`, which forbids an automatic second attempt.

---

## 3. Status

| Item | Status |
| --- | --- |
| Safe ArcSonare test window | COMPLETE |
| VisualExpectedOutcome | COMPLETE |
| Visual execution transaction | COMPLETE |
| Correlation ID propagation | COMPLETE |
| Pre-action region recapture | COMPLETE |
| Image similarity comparison | COMPLETE |
| Window identity validation | COMPLETE |
| Freshness rejection | COMPLETE |
| Cursor suppression on stale target | COMPLETE |
| Post-click region verification | COMPLETE |
| Post-click window verification | PARTIAL |
| ArcSonare test-state verification | COMPLETE |
| ClickSent versus VerifiedSucceeded distinction | COMPLETE |
| PartiallyCompleted visual result | COMPLETE |
| Duplicate fallback prevention after click | COMPLETE |
| Planner RequiresVision disposition | COMPLETE |
| Assistant-loop visual request integration | PARTIAL |
| Final visual result returned to planner | PARTIAL |
| Highlight-only visual lifecycle | COMPLETE |
| Click visual lifecycle | COMPLETE |
| Automated fresh-frame test | COMPLETE |
| Automated stale-frame test | COMPLETE |
| Automated obscured-target test | PARTIAL |
| Automated failed-click verification test | COMPLETE |
| Automated successful-click verification test | COMPLETE |
| Safe physical click ultrawide | COMPLETE |
| Safe physical click portrait | COMPLETE |
| Physical stale-target rejection | COMPLETE |
| Native action isolation | COMPLETE |
| DPI awareness | NOT STARTED |
| Display Mapping wizard | NOT STARTED |

---

## 4. Detail for every COMPLETE item

### Safe ArcSonare test window
- **File:** `src-tauri/src/visual_test_target.rs`
- **Types:** `TestTargetState`, `TestTargetRect`; commands `visual_test_show`,
  `visual_test_hide`, `visual_test_reset`, `visual_test_state`.
- A plain top-level Win32 window titled **"ArcSonare Visual Interaction Test"**,
  test id `arcsonare-test-click-target`. Counts left, right, double and
  off-target clicks; shows target state, click count and last action; turns
  green once activated. It performs no filesystem, network, account or
  destructive action — the worst it can do is count to one.
- **Deliberately not a Tauri webview.** `native_overlay.rs` documents that
  WebView2 gives this process exactly two live webviews (`main`,
  `sonare-overlay`) and a third fails with `0x8007139F`. A native window is also
  the more honest target: it is what a real click target looks like to Windows.
- **Tests:** `the_button_rectangle_sits_inside_the_window`,
  `only_points_inside_the_button_count_as_a_hit`,
  `a_reset_target_reports_ready_and_no_clicks`,
  `a_hidden_target_offers_no_button_to_aim_at`

### VisualExpectedOutcome
- **File:** `src-tauri/src/display/verification.rs` → `VisualExpectedOutcome`
- A closed set: `None`, `RegionChanged`, `WindowAppeared`, `WindowDisappeared`,
  `TestTargetClicked`. Named by ArcSonare, never by the model — the point of
  verification is that it is not the same judgement made twice.
- **Tests:** `expected_outcomes_round_trip_through_the_wire_format`,
  `an_unknown_verifier_name_is_rejected` (a payload naming arbitrary verifier
  code fails to deserialize).

### Visual execution transaction · Correlation ID propagation
- **Files:** `src-tauri/src/display/visual_commands.rs` (`VisualTargetRequest.correlation_id`,
  `VisualActionResult.correlation_id`), `src-tauri/src/interaction/commands.rs`
  (`vision_request_for`), `src/services/visualTarget.ts` (`newCorrelationId`),
  `src/features/capabilities/frontendExecutors.ts`
- One id spans plan → capture → model call → resolve → freshness → execute →
  verify, and comes back in the tool result as `correlation_id`. A request that
  arrives without one still gets one rather than losing traceability.
- **Tests:** `the_correlation_id_ties_the_request_and_the_plan_together`,
  `a_request_without_a_correlation_id_still_gets_one`

### Pre-action region recapture · Image similarity comparison
- **File:** `src-tauri/src/display/freshness.rs` → `check_region_freshness`,
  `region_around`, `similarity`
- The target's box (or a 64px square around the point) plus a 16px margin,
  clamped to **its own display** and never allowed onto a neighbour. Both images
  are reduced to a 32×32 Rec.601 luma grid and compared by normalised mean
  absolute difference. Threshold **0.12**, tuned to be forgiving: a false stale
  costs one recapture, a false fresh costs a click in the wrong place. Both
  constants are `pub` and documented.
- Crops are undone before comparing, so a window capture compares the right
  pixels; a region outside a window capture reports *unavailable* rather than
  *stale* — "I could not look" is not "it changed".
- **Tests:** `an_unchanged_region_is_identical`,
  `a_completely_different_region_scores_near_zero`,
  `a_small_visual_change_still_counts_as_fresh` (a caret must not trip it),
  `a_window_moving_away_counts_as_stale`,
  `the_compared_region_never_leaves_its_own_display`,
  `a_cropped_frame_has_its_crop_undone_before_comparing`,
  `a_region_outside_a_window_capture_cannot_be_compared`,
  `a_negative_origin_display_maps_into_its_image_without_going_negative`

### Window identity validation
- **File:** `verification.rs` → `WindowIdentity`, `window_at`, `same_window`
- Checked before the move **and again after it**, because moving the cursor can
  itself open a hover menu over the target. Best-effort by design: a window with
  no useful title (games, canvas apps, remote sessions) does not block an action
  that would otherwise be fine.
- **Tests:** `a_different_process_under_the_target_is_a_different_window`,
  `a_retitled_window_of_the_same_process_is_treated_as_moved_on`,
  `window_identity_ignores_a_missing_title_rather_than_failing_the_check`

### Freshness rejection · Cursor suppression on stale target
- **File:** `visual_commands.rs` → `pre_action_freshness`, called **before**
  `move_cursor_verified` in `execute_visual_target`. Returns
  `SCREEN_CHANGED_BEFORE_ACTION` with `recapture: true`.
- **Guard:** `check-frame-ownership.mts` asserts the source order — freshness
  before the cursor helper — because a cursor that has already travelled to a
  stale coordinate has told the user a lie about what is about to happen.

### Post-click region verification · ArcSonare test-state verification
- **File:** `verification.rs` → `snapshot_before`, `verify_after`
- The test-target verifier polls for the expected increment, then waits past it
  so a *second* click still shows up — "clicked twice" must not be reported as
  success.
- **Tests:** the physical runs below; `a_click_on_the_test_target_names_the_counter_verifier`

### ClickSent vs VerifiedSucceeded · PartiallyCompleted · Duplicate fallback prevention
- **File:** `visual_commands.rs` → `VisualAttemptStatus`, `side_effect_possible()`,
  `allows_retry()`; `frontendExecutors.ts` maps a non-verified click to
  `partial`, never `success`.
- `ClickSent`, `VerifiedSucceeded`, `VerificationFailed` and
  `NoVerifierAvailable` all set `sideEffectPossible`. Everything before the
  click (`PreviewSucceeded`, `CursorMoved`, `ScreenChangedBeforeAction`,
  `TargetObscured`, `TargetWindowChanged`, `CursorPositionMismatch`) does not.
- **Tests:** `only_statuses_after_the_click_admit_a_possible_side_effect`,
  `a_failed_verification_still_blocks_a_second_attempt`,
  `a_stale_screen_is_reported_as_retryable_because_nothing_happened`,
  `a_click_sent_is_never_serialized_as_a_verified_success`

### Planner RequiresVision disposition
- **File:** `src-tauri/src/interaction/commands.rs` →
  `plan_and_dispatch_action`, `vision_request_for`; type
  `PlanExecutionDisposition` in `request.rs`.
- Three distinct outcomes: `Executed`, `RequiresVision`, `Unsupported`. The
  visual request carries the correlation id, plan id, target description in the
  user's words, whether it needs a click or an overlay, the verifier, and the
  plan's risk level — so the assistant loop cannot execute a visual action at a
  lower bar than the planner set.
- **Tests:** `a_disposition_serializes_as_a_tagged_union_the_frontend_can_switch_on`,
  `a_highlight_request_asks_for_an_overlay_and_no_verifier`,
  `a_click_request_always_carries_a_verifier`,
  `a_visual_request_carries_the_plans_risk_level_forward`

### Highlight-only lifecycle · Click lifecycle
- Preview skips freshness (it changes nothing, and blocking "show me" on a live
  window would make the feature useless) but still validates frame, display and
  topology. It never calls the cursor helper — asserted at source level.
- **Guard:** *"previews skip freshness but clicks do not"*, *"a click defaults to
  asking for verification"*.

### Native action isolation
- Unchanged and re-verified: `npm run test:planner` 13/13, including
  *"screen and cursor capabilities are not silently absorbed by the planner"*.
  Native intents create no visual transaction — `plan_and_dispatch_action`
  reaches `vision_request_for` only when the primary strategy is
  `VisualInteraction`.

---

## 5. Physical results on this hardware

**Safe physical click** — `cargo test --lib safe_physical_click -- --nocapture --ignored`
```
display 1986660975 (ultrawide)
  expected target   (1921, 597)     resolved target (1921, 597)
  actual cursor     Some((1921, 597))   cursor error 0.0 px
  freshness score   1.000 (fresh=true)
  clicks before 0   clicks after 1   post-click check VERIFIED (exactly one)

display 135721 (portrait, negative origin)
  expected target   (-539, 356)     resolved target (-539, 356)
  actual cursor     Some((-539, 356))   cursor error 0.0 px
  freshness score   1.000 (fresh=true)
  clicks before 0   clicks after 1   post-click check VERIFIED (exactly one)

10/10 passed  (includes "nothing landed off-target" on both)
```

**Stale target rejection** — `cargo test --lib stale_visual_target -- --nocapture --ignored`
```
freshness before moving   1.000
freshness after moving    0.712 (fresh=false)  → SCREEN_CHANGED_BEFORE_ACTION
the cursor did not move                  Some((-598,-303)) -> Some((-598,-303))
the click counter did not change         0 -> 0
geometry alone would still have allowed it
5/5 passed
```
That last line is the one that matters: resolution still *succeeds* on the stale
coordinate. Freshness is the only thing standing between it and a click.

**Overlay + cursor** — still 18/18 probes, 0.0px, after the refactor.

### An incidental finding

**xcap display ids are not stable across process restarts.** The previous
session recorded `248975325` / `717163523` for these two monitors; this session
they enumerate as `1986660975` / `135721`. Frames live 30 seconds so nothing at
runtime is affected, but a persisted display mapping (the wizard) cannot key on
this id and will need a stable identifier — device path or EDID.

---

## 6. Verification commands and their real results

| Command | Result |
| --- | --- |
| `cargo test --lib` | **168 passed, 0 failed, 3 ignored** (was 133) |
| `cargo test --lib safe_physical_click -- --nocapture --ignored` | 10/10 |
| `cargo test --lib stale_visual_target -- --nocapture --ignored` | 5/5 |
| `cargo test --lib physical_overlay_and_cursor -- --nocapture --ignored` | 18/18, 0.0px |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run test:planner` | 13/13 |
| `npm run test:ownership` | 25/25 (was 19) |
| `npm run test:pointer` | 12/12 |
| `npm run test:vision` | 7/7 |
| `rustfmt --check` on the eight changed Rust files | clean |
| `cargo clippy` | **NOT RUN** — not installed for the `stable-x86_64-pc-windows-msvc` toolchain |

The three ignored tests are the physical ones: they move the pointer, draw on
screen and click ArcSonare's own window, so they run only when asked for.

---

## 7. What is PARTIAL or NOT STARTED, and why

**Post-click window verification — PARTIAL.** `WindowAppeared` and
`WindowDisappeared` are implemented and unit-tested for their matching logic,
but no physical test drives them: doing so honestly would mean opening and
closing a real application, which is outside "harmless test surface". The
region-change and test-target verifiers are the ones exercised end to end.

**Assistant-loop visual request integration — PARTIAL.** Rust returns
`RequiresVision` and `frontendExecutors.ts` runs the full capture → model →
bind → freshness → execute → verify chain with a shared correlation id. What is
*not* wired is the assistant loop calling `plan_and_dispatch_action` for visual
intents and dispatching on the returned disposition — today it reaches
`screen.click_target` directly. The pieces exist and agree on shape; the switch
in `capabilityEngine.ts` does not.

**Final visual result returned to planner — PARTIAL.** For the same reason: the
verified result is complete and correctly shaped, but nothing feeds it back into
a planner `ActionResult` yet, because nothing dispatches through the planner for
visual intents.

**Automated obscured-target test — PARTIAL.** `same_window` is unit-tested for
every case (different process, retitled window, missing title). There is no
automated test that physically covers the target and observes the refusal; the
`TargetWindowChanged` path is exercised only by code inspection.

**DPI awareness — NOT STARTED**, deliberately and unchanged.

**Display Mapping wizard — NOT STARTED**, as instructed. Note the display-id
finding above before designing its persistence.

---

## 8. Behaviour that changed for the user

- A visual click now says which of three things happened: it worked and was
  proven (`success`), input went out but nothing could be confirmed (`partial`),
  or it was refused before anything happened (`not-found`, with a reason).
- ArcSonare refuses to click when the screen changed after it looked — and says
  so — rather than clicking a coordinate that no longer means anything.
- A click whose verification fails is never retried automatically, because
  "it did nothing" and "it worked but the check was slow" are indistinguishable
  and one of them opens two windows.
- "Show me" is unchanged: it outlines and stops.
