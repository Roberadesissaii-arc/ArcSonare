/**
 * Reproduces the "task created but nowhere to be found" bug.
 *
 * hydrateTasksFromDb() replaces the whole in-memory list with a DB snapshot.
 * frontendExecutors calls reloadTasksFromStorage() (un-awaited) and then
 * addTask() synchronously — so the snapshot, taken BEFORE the new task
 * existed, resolved afterwards and wiped it. Read-back verification ran
 * before the wipe, which is why it reported success and then vanished.
 *
 * This models that exact interleaving against the real merge logic.
 * Run: npx tsx scripts/check-task-persistence.mts
 */

type T = { id: string; title: string };

// ── The logic under test, mirroring taskStore.ts ────────────────────────────
let tasks: T[] = [];
let hydratePromise: Promise<void> | null = null;
let writesDuringHydration: T[] = [];

function mergeWritesDuringHydration(snapshot: T[]): T[] {
  if (writesDuringHydration.length === 0) return snapshot;
  const known = new Set(snapshot.map((t) => t.id));
  const missing = writesDuringHydration.filter((t) => !known.has(t.id));
  writesDuringHydration = [];
  return missing.length ? [...missing, ...snapshot] : snapshot;
}

/** `dbRows` is the snapshot the DB returns — captured at call time. */
function hydrate(dbRows: T[], latencyMs: number): Promise<void> {
  if (hydratePromise) return hydratePromise;
  writesDuringHydration = [];
  hydratePromise = (async () => {
    const snapshot = await new Promise<T[]>((r) =>
      setTimeout(() => r(dbRows.slice()), latencyMs),
    );
    tasks = mergeWritesDuringHydration(snapshot);
    hydratePromise = null;
  })();
  return hydratePromise;
}

function addTask(title: string): T {
  const task = { id: `t-${Math.random().toString(36).slice(2, 8)}`, title };
  tasks = [task, ...tasks];
  if (hydratePromise) writesDuringHydration.push(task);
  return task;
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

const main = async () => {
  // 1. The reported bug: create during an in-flight hydration.
  tasks = [{ id: "existing", title: "Drone" }];
  const p = hydrate([{ id: "existing", title: "Drone" }], 40);
  const created = addTask("Appointment today at 1:30");
  await p;
  check(
    "task created mid-hydration survives",
    tasks.some((t) => t.id === created.id),
    `list after hydration: [${tasks.map((t) => t.title).join(", ")}]`,
  );

  // 2. Pre-existing tasks are not duplicated.
  check(
    "no duplicates of existing rows",
    tasks.filter((t) => t.id === "existing").length === 1,
    `"Drone" appears ${tasks.filter((t) => t.id === "existing").length}x`,
  );

  // 3. Several rapid creations all survive.
  tasks = [];
  const p2 = hydrate([], 40);
  const a = addTask("A");
  const b = addTask("B");
  const c = addTask("C");
  await p2;
  check(
    "multiple mid-hydration writes all survive",
    [a, b, c].every((t) => tasks.some((x) => x.id === t.id)),
    `${tasks.length}/3 kept`,
  );

  // 4. A task the DB already knows about isn't added twice.
  tasks = [];
  const dup = { id: "dup-1", title: "Synced already" };
  const p3 = hydrate([dup], 40);
  tasks = [dup, ...tasks];
  writesDuringHydration.push(dup);
  await p3;
  check(
    "task already in the snapshot is not duplicated",
    tasks.filter((t) => t.id === "dup-1").length === 1,
    `appears ${tasks.filter((t) => t.id === "dup-1").length}x`,
  );

  // 5. Normal hydration with no concurrent writes still replaces cleanly.
  tasks = [{ id: "stale", title: "Stale" }];
  await hydrate([{ id: "fresh", title: "Fresh" }], 5);
  check(
    "plain hydration still replaces the list",
    tasks.length === 1 && tasks[0].id === "fresh",
    `list: [${tasks.map((t) => t.title).join(", ")}]`,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed.`);
  process.exit(failed ? 1 : 0);
};

void main();
