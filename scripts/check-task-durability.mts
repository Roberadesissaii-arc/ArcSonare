/**
 * Task creation must not report success until the database says so.
 *
 * Observed failure: the user asked the speech-to-speech assistant to create a
 * task. It said the task had been created. No task existed — not on the Tasks
 * page, not on the Dashboard, and not in any of the seven SQLite databases on
 * the machine.
 *
 * The cause was a read-after-write that read the wrong thing:
 *
 *   function verifyPersisted(taskId) {
 *     return readPersistedTasks().find(t => t.id === taskId);   // in-memory
 *   }
 *
 * `readPersistedTasks()` returns the module's own array, and `addTask` had just
 * pushed into it, so the check could never fail. The durable write underneath
 * was fire-and-forget with its error swallowed into `console.error`.
 *
 * Distinct from check-task-persistence.mts, which models the hydration race
 * with a local copy of the merge logic. This one imports the real
 * `createTaskDurable` and stands a fake host in for SQLite, so the production
 * code path runs unmodified.
 *
 * Run: npx tsx scripts/check-task-durability.mts
 */

type Row = Record<string, unknown>;

const db = new Map<string, Row>();
let upsertCalls = 0;
let failNextUpsert: string | null = null;
let emitted: string[] = [];
let readBackReturnsNull = false;
let failNextDelete: string | null = null;

function reset() {
  db.clear();
  upsertCalls = 0;
  failNextUpsert = null;
  emitted = [];
  readBackReturnsNull = false;
  failNextDelete = null;
}

function rowFor(task: Record<string, unknown>): Row {
  return {
    id: task.id,
    workspaceId: null,
    title: task.title,
    description: task.note ?? null,
    status: task.completed ? "done" : "open",
    priority: task.priority ?? "medium",
    dueAt: task.due ?? null,
    assignedAgentId: task.agent ?? null,
    progress: 0,
    source: "user",
    tagsJson: JSON.stringify(task.tags ?? []),
    configurationJson: JSON.stringify(task),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    deletedAt: null,
  };
}

// `invoke` from @tauri-apps/api/core calls window.__TAURI_INTERNALS__.invoke,
// so providing that runs the real client against a stand-in database.
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = g;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.__TAURI_INTERNALS__ = {
  async invoke(cmd: string, args: Record<string, unknown>) {
    if (cmd === "tasks_upsert_local") {
      upsertCalls++;
      if (failNextUpsert) {
        const message = failNextUpsert;
        failNextUpsert = null;
        throw new Error(message);
      }
      const task = args.task as Record<string, unknown>;
      const row = rowFor(task);
      db.set(String(task.id), row);
      emitted.push(String(task.id)); // Rust emits after the commit.
      return row;
    }
    if (cmd === "tasks_get_local") {
      if (readBackReturnsNull) return null;
      return db.get(String(args.taskId)) ?? null;
    }
    if (cmd === "tasks_soft_delete_local") {
      if (failNextDelete) {
        const message = failNextDelete;
        failNextDelete = null;
        throw new Error(message);
      }
      db.delete(String(args.taskId));
      emitted.push(String(args.taskId)); // Rust emits after the commit here too.
      return null;
    }
    if (cmd === "tasks_list_local") return [...db.values()];
    return null;
  },
};

const {
  createTaskDurable,
  mutateTaskDurable,
  deleteTaskDurable,
  readPersistedTasks,
} = await import("../src/stores/taskStore");

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const base = { priority: "medium" as const, dueBucket: "none" as const };

// ── The happy path actually writes ───────────────────────────────────────
reset();
const created = await createTaskDurable({ ...base, title: "Voice integration test" });
check(
  "a successful create reports success with a real task id",
  created.success && typeof created.taskId === "string" && created.taskId.length > 0,
  created.success ? created.taskId : `failed: ${created.message}`,
);
check(
  "the task is in the database, not just the cache",
  db.size === 1 && db.has(created.success ? created.taskId : ""),
  `${db.size} row(s)`,
);
check(
  "the result carries persisted: true and the stored task",
  created.success && created.persisted && created.task.title === "Voice integration test",
  created.success
    ? JSON.stringify({ persisted: created.persisted, title: created.task.title })
    : "n/a",
);
check(
  "the durable write was awaited before returning",
  upsertCalls === 1,
  `${upsertCalls} upsert call(s)`,
);
check(
  "a change event was emitted for the other windows",
  emitted.length === 1,
  `${emitted.length} event(s)`,
);
check(
  "the task is visible to the task list",
  readPersistedTasks().some((t) => t.id === (created.success ? created.taskId : "")),
  `${readPersistedTasks().length} task(s) in the list`,
);

// ── A persistence failure must never look like success ───────────────────
reset();
const cacheBefore = readPersistedTasks().length;
failNextUpsert = "database is locked";
const wroteNothing = await createTaskDurable({ ...base, title: "Should not exist" });
check(
  "a failed write reports failure, not success",
  !wroteNothing.success,
  wroteNothing.success ? "claimed success" : `${wroteNothing.errorCode}: ${wroteNothing.message}`,
);
check("a failed write leaves no row in the database", db.size === 0, `${db.size} row(s)`);
check(
  "a failed write is rolled out of the in-memory list",
  readPersistedTasks().length === cacheBefore,
  `${readPersistedTasks().length} task(s), was ${cacheBefore}`,
);
check("a failed write emits no change event", emitted.length === 0, `${emitted.length} event(s)`);

// ── A write that cannot be read back is a failure ────────────────────────
// The exact shape of the original bug: the write "succeeded" but nothing was
// durable. The read-back is what catches it.
reset();
readBackReturnsNull = true;
const unreadable = await createTaskDurable({ ...base, title: "Vanishes on read-back" });
check(
  "a task that cannot be read back is reported as failed",
  !unreadable.success && unreadable.errorCode === "persistence-failed",
  unreadable.success ? "claimed success" : unreadable.errorCode,
);
check(
  "the unreadable task is rolled out of the list",
  !readPersistedTasks().some((t) => t.title === "Vanishes on read-back"),
  `${readPersistedTasks().length} task(s)`,
);

// ── Exactly once ─────────────────────────────────────────────────────────
reset();
const key = "call_abc123";
const first = await createTaskDurable({ ...base, title: "Exactly once" }, { idempotencyKey: key });
const replay = await createTaskDurable({ ...base, title: "Exactly once" }, { idempotencyKey: key });
check(
  "replaying the same request id creates no second task",
  db.size === 1,
  `${db.size} row(s) after two deliveries`,
);
check(
  "the replay returns the same task id",
  first.success && replay.success && first.taskId === replay.taskId,
  first.success && replay.success ? `${first.taskId} === ${replay.taskId}` : "n/a",
);
const different = await createTaskDurable(
  { ...base, title: "A genuinely new one" },
  { idempotencyKey: "call_different" },
);
check(
  "a different request id does create a second task",
  db.size === 2 && different.success,
  `${db.size} row(s)`,
);

// ── An empty title is rejected before anything is written ────────────────
reset();
const empty = await createTaskDurable({ ...base, title: "   " });
check(
  "a blank title is rejected",
  !empty.success && empty.errorCode === "invalid-arguments",
  empty.success ? "accepted" : empty.errorCode,
);
check(
  "a rejected title writes nothing",
  db.size === 0 && upsertCalls === 0,
  `${db.size} row(s), ${upsertCalls} upsert call(s)`,
);

// ── Mutations: complete, reopen, update, delete ──────────────────────────
// Same defect as creation had: the old check re-read the array the change had
// just been applied to, so "did not persist" was unreachable.
reset();
const target = await createTaskDurable({ ...base, title: "Mutation subject" });
const targetId = target.success ? target.taskId : "";

const completed = await mutateTaskDurable(
  targetId,
  (t) => ({ ...t, completed: true }),
  (stored) => stored.completed === true,
);
check(
  "complete is verified against the stored row",
  completed.success && completed.task.completed === true,
  completed.success ? "completed=true in SQLite" : `failed: ${completed.message}`,
);

const reopened = await mutateTaskDurable(
  targetId,
  (t) => ({ ...t, completed: false }),
  (stored) => stored.completed === false,
);
check(
  "reopen is verified against the stored row",
  reopened.success && reopened.task.completed === false,
  reopened.success ? "completed=false in SQLite" : `failed: ${reopened.message}`,
);

const updated = await mutateTaskDurable(
  targetId,
  (t) => ({ ...t, priority: "high" as const }),
  (stored) => stored.priority === "high",
);
check(
  "update is verified field-by-field against the stored row",
  updated.success && updated.task.priority === "high",
  updated.success ? `priority=${updated.task.priority}` : `failed: ${updated.message}`,
);

// A write that lands but does not carry the change must not report success.
const mismatched = await mutateTaskDurable(
  targetId,
  (t) => ({ ...t, priority: "low" as const }),
  () => false, // the row came back without the change
);
check(
  "a stored row that lacks the change is reported as failed",
  !mismatched.success && mismatched.errorCode === "persistence-mismatch",
  mismatched.success ? "claimed success" : mismatched.errorCode,
);
check(
  "a mismatched update is rolled back in the cache",
  readPersistedTasks().find((t) => t.id === targetId)?.priority === "high",
  `priority is ${readPersistedTasks().find((t) => t.id === targetId)?.priority}`,
);

// A failed write must roll the cache back and change nothing.
failNextUpsert = "disk full";
const failedUpdate = await mutateTaskDurable(
  targetId,
  (t) => ({ ...t, title: "Should not stick" }),
  () => true,
);
check(
  "a failed mutation write reports failure",
  !failedUpdate.success,
  failedUpdate.success ? "claimed success" : failedUpdate.errorCode,
);
check(
  "a failed mutation restores the previous cache value",
  readPersistedTasks().find((t) => t.id === targetId)?.title === "Mutation subject",
  String(readPersistedTasks().find((t) => t.id === targetId)?.title),
);

// Delete: absence is confirmed by asking the database for the id.
const rowsBeforeDelete = db.size;
const deleted = await deleteTaskDurable(targetId);
check(
  "delete is confirmed by the row being absent from SQLite",
  deleted.success && !db.has(targetId),
  deleted.success ? `${rowsBeforeDelete} -> ${db.size} row(s)` : `failed: ${deleted.message}`,
);
check(
  "a deleted task leaves the in-memory list",
  !readPersistedTasks().some((t) => t.id === targetId),
  `${readPersistedTasks().length} task(s)`,
);

// A delete whose write fails must put the task back.
const survivor = await createTaskDurable({ ...base, title: "Survives a failed delete" });
const survivorId = survivor.success ? survivor.taskId : "";
failNextDelete = "database is locked";
const failedDelete = await deleteTaskDurable(survivorId);
check(
  "a failed delete reports failure",
  !failedDelete.success,
  failedDelete.success ? "claimed success" : failedDelete.errorCode,
);
check(
  "a failed delete restores the task to the list and the database",
  db.has(survivorId) && readPersistedTasks().some((t) => t.id === survivorId),
  `in db: ${db.has(survivorId)}, in list: ${readPersistedTasks().some((t) => t.id === survivorId)}`,
);

// Deleting something already gone is a failure, not a cheerful success.
const deleteMissing = await deleteTaskDurable("task-does-not-exist");
check(
  "deleting an unknown task reports not-found",
  !deleteMissing.success && deleteMissing.errorCode === "not-found",
  deleteMissing.success ? "claimed success" : deleteMissing.errorCode,
);

console.log("-".repeat(78));
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
