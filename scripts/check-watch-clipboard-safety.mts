/**
 * The user's clipboard is not a test fixture.
 *
 * Earlier verification drove the composer by writing the prompt to the system
 * clipboard and pasting it. That was wrong twice over: it destroyed whatever the
 * user had copied, and it proved nothing — text appearing in an input is not
 * evidence that the production request path ran. It was also unreliable, and
 * twice pasted the wrong thing into a live test.
 *
 * Two rules, asserted here:
 *
 *   1. Nothing in the repository writes the user's clipboard for testing.
 *   2. Automated request tests enter through the production path, so a test
 *      cannot pass on pasted text alone.
 *
 * Run: npm run test:watch-clipboard-safety
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

const SCRIPTS = "scripts";
const scriptFiles = readdirSync(SCRIPTS).filter(
  (f) => f.endsWith(".mts") || f.endsWith(".mjs"),
);

// ── No test writes the user's clipboard ──────────────────────────────────
console.log("\n═══ real user clipboard writes = 0 ═══");
{
  // Every way a Node or browser context can put something on the system
  // clipboard. `write_clipboard` is the computer-use tool; the rest are the
  // web and shell routes.
  const WRITES = [
    /navigator\.clipboard\.write/,
    /write_clipboard/,
    /Set-Clipboard/,
    /\bclip\.exe\b/,
    /document\.execCommand\(\s*["']copy["']/,
    /pbcopy|xclip|xsel/,
  ];
  const offenders: string[] = [];
  for (const file of scriptFiles) {
    const source = readFileSync(join(SCRIPTS, file), "utf8");
    // This file names the patterns in order to forbid them.
    if (file === "check-watch-clipboard-safety.mts") continue;
    for (const pattern of WRITES) {
      if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
    }
  }
  check(
    "no test script writes the system clipboard",
    offenders.length === 0,
    offenders.length === 0 ? "0 writes" : offenders.join(" | "),
  );
}

console.log("\n═══ nothing reads the user's clipboard content either ═══");
{
  const READS = [/navigator\.clipboard\.read/, /read_clipboard/, /Get-Clipboard/];
  const offenders: string[] = [];
  for (const file of scriptFiles) {
    if (file === "check-watch-clipboard-safety.mts") continue;
    const source = readFileSync(join(SCRIPTS, file), "utf8");
    for (const pattern of READS) {
      if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
    }
  }
  check(
    "no test script reads the clipboard",
    offenders.length === 0,
    offenders.length === 0
      ? "0 reads"
      : offenders.join(" | "),
  );
}

// ── ArcSonare itself does not write the clipboard behind the user ────────
console.log("\n═══ the product only touches the clipboard when asked ═══");
{
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });

  const writers = walk("src").filter((path) =>
    /navigator\.clipboard\.write|document\.execCommand\(\s*["']copy["']/.test(
      readFileSync(path, "utf8"),
    ),
  );
  // A "copy" button the user pressed is a clipboard write the user asked for.
  // What must not exist is a write on a path the user did not trigger.
  const unrequested = writers.filter((path) => {
    const source = readFileSync(path, "utf8");
    return !/onClick|onCopy|copyTo|handleCopy|"Copy"|'Copy'/.test(source);
  });
  check(
    "every clipboard write in the app is behind an explicit user action",
    unrequested.length === 0,
    unrequested.length === 0
      ? `${writers.length} write site(s), all user-triggered`
      : `UNREQUESTED: ${unrequested.join(", ")}`,
  );
  const watchFiles = walk("src/features/watch").concat(walk("src/components/watch"));
  check(
    "no Watch code touches the clipboard at all",
    !watchFiles.some((path) => /clipboard/i.test(readFileSync(path, "utf8"))),
    "Watch never reads or writes it",
  );
}

// ── Request tests enter through the production path ──────────────────────
console.log("\n═══ request tests use the production path ═══");
{
  const harness = readFileSync("scripts/watch-production-path.mts", "utf8");
  check(
    "the harness calls the same entry point the Send button calls",
    /from "\.\.\/src\/services\/AssistantService"/.test(harness) &&
      /askAssistant\(/.test(harness),
    "askAssistant, the composer's own call",
  );
  check(
    "it does not synthesise the answer or skip the engine",
    !/skipCapabilities: true/.test(harness) &&
      !/skipOrchestration: true/.test(harness),
    "capabilities and orchestration both run",
  );
  check(
    "it sets a real conversation, so scope and provenance apply",
    /setCurrentConversation\(/.test(harness),
    "conversation id is real",
  );
  check(
    "and it calls no clipboard API",
    // The word appears in its doc comment, which explains what it replaces.
    // What must be absent is a call.
    !/navigator\.clipboard|write_clipboard|read_clipboard|Set-Clipboard|Get-Clipboard/.test(
      harness,
    ),
    "no clipboard API used",
  );

  const composer = readFileSync(
    "src/components/dashboard/CommandComposer.tsx",
    "utf8",
  );
  check(
    "that entry point really is what the composer uses",
    /await askAssistant\(text, \{/.test(composer),
    "CommandComposer calls askAssistant",
  );
}

// ── A test cannot pass on pasted text alone ──────────────────────────────
console.log("\n═══ pasted text alone cannot make a test pass ═══");
{
  const suites = [
    "check-watch-app-matrix.mts",
    "check-watch-vscode-browser.mts",
    "check-watch-multiscope.mts",
    "check-watch-provenance.mts",
  ];
  for (const suite of suites) {
    const source = readFileSync(join(SCRIPTS, suite), "utf8");
    // Every application claim in these suites rests on one of these: what the
    // prompt builder produced, what the provenance ledger recorded, or what the
    // scope reported. None of them can be satisfied by text in an input.
    const evidence =
      /watchContextForPrompt\(/.test(source) ||
      /turnContributors\(\)/.test(source) ||
      /refreshWatchScope\(/.test(source);
    check(
      `${suite} asserts on state, not on typed text`,
      evidence,
      "prompt block / provenance / scope",
    );
  }
}

console.log("\n──────────────────────────────────────────────");
if (failed === 0) {
  console.log("The user's clipboard is untouched, and no test passes on paste.");
} else {
  console.log(`${failed} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
