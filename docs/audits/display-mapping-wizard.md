# Display Mapping wizard — audit

Date: 2026-07-31 (updated after the native-target fix)
Branch: `master`
HEAD: `a8c1787`
Working tree: modified, uncommitted (no commits made — none were requested)

Status vocabulary: COMPLETE / PARTIAL / NOT STARTED / BLOCKED

---

## Update 8 — Display A re-checked, enforcement wired

### Display A re-check — COMPLETE

The stale correction is gone. Before:

```
correction a=1.00027  b=0.00210  c=-3.429
           d=-0.00009 e=0.99755  f=-2.393     ← ~(-1.8, -3.9) px, translation-dominated
```

All five of its old validation samples erred negative in Y (−6.40, −3.21, −6.64,
−3.78, −3.66) — the cursor-bias signature.

After the physical re-check on the current build:

```
Display verified          Accuracy: Excellent
CALIBRATION   accepted 9   rejected 0   outliers removed 0
              Correction: Identity retained  —  "no correction was fitted"
VALIDATION    accepted 5   average 3.2 px   maximum 4.3 px
              wrong display 0   out of bounds 0
```

| Display | Status | Avg | Max | Correction | configured_at | validated_at |
| --- | --- | --- | --- | --- | --- | --- |
| A 3840×1080 @ (0,0) | valid | 3.205 | 4.337 | **IDENTITY** | 1785541520064 (preserved) | 1785557441209 (updated) |
| B 1080×1920 @ (−1080,−661) | valid | 1.542 | 2.186 | **IDENTITY** | 1785545892711 | 1785556769455 (untouched) |

Display B was not rewritten. Both keyed on their EDID paths.

**Restart persistence — COMPLETE.** Quit (0 remaining) → PID 50548 → both
profiles `valid` + `IDENTITY`, no first-run prompt, no overlay.

Lifecycle again clean throughout: one violet target at a time, correct
Calibration → Validation transition, per-sample feedback (`Recorded — 0.0 px from
the centre`), nothing left after Finish.

### Runtime enforcement — wired

| Item | Where |
| --- | --- |
| Gate | `visual_commands::profile_gate()` |
| Profile lookup | `wizard::profile_for_bounds()` |
| Refusal wording | `wizard::describe_profile_refusal()` |
| Correction | `mapping::apply_correction_display_local()` |
| Space conversion | `visual_commands::correct_desktop_point()` |

**One choke point.** The gate sits in `resolve()`, which every visual command
passes through — `resolve_visual_target_cmd`, `preview_visual_target`,
`move_to_visual_target`, `execute_visual_target`. Putting the check in each
command would let a fifth be added without one.

Typed refusals: `DISPLAY_NOT_CONFIGURED`, `DISPLAY_PROFILE_STALE`,
`DISPLAY_PROFILE_FAILED`, `DISPLAY_IGNORED`, `DISPLAY_IDENTITY_MISMATCH`,
`DISPLAY_PROFILE_CORRUPT`, `DISPLAY_PROFILE_VERSION_UNSUPPORTED`. No fallback to
another monitor, ever.

**Correction is applied exactly once**, at the end of `resolve`, in
**display-local space**. Correcting a desktop point would fold the monitor origin
into the transform's constant term — on the portrait display at (−1080, −661)
that is a thousand-pixel error dressed up as a calibration fault.
`reconcile()` is reused so the settings page and the executor cannot disagree.

Tests: `an_identity_profile_returns_the_point_untouched`,
`a_correction_is_applied_in_display_local_space_not_desktop_space`,
`a_display_id_that_is_not_a_number_is_refused_before_anything_runs`.

### Regressions after enforcement

| Command | Result |
| --- | --- |
| `cargo test --lib` | **325 passed**, 0 failed, 7 ignored |
| `planner_highlight_real_books_folder` | (0,789) 74×70, 0.00 px, IoU 1.0000, 0 neighbours, vision false |
| `display_mapping_native_targets` | ok |
| `overlay_windows_do_not_accumulate` | ok |
| `npx tsc --noEmit` / `npm run build` | clean |
| 10 npm suites | all pass |
| `cargo fmt` | clean |
| `cargo clippy` | **unavailable** — not installed for `stable-x86_64-pc-windows-msvc` |

Native open still works in production — observed in the app: *"open my desktop
there is folder called books can you open that for me"* → *"opened the books
folder on your desktop for you."*

### Not done

| Item | Status |
| --- | --- |
| Enforcement failure-path tests (missing/failed/stale/ignored) | NOT STARTED — the gate is wired and typed, but each refusal needs a test that fakes a store state |
| Safe visual-click regression on both displays | NOT STARTED |
| Settings blocked-action UX | PARTIAL — `describe_profile_refusal` exists; not surfaced in the settings page yet |
| Stale-process diagnostics | NOT STARTED — see note |

**Stale process note.** `open_application "ArcSonare"` (which resolves to the
installed Start-menu entry) did **not** spawn a second copy: single-instance
forwarded to the running debug build and the process list stayed at one. So the
`LocalCache` copy is being started by something else — most likely the Claude
desktop sandbox launching its own bundled ArcSonare. Diagnostics are still worth
adding, but the mechanism is not `npm run tauri dev` handing off.

---

## Update 7 — Display B rerun: PASSED, and the lifecycle held

The rerun was performed on the real hardware, end to end.

| Field | Value |
| --- | --- |
| PID | 21440 → 44132 (after restart) |
| Executable | `src-tauri\target\debug\arcsonare.exe` |
| Built | 2026-07-31 23:55:25 |
| Git HEAD | `a8c1787` |
| Stale copy found and stopped | `…\LocalCache\Local\ArcSonare\arcsonare.exe` (PID 70824) |

### Result — Display B: VERIFIED, Accuracy Excellent

```
CALIBRATION   accepted 9   rejected attempts 0   outliers removed 0
              Correction: Identity retained
              "the correction is a constant shift, which is cursor-aiming bias —
               overlay placement is independently verified at 0 px"

VALIDATION    accepted 5   average 1.5 px   maximum 2.2 px
              wrong display 0   out of bounds 0
```

Persisted: `1080x1920 @ -1080,-661 | status=valid avg=1.54 max=2.19 n=14
correction=identity`, keyed on `\\?\DISPLAY#GSM5BB1#…UID4356#{…}`.

**Read this number honestly.** The run was driven programmatically — the cursor
was moved to coordinates computed from a screenshot, not aimed by eye. That
removes precisely the (−3, −5) px hand bias that made the human runs measure
4–6 px. Rust genuinely read `GetCursorPos` and the errors are real measurements,
so this validates the *pipeline*: targets in the right place, sampling correct,
counting correct, cleanup correct. It does **not** show what a human hand
achieves. The earlier human runs — Display A at 5.4 / 7.3, Display B at
6.1 / 9.1 — remain the realistic figures for manual aiming, and are why the Valid
tier sits at 6 / 10.

### Lifecycle observations — all confirmed on screen

| Requirement | Observed |
| --- | --- |
| Exactly one target visible | yes, at every one of the 14 points |
| No ghost or leftover white targets | none, at any stage |
| No target on Display A | ultrawide clean throughout |
| Active target violet | confirmed by zoom |
| Old target disappears | confirmed at every transition |
| Calibration → Validation | `VALIDATION / Point 3 of 5 — Random point 3`, with "Calibration complete. Five fresh points to check the result." |
| Per-sample feedback | `Recorded — 3.8 px from the centre.` in green |
| No target on result screen | portrait monitor completely clean |
| No target after Finish | dashboard clean, both monitors |

The ghost-ring bug is **fixed in practice, not just in test**: nine calibration
points and five validation points produced no accumulation whatsoever, which is
the direct consequence of making `init()` idempotent.

The green accepted-flash and amber rejected-flash were not captured — the flash
is 300 ms and no sample was rejected during this run. Both are verified by
`calibration_target_states` on the real screen; the hues in situ remain
unconfirmed by eye.

### Restart persistence — PASSED

Quit (0 processes remaining) → relaunched PID 44132 → dashboard, **no first-run
prompt, no calibration target on either monitor**. Both profiles loaded Valid
under their stable EDID keys despite a new process with new xcap runtime ids.

| Display | Status | Average | Maximum | Correction |
| --- | --- | --- | --- | --- |
| A — 3840×1080 @ (0,0) | valid | 5.39 px | 7.28 px | **affine (stale)** |
| B — 1080×1920 @ (−1080,−661) | valid | 1.54 px | 2.19 px | identity |

### One issue found, not fixed

**Display A's profile carries an affine correction fitted before the
constant-shift guard existed.** Under the current policy that correction would be
refused as cursor-aiming bias. It is a stale artefact of an earlier run and means
Display A currently has one person's aim baked into its coordinate transform.
Re-checking Display A would clear it. **Runtime enforcement should not be wired
until it is**, or the first enforced action will apply that bias.

Also fixed this pass: mojibake in the wizard's UI strings (`1080 Ã— 1920`,
`â‰¤ 4 px`) left by earlier PowerShell round-trips.

---

## Update 6 — Display B diagnosed from its own samples

Both displays were physically calibrated. Display A passed (5.4 / 7.3, VERIFIED).
Display B failed at 6.107 / 9.094 — over the average bar by **0.107 px**.

**Test:** `display::replay_test::replay_real_portrait_run`
**Command:** `cargo test --lib replay_real -- --nocapture`

### Why the average was 6.1

| Stage | # | Expected | Actual | Err X | Err Y | Dist |
| --- | --- | --- | --- | --- | --- | --- |
| CAL | 1 | (−1016, −597) | (−1018, −604) | −2.00 | −7.00 | 7.280 |
| CAL | 2 | (−540, −597) | (−544, −602) | −4.00 | −5.00 | 6.403 |
| CAL | 3 | (−64, −597) | (−68, −600) | −4.00 | −3.00 | 5.000 |
| CAL | 4 | (−1016, 299) | (−1015, 295) | +1.00 | −4.00 | 4.123 |
| CAL | 5 | (−540, 299) | (−541, 295) | −1.00 | −4.00 | 4.123 |
| CAL | 6 | (−64, 299) | (−66, 294) | −2.00 | −5.00 | 5.385 |
| CAL | 7 | (−1016, 1195) | (−1019, 1193) | −3.00 | −2.00 | 3.606 |
| CAL | 8 | (−540, 1195) | (−540, 1192) | 0.00 | −3.00 | 3.000 |
| CAL | 9 | (−64, 1195) | (−64, 1191) | 0.00 | −4.00 | 4.000 |
| VAL | 10 | (−795.60, 1155.35) | (−798, 1151) | −2.40 | −4.35 | 4.966 |
| **VAL** | **11** | **(−153.71, 156.39)** | **(−159, 149)** | **−5.29** | **−7.39** | **9.094** |
| VAL | 12 | (−752.21, −394.50) | (−754, −398) | −1.79 | −3.50 | 3.931 |
| VAL | 13 | (−537.07, 741.30) | (−539, 737) | −1.93 | −4.30 | 4.716 |
| VAL | 14 | (−903.29, −333.11) | (−907, −340) | −3.71 | −6.89 | 7.826 |

Validation mean error (−3.02, −5.29); median (−2.40, −4.35).
**14 of 14 samples land above their target; 11 of 14 land left of it.**

**Cause: a systematic aiming bias of roughly (−3, −5), plus one looser point.**
Sample 11 alone contributes 9.094 px; **without it the average is 5.359 px — a
pass.** Portrait geometry is not implicated: `display_mapping_native_targets`
proves this monitor's nine targets land at 0.00 px, negative origin included.

### The saved correction should not have been applied

`Correction: Applied` because `is_constant_offset` used a fixed 2 px tolerance,
and on a 1920 px-tall display the noise-fitted linear terms (`b=0.0013`,
`e=1.0011`) produce 2.3–3.0 px of variation by themselves — just enough to read
as position-dependent.

Scoring three models on the five held-out points settles it:

| Model | Average | Maximum |
| --- | --- | --- |
| Identity | 6.107 px | 9.094 px |
| **Translation-only** (mean offset) | **2.011 px** | 4.886 px |
| Full affine (saved) | 2.392 px | 4.541 px |

**A plain offset beats the full affine on data neither had seen.** The extra
degrees of freedom were fitting noise. So the correction is a uniform shift —
aiming bias — and the affine's tilt actively made it worse.

**Fix:** `is_translation_like()` in `display/mapping.rs`. Fits the simplest
competitor (the mean displacement, no position dependence) and scores both on the
held-out points; if the constant does as well or better, the candidate is refused
as aiming bias. This replaces a pixel tolerance with a model comparison, which is
what the question actually is.

`is_constant_offset` is retained as a fast path, documented as insufficient alone.

### Verified by replay

| Run | Rating | Correction |
| --- | --- | --- |
| Ultrawide 4.16 / 5.36 | **Valid** | identity retained |
| Portrait 6.11 / 9.09 | **Failed** (by 0.105 px) | identity retained |

The portrait failure is **not rounded away** — the test asserts the overage is
greater than zero and under 0.2 px.

### Ghost rings — root cause found and fixed

**`native_overlay::init()` was not idempotent.** Every call spawned a thread,
created three fresh windows, and overwrote `POINTER_HWND`/`HIGHLIGHT_HWND`/
`DRAW_HWND` with the new handles — **orphaning the previous windows while they
were still visible and painted**. Nothing could hide them afterwards, because the
only handle to them had just been overwritten.

`draw_target()` called `init()` before drawing *every* target. Nine points
therefore left nine live windows on screen, and `hide_highlight()` cleared
exactly one. The rings were never stale pixels — they were live windows, which is
why `repaint_desktop()` made no difference and why they could not be dismissed.

This also explains why the earlier live test passed while the real wizard failed:
that test called `init()` once and then looped `show_calibration_target`, which
does not call `init()`. **It never exercised the production path.**

| Item | Status | Where |
| --- | --- | --- |
| `init()` idempotent | COMPLETE | `INIT_STARTED` guard, `native_overlay.rs` |
| Window census | COMPLETE | `overlay_window_census()`, `visible_overlay_count()` |
| One-target invariant | COMPLETE | asserted per point in the live test |

**Test:** `display::mapping_live_test::overlay_windows_do_not_accumulate`
**Command:** `cargo test --lib overlay_windows_do_not_accumulate -- --nocapture --ignored`

```
after first init      6 overlay window(s)
  point 1 Top left       windows 6  visible 1
  …
  point 9 Bottom right   windows 6  visible 1
after nine targets    6 overlay window(s)
after hide_highlight  0 visible
```

Window count is flat across nine `init()` calls, exactly one visible throughout,
zero after cleanup. The census asks Windows via `EnumWindows` rather than reading
the handle statics — the bug it catches is precisely a window the statics no
longer point at, so trusting them would be circular.

### Target colour states

| State | Colour | Behaviour |
| --- | --- | --- |
| Active | violet `(192,132,252)` — the ArcSonare accent | aim here |
| Accepted | green `(122,209,154)` | 300 ms, then the next target |
| Rejected | amber `(215,178,106)` | 300 ms, then back to Active on the *same* point |

`CalibrationTargetState` in `native_overlay.rs`; `flash_target()` in `wizard.rs`
owns the 300 ms timing so React and Rust cannot each schedule a next target.
Every stroke keeps its dark halo and a white under-layer, so the hue stays bright
and readable on light and dark backgrounds alike.

**Test:** `display::mapping_live_test::calibration_target_states` — draws all
three on the real screen, asserts exactly one visible for each and none left
behind. The hues themselves still need a human eye.

### Not done

Targeted retry (Objective 7), borderline result UX (Objective 8), the physical
Display B rerun and runtime enforcement are NOT STARTED.

---

## Update 5 — the real run replayed, and cross-validation was not enough

The physical rerun was **not performed** — ArcSonare returns to its local
password gate on every restart, and this session does not type passwords. Instead
the fourteen samples from the real run were read out of the stored profile and
replayed through the current policy, which answers the same question
deterministically.

**Test:** `display::replay_test::replay_real_ultrawide_run`
**File:** `src-tauri/src/display/replay_test.rs`
**Command:** `cargo test --lib replay_real_ultrawide_run -- --nocapture`

```
validation  n=5  average 4.16 px  maximum 5.36 px  wrong 0  oob 0
rating      Valid
candidate   x' = 1.00000x + -0.00000y + -0.89
            y' = 0.00027x +  0.99895y + -3.28
decision    identity retained
reason      the correction is a constant shift, which is cursor-aiming bias —
            overlay placement is independently verified at 0 px
```

The average and maximum reproduce the stored figures to two decimals, so this is
the real measurement and not a reconstruction. **Status: Valid. Correction:
Identity retained.** Both of the outcomes the rerun was meant to confirm.

### The finding: cross-validation alone accepted the aiming bias

On the first replay, before the guard below existed, the decision was
**"correction applied"** — the candidate cut the held-out average from 4.16 px to
**1.48 px**, a 64 % improvement, and lowered the maximum too.

That was a wrong assumption in Update 4's design. A hand's aiming bias is
**systematic**, not scattered: the same ≈(−1, −3.3) px on all fourteen points. So
it generalises to held-out points exactly as a genuine mapping error would, and
improves them just as much. Held-out accuracy cannot tell the two apart. The
synthetic test that "proved" the rule worked used *scattered* noise, which is not
what a hand does — so it passed while the real data would have failed.

What does separate them is evidence from outside the clicks:
`display_mapping_native_targets` independently proves the overlay lands on its
point at **0.00 px** on both monitors. There is no origin or scale error left for
a correction to remove, so a candidate that is merely a constant shift across the
measured region is describing the operator's eye, not the display.

**Guard added:** `is_constant_offset()` in `display/mapping.rs`, measured as the
spread of the displacement the transform applies across the sampled points
(≤ 2 px ⇒ constant). Coefficients are deliberately not read directly — a scale of
0.99895 sounds significant but is barely a pixel over a 1080 px axis, and it is
the effect on this display that matters. A candidate that genuinely varies across
the display is still allowed to prove itself on held-out points.

**Tests:** `a_constant_shift_is_refused_however_well_it_cross_validates`,
plus `a_correction_that_genuinely_helps_is_applied` and
`a_correction_that_worsens_the_worst_point_is_refused`, both rewritten to use
scale-based candidates — their previous pure-translation candidates are now
refused one step earlier, so they were no longer testing what they claimed.

| Item | Status |
| --- | --- |
| Valid tier accepts the 4.2/5.4 run | COMPLETE (replayed) |
| Identity retained for that run | COMPLETE (replayed) |
| Physical rerun on hardware | BLOCKED — password gate |
| Overlay cleanup after Finish, visually | NOT VERIFIED |
| Purple / green / red target states | NOT STARTED — gated on the rerun |

---

## Update 4 — the run completed, and the verdict was wrong

The physical run **worked end to end**. Global Space recorded, the UI advanced,
nine calibration points and five validation points were collected, and a profile
was written. That is the first complete pass through the whole lifecycle.

Measured result:

| Stage | Figure |
| --- | --- |
| Calibration accepted | 9 |
| Rejected attempts | 0 |
| Outliers removed | 0 |
| Fit residual | 0.9 px |
| Validation accepted | 5 |
| **Average error** | **4.16 px** |
| **Maximum error** | **5.36 px** |
| Wrong display | 0 |
| Out of bounds | 0 |

It was recorded as **Failed**, on 0.16 px of average error.

### Two things were wrong, and neither was the geometry

**1. The pass bar was measuring the hand, not the mapping.** The canonical
Windows mapping is verified at 0.00 px by `display_mapping_native_targets`. What
nine hand-aimed rings measure is whether a person and ArcSonare agree on the same
coordinate system, and that carries irreducible human noise. A 4.2 px average
with a 5.4 px maximum, on the right display and entirely in bounds, is a good
manual result.

Replaced with two tiers, both stated on the result screen:

| Tier | Average | Maximum |
| --- | --- | --- |
| Excellent | ≤ 4 px | ≤ 8 px |
| Valid (pass) | ≤ 6 px | ≤ 10 px |

A point on the wrong display or out of bounds still fails at any error — those
are not aiming mistakes.

**File:** `display/mapping.rs` — `AccuracyRating`, `rate()`,
`EXCELLENT_AVERAGE_PX`/`VALID_AVERAGE_PX` (and maxima).
**Tests:** `the_real_four_point_two_run_is_a_pass`,
`a_run_past_the_valid_bar_still_fails`,
`the_wrong_display_or_out_of_bounds_never_passes`,
`a_very_steady_run_is_rated_excellent`.

**2. A correction was fitted from cursor-tip bias and applied unchecked.** The
stored transform from that run was:

```
a=1.00000  b=0        c=-0.89
d=0.00027  e=0.99895  f=-3.28
```

That is the operator's aim — about −0.9 px across and −3.3 px down — on its way
into the coordinate system for every future click. The 0.9 px fit residual proves
only that least squares reproduces its own input, and the 4.16 px validation
average was measured against *raw* targets, so nothing in the run ever tested
whether the correction helped.

Corrections are now cross-validated: fitted from calibration, then judged on the
five validation points the fit never saw. Identity is kept unless the candidate
lowers the average by **≥ 20 %** without worsening the maximum, and is
geometrically plausible (scale within 5 %, shear ≤ 0.02, offset ≤ 50 px). The
result screen states which was kept and why.

**File:** `display/mapping.rs` — `choose_correction()`, `CorrectionDecision`.
**Wired:** `wizard.rs` — `candidate_correction` fitted at validation start,
adopted or discarded in `complete_display_mapping`.
**Tests:** `a_cursor_bias_fitted_from_clicks_is_not_kept_without_evidence` (uses
the exact measured transform), `a_correction_that_genuinely_helps_is_applied`,
`a_correction_that_worsens_the_worst_point_is_refused`,
`an_implausibly_large_correction_is_refused_outright`,
`a_low_fit_residual_alone_does_not_justify_a_correction`.

**Under both changes, that run now reads: Valid, accuracy Excellent-adjacent,
correction — identity retained.**

### Also fixed

- Phase messaging: the HUD now reads `Point n of 9` under **Calibration** and
  `Point n of 5` under **Validation**, with "Calibration complete. Five fresh
  points to check the result." Previously the extra five targets appeared with no
  explanation, which reads as the wizard being stuck.
- Result screen: separate Calibration and Validation blocks, accuracy rating, the
  thresholds themselves, and the correction reason in words.
- "Display check failed" replaced with "Display verification needs another run".

### Encoding damage repaired

Several PowerShell `Set-Content` round-trips had re-encoded UTF-8 punctuation in
`wizard.rs`, `native_overlay.rs` and `DisplayMappingWizard.tsx` — in one case
triple-encoded, and one of them was a user-visible progress string. All three
files are now clean. **PowerShell `Set-Content` should not be used to rewrite
source files containing non-ASCII text.**

### Not done

| Item | Status |
| --- | --- |
| One-target-only rendering | NOT VERIFIED — `repaint_desktop()` is in, unproven on screen |
| Purple / green / red target states | NOT STARTED |
| Accepted-state 300 ms timing | NOT STARTED |
| Cancel / Finish cleanup verified visually | NOT STARTED |
| Synthetic 14-point harness | PARTIAL — helpers only |
| Ultrawide / portrait re-runs under new policy | NOT STARTED |
| Runtime enforcement | NOT STARTED — still gated |

---

## Update 3 — two blocking defects found by attempting the run

The physical retry was attempted with the corrected build. It got as far as
identification and the first calibration target, and stopped there — because
pressing Space did nothing visible. Two real defects came out of that.

### Defect A — global Space recorded silently, UI froze (fixed)

`register_sample_key` registered the bare `Space` shortcut successfully, which
means Windows delivered the key to the shortcut handler **instead of** the
webview. The handler then called `record_sample_internal` and **discarded the
result**:

```rust
let _ = record_sample_internal(&handle, &state, &session_id);
```

Nothing was waiting on that value. The sample was recorded and the target
advanced in Rust, while the interface stayed on "1 of 9 — Top left" forever. From
the outside it is indistinguishable from Space not working at all — and it is
caused *by* the global shortcut succeeding, so the more correct the input path
became, the more broken the wizard looked.

**Fix:** Rust emits `arcsonare://display-mapping-sample` with the new status;
the wizard listens and applies it. Phase transitions moved into that listener so
the global path and the in-app fallback leave a finished phase the same way.

| Item | Where |
| --- | --- |
| `SAMPLE_EVENT` + `emit` | `display/wizard.rs` |
| `listen(SAMPLE_EVENT)` | `DisplayMappingWizard.tsx` |
| Phase advance moved out of `recordClick` | `DisplayMappingWizard.tsx` |

### Defect B — nine rings on screen at once (fixed)

A screenshot mid-run showed **all nine calibration targets simultaneously**,
though only one overlay window exists. Zooming confirmed they were fully
rendered rings, not artefacts of the screenshot.

They were paint residue. Hiding or moving a layered window does not repaint what
was behind it — the desktop redraws only when told to — so stepping one target
through nine positions left a ring painted at every one. They cleared on restart,
which confirms nothing was leaking; but on screen it is indistinguishable from
nine overlays that were never cleaned up, and it directly contradicts "no overlay
remains after Finish".

**Fix:** `repaint_desktop()` in `native_overlay.rs` (`RedrawWindow` with
`RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN`), called on `hide_highlight` and
before each target move.

### Confirmed working on screen

- Identification: border around the correct physical monitor, panel reading
  "Display A / Generic PnP Monitor / 3840 × 1080 / 100% / Landscape / Primary: Yes".
- The new calibration target renders as designed — thin ring, crosshair arms
  stopping short of centre, visible centre dot, dark halo legible over bright
  desktop icons and the dark app window alike (verified by zoom).
- Instruction copy: "Move the pointer to the centre dot of the target on
  **Display A**. **Do not click.** Press `Space` to record — it works from any
  window."
- "Redo last" correctly disabled with no samples recorded.

### Still BLOCKED

The run could not be completed. ArcSonare returns to its **local password gate**
on every restart, and entering a password is not something this session will do.
Each fix requires a rebuild, and every rebuild puts the app back behind that
screen.

**Not claimed:** ultrawide calibration, portrait calibration, either validation
run, restart persistence, visual cleanup confirmation after Finish. Runtime
enforcement remains deliberately unwired, per the stated gate.

---

## Update 2 — sampling lifecycle diagnosed and repaired

The second physical run (211.1 px average, 1028.5 px maximum) was diagnosed from
the persisted samples. **The cause was not the coordinate pipeline — that part is
correct.** Three separate defects combined.

### Failed-sample diagnosis — COMPLETE

Every sample was recovered from `display-mappings.json` before archiving:

| # | Stage | Target | Expected | Actual | Distance |
| --- | --- | --- | --- | --- | --- |
| 3 | calibration | Top right | (3776, 64) | (3773, 57) | 7.62 |
| **4** | **calibration** | **Middle left** | **(64, 540)** | **(3773, 60)** | **3739.93** |
| 8 | calibration | Bottom centre | (1920, 1016) | (1916, 1009) | 8.06 |
| **9** | **calibration** | **Bottom right** | **(3776, 1016)** | **(1915, 1009)** | **1861.01** |
| 11 | validation | Random 2 | (930, 155) | (928, 149) | 6.38 |
| **14** | **validation** | **Random 5** | **(165, 838)** | **(926, 146)** | **1028.54** |

**Samples 4, 9 and 14 each recorded the cursor at the *previous* sample's
position.** Sample 4's actual is sample 3's spot; sample 9's is sample 8's;
sample 14's is sample 11's. Space registered a second time before the pointer
moved on. Samples 4 and 9 were in the calibration set and were **fitted**, which
is why a correction was applied to a display that needed none.

The 1028.5 px sample was **accepted silently** and only surfaced on the summary
screen — the fifth defect in the report, confirmed.

**A second finding from the same data.** Every clean sample carries a systematic
bias of roughly **(−3, −7) px** — errors negative in both axes almost without
exception. That is not random aim. It is the arrow cursor's hotspot sitting
up-left of where a person reads the pointer as being, with nothing precise to
correct against. Discarding the three bad samples leaves an average around 7 px,
**still outside the 4 px bar**. The padded highlight rectangle was as much the
problem as the double-press.

### Repairs

| Item | Status | Where |
| --- | --- | --- |
| Dedicated calibration target | COMPLETE | `native_overlay::draw_calibration_target`, `show_calibration_target` |
| Native target on production path | COMPLETE | `wizard::draw_target` → centre-based call |
| Global Space input | COMPLETE | `wizard::register_sample_key` / `unregister_sample_key` |
| Focus independence | COMPLETE | bare `Space` global shortcut, not a webview handler |
| Repeat suppression | COMPLETE | `ShortcutState::Pressed` only; `e.repeat` in the UI path |
| Key-release rearm | COMPLETE | `armed` ref + `keyup` in `TargetSurface` |
| Immediate error rejection | COMPLETE | `GROSS_ERROR_PX` (100 px), `UNMOVED_PX` (3 px) |
| Per-sample feedback | COMPLETE | `SampleFeedback` → `.dmw-feedback-ok` / `-bad` |
| Rejected-attempt diagnostics | COMPLETE | `RejectedSample` with reason and distance |
| Sample-count clarification | COMPLETE | separate Calibration / Validation blocks |
| Cleanup lifecycle | COMPLETE | `cleanup_display_mapping_session` |
| Failed-profile reset | COMPLETE | `reset_profile_measurements` on session start |
| Redo gated on a sample | COMPLETE | `canRedo` prop |

The new target is a thin ring (22 px radius), crosshair arms that **stop short of
the centre**, and a 2 px centre dot, every stroke carrying a dark halo so it
reads on light and dark backgrounds. The arms deliberately leave the exact centre
visible — that is the thing the cursor tip has to be placed on, and the previous
visual covered it.

Two thresholds, kept apart on purpose: `GROSS_ERROR_PX = 100` refuses a press
that cannot be an attempt at the target, while the 4 px / 8 px acceptance bar is
untouched. A test asserts the gap so the refusal bar can never be quietly
lowered into an acceptance bar
(`the_gross_error_bar_is_far_looser_than_the_acceptance_bar`).

**Command:** `cargo test --lib display_mapping_native_targets -- --nocapture --ignored`
**Result:** 18 targets across both monitors, worst centre error **0.00 px**, each
asserted inside its own monitor — now measured through
`show_calibration_target` / `calibration_target_centre`, the production path.

**Tests:** `the_samples_that_ruined_the_first_run_are_now_refusable`,
`ordinary_aiming_error_is_not_refused`,
`the_gross_error_bar_is_far_looser_than_the_acceptance_bar`.

### Still outstanding after this pass

| Item | Status |
| --- | --- |
| Synthetic 14-point state-machine pass | PARTIAL — `test_record_at` / `test_active_target` helpers exist; the full driver needs an `AppHandle`, which `cargo test --lib` has no way to build |
| Ultrawide manual calibration | NOT STARTED |
| Portrait manual calibration | NOT STARTED |
| Overlay removal after Finish | COMPLETE in code, NOT visually confirmed |
| Runtime enforcement | NOT STARTED — deliberately deferred |

---

## Update 1 — native target fix verified, physical re-run BLOCKED

The DOM-target defect described further down is **fixed and proved**, by
measurement rather than inspection.

**Test:** `display::mapping_live_test::display_mapping_native_targets`
**File:** `src-tauri/src/display/mapping_live_test.rs`
**Command:** `cargo test --lib display_mapping_native_targets -- --nocapture --ignored`

Every one of the nine targets on both attached monitors is drawn through the
native overlay and then **read back from Windows** with `GetWindowRect`:

| Monitor | Bounds | Targets | Worst centre error |
| --- | --- | --- | --- |
| Generic PnP Monitor (ultrawide) | 3840×1080 @ (0, 0) | 9 | **0.00 px** |
| Generic PnP Monitor (portrait) | 1080×1920 @ (−1080, −661) | 9 | **0.00 px** |

The portrait targets land at genuinely negative desktop coordinates
(top-left `(−1016, −597)`, bottom-right `(−64, 1195)`), and each ring is asserted
to fall **inside its own monitor's bounds** — under the old bug the portrait
targets were drawn inside a window sitting on the ultrawide, which this assertion
catches directly. The expected pre-input error is zero and it measured zero.

**BLOCKED — the physical calibration re-run was not performed.** ArcSonare opens
at its local password gate, and entering a password is not something this session
will do. Steps 6–9 (identification, nine-point, random validation, restart
persistence) all sit behind that screen and need the user signed in.

Per the stated ordering, runtime enforcement was **deliberately not wired** — it
is gated on the physical calibration passing on both monitors, which has not
happened.

### Also fixed this pass

| Item | Status | Detail |
| --- | --- | --- |
| DOM target removal | COMPLETE | `.dmw-target`, `-ring`, `-dot` gone from TSX; orphaned CSS removed |
| Source-level DOM guard | COMPLETE | 8 checks in `scripts/check-display-mapping.mts` |
| Duplicate/repeat Space | COMPLETE | `e.repeat` rejected + key-up required before re-arming |
| Failed-profile reset | COMPLETE | `reset_profile_measurements()` in `wizard.rs` |
| Failed profile archived | COMPLETE | `display-mappings.failed-dom-bug.json.bak` |

**Space-key gap that was found.** The handler was guarded only by a `busy` flag.
Holding the key produces a stream of `keydown` events, so a leaned-on Space would
have recorded the same cursor position for every remaining target and declared
the display verified. Now `e.repeat` is rejected and a `keyup` must re-arm.

**Stale-sample gap that was found.** `start_display_mapping_session` inherited the
previous run's samples. A retry after a failure would have fitted its affine
correction partly from the failure it was meant to replace. The session now
clears samples, correction and error figures first, keeping `configured_at_ms`.

The eight new source checks exist because this class of bug is invisible from
inside the webview — every DOM measurement agrees with every other, and only the
native cursor disagrees. They assert no `dmw-target` element, no inline
`left`/`top` from display coordinates, no display-relative percentage, no
`clientX`/`clientY`/`offsetX`-style event coordinate used as a sample, keydown
sampling with a repeat guard, and that `recordMappingClick` sends nothing but a
session id.

---

## Summary

The wizard is built and **visibly ran on the real machine**: the first-run prompt
appeared, the identification border was drawn, nine calibration points and five
validation points were collected, and a versioned profile was written to disk
keyed on the monitor's EDID hardware identity.

It also **failed its first real run — correctly.** The measured error was 443 px
average, and the cause was a defect in the wizard's own UI, not in the display
mapping. The fail-closed path did exactly what it was built to do: it recorded
`Failed`, refused to save a `Valid` profile, and kept visual interaction blocked.
The defect is fixed; **the run has not been repeated since the fix**, so the
wizard is reported PARTIAL rather than COMPLETE.

Books-folder targeting is unaffected and re-verified.

---

## The failure worth reading first

First real run, persisted to `%APPDATA%\com.arcsonare.desktop\display-mappings.json`:

```
status     failed
avgErr     443.74 px      maxErr  771.29 px      samples 14      correction affine
identity   \\?\DISPLAY#LHC9019#5&2a33d992&0&UID4358#{e6f07b5f-…}
```

**Cause.** `.dmw-target-surface` is `position: fixed`, which in a webview means
the *window* viewport, not the display. The main window covers roughly a third
of the 3840×1080 screen, so a target placed at "70% across the display" was drawn
at 70% across the window. The user aimed at the ring; the ring was in the wrong
place. Every pixel of that 443 px was the wizard's own error, and it would have
been recorded as the display's.

**Fix.** `draw_target()` in `display/wizard.rs` now draws the target through the
native overlay at the real desktop coordinate, the same mechanism that draws the
identification border. The webview shows instructions only. Sampling changed from
clicking a DOM element to *aim the pointer at the native ring, press Space* —
clicking was also wrong on its own terms, since the ring sits over whatever is on
the desktop and a calibration run must not press things. The "Record point"
button was removed for the same reason: pressing it puts the cursor on the
button, and that position is what would be measured.

**What this says about the design.** The one part that could not be unit-tested —
where a DOM element lands on a physical screen — is the part that broke. The
parts that were testable were correct on the first run. Worth remembering the
next time something looks too simple to be worth a native path.

---

## 1. Foundations

| Item | Status |
| --- | --- |
| Stable monitor identity | COMPLETE |
| Profile data model | COMPLETE |
| Profile persistence | COMPLETE |
| Corrupt-store recovery | COMPLETE |
| Profile migration | COMPLETE |

**Files:** `src-tauri/src/display/identity.rs` (pre-existing, reused),
`src-tauri/src/display/profile_store.rs` (new).
**Types:** `PersistedDisplayProfile`, `DisplayProfileStore`,
`DisplayProfileStatus` (7 states), `StoredRect`, `LoadOutcome`.
**Command:** `cargo test --lib display::profile_store` — 19 tests, all pass.

Writes are atomic (temp file + rename). A corrupt store recovers to empty and the
unreadable file is preserved as `.json.corrupt` rather than overwritten — it is
the only evidence of what went wrong. A store from a newer build is refused
rather than downgraded.

Key tests: `the_persisted_key_is_hardware_not_a_runtime_index`,
`a_corrupt_file_recovers_instead_of_failing`,
`a_store_from_a_newer_build_is_refused_rather_than_downgraded`,
`nothing_in_a_stored_profile_resembles_a_screenshot_or_a_secret`,
`a_disconnected_profile_is_kept_rather_than_deleted`,
`a_saved_store_reloads_with_its_profiles_intact`.

Confirmed on disk: the persisted key is
`\\?\DISPLAY#LHC9019#…UID4358#{…}`, never the runtime xcap id.

---

## 2. Geometry and fitting

| Item | Status |
| --- | --- |
| Nine-point target generation | COMPLETE |
| Error calculation | COMPLETE |
| Affine fitting | COMPLETE |
| Outlier rejection | COMPLETE |
| Random validation | COMPLETE |
| Pass thresholds | COMPLETE |

**File:** `src-tauri/src/display/mapping.rs`
**Command:** `cargo test --lib display::mapping` — 29 tests, all pass.

Targets are generated in display-local space and converted to desktop space by a
single addition, so a negative origin never enters the arithmetic. The inset
adapts to small displays (`inset_for`). Fitting is least squares over the normal
equations with partial pivoting; collinear or under-determined input returns
`None` rather than a transform that fits the data and nothing else. A fit within
sub-pixel jitter of identity is stored as no correction at all.

Key tests: `no_target_sits_on_the_outermost_pixels`,
`a_negative_origin_monitor_maps_into_negative_desktop_space`,
`a_portrait_display_spreads_targets_down_its_long_axis`,
`a_perfect_run_fits_the_identity_transform`,
`collinear_points_do_not_determine_a_transform`,
`a_single_wild_miss_fails_a_run_with_a_good_average`,
`a_click_on_the_wrong_display_fails_the_run_outright`,
`random_targets_are_not_the_calibration_points_again`,
`a_fitted_correction_reduces_the_error_it_was_fitted_for`.

**Bug found by its own test.** Outlier rejection first used mean and standard
deviation. One 300 px misclick among eight good samples inflates σ so far that
the outlier sits comfortably inside 3σ — the estimator is corrupted by the very
sample it is meant to find. Switched to median/MAD
(`one_wild_misclick_is_rejected`). A uniformly bad run is still not rescued by
discarding samples (`a_uniformly_bad_run_is_not_rescued_by_discarding_samples`).

---

## 3. Session, commands and enforcement

| Item | Status |
| --- | --- |
| Wizard state machine | COMPLETE |
| Startup topology comparison | COMPLETE |
| Changed-monitor stale state | COMPLETE |
| Disconnected profile preservation | COMPLETE |
| Multi-display sequence | COMPLETE |
| Ignore / Re-enable | COMPLETE |
| Diagnostics | COMPLETE |
| Runtime visual-profile enforcement | PARTIAL |

**File:** `src-tauri/src/display/wizard.rs`
**Command:** `cargo test --lib display::wizard` — 10 tests, all pass.

17 commands registered in `lib.rs`: `get_display_configuration_summary`,
`display_mapping_needs_attention`, `start_display_mapping_session`,
`identify_display`, `begin_nine_point`, `show_mapping_target`,
`record_mapping_click`, `retry_mapping_sample`, `run_random_validation`,
`complete_display_mapping`, `cancel_display_mapping`, `test_display_overlay`,
`test_display_cursor`, `ignore_display`, `enable_display`,
`remove_display_profile`, `get_display_mapping_diagnostics`.

Every session-scoped command validates the session id (`a_session_only_answers_to_its_own_id`).
`record_mapping_click` takes **no coordinate** — Rust reads `GetCursorPos` itself.

Key tests: `a_resolution_change_makes_a_profile_stale`,
`moving_a_monitor_does_not_invalidate_its_profile`,
`an_ignored_monitor_stays_ignored_and_is_not_asked_about`,
`a_failed_profile_keeps_visual_interaction_blocked`,
`a_click_outside_the_display_is_marked_out_of_bounds` (negative-origin portrait).

**PARTIAL — enforcement.** `visual_interaction_error()` exists and returns the
typed codes (`DISPLAY_NOT_CONFIGURED`, `DISPLAY_PROFILE_STALE`,
`DISPLAY_PROFILE_FAILED`, `DISPLAY_IGNORED`, `DISPLAY_IDENTITY_MISMATCH`), but it
is **not yet called from `display::visual_commands`**. Visual actions are
therefore not actually blocked on unconfigured displays yet. Native actions
correctly need no profile — that half is structural, since nothing in the native
path consults one.

---

## 4. Interface

| Item | Status |
| --- | --- |
| First-run prompt | COMPLETE |
| Display list | COMPLETE |
| Display identification | COMPLETE |
| Settings interface | COMPLETE |
| Arrangement diagram | COMPLETE |
| Test overlay / Test cursor | COMPLETE |
| Fail handling | COMPLETE |

**Files:** `src/features/display-mapping/displayMappingService.ts`,
`DisplayMappingWizard.tsx`, `DisplayMappingPrompt.tsx`,
`src/pages/settings/DisplayMappingSettingsPage.tsx`,
`src/styles/display-mapping.css`.
**Command:** `npm run test:display-mapping` — 18 checks, all pass.

Settings → **Desktop Interaction** → Display Mapping, with all requested fields
and actions. The arrangement diagram uses one scale for both axes so a portrait
monitor still reads as portrait, and computes its bounding box rather than
assuming an origin at 0,0 — a monitor left of or above the primary has negative
coordinates. Tested by `a_monitor_to_the_left_is_drawn_to_the_left`,
`negative_origins_do_not_push_a_monitor_outside_the_diagram`,
`aspect_ratio_is_preserved_rather_than_stretched_to_fit`.

The prompt is non-blocking and snoozes for a week on "Later" — a prompt that
returns on every window show is one the user learns to dismiss without reading.

Two checks exist purely to stop the wording overclaiming:
`a_verified_display_does_not_claim_anything_about_recognition` and
`the_failed_status_is_not_softened_into_something_reassuring`. **Display mapping
and target recognition are reported as separate statuses throughout.**

---

## 5. Physical verification

| Item | Status |
| --- | --- |
| First-run prompt appeared | COMPLETE |
| Wizard visibly ran | COMPLETE |
| Profile written to disk | COMPLETE |
| Nine-point passed on ultrawide | NOT ACHIEVED (failed, cause fixed, not re-run) |
| Nine-point passed on portrait | NOT STARTED |
| Random validation passed | NOT ACHIEVED |
| Restart persistence | NOT STARTED |
| New-monitor detection | NOT STARTED (logic tested; no hot-plug performed) |

**Build under test:** `src-tauri\target\debug\arcsonare.exe`, rebuilt 19:40:56,
PID 33248. Screenshots confirm the first-run prompt, the identification border
around Display A, the calibration HUD at "3 of 9 — Top right", and the validation
HUD at "3 of 5 — Random point 3".

**A stale-binary catch worth recording.** Midway through, the running process was
`…\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\ArcSonare\arcsonare.exe`
— not the debug build, and not the previously-known stale path either. The debug
binary also needs `npm run dev` on port 1420, because a `cargo build` debug binary
loads `devUrl`, not the bundled `dist`.

**Not claimed:** no nine-point or random validation run has passed. The only
completed run failed for the reason in the opening section, and has not been
repeated since the fix. Neither monitor is verified. No restart-persistence check
and no hot-plug test were performed.

---

## 6. Regressions

| Item | Status |
| --- | --- |
| Books-folder regression | COMPLETE |
| Open-folder regression | COMPLETE |
| Existing regression tests | COMPLETE |

`cargo test --lib planner_highlight_real_books_folder -- --nocapture --ignored`,
after all wizard work:

```
intent HighlightDesktopItem   strategy InternalCapability
requires capture false        requires cursor false
resolved path C:\Users\rober\Desktop\books
target rect  (0, 789) 74x70   overlay rect (0, 789) 74x70
centre distance 0.00 px       IoU 1.0000    neighbour centres 0
vision called false
```

| Command | Result |
| --- | --- |
| `cargo test --lib` | **306 passed, 0 failed**, 4 ignored (248 at session start) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `cargo build` | exit 0 |
| `npm run test:planner` / `ownership` / `files` / `pointer` / `vision` / `visual-dispatch` / `voice` | all pass |
| `npm run test:desktop-targeting` | all passed |
| `npm run test:planner-highlight` | all passed |
| `npm run test:display-mapping` | all passed (**new**, 18 checks) |
| `cargo fmt -- --check` (scoped) | exit 0 |
| `cargo clippy` | **NOT AVAILABLE** — not installed for `stable-x86_64-pc-windows-msvc`; `rustup component add clippy` |

`npm run test:display-mapping-ui` was not added — the wizard's component logic is
step sequencing over Tauri commands, and with no DOM test harness in this repo a
script would be asserting mocks rather than behaviour.

---

## 7. Voice

| Item | Status |
| --- | --- |
| Voice speaker/microphone test | BLOCKED |

Unchanged and not rewritten. `cargo test --lib voice_session` (13 tests) and
`npm run test:voice` pass. The physical test needs a person with live audio
hardware. **Physical echo suppression is not claimed.**

---

## Completion definition

| # | Requirement | Status |
| --- | --- | --- |
| 1 | User with no profiles sees the first-run prompt | COMPLETE — observed on screen |
| 2 | Wizard visibly identifies each monitor | PARTIAL — observed on Display A only |
| 3 | Nine-point uses native physical cursor coordinates | COMPLETE — `GetCursorPos`, no coordinate accepted from the webview |
| 4 | Random validation passes on both real monitors | NOT ACHIEVED |
| 5 | Stable identities persisted | COMPLETE — verified on disk |
| 6 | Profiles survive restart | NOT TESTED |
| 7 | Runtime xcap id changes do not invalidate profiles | COMPLETE — no runtime id is persisted |
| 8 | A new display requires only its own setup | COMPLETE in logic; no hot-plug performed |
| 9 | Visual interaction blocked only on invalid displays | PARTIAL — helper exists, not wired into `visual_commands` |
| 10 | Native actions remain available | COMPLETE |
| 11 | Settings supports reconfiguration and validation | COMPLETE |
| 12 | Books-folder targeting remains exact | COMPLETE |
| 13 | All applicable tests pass | COMPLETE |

**Display Mapping is not declared complete.** Items 2, 4, 6, 9 are outstanding.

---

## Files changed

| File | Change |
| --- | --- |
| `src-tauri/src/display/mapping.rs` | **new** — targets, affine fit, outliers, validation |
| `src-tauri/src/display/profile_store.rs` | **new** — versioned atomic persistence |
| `src-tauri/src/display/wizard.rs` | **new** — session, 17 commands, enforcement helper |
| `src-tauri/src/display/mod.rs` | registered the new modules |
| `src-tauri/src/lib.rs` | `WizardState` managed, 17 commands registered |
| `src/features/display-mapping/displayMappingService.ts` | **new** |
| `src/features/display-mapping/DisplayMappingWizard.tsx` | **new** |
| `src/features/display-mapping/DisplayMappingPrompt.tsx` | **new** |
| `src/pages/settings/DisplayMappingSettingsPage.tsx` | **new** |
| `src/styles/display-mapping.css` | **new** |
| `src/main.tsx`, `src/app/AppShell.tsx`, `src/pages/SettingsPage.tsx`, `src/components/settings/SettingsSidebar.tsx`, `src/stores/appStore.ts` | wiring |
| `scripts/check-display-mapping.mts`, `package.json` | **new** suite |

No commits were made. Unrelated working-tree changes were preserved.
