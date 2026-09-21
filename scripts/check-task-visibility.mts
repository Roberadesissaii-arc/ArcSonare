/**
 * A deleted task must leave the list the UI actually renders.
 *
 * Observed failure: the user asked the assistant to delete a task. It said the
 * task was gone, the evidence chip said "Task deleted", and SQLite agreed — the
 * row had `deleted_at` set and `WHERE deleted_at IS NULL` returned 8 rows
 * without it. The Tasks page still showed 9. Navigating away and back did not
 * clear it. Only a full reload did.
 *
 * The cause was a stale hydration snapshot, not the write:
 *
 *   function findTask(args) {
 *     reloadTasksFromStorage();          // un-awaited hydrateTasksFromDb()
 *     const all = readPersistedTasks();  // resolves the task synchronously
 *   }
 *
 * Every task mutation resolves its target through `findTask`, so a hydration is
 * always in flight by the time the delete runs. That read took its snapshot
 * before the delete committed, so when it landed it assigned the pre-delete row
 * set straight over the list and the task came back. Creation was immune
 * because `writesDuringHydration` already covered the mirror-image case; there
 * was no delete-side equivalent.
 *
 * The corrective re-read never arrived either: Rust emits `tasks-changed` after
 * the commit and the listener calls `hydrateTasksFromDb()`, but that returns the
 * in-flight promise — whose snapshot predates the very change it is reacting to.
 *
 * Distinct from check-task-durability.mts, which asserts the database. That
 * suite passes while this bug is present, because the row really is deleted.
 * This one asserts what a person looking at the screen would see, so it drives
 * the interleaving explicitly: it holds a `tasks_list_local` read open across
 * the delete and only then lets it land.
 *
 * `readPersistedTasks()` returns the same array `useTasks()` renders, so it is
 * the observable list here; no DOM is involved.
 *
 * Run: npx tsx scripts/check-task-visibility.mts
 */

type Row = Record<string, unknown>;

const db = new Map<string, Row>();

/** Lets a `tasks_list_local` read be held open across other work. */
let releaseListRead: (() => void) | null = null;
let listGate: Promise<void> | null = null;

function holdListReads() {
  listGate = new Promise<void>((resolve) => {
    releaseListRead = resolve;
  });
}

function letListReadsLand() {
  releaseListRead?.();
  releaseListRead = null;
  listGate = null;
}

function rowFor(task: Record<string, unknown>): Row {
  return {
    id: task.id,
    title: task.title,
    description: task.note ?? null,
    status: task.completed ? "done" : "open",
    priority: task.priority ?? "medium",
    dueAt: task.due ?? null,
    assignedAgentId: task.agent ?? null,
    progress: 0,
    tagsJson: JSON.stringify(task.tags ?? []),
    configurationJson: JSON.stringify(task),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    deletedAt: null,
  };
}

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = g;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
// Skip the one-time localStorage migration so each hydration is a single read.
store.set("arcsonare.tasks.sqliteMigrated.v1", "1");

g.__TAURI_INTERNALS__ = {
  async invoke(cmd: string, args: Record<string, unknown>) {
    if (cmd === "tasks_upsert_local") {
      const task = args.task as Record<string, unknown>;
      const row = rowFor(task);
      db.set(String(task.id), row);
      return row;
    }
    if (cmd === "tasks_get_local") {
      return db.get(String(args.taskId)) ?? null;
    }
    if (cmd === "tasks_soft_delete_local") {
      // The real command sets deleted_at; every read filters on it.
      db.delete(String(args.taskId));
      return null;
    }
    if (cmd === "tasks_list_local") {
      // A real read snapshots the rows when the query runs, then delivers the
      // result later. The gap between those two moments is the entire bug.
      const snapshot = [...db.values()];
      if (listGate) await listGate;
      return snapshot;
    }
    return null;
  },
};

const {
  createTaskDurable,
  deleteTaskDurable,
  removeTask,
  hydrateTasksFromDb,
  readPersistedTasks,
  filterTasks,
} = await import("../src/stores/taskStore");

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const base = { priority: "medium" as const, dueBucket: "none" as const };
const listed = () => readPersistedTasks().map((t) => t.title);
const openCount = () => filterTasks(readPersistedTasks(), "open").length;

async function seed(titles: string[]): Promise<string[]> {
  db.clear();
  await hydrateTasksFromDb();
  const ids: string[] = [];
  for (const title of titles) {
    const made = await createTaskDurable({ ...base, title });
    if (!made.success) throw new Error(`seed failed: ${made.message}`);
    ids.push(made.taskId);
  }
  return ids;
}

// ── The plain case: nothing else in flight ───────────────────────────────
{
  const [, victimId] = await seed(["Keep me", "Restart regression probe 8021"]);
  const outcome = await deleteTaskDurable(victimId);
  check(
    "a delete with no read in flight drops the task from the list",
    outcome.success && !listed().includes("Restart regression probe 8021"),
    listed().join(", ") || "(empty)",
  );
}

// ── The reported failure: a read is in flight across the delete ──────────
// This is what `findTask` does on every mutation — `reloadTasksFromStorage()`
// without awaiting it, immediately before the delete runs.
{
  const [, victimId] = await seed(["Keep me", "Restart regression probe 8021"]);
  const before = openCount();

  holdListReads();
  const inFlight = hydrateTasksFromDb(); // snapshot taken now: still 2 rows

  const outcome = await deleteTaskDurable(victimId);
  check(
    "the delete itself still reports success",
    outcome.success,
    outcome.success ? "success" : `${outcome.errorCode}: ${outcome.message}`,
  );

  letListReadsLand();
  await inFlight;

  check(
    "a snapshot that predates the delete does not put the task back",
    !listed().includes("Restart regression probe 8021"),
    listed().join(", ") || "(empty)",
  );
  check(
    "the open-task count reflects the delete",
    openCount() === before - 1,
    `${openCount()} open, was ${before}`,
  );
  check(
    "the surviving task is untouched",
    listed().includes("Keep me"),
    listed().join(", ") || "(empty)",
  );
}

// ── A delete made in another window, arriving as a `tasks-changed` event ─
// The listener calls `hydrateTasksFromDb()`. If a read is already in flight,
// handing back that promise answers with a snapshot older than the event.
{
  const [, victimId] = await seed(["Keep me", "Deleted by the overlay"]);

  holdListReads();
  const inFlight = hydrateTasksFromDb(); // snapshot taken now: still 2 rows

  // The other window's write commits. Nothing local touched the cache.
  db.delete(victimId);

  // What listenForTaskChanges does when `arcsonare://tasks-changed` arrives.
  const onEvent = hydrateTasksFromDb();

  letListReadsLand();
  await Promise.all([inFlight, onEvent]);

  check(
    "a change event during an in-flight read is not answered with stale data",
    !listed().includes("Deleted by the overlay"),
    listed().join(", ") || "(empty)",
  );
}

// ── The Tasks page delete button, which is not the durable path ──────────
// `removeTask` is fire-and-forget by design, but it is removing the same row
// from the same list and a stale snapshot puts it back just the same.
{
  const [, victimId] = await seed(["Keep me", "Deleted by the button"]);

  holdListReads();
  const inFlight = hydrateTasksFromDb(); // snapshot taken now: still 2 rows

  removeTask(victimId);

  letListReadsLand();
  await inFlight;
  // Let the fire-and-forget write settle.
  await new Promise((r) => setTimeout(r, 0));

  check(
    "a task removed from the UI is not restored by an older snapshot",
    !listed().includes("Deleted by the button"),
    listed().join(", ") || "(empty)",
  );
}

// ── The create-side protection must survive the delete-side fix ──────────
{
  await seed(["Keep me"]);

  holdListReads();
  const inFlight = hydrateTasksFromDb(); // snapshot taken now: 1 row

  const made = await createTaskDurable({ ...base, title: "Born mid-hydration" });

  letListReadsLand();
  await inFlight;

  check(
    "a task created mid-hydration is not wiped by the older snapshot",
    made.success && listed().includes("Born mid-hydration"),
    listed().join(", ") || "(empty)",
  );
}

// ── A delete that fails must leave the task visible ──────────────────────
{
  const [, victimId] = await seed(["Keep me", "Delete will fail"]);
  const invoke = (g.__TAURI_INTERNALS__ as { invoke: unknown }).invoke;
  (g.__TAURI_INTERNALS__ as Record<string, unknown>).invoke = async (
    cmd: string,
    args: Record<string, unknown>,
  ) => {
    if (cmd === "tasks_soft_delete_local") throw new Error("database is locked");
    return (invoke as (c: string, a: Record<string, unknown>) => Promise<unknown>)(cmd, args);
  };

  const outcome = await deleteTaskDurable(victimId);
  (g.__TAURI_INTERNALS__ as Record<string, unknown>).invoke = invoke;

  check(
    "a failed delete reports failure and keeps the task on screen",
    !outcome.success && listed().includes("Delete will fail"),
    outcome.success ? "claimed success" : listed().join(", "),
  );

  // And the failed delete must not go on hiding it from later reads.
  await hydrateTasksFromDb();
  check(
    "a failed delete does not hide the task from the next hydration",
    listed().includes("Delete will fail"),
    listed().join(", ") || "(empty)",
  );
}

console.log("-".repeat(78));
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
