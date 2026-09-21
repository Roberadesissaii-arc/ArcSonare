/**
 * Ownership must survive the trip from screenshot to click.
 *
 * The bug this guards is not arithmetic — Rust does the arithmetic now. It is
 * ownership going missing on the way: a capture whose display id gets dropped,
 * a model answer that supplies its own frame id, or production code quietly
 * reaching for the diagnostic helpers that add an origin in TypeScript. Each of
 * those puts a click on the wrong monitor while every individual function still
 * looks correct.
 *
 * Run: npx tsx scripts/check-frame-ownership.mts
 */

import { readFileSync } from "node:fs";
import {
  buildVisualTarget,
  frameContextFrom,
  isVisualError,
  describeVisualError,
} from "../src/services/visualTarget";
import { modelGeometryFromBox2d } from "../src/services/visionCoords";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

/** What Rust's `screen.capture` actually returns, in its own snake_case. */
const captureData = {
  frame_id: "frame-1785527330361-0",
  display_id: "717163523",
  topology_version: "248975325:3840x1080@0,0s1.000r0|717163523:1080x1920@-1080,-661s1.000r90",
  capture_width: 1080,
  capture_height: 1920,
  image_width: 1080,
  image_height: 1920,
  capture_id: "frame-1785527330361-0",
};

// ------------------------------------------------------- reading the capture
{
  const ctx = frameContextFrom(captureData);
  check(
    "a capture's ownership survives snake_case → camelCase",
    ctx?.frameId === captureData.frame_id &&
      ctx?.displayId === captureData.display_id &&
      ctx?.topologyVersion === captureData.topology_version,
    `${ctx?.frameId} / ${ctx?.displayId}`,
  );
  check(
    "the portrait display's id is carried verbatim, not renumbered",
    ctx?.displayId === "717163523",
    String(ctx?.displayId),
  );
}
{
  // Each field removed in turn: a partial context must be rejected outright,
  // because it looks actionable right up to the point Rust refuses it.
  for (const missing of ["frame_id", "display_id", "topology_version"] as const) {
    const partial: Record<string, unknown> = { ...captureData };
    delete partial[missing];
    check(
      `a capture missing ${missing} is not actionable`,
      frameContextFrom(partial) === null,
      "rejected",
    );
  }
  check(
    "an empty capture result is not actionable",
    frameContextFrom(undefined) === null && frameContextFrom({}) === null,
    "rejected",
  );
}

// -------------------------------------------------- binding model to capture
{
  const ctx = frameContextFrom(captureData)!;
  const geometry = modelGeometryFromBox2d([100, 200, 300, 400])!;
  const target = buildVisualTarget(ctx, { ...geometry, label: "the button" });
  check(
    "a target takes its frame from the capture, not from the model",
    target.frameId === captureData.frame_id &&
      target.displayId === captureData.display_id &&
      target.topologyVersion === captureData.topology_version,
    `${target.frameId} on display ${target.displayId}`,
  );
  check(
    "geometry stays in the model's normalised space",
    target.normalizedMax === 1000 && target.x === 300 && target.y === 200,
    `centre (${target.x}, ${target.y}) of max ${target.normalizedMax}`,
  );
  check(
    "the box travels with the point so a wrong match is visible",
    target.boxX === 200 && target.boxY === 100 && target.boxWidth === 200 && target.boxHeight === 200,
    `box ${target.boxX},${target.boxY} ${target.boxWidth}x${target.boxHeight}`,
  );

  // A model that invents ownership must be ignored, not believed.
  const hostile = {
    ...geometry,
    label: "x",
    frameId: "attacker-frame",
    displayId: "1",
    topologyVersion: "made-up",
  } as never;
  const bound = buildVisualTarget(ctx, hostile);
  check(
    "ownership fields in the model's own output are discarded",
    bound.frameId === captureData.frame_id &&
      bound.displayId === captureData.display_id &&
      bound.topologyVersion === captureData.topology_version,
    `${bound.frameId} / ${bound.displayId}`,
  );
}

// ------------------------------------------------------------ shape guards
{
  check(
    "a tall sliver is rejected before it becomes a click",
    // A whole icon column rather than one icon: clicking its centre hits the
    // wrong row, and the box shape is the only warning available.
    modelGeometryFromBox2d([50, 400, 950, 480]) === null,
    "rejected",
  );
  check(
    "a zero-area box is rejected",
    modelGeometryFromBox2d([500, 500, 500, 500]) === null,
    "rejected",
  );
  check(
    "a non-finite box is rejected",
    modelGeometryFromBox2d([NaN, 0, 100, 100]) === null,
    "rejected",
  );
}

// ------------------------------------------------------------- refusals
{
  const e = describeVisualError({
    code: "frame-expired",
    message: "that screenshot is 41000ms old",
    recapture: true,
  });
  check(
    "a Rust refusal keeps its code and its recapture hint",
    isVisualError(e) && e.code === "frame-expired" && e.recapture,
    `${e.code} recapture=${e.recapture}`,
  );
  const thrown = describeVisualError(new Error("boom"));
  check(
    "an unexpected throw is not reported as retryable",
    thrown.recapture === false,
    `${thrown.code} recapture=${thrown.recapture}`,
  );
}

// ------------------------------------------- production must not compute origins
{
  const source = readFileSync("src/features/capabilities/frontendExecutors.ts", "utf8");
  const banned = [
    "diagnosticClickPointFromDetection",
    "diagnosticImagePointToScreen",
    "mouse_monitor_bounds",
    "origin_x",
    "originX",
  ];
  const found = banned.filter((b) => source.includes(b));
  check(
    "the runtime executor computes no desktop coordinates of its own",
    found.length === 0,
    found.length ? `still references: ${found.join(", ")}` : "none of the origin helpers",
  );

  const pointer = readFileSync("src/services/agentPointer.ts", "utf8");
  check(
    "the pointer module no longer takes coordinates from the webview",
    !pointer.includes("agent_set_cursor_pos") && !pointer.includes("input.click_at"),
    "hide only",
  );

  // "Show me" must outline and stop. The guarantee is structural — the preview
  // command never calls the cursor helper — so read the source rather than
  // trusting that it stays that way.
  const rust = readFileSync("src-tauri/src/display/visual_commands.rs", "utf8");
  const preview = rust.slice(
    rust.indexOf("pub fn preview_visual_target"),
    rust.indexOf("pub fn move_to_visual_target"),
  );
  check(
    "preview outlines the target and never moves the cursor",
    preview.length > 0 &&
      !preview.includes("move_cursor_verified") &&
      !preview.includes("click_at_point"),
    preview.length ? "overlay only" : "could not read preview_visual_target",
  );
  check(
    "clicking checks the screen before it moves the cursor",
    // Order matters: freshness has to run before move_cursor_verified, or a
    // stale coordinate has already been pointed at by the time it is refused.
    rust.indexOf("pre_action_freshness", rust.indexOf("pub fn execute_visual_target")) <
      rust.indexOf("move_cursor_verified", rust.indexOf("pub fn execute_visual_target")),
    "freshness first",
  );
  check(
    "clicking refuses when the cursor did not arrive",
    rust.includes("CursorPositionMismatch") && rust.includes("if !cursor.success"),
    "guarded",
  );
  check(
    "a click that was sent can never be retried automatically",
    rust.includes("fn side_effect_possible") &&
      rust.includes("Self::ClickSent") &&
      rust.includes("Self::VerificationFailed"),
    "click-sent and verification-failed both block retry",
  );
}

// --------------------------------------------- click-sent is not click-worked
{
  const executor = readFileSync("src/features/capabilities/frontendExecutors.ts", "utf8");
  check(
    "an unverified click is reported as partial, not success",
    executor.includes('verified ? "success" : "partial"') &&
      executor.includes('clicked.status === "verified-succeeded"'),
    "only a verified click reports success",
  );
  check(
    "a refused click is never reported as having happened",
    executor.includes("if (!clicked.clicked)"),
    "pre-click refusals reported separately",
  );

  const visual = readFileSync("src/services/visualTarget.ts", "utf8");
  check(
    "a click defaults to asking for verification",
    visual.includes('expectedOutcome: { kind: "region-changed" }'),
    "region-changed by default",
  );
  check(
    "previews skip freshness but clicks do not",
    visual.includes("skipFreshness: true, ...options") &&
      !visual.slice(visual.indexOf("export function executeVisualTarget")).includes("skipFreshness: true"),
    "preview only",
  );
}

console.log(failed === 0 ? "\nAll frame ownership checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
