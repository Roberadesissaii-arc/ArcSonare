/**
 * The two-row invariant, asserted against the real pager.
 *
 * The reported failure was visual: the Running Apps card showed three rows, the
 * third clipped, and the list rode up over its own subtitle. The cause was that
 * the card had its own expand/collapse instead of the Applications card's row
 * window, so with three applications it grew instead of paging.
 *
 * `useRowPager` is that window, extracted from `ConnectedToolsCard`. This suite
 * drives it as a pure reducer — the sequence of visible windows is the whole
 * behaviour — and then checks that both cards are wired to it identically.
 *
 * Run: npm run test:watch-pager
 */

import { readFileSync } from "node:fs";

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

const VISIBLE_ROWS = 2;

/**
 * The pager's arithmetic, mirrored exactly from `useRowPager`. React's hook
 * cannot run outside a renderer, so the arithmetic is asserted here and the
 * source is asserted below to be the same arithmetic.
 */
function pager(items: string[], windowStart: number) {
  const maxStart = Math.max(0, items.length - VISIBLE_ROWS);
  const start = Math.min(windowStart, maxStart);
  return {
    visible: items.slice(start, start + VISIBLE_ROWS),
    canPageUp: start > 0,
    canPageDown: start < maxStart,
    hasMore: items.length > VISIBLE_ROWS,
    next: (delta: number) => Math.min(maxStart, Math.max(0, start + delta)),
  };
}

// ── Objective 16 — three applications, exactly two rows, always ───────────
console.log("\n═══ three running applications ═══");
{
  const apps = ["Spotify", "Chrome", "Discord"];

  let start = 0;
  let view = pager(apps, start);
  check(
    "the initial view is exactly two complete rows",
    view.visible.length === 2 && view.visible.join(",") === "Spotify,Chrome",
    `[${view.visible.join(", ")}]`,
  );
  check(
    "there is no up arrow at the top of the list",
    !view.canPageUp,
    "spacer, not a chevron",
  );
  check(
    "there is a down arrow, because a third application exists",
    view.canPageDown && view.hasMore,
    `canPageDown=${view.canPageDown}`,
  );

  // Press the bottom arrow.
  start = view.next(1);
  view = pager(apps, start);
  check(
    "after the bottom arrow, still exactly two complete rows",
    view.visible.length === 2,
    `${view.visible.length} rows`,
  );
  check(
    "the old first row is gone and the next one has appeared",
    view.visible.join(",") === "Chrome,Discord",
    `[${view.visible.join(", ")}]`,
  );
  check(
    "no third row is ever in the window, so none can be clipped",
    view.visible.length <= VISIBLE_ROWS,
    "the window is the card's whole height",
  );
  check(
    "the bottom arrow is spent and the top arrow has appeared",
    !view.canPageDown && view.canPageUp,
    `up=${view.canPageUp} down=${view.canPageDown}`,
  );

  // Press the opposite arrow.
  start = view.next(-1);
  view = pager(apps, start);
  check(
    "the previous two-row view is restored exactly",
    view.visible.join(",") === "Spotify,Chrome",
    `[${view.visible.join(", ")}]`,
  );
  check(
    "no row was duplicated and none was lost",
    new Set([...pager(apps, 0).visible, ...pager(apps, 1).visible]).size === 3,
    "all three reachable, each once per window",
  );
}

// ── Every window is full, at every length ─────────────────────────────────
console.log("\n═══ the window is never partial ═══");
{
  let bad = "";
  for (let n = 3; n <= 8; n += 1) {
    const apps = Array.from({ length: n }, (_, i) => `app-${i}`);
    for (let start = 0; start <= n; start += 1) {
      const view = pager(apps, start);
      if (view.visible.length !== VISIBLE_ROWS) {
        bad = `n=${n} start=${start} → ${view.visible.length} rows`;
        break;
      }
    }
    if (bad) break;
  }
  check(
    "every reachable window holds exactly two rows",
    bad === "",
    bad || "2 rows at every length and every position",
  );
}

// ── A shrinking list clamps instead of emptying ───────────────────────────
console.log("\n═══ an application closes while the list is paged down ═══");
{
  const three = ["Spotify", "Chrome", "Discord"];
  const pagedDown = pager(three, 0).next(1);
  // Spotify quits. The card re-renders from a shorter list at the same start.
  const two = ["Chrome", "Discord"];
  const after = pager(two, pagedDown);
  check(
    "the window clamps back rather than rendering an empty card",
    after.visible.join(",") === "Chrome,Discord",
    `[${after.visible.join(", ")}]`,
  );
  check(
    "with nothing left to page to, both arrows are gone",
    !after.canPageUp && !after.canPageDown && !after.hasMore,
    "two rows, no chevrons, same height",
  );
}

// ── Both cards are wired to the one pager ─────────────────────────────────
console.log("\n=== one pager, one card component ===");
{
  const hook = readFileSync("src/components/dashboard/useRowPager.ts", "utf8");
  const frame = readFileSync(
    "src/components/dashboard/PagedApplicationCard.tsx",
    "utf8",
  );
  const applications = readFileSync(
    "src/components/dashboard/ConnectedToolsCard.tsx",
    "utf8",
  );
  const running = readFileSync(
    "src/components/dashboard/RunningAppsCard.tsx",
    "utf8",
  );

  check(
    "both cards render through the one frame component",
    /<PagedApplicationCard/.test(applications) && /<PagedApplicationCard/.test(running),
    "Applications and Running Apps, same component",
  );
  check(
    "the frame owns the pager",
    /useRowPager\(/.test(frame) && /from "\.\/useRowPager"/.test(frame),
    "imported once, by the frame",
  );
  check(
    "neither card touches the pager itself",
    !/useRowPager/.test(applications) && !/useRowPager/.test(running),
    "no card can page differently from the other",
  );
  check(
    "neither card keeps a private window-start",
    !/useState\(0\)/.test(applications) && !/useState\(0\)/.test(running),
    "the window lives in the hook",
  );
  check(
    "no card has expand/collapse left",
    !/expanded/.test(running) && !/expanded/.test(applications),
    "paging only, so the card never changes height",
  );
  check(
    "the frame pages by a single row",
    /pageBy\(1\)/.test(frame) && /pageBy\(-1\)/.test(frame),
    "one row at a time, for both cards at once",
  );
  check(
    "two rows is one constant, not one per card",
    /export const VISIBLE_ROWS = 2;/.test(frame) &&
      !/VISIBLE_ROWS/.test(applications) &&
      !/VISIBLE_ROWS/.test(running),
    "VISIBLE_ROWS = 2, in the frame",
  );
  check(
    "the hook's arithmetic is the arithmetic asserted above",
    /items\.length - visibleRows/.test(hook) &&
      /items\.slice\(windowStart, windowStart \+ visibleRows\)/.test(hook) &&
      /Math\.min\(maxStart, Math\.max\(0, start \+ delta\)\)/.test(hook),
    "slice(start, start+n), clamped to length-n",
  );
  check(
    "the hook clamps the window when the list shrinks",
    /setWindowStart\(\(start\) => Math\.min\(start, maxStart\)\)/.test(hook),
    "a closing application cannot empty the card",
  );
}

// The card cannot grow
console.log("\n=== nothing lets the card change height ===");
{
  const css = readFileSync("src/styles/watch.css", "utf8");
  const cards = readFileSync("src/styles/cards.css", "utf8");
  const frame = readFileSync(
    "src/components/dashboard/PagedApplicationCard.tsx",
    "utf8",
  );
  check(
    "the subtitle is a sibling of the list, not inside it",
    frame.indexOf('<p className="card-lede"') <
      frame.indexOf("opened-apps-list-wrap"),
    "card-lede sits above the list wrapper",
  );
  check(
    "no Watch rule positions, offsets or overflows the card",
    !/\.opened-apps-card[^}]*(?:position:\s*absolute|margin-top:\s*-|overflow)/.test(
      css,
    ),
    "no absolute, negative-margin or overflow rules",
  );
  check(
    "the two variants share one list rule",
    !/\.(?:applications|opened-apps)-card\s+\.tools-list-opened\s*\{/.test(cards),
    "no per-card flex or overflow override",
  );
  check(
    "the spacer keeps the height when there is nothing to page to",
    /opened-apps-page-spacer/.test(frame),
    "same spacer for both cards",
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Two rows, always — the same window as the Applications card.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
