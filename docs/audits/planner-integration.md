# Planner Integration — Native Vertical Slice

**Date:** 2026-07-31
**Branch:** `master` · **HEAD at start:** `a8c17873d68b7b87d4a31a75274ed07759a36641`
**Scope of this session:** connect the existing strategy planner to the real
command-dispatch path for native actions. Visual interaction deliberately
untouched and still gated.

---

## 1. What the audit found before any code changed

`cargo test --lib` → **91 passed, 0 failed**, matching the handoff exactly. The
display and interaction modules existed and were well tested — and entirely
disconnected. The compiler said so:

```
warning: unused imports: `ActionIntent`, `AttemptStatus`, `AvailableCapabilities`,
         `ExecutionPlan`, `ExecutionStrategy`, `RiskLevel`, and `plan`
warning: unused imports: `CapturedFrame`, `FrameRegistry`, ... `resolve_visual_target`
```

Zero production callers for either. Tested dead code.

### Corrections to the handoff

| Handoff claim | Repository reality |
| --- | --- |
| "the running command engine" is Rust | The command engine is **TypeScript** (`src/features/capabilities/capabilityEngine.ts`). Rust's `capability_execute` is a dispatcher with no planning stage. |
| `src-tauri/src/screenshots.rs` | `src-tauri/src/capabilities/screenshots.rs` (`capture_origin` at :68, called at :106 — otherwise accurate) |
| `src/frontendExecutors.ts` | `src/features/capabilities/frontendExecutors.ts` |
| `AttemptStatus` has `PartiallyCompleted` / `Cancelled` / `FailedAfterPossibleSideEffect` | Real variants: `Succeeded, Unsupported, Unavailable, TargetNotFound, VerificationFailed, PermissionDenied, Unsafe, Failed`. The distinction the handoff wanted is preserved via `ActionStatus::PartiallyCompleted`. |
| Phase 6 (focus-before-launch) not started | `applications::open_application` ([applications.rs:988](../../src-tauri/src/capabilities/applications.rs)) **already** finds a running window and focuses it before launching, with `window-detected` evidence. Reused, not rewritten. |

---

## 2. Status

| Item | Status |
| --- | --- |
| Repository state verified | COMPLETE |
| Previous test claims verified | COMPLETE |
| ActionRequest implemented | COMPLETE |
| Planner connected to command engine | COMPLETE |
| ExecutionPlan executor | COMPLETE |
| Live capability registry | COMPLETE |
| Native folder execution | COMPLETE |
| Native application launch | COMPLETE |
| Native URL execution | COMPLETE |
| Native Windows Settings execution | COMPLETE |
| Native window execution | PARTIAL — focus routed; minimize/maximize/move keep their direct path |
| Media control | NOT STARTED |
| Risk enforcement | COMPLETE |
| Fallback execution | COMPLETE |
| Duplicate prevention | COMPLETE |
| Result verification | COMPLETE |
| Frontend command integration | COMPLETE |
| Visual migration gate | COMPLETE |
| Production per-display capture | NOT STARTED |
| Production frame registration | NOT STARTED |
| Capture metadata returned | NOT STARTED |
| AI frame propagation | NOT STARTED |
| VisualTarget runtime construction | NOT STARTED |
| `capture_origin` removed | NOT STARTED |
| Monitor-under-mouse fallback removed | NOT STARTED |
| Canonical visual resolver wired | NOT STARTED |
| Overlay integration | NOT STARTED |
| Cursor integration | NOT STARTED |
| Click integration | NOT STARTED |
| Live folder test | COMPLETE (resolution verified on real hardware) |
| Live application test | NOT STARTED |
| Live URL test | NOT STARTED |
| Live hardware capture ownership | NOT STARTED |
| Physical overlay test | NOT STARTED |
| Physical cursor test | NOT STARTED |
| DPI awareness | NOT STARTED (unchanged; still process-wide DPI-unaware by choice) |
| First-run Display Mapping wizard | NOT STARTED |

---

## 3. Detail for every COMPLETE item

### ActionRequest implemented
- **File:** `src-tauri/src/interaction/request.rs`
- **Types:** `ActionRequest`, `ActionTarget` (path / application / url /
  system-settings / window / media / visual-description / none), `KnownFolder`,
  `RequestSource`, `ConfirmationState`, `PlannedAction`, `PlanningError`,
  `ActionResult`, `ActionStatus`, `VerificationResult`, `StrategyAttempt`.
- **Tests:** `the_folder_payload_the_frontend_sends_deserializes`,
  `the_application_payload_keeps_its_camel_case_fields`,
  `url_and_settings_payloads_deserialize`,
  `a_result_serializes_with_the_keys_the_frontend_reads`. These use the literal
  JSON `plannerBridge.ts` sends, so a rename on either side fails the suite
  rather than the user's next command.
- **Command:** `cargo test --lib` → **111 passed, 0 failed**

### Planner connected to command engine
- **Files:** `src/features/capabilities/plannerBridge.ts` (new),
  `src/features/capabilities/capabilityEngine.ts` (`executeCapability`)
- The single funnel every capability call already passed through now diverts
  planner-routed ids to `plan_and_execute_action`. Nothing else changed shape:
  the result comes back as a `ToolResult`, so the response composer, audit
  trail, ambiguity confirmations and run store are untouched.
- Routed: `applications.open`, `applications.focus`, `filesystem.open_item`,
  `web.open_url`, `system.open_settings`.
- **Test:** `npx tsx scripts/check-planner-routing.mts` → 13/13 PASS
  (also wired as `npm run test:planner`)

### ExecutionPlan executor
- **File:** `src-tauri/src/interaction/executor.rs`
- **API:** `create_execution_plan()`, `execute_plan()`, `ExecutionContext`
- Validates the target against the intent *before* planning, enforces risk,
  runs one attempt per strategy, verifies, and stops the chain the moment
  continuing could repeat a side effect.
- **Tests:** `opening_a_folder_plans_a_native_route_with_no_screen_or_cursor`,
  `a_url_request_carrying_a_path_is_refused_before_anything_runs`,
  `a_folder_request_with_nothing_to_open_is_refused`,
  `every_native_intent_plans_without_the_cursor_or_a_screenshot`

### Live capability registry
- **File:** `src-tauri/src/interaction/commands.rs` → `live_capabilities()`
- Probed, not declared: `native_filesystem` checks a real Desktop/home dir,
  `application_registry` checks the app index is non-empty.
  `application_adapter`, `ui_automation`, `browser_automation` are hard `false`
  — no implementation exists, and a capability that silently does nothing is
  worse than an admitted gap because the planner would pick it.
- **Command:** `get_available_capabilities` (Tauri)

### Native folder / application / URL / settings execution
- **File:** `src-tauri/src/interaction/executor.rs` → `run_native()`
- Delegates to the existing, already-verified capability functions
  (`filesystem::open_item`, `filesystem::create_directory`,
  `applications::open_application`, `applications::focus_application`,
  `web::open_url`) rather than reimplementing them.
- Settings uses an **allowlist** of ~20 named pages → `ms-settings:` URIs.
  Anything URI-shaped is rejected outright: the scheme reaches far more than
  Settings, and the caller is naming a page, never a URI.
- **Tests:** `every_named_settings_page_maps_to_an_ms_settings_uri`,
  `an_unknown_settings_page_is_refused_rather_than_guessed`,
  `a_more_specific_settings_phrase_wins_over_a_shorter_one`,
  `a_settings_page_never_becomes_an_arbitrary_uri`

### Risk enforcement
- **File:** `executor.rs` → `risk_refusal()`, called before any strategy runs.
- `High`/`Destructive` require `ConfirmationState::Confirmed`. A refusal returns
  immediately — it never falls through to a more invasive strategy.
- **Test:** `a_high_risk_request_without_approval_stops_before_any_strategy`

### Fallback execution + duplicate prevention + result verification
- **File:** `executor.rs` → `execute_plan()`, `from_tool_result()`
- An unverified success is reported as `PartiallyCompleted`, whose attempt
  status does **not** allow fallback. "Windows accepted the launch" is not
  "Spotify is open", and treating it as success is precisely how a fallback
  opens a second instance.
- Folder opens upgrade `return-code` evidence to `filesystem-postcondition` by
  checking the path exists — the postcondition the user actually cares about.
- **Tests:** `an_accepted_but_unconfirmed_launch_is_partial_and_stops_the_chain`,
  `a_target_that_was_never_found_may_still_fall_back`

### Visual migration gate
- **File:** `executor.rs` → `visual_attempt()`
- Returns `VISUAL_INTERACTION_NOT_READY` naming the next blocking step. It never
  constructs a `ToolResult`, which is the proof that no executor ran.
- **Tests:** `a_visual_request_is_refused_with_the_migration_reason`,
  `a_show_me_request_plans_visually_and_then_refuses_to_run`
- `visual_interaction` remains **false**. `VisualMigrationState::current()` is
  unchanged — all six flags still false.

### Live folder test
- **File:** `executor.rs` → `mod tests::live`
- `the_desktop_resolves_without_looking_at_the_screen`,
  `a_named_folder_under_the_desktop_resolves_to_its_real_path`,
  `a_folder_that_does_not_exist_is_refused_rather_than_substituted`
- **Command:** `cargo test --lib interaction::executor::tests::live` → 3 passed
- These resolve and verify against this actual machine but launch nothing, so
  running the suite opens no windows.

---

## 4. Verification commands and their real results

| Command | Result |
| --- | --- |
| `cargo test --lib` | **111 passed, 0 failed** (was 91) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npx tsx scripts/check-planner-routing.mts` | 13/13 PASS |
| `rustfmt --check` on the four new/changed `interaction/*.rs` files | clean |
| `npm run tauri dev` | builds and launches; `arcsonare.exe` running with the three new Tauri commands registered |
| `cargo clippy` | **NOT RUN** — `cargo-clippy` is not installed for the `stable-x86_64-pc-windows-msvc` toolchain |

Pre-existing formatting differences in `applications.rs` were left untouched.

---

## 5. What is explicitly NOT done

The whole visual half. This was deliberate: the handoff's own gate says routing
more traffic into the origin-guessing click path makes the reported inaccuracy
worse, not better. Concretely still outstanding:

1. `capture_origin()` is still live at `capabilities/screenshots.rs:68` (:106).
2. `input.mouse_monitor_bounds` is still dispatched at
   `capabilities/executor.rs:330`, implemented at `capabilities/input.rs:22`.
3. Production `screen.capture` still does not bind a display before calling
   xcap, does not register a `CapturedFrame`, and returns no ownership metadata.
4. `resolve_visual_target()` has no Tauri command; overlay, cursor and click do
   not use it.
5. `display::*` remains unused by production code — the proven logic in
   `display/live_capture.rs` has not been ported into the production capture.

The next contiguous change is Phase 13: port `live_capture.rs`'s
select-display-then-capture-then-register sequence into `screen.capture`, return
`frame_id` / `display_id` / `topology_version`, and only then start flipping the
`VisualMigrationState` flags.

## 6. Existing behaviour

No existing capability was removed or renamed. Non-routed capabilities
(screenshots, clicking, highlighting, clipboard, tasks, Google Workspace) keep
their exact previous path. The four planner-routed ids return the same
`ToolResult` shape they returned before, with plan metadata added under
`data.plan`.
