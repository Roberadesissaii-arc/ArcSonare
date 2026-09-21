/**
 * The Dashboard's two side rails, asserted as one layout.
 *
 * The reported failure: Meeting Intelligence and Urgent were different heights,
 * and so were the cards above and below them. The cause was structural rather
 * than numeric — the two columns were laid out by different mechanisms. The
 * left was a flex column of content-sized cards that scrolled; the right was a
 * grid of `fr` rows stretched to the viewport. No pair of cards could agree on
 * a height because nothing was asking them to.
 *
 * So this suite asserts the *structure*, not two numbers kept in step: both
 * rails resolve to the same grid tracks from the same tokens, which makes each
 * pair the same height by construction. The physical measurement is a separate
 * step, run against the live app.
 *
 * Run: npm run test:dashboard-layout
 */

import { existsSync, readFileSync } from "node:fs";

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

const css = readFileSync("src/styles/dashboard.css", "utf8");
const tokens = readFileSync("src/styles/tokens.css", "utf8");
const page = readFileSync("src/pages/DashboardPage.tsx", "utf8");

/**
 * The declaration block that follows a selector.
 *
 * Located by index rather than by regex: these selector lists span several
 * lines, and matching them as one pattern is more brittle than finding where
 * the block starts and reading to its close.
 */
function rule(source: string, selector: string): string {
  const at = source.indexOf(selector);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return open === -1 || close === -1 ? "" : source.slice(open + 1, close);
}

// ── The pairs exist, in the order the rows imply ─────────────────────────
console.log("\n═══ the three pairs are opposite each other ═══");
{
  const left = page.slice(
    page.indexOf("dashboard-left-stretch"),
    page.indexOf("dashboard-center"),
  );
  const right = page.slice(page.indexOf("dashboard-right-stretch"));

  const order = (source: string, names: string[]) =>
    names.map((n) => source.indexOf(`<${n}`)).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1]));

  check(
    "the left rail is Focus, Meeting Intelligence, Applications",
    order(left, ["FocusCard", "MeetingIntelligenceCard", "ConnectedToolsCard"]),
    "three cards, in row order",
  );
  check(
    "the right rail is Up Next, Urgent, Running Apps",
    order(right, ["UpNextCard", "UrgentCard", "RunningAppsCard"]),
    "three cards, in row order",
  );
  check(
    "each rail holds exactly three cards, so the rows line up",
    (left.match(/<(FocusCard|MeetingIntelligenceCard|ConnectedToolsCard)\b/g) ?? [])
      .length === 3 &&
      (right.match(/<(UpNextCard|UrgentCard|RunningAppsCard)\b/g) ?? []).length === 3,
    "3 and 3",
  );
}

// One grid, not two rails
console.log("\n=== all six cards live in one grid ===");
{
  const dash = rule(css, ".dashboard {");
  check(
    "the Dashboard itself declares the rows",
    /grid-template-rows:[\s\S]*?var\(--dashboard-row-top\)/.test(dash) &&
      /var\(--dashboard-row-middle\)/.test(dash) &&
      /var\(--dashboard-row-bottom\)/.test(dash),
    "three tracks on .dashboard",
  );
  check(
    "and the gap between them",
    /row-gap:\s*var\(--dashboard-row-gap\)/.test(dash),
    "var(--dashboard-row-gap)",
  );
  check(
    "the rails are not layout boxes any more",
    /\.dashboard > \.dashboard-left-stretch,\s*\n\.dashboard > \.dashboard-right-stretch \{\s*\n\s*display: contents;/.test(
      css,
    ),
    "display: contents, scoped to beat .side-column",
  );
  check(
    "neither rail declares rows of its own",
    !/\.dashboard-(?:left|right)-stretch\s*\{[^}]*grid-template-rows/.test(css),
    "no private track list",
  );

  // Each pair shares a row because both cards are assigned that row — not
  // because two track lists were kept in step.
  const pairs: Array<[string, string, string]> = [
    [".focus-card", ".upnext-card", "1"],
    [".mi-card", ".urgent-card", "2"],
    [".applications-card", ".opened-apps-card", "3"],
  ];
  for (const [left, right, row] of pairs) {
    const l = rule(css, ".dashboard " + left + " {");
    const r = rule(css, ".dashboard " + right + " {");
    check(
      left + " and " + right + " are both in grid row " + row,
      new RegExp(`grid-row:\\s*${row}\\b`).test(l) &&
        new RegExp(`grid-row:\\s*${row}\\b`).test(r),
      "row " + row + ", columns 1 and 3",
    );
    check(
      left + " and " + right + " are in opposite columns",
      /grid-column:\s*1\b/.test(l) && /grid-column:\s*3\b/.test(r),
      "1 | 3",
    );
  }
  check(
    "the centre spans all three rows",
    /\.dashboard > \.dashboard-center\s*\{[^}]*grid-row:\s*1 \/ 4/.test(css),
    "grid-row: 1 / 4",
  );

  for (const token of [
    "--dashboard-row-gap",
    "--dashboard-row-top",
    "--dashboard-row-middle",
    "--dashboard-row-bottom",
    "--dashboard-row-top-min",
    "--dashboard-row-middle-min",
    "--dashboard-row-bottom-min",
    "--dashboard-side-width",
    "--dashboard-column-gap",
  ]) {
    check(
      token + " is defined once, in the token sheet",
      (tokens.match(new RegExp(token + ":", "g")) ?? []).length === 1,
      "one definition",
    );
  }
}

// Every side card fills the row it was given
console.log("\n=== every side card fills its row ===");
{
  const fill = rule(css, ".dashboard .focus-card,");
  check("one rule covers all six paired cards", fill.length > 0, "shared rule");
  check(
    "and it makes them fill the track",
    /height:\s*100%/.test(fill) &&
      /min-height:\s*0/.test(fill) &&
      /align-self:\s*stretch/.test(fill),
    "height: 100%, min-height: 0, align-self: stretch",
  );
  check(
    "nothing is left content-sized or capped",
    !/height:\s*auto/.test(fill) && /max-height:\s*none/.test(fill),
    "no auto height, no max-height",
  );
  check("and no margin escapes the shared gap", /margin:\s*0/.test(fill), "margin: 0");
}

// ── Short windows keep the pairs equal ───────────────────────────────────
console.log("\n═══ a short window keeps the rows paired ═══");
{
  const shared = rule(css, ".dashboard {");
  const rowTracks = /grid-template-rows:([\s\S]*?);/.exec(shared)?.[1] ?? "";
  check(
    "every row track has a minimum, so nothing is crushed to a strip",
    (rowTracks.match(/minmax\(/g) ?? []).length === 3,
    "three minmax row tracks",
  );
  const middleMin = /--dashboard-row-middle-min:\s*(\d+)px/.exec(tokens)?.[1];
  check(
    "Meeting Intelligence and Urgent keep a usable floor",
    Number(middleMin) >= 180,
    `${middleMin}px`,
  );
  check(
    "the floors are shared, so both rails hit them together",
    /var\(--dashboard-row-top-min\)/.test(rowTracks) &&
      /var\(--dashboard-row-middle-min\)/.test(rowTracks) &&
      /var\(--dashboard-row-bottom-min\)/.test(rowTracks),
    "the same floor for each pair",
  );
}

// ── Meeting Intelligence icons are the real assets ───────────────────────
console.log("\n═══ the platform icons are ArcSonare's own artwork ═══");
{
  const icon = readFileSync(
    "src/components/meeting/MeetingPlatformIcon.tsx",
    "utf8",
  );
  const registry = readFileSync("src/config/iconRegistry.ts", "utf8");
  const meetingCss = readFileSync("src/styles/meeting.css", "utf8");

  check(
    "the icon reads the same registry Connect and Applications read",
    /from "\.\.\/\.\.\/config\/iconRegistry"/.test(icon) &&
      /integrationIcons\[/.test(icon),
    "integrationIcons",
  );
  check(
    "no hand-drawn brand SVG remains",
    !/<svg/.test(icon) && !/viewBox/.test(icon),
    /<svg/.test(icon) ? "SVG STILL DRAWN HERE" : "assets only",
  );
  check(
    "no generic camera icon stands in for a platform",
    !/Video\b|VideoIcon|Camera/.test(icon),
    "no placeholder camera",
  );
  check(
    "nothing is hotlinked",
    !/https?:\/\//.test(icon),
    "local assets only",
  );

  for (const [platform, integration] of [
    ["Zoom", "zoom"],
    ["Microsoft Teams", "teams"],
    ["Google Meet", "googleMeet"],
  ] as const) {
    check(
      `${platform} maps to the real ${integration} asset`,
      new RegExp(`["']?${integration}["']?:\\s*"?${integration}"?`).test(icon) ||
        new RegExp(`:\\s*"${integration}"`).test(icon),
      `→ ${integration}`,
    );
    check(
      `and that asset exists in the registry`,
      new RegExp(`import ${integration} from "\\.\\./assets/icons/integrations/`).test(
        registry,
      ),
      "imported from src/assets/icons/integrations",
    );
  }

  // Webex has no artwork anywhere in the repository. The fallback says so
  // rather than impersonating the brand with a drawn approximation.
  check(
    "Webex is not given invented artwork",
    /Webex is deliberately absent/.test(icon) && /FALLBACK_INITIAL/.test(icon),
    "neutral badge, documented",
  );

  check(
    "the icons are big enough to recognise",
    /\.mi-platform-chip\s*\{[^}]*width:\s*28px/.test(meetingCss) &&
      /\.mi-platform-chip img\s*\{[^}]*width:\s*20px/.test(meetingCss),
    "28px slot, 20px artwork",
  );
  check(
    "with the spacing the header layout calls for",
    /\.mi-platform-row\s*\{[^}]*gap:\s*6px/.test(meetingCss),
    "6px gap",
  );
  check(
    "a detected platform is ringed, and none of the others is hidden",
    /\.mi-platform-chip\.is-detected\s*\{/.test(meetingCss) &&
      !/\.mi-platform-chip[^{]*\{[^}]*display:\s*none/.test(meetingCss),
    "ring on one, all four still drawn",
  );
  check(
    "the ring uses ArcSonare's accent rather than a new colour",
    /\.mi-platform-chip\.is-detected\s*\{[^}]*rgba\(145, 104, 255/.test(meetingCss),
    "the violet accent",
  );
}

// The measuring harness. Structure is asserted above; the numbers come from
// real `getBoundingClientRect()` calls against these same stylesheets, which is
// the only evidence that settles a height question.
console.log("\n=== the geometry harness is available and out of the way ===");
{
  check(
    "the harness exists under scripts/fixtures",
    existsSync("scripts/fixtures/dashboard-geometry.html"),
    "scripts/fixtures/dashboard-geometry.html",
  );
  check(
    "and does not ship as a public application asset",
    !existsSync("public/dashboard-geometry.html"),
    "not in public/",
  );
  const harness = readFileSync(
    "scripts/fixtures/dashboard-geometry.html",
    "utf8",
  );
  check(
    "it loads the real stylesheets rather than copies of them",
    /href="\.\.\/\.\.\/src\/styles\/dashboard\.css"/.test(harness) &&
      /href="\.\.\/\.\.\/src\/styles\/tokens\.css"/.test(harness),
    "../../src/styles/*",
  );
  check(
    "it reproduces the real card class names",
    [
      "focus-card",
      "upnext-card",
      "mi-card",
      "urgent-card",
      "applications-card",
      "opened-apps-card",
    ].every((c) => harness.includes(c)),
    "all six cards",
  );
  check(
    "and exposes the measurement for a browser to call",
    /window\.measureDashboard = function/.test(harness) &&
      /getBoundingClientRect\(\)/.test(harness),
    "window.measureDashboard()",
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("One layout, two rails, three pairs — and the real icons.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
