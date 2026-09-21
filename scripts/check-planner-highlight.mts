/**
 * What "show me the books folder on my Desktop" tells the planner.
 *
 * This is the seam the original bug travelled through. The frontend described
 * every highlight request as a *visual description* — "find this in a
 * photograph" — so the planner had no way to know that Windows could answer the
 * question exactly, and routed it to a vision model. The model returned a box
 * covering four unrelated icons, and every layer below it faithfully drew that
 * box in the right place.
 *
 * A named Desktop item must therefore leave TypeScript as a *path*, so the Rust
 * planner can pick the shell lookup. These checks pin that down; the Rust side
 * proves what it then does with it:
 *
 *   cargo test --lib planner_highlight_real_books_folder -- --nocapture --ignored
 *
 * Run: npx tsx scripts/check-planner-highlight.mts
 */

import { highlightTarget } from "../src/features/capabilities/plannerBridge";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const describe = (t: ReturnType<typeof highlightTarget>) => JSON.stringify(t);

// ---------------------------------------------------------------------------
// The exact production request
// ---------------------------------------------------------------------------

const books = highlightTarget("the books folder on my Desktop");
check(
  "the books request leaves TypeScript as a path, not a photograph",
  books.kind === "path",
  describe(books),
);
check(
  "it names the item the shell will look up",
  books.name === "books",
  String(books.name),
);
check(
  "it says which known folder, so a redirected Desktop still resolves",
  books.knownFolder === "desktop",
  String(books.knownFolder),
);
check(
  "it carries no literal path — Rust resolves the Desktop itself",
  books.path === null,
  String(books.path),
);

for (const phrasing of [
  "the books folder on my Desktop",
  "books folder on my desktop",
  "my books folder on the desktop",
  "the books icon on my Desktop",
]) {
  const t = highlightTarget(phrasing);
  check(
    `“${phrasing}” routes to the shell lookup`,
    t.kind === "path" && t.name === "books",
    describe(t),
  );
}

// ---------------------------------------------------------------------------
// Things that genuinely are recognition problems
// ---------------------------------------------------------------------------

const play = highlightTarget("the blue Play button");
check(
  "a control inside an app stays a visual description",
  play.kind === "visual-description" && play.description === "the blue Play button",
  describe(play),
);

const song = highlightTarget("the third song in the playlist");
check(
  "something with no Desktop mention stays a visual description",
  song.kind === "visual-description",
  describe(song),
);

// "Desktop" with nothing named is not a lookup — there is no item to find.
const bare = highlightTarget("my desktop");
check(
  "naming only the desktop does not invent an item to look up",
  bare.kind === "visual-description",
  describe(bare),
);

// ---------------------------------------------------------------------------
// The failure this replaced
// ---------------------------------------------------------------------------

check(
  "the books request never reaches the planner as a visual description",
  highlightTarget("Show me the books folder on my Desktop").kind !== "visual-description",
  "path, so vision is not the plan",
);

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
