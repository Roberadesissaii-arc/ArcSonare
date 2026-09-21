/**
 * Creating a file and changing one are different requests.
 *
 * The bug this guards: "fix the bug in that script" was routed to the create
 * capability, which found the file already there, asked permission to overwrite
 * it, and — because the answer was never attached to anything — asked again.
 * The user's "yes" did nothing, forever.
 *
 * These checks are about the contract that prevents that: the registry has to
 * offer a modify tool and describe it well enough that a model picks it, the
 * modify tool must not be gated on confirmation, and the resumed call after an
 * approval must differ from the call that asked.
 *
 * Run: npx tsx scripts/check-file-intents.mts
 */

import { readFileSync } from "node:fs";
import { CAPABILITY_REGISTRY } from "../src/features/capabilities/capabilityRegistry";
import {
  clearSessionActions,
  formatSessionActionContext,
  recentFileArtifact,
  recordSessionAction,
} from "../src/features/capabilities/actionSessionMemory";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const byId = (id: string) => CAPABILITY_REGISTRY.find((c) => c.id === id);

// ------------------------------------------------- the tools exist and differ
{
  const modify = byId("filesystem.modify_file");
  const create = byId("filesystem.create_file");
  const read = byId("filesystem.read_for_edit");
  check(
    "there is a distinct tool for changing an existing file",
    !!modify && !!create && modify.id !== create.id,
    modify ? `${modify.id} vs ${create?.id}` : "filesystem.modify_file missing",
  );
  check(
    "reading before an edit is its own read-only step",
    read?.riskLevel === "read-only",
    `${read?.id} (${read?.riskLevel})`,
  );

  check(
    "modifying an existing file never asks for confirmation",
    // The file existing is the premise of a modification, not a hazard.
    modify?.confirmation === "never",
    `confirmation=${modify?.confirmation}`,
  );
  check(
    "modifying is not classed as destructive",
    modify?.riskLevel === "reversible",
    `riskLevel=${modify?.riskLevel}`,
  );
}

// ------------------------------------- descriptions steer create vs modify
{
  const modify = byId("filesystem.modify_file")!;
  const create = byId("filesystem.create_file")!;
  const write = byId("filesystem.write_text_file")!;

  check(
    "the modify tool tells the model it will not ask about overwriting",
    /never asks permission to overwrite/i.test(modify.description),
    "stated in the description",
  );
  check(
    "the create tool sends existing-file edits to the modify tool",
    /use filesystem\.modify_file instead/i.test(create.description),
    "create defers to modify",
  );
  check(
    "the full-rewrite tool also defers for partial changes",
    /use filesystem\.modify_file instead/i.test(write.description),
    "write_text_file defers to modify",
  );

  // The phrases a user actually says have to land on the right tool.
  const fixPhrases = [
    "fix the bug in prime_finder.py",
    "correct the syntax error in the file you just created",
    "change the API url in config.json",
    "add error handling to that file",
  ];
  const modifyText = [
    modify.description,
    ...modify.intentExamples,
    ...modify.keywords,
    ...modify.aliases,
  ]
    .join(" ")
    .toLowerCase();
  const missed = fixPhrases.filter((p) => {
    const words = p.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    return !words.some((w) => modifyText.includes(w));
  });
  check(
    "every ordinary way of asking for a fix matches the modify tool",
    missed.length === 0,
    missed.length ? `unmatched: ${missed.join("; ")}` : "fix / correct / change / add all match",
  );
}

// ------------------------------------------------- "that file" resolution
{
  clearSessionActions();
  const created: ToolResult = {
    callId: "c1",
    capabilityId: "filesystem.create_file",
    status: "success",
    summary: 'Wrote "C:\\Users\\rober\\Desktop\\prime.py" (276 B).',
    data: { path: "C:\\Users\\rober\\Desktop\\prime.py" },
    evidence: { verified: true, method: "filesystem-postcondition" },
    startedAt: "",
    completedAt: "",
    durationMs: 1,
  };
  recordSessionAction("create a python file on my desktop", "filesystem.create_file", created);

  const artifact = recentFileArtifact();
  check(
    '"that file" resolves to the path ArcSonare already knows',
    artifact?.path === "C:\\Users\\rober\\Desktop\\prime.py",
    String(artifact?.path),
  );

  const context = formatSessionActionContext();
  check(
    "the prompt names that path and forbids re-creating it",
    context.includes("prime.py") &&
      /do not call filesystem\.create_file/i.test(context) &&
      /filesystem\.modify_file/i.test(context),
    "path + modify instruction present",
  );
  check(
    "the prompt tells the model not to hunt for the file on screen",
    /do not search the screen/i.test(context),
    // Searching the desktop for a file whose path is recorded is both slower
    // and capable of finding a different file with the same name.
    "no visual search for a known path",
  );

  // A capture is not a file the user can ask to be fixed.
  clearSessionActions();
  recordSessionAction("screenshot", "screen.capture", {
    ...created,
    capabilityId: "screen.capture",
    data: { path: "C:\\captures\\frame-1.png" },
  });
  check(
    "a screenshot is not offered as the file to fix",
    recentFileArtifact() === undefined,
    "only file-producing capabilities count",
  );
  clearSessionActions();
}

// --------------------------------------- the approval actually changes the call
{
  const engine = readFileSync("src/features/capabilities/capabilityEngine.ts", "utf8");
  const resume = engine.slice(engine.indexOf("export async function resolvePendingConfirmation"));
  check(
    "approving a name clash resumes with overwrite, not the same call again",
    resume.includes('if_exists: "overwrite"'),
    // Without this the resumed call is byte-identical to the one that asked,
    // so the file still exists and the same question comes straight back.
    "the resumed call carries the decision",
  );
  check(
    "the resumed call carries the approval token",
    resume.includes("pending.token"),
    "token forwarded on resume",
  );

  const fs = readFileSync("src-tauri/src/capabilities/filesystem.rs", "utf8");
  check(
    "the conflict question hands back a token that can answer it",
    fs.includes("confirmations.issue(capability_id, &approved_args)") &&
      fs.includes('"confirmation": {'),
    // A confirmation with no token is a confirmation nobody can answer.
    "token issued with the question",
  );
  check(
    "the token is issued against the args that will actually be re-sent",
    fs.includes('"if_exists": "overwrite",') &&
      fs.indexOf("let approved_args") < fs.indexOf("confirmations.issue(capability_id"),
    "approved action == executed action",
  );

  const edit = readFileSync("src-tauri/src/capabilities/file_edit.rs", "utf8");
  check(
    "modifying a file never returns needs-confirmation",
    !edit.includes("needs_confirmation"),
    "no overwrite gate on the edit path",
  );
  check(
    "a modification of a missing file is refused, not turned into a create",
    edit.includes("there is nothing to modify"),
    "not-found, not silent creation",
  );
  check(
    "edits are written atomically through a temporary file",
    edit.includes("fn atomic_write") && edit.includes("arcsonare-tmp"),
    "temp + replace",
  );
  check(
    "a stale patch is refused rather than applied",
    edit.includes("FILE_CHANGED_SINCE_READ"),
    "hash checked before writing",
  );

  const executor = readFileSync("src-tauri/src/capabilities/executor.rs", "utf8");
  const risk = executor.slice(0, executor.indexOf("fn parse"));
  check(
    "deleting still requires confirmation",
    /"filesystem\.delete" => Risk::Destructive/.test(risk),
    // Relaxing the overwrite loop must not relax deletion.
    "delete remains destructive",
  );
}

console.log(failed === 0 ? "\nAll file intent checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
