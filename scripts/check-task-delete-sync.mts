/**
 * A deleted task must disappear from what the user can see, not just from the
 * database.
 *
 * The shipped defect: `tasks.delete` soft-deleted the row correctly, verified
 * its absence, and reported success — and the Tasks page, the open-task count
 * and Up Next all kept showing it until the app was reloaded.
 * `check-task-durability.mts` passed the whole time, because it asserts the
 * database, which was right.
 *
 * So these assertions run against the store's *observable* state — the value
 * `useTasks()` hands React, and the selectors the Dashboard, Galaxy, Focus, Up
 * Next, Today and Urgent panels derive from it — with a working fake backend
 * behind it (`register-task-backend-stub.mjs`).
 *
 * Run: npm run test:task-delete-sync
 */

import {
  createTaskDurable,
  deleteTaskDurable,
  hydrateTasksFromDb,
  listenForTaskChanges,
  readPersistedTasks,
} from "../src/stores/taskStore";

const backend = (globalThis as unknown as { __taskBackend: TaskBackend }).__taskBackend;

interface TaskBackend {
  reset(): void;
  liveRows(): Array<{ id: string }>;
  isSoftDeleted(id: string): boolean;
  calls: { list: number; get: number; upsert: number; delete: number; eventsEmitted: number };
  settle(turns?: number): Promise<void>;
}

let failed = 0;
const failures: string[] = [];
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) {
    failed += 1;
    failures.push(`${name} → ${got}`);
  }
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** What every surface counts: the list the store hands its subscribers. */
const visible = () => readPersistedTasks();
const visibleTitles = () => visible().map((t) => t.title);
const openCount = () => visible().filter((t) => !t.completed).length;

backend.reset();
await listenForTaskChanges();
await hydrateTasksFromDb();

// ── The reported sequence ─────────────────────────────────────────────────
console.log("\n— create, then delete —");
const created = await createTaskDurable({
  title: "Delete sync probe",
  priority: "medium",
  dueBucket: "none",
});
if (!created.success) {
  console.log("FAIL  the probe task could not be created");
  console.log(`      -> ${created.message}`);
  process.exit(1);
}
const probeId = created.taskId;

await backend.settle();
check(
  "a created task is visible",
  visibleTitles().includes("Delete sync probe"),
  `${visible().length} visible`,
);
const countBefore = openCount();

const deleted = await deleteTaskDurable(probeId);
check("the delete reports success", deleted.success, deleted.success ? "success" : deleted.message);
check(
  "the database row is soft-deleted",
  backend.isSoftDeleted(probeId),
  "deleted_at set",
);

// The part that was broken. Everything below is what the user actually sees.
check(
  "the task is gone from the visible list immediately",
  !visible().some((t) => t.id === probeId),
  visibleTitles().join(", ") || "(empty)",
);
check(
  "the open-task count drops",
  openCount() === countBefore - 1,
  `${countBefore} → ${openCount()}`,
);

// ── It must stay gone once the change event has been processed ────────────
// The delete emits `arcsonare://tasks-changed`, every window rehydrates, and a
// rehydrate that re-adds the row would put it straight back on screen.
await backend.settle();
console.log("\n— after the change event settles —");
check(
  "the change event does not bring it back",
  !visible().some((t) => t.id === probeId),
  visibleTitles().join(", ") || "(empty)",
);
check(
  "the count stays down",
  openCount() === countBefore - 1,
  `${openCount()} open`,
);

// ── Navigating away and back re-hydrates; so does a restart ───────────────
console.log("\n— navigation and restart —");
await hydrateTasksFromDb();
await backend.settle();
check(
  "navigating away and back does not restore it",
  !visible().some((t) => t.id === probeId),
  visibleTitles().join(", ") || "(empty)",
);

// A restart is a fresh hydration against the same database.
await hydrateTasksFromDb();
await backend.settle();
check(
  "a restart does not restore it",
  !visible().some((t) => t.id === probeId),
  `${visible().length} task(s) after rehydrate`,
);
check(
  "the backend agrees",
  backend.liveRows().every((r) => r.id !== probeId),
  `${backend.liveRows().length} live row(s)`,
);

// ── Deleting mid-hydration ────────────────────────────────────────────────
// `writesDuringHydration` re-adds tasks created while a hydration snapshot was
// in flight. A task deleted in that same window must not be re-added by it.
console.log("\n— deleted while a hydration is in flight —");
{
  const racer = await createTaskDurable({
    title: "Race probe",
    priority: "low",
    dueBucket: "none",
  });
  await backend.settle();
  // Start a hydration and delete before it resolves.
  const inFlight = hydrateTasksFromDb();
  const raceDelete = await deleteTaskDurable(racer.success ? racer.taskId : "");
  await inFlight;
  await backend.settle();
  check(
    "a task deleted during hydration is not resurrected",
    raceDelete.success && !visible().some((t) => t.title === "Race probe"),
    visibleTitles().join(", ") || "(empty)",
  );
}

// ── The Tasks page delete button takes a different path ───────────────────
// `removeTask` is fire-and-forget: it does not await the write, so an in-flight
// snapshot is even more likely to land after it.
console.log("\n— the UI delete button —");
{
  const { removeTask } = await import("../src/stores/taskStore");
  const byButton = await createTaskDurable({
    title: "Button probe",
    priority: "medium",
    dueBucket: "none",
  });
  await backend.settle();
  const inFlight = hydrateTasksFromDb();
  removeTask(byButton.success ? byButton.taskId : "");
  await inFlight;
  await backend.settle();
  check(
    "a task removed from the Tasks page stays removed",
    !visibleTitles().includes("Button probe"),
    visibleTitles().join(", ") || "(empty)",
  );
  check(
    "and it reaches the database",
    backend.isSoftDeleted(byButton.success ? byButton.taskId : ""),
    "deleted_at set",
  );
}

// ── Every surface reads the same list ─────────────────────────────────────
// Tasks, Dashboard, Galaxy, Focus, Up Next, Today and Urgent are all supposed
// to derive from the one store. If any of them held its own copy, fixing the
// store would fix only some of them — so that is asserted rather than assumed.
console.log("\n— one source for every surface —");
{
  const { readFileSync } = await import("node:fs");
  const surfaces = [
    "src/pages/TasksPage.tsx",
    "src/pages/DashboardPage.tsx",
    "src/components/dashboard/OrbitalCommandMap.tsx",
    "src/components/dashboard/FocusCard.tsx",
    "src/components/dashboard/UpNextCard.tsx",
    "src/components/dashboard/UrgentCard.tsx",
    "src/components/dashboard/TodayGlanceCard.tsx",
  ];
  const offenders = surfaces.filter((f) => !readFileSync(f, "utf8").includes("useTasks()"));
  check(
    "every task surface derives from useTasks()",
    offenders.length === 0,
    offenders.join(", ") || `${surfaces.length} surfaces, one store`,
  );
  check(
    "the capability executors read that same list",
    readFileSync("src/features/capabilities/frontendExecutors.ts", "utf8").includes(
      "readPersistedTasks()",
    ),
    "no second cache for the assistant",
  );

  // Counts the panels compute. Each one must have dropped the deleted task.
  const all = visible();
  check(
    "no derived view can still see the deleted task",
    [
      all.filter((t) => !t.completed),
      all.filter((t) => t.urgent),
      all.filter((t) => t.priority === "high"),
      all.filter((t) => t.due),
      all.filter((t) => t.completed),
    ].every((list) => !list.some((t) => t.id === probeId)),
    "open, urgent, high, due and completed views all clear",
  );
}

// ── Deleting something that is already gone ───────────────────────────────
console.log("\n— second delete —");
{
  const again = await deleteTaskDurable(probeId);
  check(
    "deleting an already-deleted task fails instead of reporting success",
    !again.success,
    again.success ? "reported success" : again.errorCode,
  );
}

console.log(`\n${"-".repeat(74)}`);
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failed === 0 ? 0 : 1);
