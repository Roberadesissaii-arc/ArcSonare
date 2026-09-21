# Task mutations, voice safety, and conversation context

Opened after two defects and a set of chat-quality complaints. Phases 1 and 2
are done; phases 3–7 are not started.

## Task mutations

The same defect creation had: `verifyPersisted` re-read the in-memory array the
change had just been applied to, so "did not persist" was unreachable and a
failed write reported success. Every mutation now goes through one contract in
`src/stores/taskStore.ts`.

| Item | Status |
| --- | --- |
| update | COMPLETE |
| complete | COMPLETE |
| reopen | COMPLETE |
| delete | COMPLETE |
| add subtask | COMPLETE |
| assign agent | COMPLETE |
| failure rollback | COMPLETE |
| event synchronization | COMPLETE |
| restart persistence | COMPLETE (verified in the previous session) |

`mutateTaskDurable(id, updater, verify)` awaits the SQLite write, reads the row
back by exact id through `tasks_get_local`, and hands it to a caller-supplied
`verify` — completed is true, the priority is what was asked for — because "the
write returned" and "the field actually changed" are different claims. A failed
or mismatched write restores the previous cache value.

`deleteTaskDurable(id)` confirms absence by asking the database for the id and
requiring nothing back, then restores the task to its original list position if
the write failed.

`verifyPersisted` no longer exists anywhere in the codebase.

Tests: `npm run test:task-durability` → `all passed` (26 checks), including
`complete is verified against the stored row`, `update is verified field-by-field
against the stored row`, `a stored row that lacks the change is reported as
failed` → `persistence-mismatch`, `a mismatched update is rolled back in the
cache`, `a failed delete restores the task to the list and the database`.

Subtasks supplied at create time are now awaited individually, so a subtask that
fails to save cannot be silently dropped from a task reported as saved.

## Voice safety

| Item | Status |
| --- | --- |
| stop behavior | COMPLETE |
| overlay close | COMPLETE |
| late transcript rejection | COMPLETE |
| duplicate transcript / redelivered tool call | COMPLETE |
| cross-session isolation | COMPLETE |
| ambient audio | PARTIAL — see below |
| Rust-owned session state | NOT STARTED |

**The defect.** `runToolCall` is async and awaits `dispatchRealtimeToolCall`. The
only `closed` check happened at the top of `handleEvent`, *before* that await. A
tool call arriving one tick before the overlay closed still reached a capability
and still wrote to SQLite. That is how ambient room audio produced a task called
"Beauty and the Beast" after the session had been dismissed.

**The fix.** A boolean cannot express this — the question is not "is this session
closed" but "is this session still entitled to act", and it has to be re-asked
after every await. `src/services/realtime/sessionGuard.ts` gives each session a
generation at birth; closing any session retires it, and opening a new one
supersedes the old. `RealtimeSession` checks it on entry to `handleEvent`, before
reaching a capability, and again after the await. Tool call ids are de-duplicated
so a redelivery is a no-op.

The guard was extracted into its own dependency-free module because
`RealtimeSession`'s module graph reaches `import.meta.glob`, which only Vite
understands — it could not otherwise be tested without WebRTC and a microphone.

Tests: `npm run test:voice-safety` → `all passed` (13 checks). The suite includes
a source check that the post-await guard exists; deleting that guard makes it
fail with `NO post-await guard — a dismissed session can still act`, which was
verified by removing it and restoring it.

**Ambient audio is PARTIAL.** A dismissed session can no longer act, which closes
the observed failure. What is *not* implemented is confidence-based refusal for
a session that is still open: an ambiguous or low-confidence side-effect request
should ask for clarification rather than create a task. That belongs with the
follow-up resolver in phase 4.

**Rust-owned session state is NOT STARTED.** The guard is per-webview. It is
sufficient for the observed defect, because the overlay's session and its tool
calls live in the same heap. It would not stop a second window from acting.

## Conversation memory

| Item | Status |
| --- | --- |
| recent entities | NOT STARTED |
| tool-result memory | NOT STARTED |
| account isolation | NOT STARTED |
| navigation persistence | NOT STARTED |
| voice/text sharing | NOT STARTED |
| stale visual target handling | NOT STARTED |

## Follow-up resolution

| Item | Status |
| --- | --- |
| it / that / that one | NOT STARTED |
| ordinal references | NOT STARTED |
| ambiguous references | NOT STARTED |
| missing context | NOT STARTED |

`npm run test:click` still fails on `"press it" with no history does not search
for "it"`. It is the same defect this phase would fix. It has not been touched
and its expectation has not been changed.

## Response quality

| Item | Status |
| --- | --- |
| friendly confirmations | NOT STARTED |
| recommendations | NOT STARTED |
| accurate success/failure | PARTIAL |
| result presentation | NOT STARTED |
| action chips | NOT STARTED |

Accurate success/failure is PARTIAL only in the sense that mutation failures now
say something a person can act on — "I couldn't save that update, so nothing
changed" rather than "Readback mismatch" — and distinguish a write that never
landed from one that landed without the change. The wider composer is not built.

## Verification

`cargo test --lib` → 408 passed, 0 failed, 11 ignored. `npx tsc --noEmit` clean.
`npm run build` clean. `test:task-durability`, `test:voice-safety`, `test:tasks`,
`test:persistence`, `test:planner`, `test:voice` all pass. `test:click` fails as
described above.

## Test tasks still present

Delete durability is now repaired, so these can be removed on request. Left in
place because removing them was not asked for in this task:

- `task-msaq1f8c-g9j74` Quick Add persistence test 4417
- `task-msaq2qx4-ghrpg` Modal persistence test 4418
- `task-msaq3uqe-0uzhr` Text persistence test 4419
- `task-external-4420` External rehydrate probe 4420

`task-msaq5wye-w5niy` "Beauty and the Beast" is the ambient-audio task. Its
origin is ambiguous, so it needs user confirmation before deletion. The two
user-created tasks — "Build base frame for rover" and "Apply to Y Combinator" —
must not be deleted.
