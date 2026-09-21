/**
 * Pointing at one Desktop icon rather than four.
 *
 * "Show me the books folder on my Desktop" produced a border around File,
 * New folder, ridetrip-devop and Trip. Nothing underneath the model's answer was
 * wrong, so nothing underneath could have caught it. These checks are the layer
 * that now does: they take the exact rectangle from that failure and require it
 * to be refused.
 *
 * The geometry below is the real Desktop grid measured from the shell on the
 * machine that produced the bug — 74x70 icons on a 75x98 pitch.
 *
 * Run: npx tsx scripts/check-desktop-targeting.mts
 */

import {
  verifyDesktopIconTarget,
  iconsCentredIn,
  labelsAgree,
  desktopItemName,
  mentionsDesktop,
  type DesktopIcon,
} from "../src/services/desktopIconGuard";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const ICON_W = 74;
const ICON_H = 70;
const COL = 75;
const ROW = 98;

const icon = (name: string, col: number, row: number): DesktopIcon => ({
  name,
  bounds: { x: col * COL, y: 5 + row * ROW, width: ICON_W, height: ICON_H },
});

/** The real arrangement, including the four icons the bad box swallowed. */
const desktop: DesktopIcon[] = [
  icon("File", 2, 2),
  icon("New folder", 2, 3),
  icon("ridetrip-devop", 2, 4),
  icon("Trip", 2, 5),
  icon("books", 0, 8),
  icon("Trophies_landing", 4, 6),
];

const books = desktop.find((i) => i.name === "books")!;

// ---------------------------------------------------------------------------
// The reported failure
// ---------------------------------------------------------------------------

// A box tall enough to cover File, New folder, ridetrip-devop and Trip.
const fourIconBox = { x: 2 * COL - 6, y: 5 + 2 * ROW - 6, width: ICON_W + 12, height: ROW * 3 + ICON_H + 12 };
const swallowed = iconsCentredIn(fourIconBox, desktop);
check(
  "the box from the bug report really does cover four icons",
  swallowed.length === 4,
  swallowed.map((i) => i.name).join(", "),
);

const rejected = verifyDesktopIconTarget({
  box: fourIconBox,
  requested: "books",
  icons: desktop,
});
check(
  "a box spanning four icons is refused, not drawn",
  !rejected.verified,
  `${rejected.reason} — ${rejected.detail}`,
);

// ---------------------------------------------------------------------------
// Label mismatch
// ---------------------------------------------------------------------------

check(
  "asking for books and being handed Trip is refused",
  !verifyDesktopIconTarget({
    box: books.bounds,
    requested: "books",
    modelLabel: "Trip",
    icons: desktop,
  }).verified,
  "label-mismatch",
);

check(
  "a box landing on the wrong icon is refused even with no label",
  !verifyDesktopIconTarget({
    box: desktop.find((i) => i.name === "Trip")!.bounds,
    requested: "books",
    icons: desktop,
  }).verified,
  "lands on Trip",
);

check("books and 'books folder' are the same request", labelsAgree("books", "books folder"), "agree");
check("books and Trip are not", !labelsAgree("books", "Trip"), "disagree");

// ---------------------------------------------------------------------------
// The correct answer must still be accepted
// ---------------------------------------------------------------------------

const accepted = verifyDesktopIconTarget({
  box: books.bounds,
  requested: "books",
  modelLabel: "books",
  icons: desktop,
});
check(
  "the real books rectangle is accepted",
  accepted.verified && accepted.matched?.name === "books",
  `matched ${accepted.matched?.name}`,
);

check(
  "the accepted box holds no other icon centre",
  iconsCentredIn(books.bounds, desktop).length === 1,
  "one icon",
);

// ---------------------------------------------------------------------------
// Shape checks
// ---------------------------------------------------------------------------

check(
  "a boxed column strip is refused",
  !verifyDesktopIconTarget({
    box: { x: 0, y: 0, width: 80, height: 900 },
    requested: "books",
    icons: desktop,
  }).verified,
  "implausible-aspect",
);

check(
  "a box twice an icon wide is refused",
  !verifyDesktopIconTarget({
    box: { x: books.bounds.x, y: books.bounds.y, width: ICON_W * 2.2, height: ICON_H },
    requested: "books",
    icons: desktop,
  }).verified,
  "wider-than-one-icon",
);

check(
  "a box on empty desktop is refused",
  !verifyDesktopIconTarget({
    box: { x: 2000, y: 400, width: ICON_W, height: ICON_H },
    requested: "books",
    icons: desktop,
  }).verified,
  "covers-no-icon",
);

check(
  "a zero-area box is refused",
  !verifyDesktopIconTarget({ box: { x: 10, y: 10, width: 0, height: 0 }, requested: "books", icons: desktop })
    .verified,
  "empty-box",
);

// Inside an application window there is no icon list; the guard must not block
// every highlight just because it has nothing to compare against.
check(
  "with no Desktop icon list a plausible box still passes",
  verifyDesktopIconTarget({
    box: { x: 100, y: 100, width: 120, height: 40 },
    requested: "the play button",
    icons: [],
  }).verified,
  "no ground truth to contradict it",
);

// ---------------------------------------------------------------------------
// Request parsing — what actually gets looked up
// ---------------------------------------------------------------------------

check(
  "the books request reduces to a name the shell can match",
  desktopItemName("the books folder on my Desktop") === "books",
  desktopItemName("the books folder on my Desktop"),
);
check(
  "show me the books folder reduces the same way",
  desktopItemName("show me the books folder") === "show me books",
  desktopItemName("show me the books folder"),
);
check(
  "a Desktop mention is recognised",
  mentionsDesktop("Show me the books folder on my Desktop") && !mentionsDesktop("pause the music"),
  "desktop detected",
);

console.log("-".repeat(78));
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
