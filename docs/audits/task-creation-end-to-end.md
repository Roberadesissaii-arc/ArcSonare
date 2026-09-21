# Task creation, end to end

Opened after a production failure: the user asked the speech-to-speech assistant
to create a task, was told verbally that it had been created, and found nothing
anywhere — Dashboard empty, Tasks page All 0, Daily Pulse 0/0.

## The failure, reproduced

Not reproduced through the microphone. There is no way to speak into this
machine from here, so the reproduction was done against the canonical store,
which is where the claim was falsifiable.

| Evidence | Value |
| --- | --- |
| Build | `src-tauri/target/debug/arcsonare.exe`, mtime `2026-08-01 13:52` |
| Git HEAD | `a8c1787` |
| Task rows written on 2026-08-01, all 7 databases | **0** |
| Only task row anywhere | `task-ms97knfg-gm2kr` "Design the UI screen", `2026-07-31T17:20:31` |

The databases were opened that day (mtime 14:03) and no task row was written.
So the spoken confirmation corresponded to no durable record at all. This was
never a refresh problem.

## First divergent stage

`verifyPersisted` in `src/features/capabilities/frontendExecutors.ts`:

```ts
function verifyPersisted(taskId: string) {
  return readPersistedTasks().find((t) => t.id === taskId);
}
```

`readPersistedTasks()` is `return tasks.slice()` — the module's own in-memory
array. `addTask` pushes into that array on the line before. The read-after-write
verified the write it had just made *to memory*, so it could not fail.

Two defects immediately beneath it:

- `syncTaskAsync` (`src/stores/taskStore.ts`) was
  `void upsertTaskToDb(task).catch(err => console.error(...))` — the durable
  write was neither awaited nor allowed to fail the operation.
- No `TaskCreated` event existed anywhere in the codebase. Voice runs in the
  `sonare-overlay` webview and the Tasks page in `main`; those are separate
  JavaScript heaps, so even a successful write could not have reached the UI
  without a restart.

## Physically observed, 2026-08-01

Run against the debug build, PID 68180 then PID 6736 after a real restart, path
`src-tauri/target/debug/arcsonare.exe`, Git HEAD `a8c1787`. Active account hash
`76610d29...`, database `users/76610d29ca947767e097d234081baf6a/arcsonare.db`.

A stale LocalCache process (PID 26176, built 2026-07-31 12:39) was found holding
the single-instance lock and was stopped with the user's approval. Any earlier
voice test ran against that binary, which predates this repair.

| Path | Task id | Result |
| --- | --- | --- |
| Quick Add | `task-msaq1f8c-g9j74` | 1 row, All 0→1, field cleared only after success |
| Create Task modal | `task-msaq2qx4-ghrpg` | 1 row, All 1→2, modal closed only after success |
| Text chat | `task-msaq3uqe-0uzhr` | 1 row, All 2→3, reply "Done — …is on your task list" |
| Voice (overlay) | `task-msaq5wye-w5niy` | 1 row, appeared in `main` with no restart |

**Cross-webview proof.** A row was inserted directly into SQLite from outside the
application (`task-external-4420`), invisible to any window's cache. The next
write from the `sonare-overlay` voice session made Rust emit
`arcsonare://tasks-changed`; `main` then displayed *both* that row and the new
one. Hydration therefore read SQLite rather than trusting its own heap, which is
the exact mechanism the voice path depends on.

**Restart.** Process killed to zero, relaunched as a new PID. All 7 tasks
present, Dashboard and Galaxy reloaded, no duplicates.

**Projection rules** (`src/stores/taskStore.ts:560`): open `!completed`; today
`dueBucket === "today"`; upcoming `dueBucket === "upcoming"`; urgent
`urgent || priority === "high"`. Observed counts matched: the high/today task
qualified for Today and Urgent, the two medium/no-due tasks for All only.

**Galaxy is task-driven** — `OrbitalCommandMap` uses `useTasks()` and
`filterTasks(tasks, "open"|"urgent"|"today")`. Task nodes were observed
appearing and surviving restart.

## Status

| Item | Status |
| --- | --- |
| Intent selection | COMPLETE |
| Tool invocation | COMPLETE |
| Durable persistence | COMPLETE |
| Read-after-write | COMPLETE |
| Task ID returned | COMPLETE |
| Failure behavior | COMPLETE |
| Exactly-once behavior | COMPLETE |
| TaskCreated event | COMPLETE |
| Tasks-page synchronization | COMPLETE |
| Dashboard synchronization | COMPLETE |
| Galaxy synchronization | COMPLETE |
| Direct UI create | COMPLETE |
| Quick Add create | COMPLETE |
| Text-chat create | COMPLETE |
| Speech-to-speech create | PARTIAL — voice-originated row observed; controlled sentence BLOCKED (no mic) |
| Navigation persistence | COMPLETE |
| Restart persistence | COMPLETE |
| Automated tests | COMPLETE |
| Physical voice test | BLOCKED — no microphone access |

### COMPLETE items

**Intent selection** — `src/features/capabilities/capabilityRegistry.ts`,
`tasks.create`. Test `scripts/check-task-creation.mts`.
`npm run test:tasks` → `14/14 passed.`

**Tool invocation** — `src/services/realtime/realtimeTools.ts`,
`dispatchRealtimeToolCall`. Awaits `executeCapabilityById` and returns the real
`ToolResult`; it was never the bug. Verified by reading the call path.

**Durable persistence** — `src/stores/taskStore.ts`, `createTaskDurable`. Awaits
`upsertTaskToDb`, which invokes the transactional Rust command
`tasks_upsert_local` (`src-tauri/src/database/tasks.rs`).
Test `the durable write was awaited before returning`.
`npm run test:task-durability` → `1 upsert call(s)`.

**Read-after-write** — `src-tauri/src/database/tasks.rs`, `tasks_get_local`;
`src/services/taskPersistence.ts`, `getTaskFromDb`. Reads the row back from
SQLite by id, touching no cache. Test
`a task that cannot be read back is reported as failed` →
`persistence-failed`.

**Task ID returned** — `CreateTaskOutcome` in `src/stores/taskStore.ts`, shape
`{ success: true, taskId, task, persisted: true }`. Test
`a successful create reports success with a real task id`.

**Failure behavior** — `createTaskDurable` rolls the optimistic task out of the
cache and returns `{ success: false, errorCode, message }`;
`executeTaskCreate` renders `"I couldn't create that task because it could not
be saved."` Tests `a failed write reports failure, not success`,
`a failed write leaves no row in the database`,
`a failed write is rolled out of the in-memory list`,
`a failed write emits no change event` — all pass.

**Exactly-once** — idempotency key threaded from the Realtime API's `call_id`
(`RealtimeSession.ts` → `realtimeTools.ts` → `capabilityEngine.ts` →
`frontendExecutors.ts` → `createTaskDurable`). Tests
`replaying the same request id creates no second task` → `1 row(s) after two
deliveries`, and `a different request id does create a second task` →
`2 row(s)`.

**TaskCreated event** — `TASKS_CHANGED_EVENT` (`arcsonare://tasks-changed`),
emitted from Rust in `tasks_upsert_local` *after* the transaction commits.
Frontend listener `listenForTaskChanges` in `src/stores/taskStore.ts`, attached
in `src/app/AppShell.tsx`. Test `a change event was emitted for the other
windows` → `1 event(s)`.

**Automated tests** — `scripts/check-task-durability.mts`, 17 checks.
`npm run test:task-durability` → `all passed`.

### A defect this work introduced and the tests caught

The first version of `createTaskDurable` called `addTask`, which fires its own
un-awaited write. That produced **two** upserts, and the fire-and-forget copy
still succeeded when the awaited one failed — so a task the user was told could
not be saved was saved anyway. Fixed by splitting `buildTask` / `cacheNewTask`
out of `addTask` so the durable path owns its own single write.

### PARTIAL and BLOCKED — why

**Speech-to-speech create** is PARTIAL rather than COMPLETE. A voice-originated
row (`task-msaq5wye-w5niy`) was written by the `sonare-overlay` session from real
microphone audio and appeared in `main` immediately, which proves the chain works
end to end. But that audio was ambient — no controlled sentence was spoken, and
the transcript was never observed. So the mechanism is proven; the specific
"create a task called X" phrasing producing the right title is not.

**Physical voice test** is BLOCKED: this environment has no way to speak into the
microphone. Per instruction it has not been replaced with a synthetic substitute.

**Exactly-once** is proven by the automated suite, where replaying one
idempotency key yields one row. It was not replayed physically, because the key
is the Realtime `call_id` and reaching it requires the voice path.

**Failure behaviour** is likewise proven by the automated suite only. Forcing a
real write failure would have meant damaging the signed-in user's database.

## Out of scope, noted

`verifyPersisted` still backs `tasks.complete`, `tasks.reopen`, `tasks.update`
and `tasks.delete`. Those have the same in-memory-verification weakness that
creation had. Left unchanged so this repair stayed scoped to creation; they
should get the same treatment.

## Frozen display work

Unchanged by this task, per instruction: Settings runtime compatibility NOT
STARTED, stale-process diagnostics NOT STARTED, final restart regression NOT
STARTED.
