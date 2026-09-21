/**
 * The Running Apps card, asserted against the Applications card.
 *
 * Applications is the reference. These checks compare the two *structurally* —
 * same container classes, same header, same list wrapper, same row markup, same
 * chevron — because that is what makes two cards in one rail look like one
 * product rather than two.
 *
 * Run: npm run test:watch-ui
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

const reference = readFileSync(
  "src/components/dashboard/ConnectedToolsCard.tsx",
  "utf8",
);
const card = readFileSync("src/components/dashboard/RunningAppsCard.tsx", "utf8");
// The frame both cards render through. Since it is one component, "the two
// cards match" is no longer a string comparison between two files — it is the
// fact that neither file contains a frame of its own.
const frame = readFileSync(
  "src/components/dashboard/PagedApplicationCard.tsx",
  "utf8",
);
const row = readFileSync("src/components/watch/WatchRow.tsx", "utf8");
const composer = readFileSync(
  "src/components/dashboard/CommandComposer.tsx",
  "utf8",
);
const css = readFileSync("src/styles/watch.css", "utf8");

// ── One frame, two cards ──────────────────────────────────────────────────
console.log("\n═══ both cards render through one component ═══");
{
  // The strongest form this assertion can take. Comparing two files for
  // matching class names only ever proved they had been made to match *again*;
  // the two cards drifted after every edit because there were two of them.
  check(
    "Applications renders through PagedApplicationCard",
    /<PagedApplicationCard/.test(reference),
    "delegated",
  );
  check(
    "Running Apps renders through the same component",
    /<PagedApplicationCard/.test(card),
    "delegated",
  );
  for (const [label, source] of [
    ["Applications", reference],
    ["Running Apps", card],
  ] as const) {
    check(
      `${label} keeps no frame markup of its own`,
      !/className="card sonare-card tools-card/.test(source) &&
        !/tools-section-head/.test(source) &&
        !/card-lede/.test(source) &&
        !/opened-apps-list-wrap/.test(source) &&
        !/opened-apps-page-btn/.test(source),
      "no section, header, subtitle, wrapper or chevron",
    );
  }
  check(
    "the frame carries the container classes",
    /className=\{`card sonare-card tools-card tools-card-stretch \$\{props\.variant\}`\}/.test(
      frame,
    ),
    "card / sonare-card / tools-card / tools-card-stretch",
  );
  check(
    "no private Watch card class overriding the frame",
    !/\.opened-apps-card\s*\{[^}]*(?:border-radius|background|border:)/.test(css),
    "frame comes from .card / .sonare-card / .tools-card",
  );
  check(
    "no stylesheet gives the two variants different box metrics",
    !/\.(?:applications|opened-apps)-card\s+\.tools-list-opened\s*\{/.test(
      readFileSync("src/styles/cards.css", "utf8"),
    ),
    "one list rule, shared",
  );
}

// ── Header + subtitle ─────────────────────────────────────────────────────
console.log("\n═══ header and subtitle come from the frame ═══");
{
  check(
    "one header wrapper and label element, in the frame",
    /className="tools-section-head"/.test(frame) &&
      /className="card-label"/.test(frame),
    "tools-section-head + card-label",
  );
  check(
    "one right-hand All link, in the frame",
    (frame.match(/className="tools-section-link"/g) ?? []).length === 1 &&
      /All\s*\n\s*<ArrowRightIcon size=\{12\} \/>/.test(frame),
    "All + ArrowRightIcon",
  );
  check(
    "the header carries no count and no extra buttons",
    !/running-apps-count/.test(card) && !/watch-count/.test(card),
    "one label, one link",
  );
  check(
    "the subtitle is one card-lede, immediately after the header",
    /<p className="card-lede">\{props\.description\}<\/p>/.test(frame) &&
      frame.indexOf('<p className="card-lede"') >
        frame.indexOf('className="tools-section-head"'),
    "card-lede below the header, for both cards",
  );
  check(
    "each card supplies only its own words",
    /description="Apps you can link in Connect\."/.test(reference) &&
      /description="Apps ArcSonare can watch and control\."/.test(card),
    "labels and descriptions differ, structure does not",
  );
}

// ── List and rows ─────────────────────────────────────────────────────────
console.log("\n═══ one list wrapper, one row language ═══");
{
  check(
    "the list wrapper classes live in the frame",
    /opened-apps-list-wrap opened-apps-paged applications-paged/.test(frame),
    "opened-apps-list-wrap opened-apps-paged applications-paged",
  );
  check(
    "the ul classes live in the frame",
    /tools-list tools-list-opened tools-list-opened-snap/.test(frame),
    "tools-list tools-list-opened tools-list-opened-snap",
  );
  check(
    "rows use the Applications row and icon classes",
    /tools-list-row watch-row/.test(row) &&
      /className="tools-list-icon/.test(row) &&
      /className="tools-list-copy"/.test(row) &&
      /className="tools-list-title"/.test(row) &&
      /className="tools-list-desc"/.test(row),
    "tools-list-row / -icon / -copy / -title / -desc",
  );
  check(
    "artwork is 28px in both cards",
    /width=\{28\}\s+height=\{28\}/.test(reference) &&
      /width=\{28\}\s+height=\{28\}/.test(row),
    "28px in Applications and in Running apps",
  );
  // The only permitted override is the third grid column that holds the
  // overflow button. Anything touching height, padding or icon width would
  // change how tall the row is, which is the thing that must match.
  // `.watch-row-btn` and friends are the controls *inside* that third column —
  // their own padding does not set the row's height, so they are not row rules.
  const watchRowBlocks = css.match(/\.watch-row(?![-\w])[^{]*\{[^}]*\}/g) ?? [];
  const metricOverrides = watchRowBlocks.filter((block) =>
    /(?:^|[\s;])(?:height|min-height|padding|font-size)\s*:/.test(block),
  );
  check(
    "no row-height, padding or icon-size override for Watch rows",
    metricOverrides.length === 0,
    metricOverrides.length === 0
      ? "row metrics come from tools-list-row"
      : metricOverrides.join(" | "),
  );
}

// ── Two rows and the bottom arrow ─────────────────────────────────────────
console.log("\n═══ two rows, bottom-centred arrow ═══");
{
  check(
    "two rows, defined once and not settable per card",
    /export const VISIBLE_ROWS = 2;/.test(frame) &&
      !/VISIBLE_ROWS/.test(reference) &&
      !/VISIBLE_ROWS/.test(card),
    "one constant, in the frame",
  );
  check(
    "the chevron button classes and size live in the frame",
    /opened-apps-page-btn opened-apps-page-down/.test(frame) &&
      /opened-apps-page-btn opened-apps-page-up/.test(frame) &&
      /ChevronDown size=\{14\} strokeWidth=\{2\.25\}/.test(frame) &&
      /ChevronUp size=\{14\} strokeWidth=\{2\.25\}/.test(frame),
    "opened-apps-page-btn, 14px chevron, 2.25 stroke",
  );
  check(
    "the up chevron sits above the list and the down chevron below",
    frame.indexOf("opened-apps-page-up") < frame.indexOf("<ul") &&
      frame.indexOf("opened-apps-page-down") > frame.indexOf("</ul>"),
    "up above, down below",
  );
  check(
    "the up slot is always occupied, so the list never rides over the subtitle",
    /opened-apps-page-spacer/.test(frame) &&
      /\) : \(\s*<span className="opened-apps-page-spacer"/.test(frame),
    "chevron or spacer, never nothing",
  );
  check(
    "only one expansion control — no View all, no Manage crowding it",
    !/View all applications/.test(card) && !/running-apps-more/.test(card),
    "the chevron is the only expander",
  );
  check(
    "the window comes from the shared pager, not a private slice",
    /useRowPager\(/.test(frame) &&
      !/useRowPager|\.slice\(0,/.test(card) &&
      !/useRowPager|\.slice\(0,/.test(reference),
    "one window implementation for both cards",
  );
  check(
    "the card pages instead of expanding, so its height never changes",
    !/expanded/.test(card) && /pageBy\(1\)/.test(frame) && /pageBy\(-1\)/.test(frame),
    "±1 row, fixed height",
  );
  check(
    "no card introduces an inner scroll region",
    !/\.opened-apps-card[^}]*overflow-y:\s*auto/.test(css),
    "no nested scrolling",
  );
}

// -- Composer Watch control: three states, and only three ------------------
console.log("\n=== the composer Watch control ===");
{
  const control = readFileSync(
    "src/components/watch/WatchComposerControl.tsx",
    "utf8",
  );

  check(
    "it is Binoculars, never the eye",
    /import \{ Binoculars \} from "lucide-react"/.test(control) &&
      !/EyeIcon|\bEye\b/.test(control),
    "Binoculars",
  );
  check(
    "there is exactly one Watch control in the composer",
    (composer.match(/<WatchComposerControl/g) ?? []).length === 1,
    "one control, fourth and last",
  );
  check(
    "it is the fourth quick action, after Reasoning",
    composer.indexOf("<WatchComposerControl") > composer.indexOf("toggle-pill${reasoningActive"),
    "last in the toolbar",
  );

  // Inactive: a plain button. No icons, no name, no count, no dot.
  check(
    "with nothing active the label is null, so only the icon renders",
    /active\.length === 0\s*\n?\s*\? null/.test(control),
    "no label when inactive",
  );
  check(
    "the label renders only when something is active",
    /\{label \? <span className="toggle-pill-label">\{label\}<\/span> : null\}/.test(
      control,
    ),
    "no label, and no extra element, when inactive",
  );
  check(
    "the inactive tooltip is the plain one",
    /"Focus on running applications"/.test(control),
    "Focus on running applications",
  );
  check(
    "no status dot is rendered inside the pill",
    !/watch-dot/.test(control.slice(0, control.indexOf("watch-composer-pop"))),
    "dots belong to rows, not to the composer",
  );

  // One active: the application's name.
  check(
    "one active application shows its name",
    /active\.length === 1\s*\n?\s*\? active\[0\]\.displayName/.test(control),
    "the name, on its own",
  );

  // Two or more: Watch +N, text only.
  check(
    "several active applications collapse to Watch +N",
    /: `Watch \+\$\{active\.length\}`/.test(control),
    "Watch +N",
  );

  // The toolbar carries no application artwork in any state. Icons in a bar
  // meant for composing are decoration competing with the input; they belong in
  // the dropdown, where a person is choosing between applications.
  const button = control.slice(
    control.indexOf("<button"),
    control.indexOf("</button>"),
  );
  const dropdown = control.slice(control.indexOf("watch-composer-pop"));
  check(
    "the composer button renders no application image",
    !/<img/.test(button),
    /<img/.test(button) ? "IMAGE IN THE TOOLBAR" : "text only",
  );
  check(
    "it renders no icon list at all",
    !/active\.slice\(0, \d\)\.map/.test(button) &&
      !/iconSrc/.test(button),
    "no iconSrc, no slice-and-map",
  );
  check(
    "and no status dot or check",
    !/watch-dot|BadgeCheck/.test(button),
    "no dot, no check",
  );
  check(
    "with several active the pill shows the count, not a list of names",
    // The names do appear in `title` — that is the tooltip, which is exactly
    // where a full list belongs. What must not be rendered is the list itself.
    !/>\{active\.map/.test(button) &&
      /: `Watch \+\$\{active\.length\}`/.test(control),
    "Watch +N rendered, names only in the tooltip",
  );
  check(
    "the dropdown keeps its application icons",
    /<img/.test(dropdown) || /iconSrc/.test(dropdown),
    "icons where they help tell applications apart",
  );
  check(
    "and shows each application's name and state there",
    /watch-composer-option-name/.test(control) &&
      /watch-dot watch-dot-/.test(dropdown),
    "name + active/watched/running dot",
  );
  check(
    "no empty icon slot is left behind in the pill",
    !/\.watch-composer-active/.test(css),
    "the icon row's styles are gone with it",
  );
  check(
    "the pill is width-capped so it cannot take over the composer",
    /\.watch-composer \.toggle-pill-label\s*\{[^}]*max-width:/.test(css),
    /max-width:\s*([^;]+);/.exec(
      /\.watch-composer \.toggle-pill-label\s*\{[^}]*\}/.exec(css)?.[0] ?? "",
    )?.[1] ?? "none",
  );
  check(
    "the popover can reach the full manager",
    /watch-composer-manage/.test(control) && /open-watch-manager/.test(control),
    "Open Running apps",
  );
  check(
    "toggling one application in the popover toggles only that one",
    /toggleWatchScope\(conversationId, row\.appCatalogId\)/.test(control),
    "one toggle per application",
  );
}

// -- The active row stays neutral -------------------------------------------
console.log("\n=== the active row is marked, not recoloured ===");
{
  const cards = readFileSync("src/styles/cards.css", "utf8");

  check(
    "no rule paints an active row's background or border",
    !/\.watch-row[^{]*is-watch-active[^{]*\{/.test(css) &&
      !/is-watch-active[^{]*\{[^}]*(?:background:\s*rgba\(\s*(?:52|72)|box-shadow:\s*inset)/.test(
        css,
      ),
    "no green fill, no green inset border",
  );
  check(
    "the row's class list no longer carries an active surface",
    !/is-watch-active/.test(
      row.slice(row.indexOf("className={`tools-list-row"), row.indexOf("</div>")),
    ) || !/tools-list-row watch-row\$\{[^}]*is-watch-active/.test(row),
    "neutral row in every state",
  );
  check(
    "active is said by the Applications badge element",
    /className="tools-list-status is-watch-active"/.test(row) &&
      /<BadgeCheck size=\{14\} strokeWidth=\{2\.25\} \/>/.test(row),
    "tools-list-status + BadgeCheck, same as Applications",
  );
  check(
    "the badge sits inside the icon container, so it cannot change row height",
    row.indexOf('className="tools-list-status is-watch-active"') >
      row.indexOf('className="tools-list-icon tools-list-icon-app"') &&
      row.indexOf('className="tools-list-status is-watch-active"') <
        row.indexOf('className="tools-list-copy"'),
    "absolutely positioned on the 40px icon",
  );
  check(
    "the badge sets no geometry of its own",
    !/\.tools-list-status\.is-watch-active\s*\{[^}]*(?:width|height|top|right|border-radius|border:|box-shadow)/.test(
      css,
    ),
    "size, position, radius, border and shadow all come from the shared rule",
  );
  check(
    "the shared rule is the one Applications uses",
    /\.tools-list-status\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/.test(cards) &&
      /\.tools-list-status\s*\{[^}]*top:\s*-6px/.test(cards),
    "18px, offset -6px, from cards.css",
  );
  check(
    "it uses the composer's own accent token, not a hard-coded purple",
    /\.tools-list-status\.is-watch-active\s*\{[^}]*var\(--sonare-violet\)/.test(css) &&
      !/\.tools-list-status\.is-watch-active\s*\{[^}]*#[0-9a-f]{3,8}/i.test(css),
    "var(--sonare-violet) / var(--sonare-on-accent)",
  );
  check(
    "and a different colour from the Applications connected badge",
    /\.tools-list-status\.is-connected\s*\{[^}]*#4fce88/.test(cards),
    "green for connected, accent for active",
  );
  check(
    "the running dot survives as the availability status",
    /watch-dot watch-dot-\$\{kind\}/.test(row) &&
      /\.watch-dot-active\s*\{/.test(css),
    "solid green dot, unchanged",
  );
  check(
    "a watched-but-inactive row gets no badge",
    /\{row\.active \? \(/.test(row),
    "badge is conditional on active",
  );
}

// ── Eye icons ─────────────────────────────────────────────────────────────
console.log("\n═══ the eye icon is gone from normal Watch UI ═══");
{
  const surfaces: Array<[string, string]> = [
    ["Running Apps card", card],
    ["application row", row],
    ["composer", composer],
    ["message badge", readFileSync("src/components/watch/WatchSourceBadge.tsx", "utf8")],
    ["manager", readFileSync("src/components/watch/WatchManagerModal.tsx", "utf8")],
    ["details", readFileSync("src/components/watch/WatchDetailsModal.tsx", "utf8")],
  ];
  for (const [label, source] of surfaces) {
    check(
      `no EyeIcon in the ${label}`,
      !/EyeIcon/.test(source),
      /EyeIcon/.test(source) ? "EyeIcon present" : "none",
    );
  }
}

// ── One status mark per row ───────────────────────────────────────────────
console.log("\n═══ one status mark per row ═══");
{
  check(
    "the purple connected-check is not used on Watch rows",
    !/tools-list-check/.test(row),
    "no check badge",
  );
  check(
    "exactly one status element is rendered",
    (row.match(/watch-dot watch-dot-/g) ?? []).length === 1,
    `${(row.match(/watch-dot watch-dot-/g) ?? []).length} status element(s)`,
  );
  check(
    "the dot does not overlap the application artwork",
    !/\.watch-dot[^}]*position:\s*absolute/.test(css),
    "inline, beside the description",
  );
  check(
    "the dot is 8–10px",
    /\.watch-dot\s*\{[^}]*width:\s*(?:8|9|10)px/.test(css),
    /\.watch-dot\s*\{[^}]*width:\s*(\d+)px/.exec(css)?.[1] + "px",
  );
  for (const state of ["active", "watched", "unwatched", "offline"]) {
    check(
      `the ${state} state has its own appearance`,
      new RegExp(`\\.watch-dot-${state}\\s*\\{`).test(css),
      `.watch-dot-${state}`,
    );
  }
}

// ── Composer restoration ──────────────────────────────────────────────────
console.log("\n═══ the composer is back to its original layout ═══");
{
  check(
    "no Watch chip component",
    !/WatchComposerPill/.test(composer),
    "absent",
  );
  check(
    "no application icons in the composer",
    !/watchAppVisual|WatchAppIcons|watch-chip-app/.test(composer),
    "absent",
  );
  check(
    "no watch status dot in the composer",
    !/watch-dot/.test(composer),
    "absent",
  );
  check(
    "no Watch toggle-pill remains",
    !/toggle-pill-watch/.test(composer),
    "absent",
  );
  check(
    "no watch composer styles remain",
    !/toggle-pill-watch|watch-chip/.test(css),
    "absent from watch.css too",
  );
  check(
    'the "watch" composer mode is gone from message chips',
    !/case "watch"/.test(composer) && !/if \(watchActive\) return "watch"/.test(composer),
    "no watch mode chip",
  );
  check(
    "Smart mode and the microphone are untouched",
    /composer-mode/.test(composer) && /MicIcon/.test(composer),
    "both still present, unmodified",
  );
}

// ── Message badge ─────────────────────────────────────────────────────────
console.log("\n═══ the message badge is informational only ═══");
{
  const badge = readFileSync("src/components/watch/WatchSourceBadge.tsx", "utf8");
  // Checked against the JSX, not the file: the doc comment explains that the
  // badge carries no toggles, and the word "toggles" is not a toggle.
  const badgeJsx = badge.slice(badge.indexOf("return ("));
  check(
    "the badge contains no controls",
    !/<button|onClick=/.test(badgeJsx),
    "no interactive elements",
  );
  check(
    "it names the application and its role",
    /context|Controlled through/.test(badge),
    '"Spotify context" / "Controlled through Spotify"',
  );
  const service = readFileSync("src/services/AssistantService.ts", "utf8");
  check(
    "it is shown only when the application actually contributed to this turn",
    /const contributed = turnContributors\(\);/.test(service) &&
      /if \(contributed\.length === 0\) return reply;/.test(service),
    "credited from this turn's provenance, not from the question shape",
  );
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("Running Apps matches the Applications card.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
