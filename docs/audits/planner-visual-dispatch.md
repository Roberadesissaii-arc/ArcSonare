# Planner Visual Dispatch and Approval Scope

**Date:** 2026-07-31
**Branch:** `master` · **HEAD at start:** `a8c17873d68b7b87d4a31a75274ed07759a36641`
**Scope:** the central `PlanDisposition` switch, returning visual results to the
plan that asked for them, and making the approval scope explicit. Follows
[file-operations-and-approval.md](file-operations-and-approval.md).

---

## 1. What the audit found

- **The disposition switch had zero callers.** `executeCapability` called
  `executeThroughPlanner` → `plan_and_execute_action`. `planAndDispatchAction`
  and `completeVisualAction` existed, type-checked, and were never invoked.
- **Visual capabilities never reached the planner at all.**
  `screen.click_target` / `highlight_target` are `executor: "frontend"`, and the
  frontend branch ran *before* the planner check — so `isPlannedCapability` was
  never consulted for them. The click happened, the pipeline verified it, and
  the plan that decided a click was appropriate never heard how it went.
- **`sonare-overlay` is a separate webview.** `App.tsx` renders a different tree
  per window label, and each window is its own JS heap. `pendingByRun` is a
  module-level `Map` in `capabilityEngine.ts`, so **the overlay's pending
  confirmations and the main window's are different objects**. A confirmation
  raised in one cannot be resolved from the other. This is why Problem 3 was
  "unproven": it is not unproven, it is currently impossible.

## 2. The shape it has now

```
executeCapability
  → isPlannedCapability || isVisualCapability
      → plan_and_dispatch_action
          ├ "executed"        → ActionResult → ToolResult
          ├ "requires-vision" → fulfillVisualPlan
          │      beginVisualPlan (requestId, planId, runId, correlationId)
          │      → existing vision pipeline, correlationId passed down
          │      → completionFromToolResult
          │      → finishVisualPlan → completeVisualAction
          └ "unsupported"     → ActionResult → ToolResult
  → (otherwise) frontend executor or capability_execute
```

The `default:` branch assigns to `const unreachable: never`, so a new
disposition variant is a compile error rather than a silent fall-through into
the direct path.

---

## 3. Status

| Item | Status |
| --- | --- |
| Central PlanDisposition switch | COMPLETE |
| Direct planner visual bypass removal | COMPLETE |
| PendingVisualPlan lifecycle | COMPLETE |
| RequiresVision fulfillment | COMPLETE |
| Frame ownership preservation | COMPLETE |
| Correlation ID preservation | COMPLETE |
| Plan ID preservation | COMPLETE |
| Request ID preservation | COMPLETE |
| completeVisualAction integration | COMPLETE |
| Visual completion idempotency | COMPLETE |
| Preview result mapping | COMPLETE |
| Verified click result mapping | COMPLETE |
| Partial visual result mapping | COMPLETE |
| Stale-target planner result | COMPLETE |
| Duplicate fallback prevention | COMPLETE |
| Final visual result returned to planner | COMPLETE |
| Shared action lifecycle across surfaces | BLOCKED |
| Explicit exact-action approval scope | COMPLETE |
| Confirmation resume state | COMPLETE |
| Overlay-to-main confirmation | BLOCKED |
| Main-to-overlay status | BLOCKED |
| Confirmation token single consumption | COMPLETE |
| Wrong-run token rejection | COMPLETE |
| Cross-surface cancellation | BLOCKED |
| Repeated prompt prevention | COMPLETE |
| Create-then-fix regression | COMPLETE |
| Create-conflict one-time decision | COMPLETE |
| Modify-existing no-confirmation | COMPLETE |
| Explicit replacement behavior | COMPLETE |
| Deletion confirmation | COMPLETE |
| Temporary cleanup | COMPLETE |
| Native file-action isolation | COMPLETE |
| Planner highlight physical test | NOT STARTED |
| Planner safe-click physical test | NOT STARTED |
| xcap stable-identity documentation | COMPLETE |
| DPI awareness | NOT STARTED |
| Display Mapping wizard | NOT STARTED |

---

## 4. Detail for every COMPLETE item

### Central PlanDisposition switch · bypass removal
- **File:** `src/features/capabilities/capabilityEngine.ts` → `executeCapability`
- **Types:** `PlanDisposition`, `isVisualCapability`, `toToolResult` in
  `plannerBridge.ts`.
- Visual capabilities are now checked **before** the frontend-executor branch;
  that ordering is the fix, and it is asserted.
- `executeThroughPlanner` is deleted — it called `plan_and_execute_action`,
  which returns a finished result and leaves no room for the third answer a
  visual plan needs ("this one is yours to carry out"). Its `toToolResult`
  helper is now shared by the switch rather than duplicated.
- **Tests:** `the engine dispatches on the planner disposition`,
  `every disposition variant is handled`,
  `visual capabilities enter the switch before the frontend executor`,
  `a visual plan is fulfilled, not executed inline`,
  `there is no direct planner-bypassing visual call left in the engine`
- **Command:** `npm run test:visual-dispatch` → **24/24**

### PendingVisualPlan lifecycle · RequiresVision fulfillment
- **File:** `src/features/capabilities/visualPlanLifecycle.ts` →
  `PendingVisualPlan`, `beginVisualPlan`, `advanceVisualPlan`,
  `finishVisualPlan`, `completionFromToolResult`, `planKey`.
- `fulfillVisualPlan` in `capabilityEngine.ts` reuses the **existing** vision
  pipeline via `executeFrontendCapability`. Rebuilding it would mean two
  pipelines, and the second would be the one without freshness, frame ownership
  and verification.
- **Tests:** `fulfilment reuses the existing vision pipeline`,
  `fulfilment passes the plan's correlation id down, and does not mint one`,
  `fulfilment closes the plan`

### Identity preservation (request / plan / run / correlation)
- The correlation id flows **down** from the plan into the pipeline
  (`correlation_id: visualRequest.correlationId`); nothing mints a new one.
- A plan is keyed by `planId::correlationId`, and `finishVisualPlan` also checks
  `requestId` — so a result carrying a mismatched pair cannot close a plan it
  does not belong to.
- **Tests:** `a plan records all four identifiers`,
  `the verified result closes the original plan, unchanged`,
  `a result from a different request cannot close this plan`,
  `and the real plan is still open afterwards`

### Visual completion idempotency · duplicate fallback prevention
- A plan is removed from the map as it completes; a second completion returns
  `{ ok: false, reason: "already-completed" }` and the engine attaches a warning
  rather than absorbing it. Absorbing would append a second activity entry and
  could promote a partial to a success with no new evidence.
- **Tests:** `a second completion is refused, not absorbed`,
  `the side-effect flag survives the trip back from the executor`,
  `a pre-click refusal is not marked as having had a side effect`

### Result mapping (preview / verified / partial / stale)
- Seven mappings asserted in one table:
  `preview-succeeded` → `succeeded`; `verified-succeeded` → `succeeded`;
  `verification-failed` → **`partially-completed`**; `no-verifier-available` →
  `partially-completed`; `screen-changed-before-action` → `not-found` (retry
  allowed, nothing happened); `cursor-position-mismatch` → `failed`;
  `target-window-changed` → `failed`.
- **Tests:** `every visual outcome maps to the planner status it deserves`,
  `a sent-but-unverified click is never reported as completed`

### Explicit exact-action approval scope · wrong-run rejection · single consumption
- **File:** `src-tauri/src/capabilities/confirmation.rs` → `ApprovalScope`
  (one variant, `ExactAction`), `GrantError`, `issue_for_run`,
  `consume_for_run`; wired through `capability_execute` and `destructive_gate`
  in `executor.rs`.
- A token is removed **before** it is validated, so a token that fails one check
  cannot be re-presented against another — guessing a run id is not a way to
  reuse someone else's approval.
- A wrong-run token on a non-destructive path is **denied outright** rather than
  ignored: silently continuing unconfirmed would ask the user again, which is
  the loop this whole area exists to prevent.
- **Tests:** `a_token_from_another_run_cannot_authorise_this_one`,
  `a_rejected_token_is_spent_rather_than_left_for_a_second_try`,
  `the_right_run_consumes_the_grant_exactly_once`,
  `an_unbound_grant_still_works_for_callers_that_send_no_run`,
  `the_only_scope_is_the_narrowest_one`
- **Command:** `cargo test --lib` → **192 passed, 0 failed**

### File behaviour regressions · native isolation
- Unchanged and re-verified: `npm run test:files` 21/21,
  `cargo test --lib file_edit_live` 5 passed, `npm run test:planner` 13/13
  (including *"screen and cursor capabilities are not silently absorbed by the
  planner"*), `npm run test:ownership` 25/25.

---

## 5. Verification commands and their real results

| Command | Result |
| --- | --- |
| `cargo test --lib` | **192 passed, 0 failed, 3 ignored** (was 187) |
| `cargo test --lib file_edit_live` | 5 passed |
| `cargo test --lib safe_physical_click -- --ignored` | 1 passed |
| `cargo test --lib stale_visual_target -- --ignored` | 1 passed |
| `cargo test --lib physical_overlay_and_cursor -- --ignored` | 1 passed |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run test:visual-dispatch` | **24/24** (new) |
| `npm run test:planner` | 13/13 |
| `npm run test:ownership` | 25/25 |
| `npm run test:files` | 21/21 |
| `npm run test:pointer` | 12/12 |
| `npm run test:vision` | 7/7 |
| `rustfmt --check` on the changed Rust files | clean |
| `cargo clippy` | **NOT RUN** — not installed for the `stable-x86_64-pc-windows-msvc` toolchain |

---

## 6. BLOCKED: cross-surface confirmation

**This is a genuine architectural blocker, not an omission.**

`App.tsx` serves one Vite bundle to every window and picks the UI by window
label. `sonare-overlay` is a **separate WebView2 instance with its own JavaScript
heap**. `pendingByRun` is a module-level `Map` inside `capabilityEngine.ts`, so
the overlay and the main window each hold a *different* Map. A confirmation
raised in the overlay is invisible to the main window and vice versa.

What works today: the overlay raises and resolves its own confirmations inline
(`driveOverlayFromEngine` in `overlayActions.ts` matches the next yes/no against
`pendingConfirmRunId`). That path is unaffected and still correct.

What cannot work without new plumbing: approving in one window an action started
in another. Fixing it properly means moving pending-confirmation state out of
the webview — either into Rust managed state alongside `ConfirmationStore`, with
Tauri commands to list and resolve, or a Tauri event bridge that mirrors the
pending map between windows. Both are real work and neither should be faked.

The Rust half is now ready for it: grants are bound to a run id, a wrong-run
token is rejected with a distinct error, and the scope is explicit. What is
missing is the shared *pending action* store, not the approval model.

Consequently **Overlay-to-main confirmation, Main-to-overlay status, Shared
action lifecycle across surfaces and Cross-surface cancellation are BLOCKED**,
and the Part 17 physical cross-surface test could not be run.

## 7. Other incomplete items

**Planner highlight / safe-click physical tests — NOT STARTED.** The switch is
proven at the unit and source level, but no physical run drives a highlight or a
safe click *through* `plan_and_dispatch_action` end to end. The underlying
physical tests (`safe_physical_click`, `physical_overlay_and_cursor`) still pass
against the executor directly.

**DPI awareness / Display Mapping wizard — NOT STARTED**, as instructed.

**xcap stable identity — documented, not solved.** Repeating the finding: xcap
display ids change across process restarts (`248975325`/`717163523` one session,
`1986660975`/`135721` the next, same monitors). Runtime frame ownership is
unaffected because frames live 30 seconds. A persisted Display Mapping must key
on a Windows display device path, monitor instance id, EDID-derived identity or
`DISPLAYCONFIG` target device path instead.
