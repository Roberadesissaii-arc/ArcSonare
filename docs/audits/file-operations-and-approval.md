# File Operations and Approval

**Date:** 2026-07-31
**Branch:** `master` · **HEAD at start:** `a8c17873d68b7b87d4a31a75274ed07759a36641`
**Scope:** the create-versus-modify confusion and the confirmation loop it
caused, plus the planner's visual disposition. Follows
[visual-click-reliability.md](visual-click-reliability.md).

---

## 1. Why the loop happened

Three independent faults stacked, which is why it repeated forever rather than
failing once:

1. **No token was ever issued.** `create_or_write_file` returned
   `needs_confirmation` with `{reason, path, options}` and never called
   `ConfirmationStore::issue()`. `extractConfirmation` read `token: undefined`,
   so the resumed call arrived with `confirmed = false`.
2. **The resume never carried the decision.** `resolvePendingConfirmation` had
   branches for `applications.open`, `filesystem.delete`, `screen.capture` and
   `tasks.*` — none for file writes. The resumed call was byte-identical to the
   one that asked. The file still existed. Same question.
3. **Even with a token it would have failed.** `consume()` fingerprints the
   args; changing `if_exists` to `"overwrite"` changes the fingerprint, so the
   approval would not have matched the action it approved.

Underneath all three: `filesystem.create_file` and `filesystem.write_text_file`
were **the same Rust function**. Nothing distinguished "make a new file" from
"change this one", so "fix the bug" hit the existence check and asked to
overwrite — a question the user had already answered by asking.

## 2. What it does now

```
"fix the bug in prime.py"
  → recent artifact resolves the path ArcSonare itself recorded
  → filesystem.read_for_edit  (content + hash)
  → filesystem.modify_file    (smallest patch, no confirmation)
  → hash checked, patch applied in memory
  → temp file + atomic replace
  → read back, syntax checked
  → "Updated prime.py — replaced 1 snippet, no syntax problems found"
```

Creating and modifying are now different capabilities with different risk, and
the create-conflict question issues a token against **the args that will
actually be re-sent**.

---

## 3. Status

| Item | Status |
| --- | --- |
| RequiresVision disposition switch | PARTIAL |
| Planner visual result completion | PARTIAL |
| Correlation ID preservation | COMPLETE |
| File action intent model | COMPLETE |
| CreateFile routing | COMPLETE |
| ModifyFile routing | COMPLETE |
| PatchFile routing | COMPLETE |
| ReplaceFileContents routing | COMPLETE |
| DeleteFile routing | COMPLETE |
| Recent artifact tracking | COMPLETE |
| "Fix that file" resolution | COMPLETE |
| Atomic file writes | COMPLETE |
| File-change conflict detection | COMPLETE |
| Unrelated-content preservation | COMPLETE |
| Syntax verification | COMPLETE |
| Scoped action approval | PARTIAL |
| Approval reuse | COMPLETE |
| Confirmation resume | COMPLETE |
| Repeated confirmation prevention | COMPLETE |
| Cross-surface approval state | PARTIAL |
| Temporary-file cleanup policy | COMPLETE |
| Create-conflict one-time decision | COMPLETE |
| Explicit overwrite handling | COMPLETE |
| Delete confirmation once | COMPLETE |
| No delete-and-recreate fallback | COMPLETE |
| Create-then-fix integration test | COMPLETE |
| Overlay modify-file integration test | NOT STARTED |
| Safe live Python fix test | COMPLETE |
| Native action isolation | COMPLETE |
| Post-click verification | COMPLETE (unchanged) |
| Freshness validation | COMPLETE (unchanged) |
| Visual planner lifecycle | PARTIAL |
| Stable monitor identity documentation | COMPLETE |
| DPI awareness | NOT STARTED |
| Display Mapping wizard | NOT STARTED |

---

## 4. Detail for every COMPLETE item

### File action intent model · Modify / Patch / Replace / Create / Delete routing
- **File:** `src-tauri/src/capabilities/file_edit.rs`
- **Types:** `FilePatch` (`ReplaceText` / `Append` / `FullContent`),
  `ModifyFileArgs`, `AppliedPatch`; functions `apply_patch`, `modify_file`,
  `read_for_edit`, `content_hash`, `atomic_write`, `validate_syntax`.
- **Capabilities:** `filesystem.modify_file` (`Risk::Sensitive`, confirmation
  `never`), `filesystem.read_for_edit` (`Risk::ReadOnly`),
  `filesystem.create_file` (new files only), `filesystem.write_text_file`
  (whole-file replacement only), `filesystem.delete` (still
  `Risk::Destructive`).
- `ReplaceText` is the default because it is the only form that can **fail
  loudly** when the file is not what the caller thought. A full-content write
  always "succeeds", including when it silently discards someone's edits.
- **Tests:** `replacing_a_snippet_leaves_everything_else_alone`,
  `a_snippet_that_is_not_there_is_refused_rather_than_guessed`,
  `an_ambiguous_snippet_is_refused_rather_than_picking_one`,
  `an_ambiguous_snippet_is_allowed_when_the_caller_says_how_many`,
  `appending_keeps_the_file_newline_terminated`
- **Command:** `cargo test --lib` → **187 passed, 0 failed**

### Modify never asks about overwriting
- `modify_file` contains no `needs_confirmation` path at all — asserted at
  source level by *"modifying a file never returns needs-confirmation"*.
- A modification of a file that does not exist returns **not-found**, not a
  silent create: *"a modification of a missing file is refused, not turned into
  a create"* and `file_edit_live_modify_refuses_a_file_that_is_not_there`.

### Recent artifact tracking · "Fix that file" resolution
- **File:** `src/features/capabilities/actionSessionMemory.ts` →
  `recentFileArtifact()`, `FILE_PRODUCING`, and the prompt block in
  `formatSessionActionContext()`.
- The prompt now names the exact path and says: call `read_for_edit` then
  `modify_file`, **do not** call `create_file`, and **do not** search the screen
  — hunting the desktop for a file whose path is recorded is both slower and
  capable of finding a different file with the same name.
- A screenshot is not offered as "that file": only file-producing capabilities
  qualify.
- **Tests:** `"that file" resolves to the path ArcSonare already knows`,
  `the prompt names that path and forbids re-creating it`,
  `a screenshot is not offered as the file to fix`
- **Command:** `npm run test:files` → **21/21**

### Confirmation resume · Approval reuse · Repeated confirmation prevention · Create-conflict one-time decision
- **Files:** `src-tauri/src/capabilities/filesystem.rs` (`create_or_write_file`
  now issues a token against `approved_args` carrying
  `if_exists: "overwrite"`), `src/features/capabilities/capabilityEngine.ts`
  (`resolvePendingConfirmation` sets `if_exists: "overwrite"` before resuming).
- The approved action and the executed action are now **the same action**, so
  the fingerprint check passes and the write runs.
- **Test:** `file_edit_live_create_conflict_asks_once_and_then_proceeds` —
  asserts a token exists (*"a confirmation with no token is a confirmation that
  cannot be answered"*), that it consumes against the resumed args, and that the
  second call succeeds rather than asking again.
- **Command:** `cargo test --lib file_edit_live -- --nocapture`

### Atomic writes · Temporary-file cleanup · No delete-and-recreate
- `atomic_write` writes `<name>.arcsonare-tmp` beside the file and replaces it.
  A crash mid-`fs::write` would otherwise truncate the original and lose it.
- The temporary file is ArcSonare's own; removing it is never the user's file
  being deleted and needs no approval. Documented in the function.
- Nothing in the edit path deletes and recreates: the live test asserts no
  `arcsonare-tmp` files survive.

### File-change conflict detection · Unrelated-content preservation
- `based_on_hash` (FNV-1a over the content read) is compared before writing.
  A mismatch returns **`FILE_CHANGED_SINCE_READ`** and leaves the file alone.
- **Test:** `file_edit_live_create_then_fix` asserts the fix landed, that
  `describe()` and `__main__` survived, that the line count is unchanged, and
  that a patch based on the pre-fix hash is refused **and did not apply**.

### Syntax verification
- **File:** `file_edit.rs` → `validate_syntax`, `check_python_syntax`
- Python is checked *structurally* — brackets, string termination, block bodies
  — without an interpreter. `validate_syntax` returns `None` for file types with
  no checker, so "not checked" and "checked and fine" stay different claims.
  A Python file is never executed to find out whether it works.
- A broken edit is reported `partial` with the reason, not `success`: the change
  is on disk and it does not parse, and both halves have to be said.
- **Tests:** `valid_python_passes_the_syntax_check`,
  `an_unbalanced_bracket_is_caught_before_it_reaches_the_user`,
  `a_block_with_no_body_is_caught`,
  `a_string_containing_a_bracket_does_not_look_unbalanced`,
  `a_comment_containing_a_bracket_does_not_look_unbalanced`,
  `a_docstring_spanning_lines_is_not_an_unterminated_string`,
  `invalid_json_is_caught_and_valid_json_is_not`,
  `a_file_type_with_no_checker_reports_that_rather_than_passing`,
  `file_edit_live_a_broken_edit_is_reported_as_broken`

### Delete confirmation once
- Unchanged and re-asserted: `filesystem.delete` is still `Risk::Destructive`
  and still goes through `destructive_gate`, which issues a real token. The
  overwrite fix did **not** relax deletion — checked by *"deleting still
  requires confirmation"*.

### Create-then-fix integration · Safe live Python fix
- **File:** `src-tauri/src/capabilities/file_edit_live_test.rs`
- Runs in a per-test temp folder and cleans up. **Real output:**
```
create           Success  Wrote "...\prime.py" (276 B).
read_for_edit    hash dfb4286e6ce1b2ff
modify           Success  Updated "...\prime.py" — replaced 1 snippet, no syntax problems found.
preserved        describe() and __main__ intact, syntax ok
repeat patch     Error  That snippet isn't in the file — it may already have been changed.
stale patch      Error  The file changed after I read it — I'll read it again rather than overwrite that change.
cleanup          no temporary files left behind
conflict         asked once, token confirm-1785533520987-0
after approval   Success  Wrote "...\prime.py" (12 B).
5 passed
```

### Correlation ID preservation
- `plan_and_dispatch_action` builds the correlation id from the request id and
  plan id; `completeVisualAction` in `plannerBridge.ts` returns a planner
  `ActionResult` carrying the **same** `requestId` and `planId`, and maps a
  sent-but-unverified click to `partially-completed`, never `succeeded`.

### Native action isolation · Post-click verification · Freshness
- Unchanged and re-verified. `npm run test:planner` 13/13,
  `npm run test:ownership` 25/25, and all three physical tests still pass.

### Stable monitor identity documentation
- Documented in [visual-click-reliability.md](visual-click-reliability.md) §5 and
  repeated here: **xcap display ids change across process restarts.** The same
  two monitors enumerated as `248975325`/`717163523` in one session and
  `1986660975`/`135721` in the next. Runtime frame ownership is unaffected
  (frames live 30s), but a persisted Display Mapping **must not key on xcap
  ids**. Investigate the Windows display device path, EDID-derived identity,
  `DISPLAYCONFIG` target device path or monitor instance id instead.

---

## 5. Verification commands and their real results

| Command | Result |
| --- | --- |
| `cargo test --lib` | **187 passed, 0 failed, 3 ignored** (was 168) |
| `cargo test --lib file_edit_live -- --nocapture` | 5 passed |
| `cargo test --lib safe_physical_click -- --ignored` | 1 passed (10/10 probes) |
| `cargo test --lib stale_visual_target -- --ignored` | 1 passed (5/5) |
| `cargo test --lib physical_overlay_and_cursor -- --ignored` | 1 passed (18/18) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run test:planner` | 13/13 |
| `npm run test:ownership` | 25/25 |
| `npm run test:files` | **21/21** (new) |
| `npm run test:pointer` | 12/12 |
| `npm run test:vision` | 7/7 |
| `rustfmt --check` on the changed Rust files | clean |
| `cargo clippy` | **NOT RUN** — not installed for the `stable-x86_64-pc-windows-msvc` toolchain |

---

## 6. What is PARTIAL or NOT STARTED, and why

**RequiresVision disposition switch — PARTIAL.** `plan_and_dispatch_action`
exists in Rust and returns the tagged union; `planAndDispatchAction`,
`PlanDisposition` and `completeVisualAction` exist in `plannerBridge.ts` and
type-check. What is **not** done is the switch itself in
`capabilityEngine.ts` — visual intents still reach `screen.click_target`
directly. Both halves agree on shape; the call site is unchanged.

**Planner visual result completion — PARTIAL**, for the same reason.
`completeVisualAction` builds a correct planner `ActionResult` with the original
identifiers, and nothing calls it yet.

**Visual planner lifecycle — PARTIAL**, same root cause.

**Scoped action approval — PARTIAL.** The specific loop is fixed and approvals
are consumed exactly once against a fingerprint of the exact action. What is not
built is the general `ActionApproval` type with `ApprovalScope`
(`ThisExactAction` / `ThisFileForCurrentRequest` / `ThisPlan` /
`ThisSessionForNonDestructiveEdits`). Today the scope is implicitly
"this exact action", which is the narrowest and safest of the four — but it is
not selectable.

**Cross-surface approval state — PARTIAL.** Confirmations are keyed by `runId`
in `pendingByRun`, which already survives a reply arriving from a different
surface as long as the same run id is used. There is no test proving an overlay
request confirmed in the main window resumes the same run, and no
`ActionLifecycleState` machine.

**Overlay modify-file integration test — NOT STARTED.**

**DPI awareness / Display Mapping wizard — NOT STARTED**, as instructed.

---

## 7. Behaviour that changed for the user

- "Fix the bug in that file" edits the file. It does not ask to overwrite it,
  because the file existing is the premise of the request.
- Approving a genuine name clash now works: the answer is attached to the action
  and the write runs. Previously "yes" produced the identical question.
- A fix that would break the file is reported as broken, with the reason, and
  the change is still named as being on disk.
- A patch written against a file that changed since it was read is refused with
  `FILE_CHANGED_SINCE_READ` rather than overwriting someone else's edit.
- Deleting still asks. Nothing about the overwrite fix loosened that.
