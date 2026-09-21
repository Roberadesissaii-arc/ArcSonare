/**
 * The border-and-circle conversation, driven through the production executors.
 *
 * These call `annotationExecutors.ts` itself — the module the capability table
 * dispatches to — with the vision and native calls replaced by fakes. That
 * split is the point: the parts being faked are a camera and a GPU, and the
 * parts being tested are which target gets resolved, which id gets updated, and
 * what happens when the native side says no.
 *
 * The Rust manager has its own 26 tests for identity and lifecycle. This is the
 * layer above: does the executor ask it the right question, and does it ever
 * report success it did not get?
 *
 * Run: npm run test:annotation-executors
 */

import {
  executeAnnotate,
  executeClearAnnotations,
  executeRemoveAnnotation,
  executeUpdateAnnotation,
  type AnnotationExecutorDeps,
} from "../src/features/capabilities/annotationExecutors";
import { permissionFor } from "../src/features/capabilities/permissionPolicy";
import { getCapability } from "../src/features/capabilities/capabilityRegistry";
import type { ToolResult } from "../src/features/capabilities/capabilityTypes";

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

// ── A fake of the Rust manager, with the same rules ───────────────────────
//
// Mirrors `AnnotationManager`: Rust-owned ids, duplicate creates return the
// existing annotation, scope is enforced, a removed annotation cannot be
// updated. The real one is tested in Rust; this exists so the executor can be
// driven without a window server.
interface Row {
  id: string;
  conversationId: string;
  accountId: string;
  requestId: string;
  targetId: string;
  parentTargetId?: string;
  shape: string;
  geometry: { x: number; y: number; width: number; height: number };
  style: { colour: string; thickness: number; opacity: number };
  sourceWindowId: string;
  monitorId: string;
  removed: boolean;
}

class FakeManager {
  rows: Row[] = [];
  next = 1;
  /** Set to make the native side refuse, so "no false success" is testable. */
  refuse = false;
  createCalls = 0;
  updateCalls = 0;

  create(request: Record<string, unknown>): Record<string, unknown> {
    this.createCalls += 1;
    if (this.refuse) {
      return { ok: false, error: "overlay-failed", message: "I couldn't draw on screen just now." };
    }
    const existing = this.rows.find(
      (r) =>
        !r.removed &&
        r.requestId === request.requestId &&
        r.targetId === request.targetId &&
        r.shape === request.shape,
    );
    if (existing) return { ok: true, annotation: existing };

    const style = (request.style ?? {}) as { colour?: string };
    const row: Row = {
      id: `ann-fake-${this.next++}`,
      conversationId: String(request.conversationId),
      accountId: String(request.accountId),
      requestId: String(request.requestId),
      targetId: String(request.targetId),
      parentTargetId: request.parentTargetId as string | undefined,
      shape: String(request.shape),
      geometry: request.geometry as Row["geometry"],
      style: { colour: style.colour ?? "#c084fc", thickness: 2.5, opacity: 1 },
      sourceWindowId: String(request.sourceWindowId ?? ""),
      monitorId: String(request.monitorId ?? ""),
      removed: false,
    };
    this.rows.push(row);
    return { ok: true, annotation: row };
  }

  update(id: string, scope: Record<string, string>, change: Record<string, unknown>) {
    this.updateCalls += 1;
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { ok: false, error: "not-found", message: "I don't have that annotation." };
    if (row.accountId !== scope.accountId || row.conversationId !== scope.conversationId) {
      return { ok: false, error: "not-yours", message: "That belongs to another conversation." };
    }
    if (row.removed) {
      return { ok: false, error: "already-removed", message: "That one's already gone." };
    }
    if (typeof change.colour === "string") row.style.colour = change.colour;
    return { ok: true, annotation: row };
  }

  remove(id: string, scope: Record<string, string>) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { ok: false, error: "not-found", message: "I don't have that annotation." };
    if (row.accountId !== scope.accountId || row.conversationId !== scope.conversationId) {
      return { ok: false, error: "not-yours", message: "That belongs to another conversation." };
    }
    if (row.removed) {
      return { ok: false, error: "already-removed", message: "That one's already gone." };
    }
    row.removed = true;
    return { ok: true };
  }

  live(scope: Record<string, string>) {
    return this.rows.filter(
      (r) =>
        !r.removed &&
        r.accountId === scope.accountId &&
        r.conversationId === scope.conversationId,
    );
  }
}

let manager = new FakeManager();
let scope = { accountId: "acct-A", conversationId: "conv-1" };
let requestId = "req-1";
let remembered: Record<string, string> = {};

// The service and context modules the executor imports, replaced in the module
// registry so the executor itself is unmodified production code.
const serviceStub = {
  annotateResolved: async (
    s: typeof scope,
    _context: unknown,
    geometry: { box?: { x: number; y: number; width: number; height: number } },
    options: Record<string, unknown>,
  ) =>
    manager.create({
      accountId: s.accountId,
      conversationId: s.conversationId,
      requestId: options.requestId,
      targetId: options.targetId,
      parentTargetId: options.parentTargetId,
      shape: options.shape,
      geometry: geometry.box ?? { x: 0, y: 0, width: 0, height: 0 },
      style: options.colour ? { colour: options.colour } : {},
      sourceWindowId: "hwnd-image",
      monitorId: "1",
    }),
  updateAnnotation: async (s: typeof scope, id: string, change: Record<string, unknown>) =>
    manager.update(id, s, change),
  removeAnnotation: async (s: typeof scope, id: string) => manager.remove(id, s),
  listAnnotations: async (s: typeof scope) => manager.live(s),
  annotationsForTarget: async (s: typeof scope, targetId: string) =>
    manager.live(s).filter((r) => r.targetId === targetId),
  clearConversationAnnotations: async (conversationId: string) => {
    const n = manager.rows.filter((r) => !r.removed && r.conversationId === conversationId).length;
    manager.rows.forEach((r) => {
      if (r.conversationId === conversationId) r.removed = true;
    });
    return n;
  },
  clearAllTemporaryAnnotations: async () => 0,
  annotationCensus: async () => {
    const live = manager.rows.filter((r) => !r.removed);
    return {
      annotations: live.length,
      active: live.length,
      hidden: 0,
      stale: 0,
      trackedWindows: live.length,
      nativeWindows: live.length,
      conversations: new Set(live.map((r) => r.conversationId)).size,
    };
  },
};

/** A capture that always succeeds, with a known frame. */
const capture = async (): Promise<ToolResult> => ({
  callId: "cap",
  capabilityId: "screen.capture",
  status: "success",
  summary: "captured",
  evidence: { verified: true, method: "artifact-validated" },
  // Snake_case, because that is what Rust sends and `frameContextFrom` is the
  // only accepted way to read it — a camelCase fixture would test a shape
  // production never sees.
  data: {
    frame_id: "frame-1",
    display_id: "1",
    topology_version: "v1",
    capture_width: 1920,
    capture_height: 1080,
    image_width: 1000,
    image_height: 562,
  },
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 1,
});

/** Two people, side by side, with faces inside each. */
const PEOPLE = {
  left: { boxX: 120, boxY: 100, boxWidth: 180, boxHeight: 400 },
  right: { boxX: 560, boxY: 110, boxWidth: 190, boxHeight: 400 },
};
const FACES = {
  left: { boxX: 165, boxY: 130, boxWidth: 80, boxHeight: 90 },
  right: { boxX: 605, boxY: 140, boxWidth: 82, boxHeight: 92 },
};

let lastSearchRegion: { x: number; y: number; width: number; height: number } | undefined;
let faceFound = true;
let personCandidates = 1;

const locate: AnnotationExecutorDeps["locate"] = async (_dataUrl, target, within) => {
  lastSearchRegion = within;
  if (/face/i.test(target)) {
    if (!faceFound) return { found: false };
    // Honest about the constraint: a face is only returned when it is inside
    // the region the executor asked about. An unconstrained search returning
    // the right-hand face is exactly the bug being guarded against.
    const candidate = within && within.x > 400 ? FACES.right : FACES.left;
    return { found: true, confidence: 0.9, ...candidate, candidates: 1, label: "face" };
  }
  if (/left/i.test(target)) {
    return { found: true, confidence: 0.9, ...PEOPLE.left, candidates: personCandidates };
  }
  return { found: true, confidence: 0.9, ...PEOPLE.right, candidates: personCandidates };
};

const deps: AnnotationExecutorDeps = {
  capture,
  locate,
  dataUrl: async () => "data:image/png;base64,AA==",
  scope: () => scope,
  requestId: () => requestId,
  service: serviceStub as unknown as AnnotationExecutorDeps["service"],
  memory: {
    read: () =>
      Object.entries(remembered).map(([ref, annotationId]) => ({ ref, meta: { annotationId } })),
    write: (ref, _label, annotationId) => {
      remembered[ref] = annotationId;
    },
  },
};

function reset() {
  manager = new FakeManager();
  scope = { accountId: "acct-A", conversationId: "conv-1" };
  requestId = "req-1";
  remembered = {};
  faceFound = true;
  personCandidates = 1;
  lastSearchRegion = undefined;
}

const started = () => new Date().toISOString();
const data = (r: ToolResult) => (r.data ?? {}) as Record<string, unknown>;

// ═══ The five-turn conversation ═══════════════════════════════════════════
console.log("\n— the conversation —");
reset();
{
  // 1. "Draw a border around the person on the left."
  const border = await executeAnnotate(
    deps,
    { target: "the person on the left", shape: "rectangle" },
    started(),
  );
  check("border: succeeds", border.status === "success", border.summary);
  check(
    "border: the id came from the manager, not the frontend",
    String(data(border).annotationId ?? "").startsWith("ann-fake-"),
    String(data(border).annotationId),
  );
  check(
    "border: the left person was selected, not the right",
    (data(border).geometry as { x: number }).x === PEOPLE.left.boxX,
    JSON.stringify(data(border).geometry),
  );
  check("border: annotation count is 1", data(border).annotationCount === 1, String(data(border).annotationCount));
  const borderId = String(data(border).annotationId);

  // 2. "Circle their face."
  requestId = "req-2";
  const circle = await executeAnnotate(deps, { target: "their face", shape: "circle" }, started());
  check("circle: succeeds", circle.status === "success", circle.summary);
  check(
    "circle: the face was searched inside the person, not the whole screen",
    Boolean(lastSearchRegion) && lastSearchRegion!.x < 400,
    JSON.stringify(lastSearchRegion),
  );
  check(
    "circle: it is the left person's face",
    (data(circle).geometry as { x: number }).x === FACES.left.boxX,
    JSON.stringify(data(circle).geometry),
  );
  check(
    "circle: linked to the person as its parent",
    typeof data(circle).parentTargetId === "string",
    String(data(circle).parentTargetId),
  );
  check(
    "circle: border and circle coexist",
    data(circle).annotationCount === 2,
    String(data(circle).annotationCount),
  );
  const circleId = String(data(circle).annotationId);
  check("circle: a different id from the border", circleId !== borderId, `${borderId} vs ${circleId}`);

  // 3. "Make the circle red."
  const red = await executeUpdateAnnotation(deps, { colour: "red" }, started());
  check("recolour: succeeds", red.status === "success", red.summary);
  check(
    "recolour: the same annotation id",
    data(red).annotationId === circleId,
    String(data(red).annotationId),
  );
  check(
    "recolour: no second circle was drawn",
    data(red).annotationCount === 2,
    String(data(red).annotationCount),
  );
  check(
    "recolour: the border is untouched",
    manager.rows.find((r) => r.id === borderId)!.style.colour === "#c084fc",
    manager.rows.find((r) => r.id === borderId)!.style.colour,
  );

  // 4. "Remove the circle but keep the border."
  const removed = await executeRemoveAnnotation(deps, { annotation_id: circleId }, started());
  check("remove: succeeds", removed.status === "success", removed.summary);
  check(
    "remove: the circle went and the border stayed",
    (data(removed).remainingAnnotationIds as string[]).join() === borderId,
    JSON.stringify(data(removed).remainingAnnotationIds),
  );
  check("remove: count drops to 1", data(removed).annotationCount === 1, String(data(removed).annotationCount));

  // 5. "Clear everything."
  const cleared = await executeClearAnnotations(deps, {}, started());
  check("clear: succeeds", cleared.status === "success", cleared.summary);
  check("clear: annotation count zero", data(cleared).annotationCount === 0, String(data(cleared).annotationCount));
  check("clear: overlay count zero", data(cleared).overlayCount === 0, String(data(cleared).overlayCount));
}

// ═══ Duplicate and replay ═════════════════════════════════════════════════
console.log("\n— duplicate tool calls —");
reset();
{
  const first = await executeAnnotate(deps, { target: "the person on the left" }, started());
  const again = await executeAnnotate(deps, { target: "the person on the left" }, started());
  check(
    "a redelivered create returns the same id",
    data(first).annotationId === data(again).annotationId,
    `${data(first).annotationId} / ${data(again).annotationId}`,
  );
  check(
    "and does not draw a second shape",
    data(again).annotationCount === 1,
    String(data(again).annotationCount),
  );

  const id = String(data(first).annotationId);
  await executeUpdateAnnotation(deps, { annotation_id: id, colour: "red" }, started());
  const twice = await executeUpdateAnnotation(deps, { annotation_id: id, colour: "red" }, started());
  check("a repeated colour change is harmless", twice.status === "success", twice.summary);

  await executeRemoveAnnotation(deps, { annotation_id: id }, started());
  const removeAgain = await executeRemoveAnnotation(deps, { annotation_id: id }, started());
  check(
    "a repeated remove does not claim to remove it twice",
    removeAgain.status === "error",
    removeAgain.summary,
  );

  const clearTwice = await executeClearAnnotations(deps, {}, started());
  check("a repeated clear is still zero", clearTwice.status === "success", clearTwice.summary);
}

// ═══ Refusals ═════════════════════════════════════════════════════════════
console.log("\n— what must not be drawn —");
reset();
{
  faceFound = false;
  await executeAnnotate(deps, { target: "the person on the left" }, started());
  requestId = "req-2";
  const noFace = await executeAnnotate(deps, { target: "their face", shape: "circle" }, started());
  check("a face that cannot be found draws nothing", noFace.status === "error", noFace.summary);
  check(
    "and the border survives",
    manager.live(scope).length === 1,
    `${manager.live(scope).length} annotation(s)`,
  );
  check(
    "and the message does not blame the screen",
    !/screen moved|screen changed/i.test(noFace.summary),
    noFace.summary,
  );
}

reset();
{
  personCandidates = 2;
  const ambiguous = await executeAnnotate(deps, { target: "the person" }, started());
  check(
    "two matching people ask which one",
    ambiguous.status === "error" && /which one/i.test(ambiguous.summary),
    ambiguous.summary,
  );
  check("and draw nothing", manager.live(scope).length === 0, `${manager.live(scope).length}`);
}

reset();
{
  const wholeImage: AnnotationExecutorDeps = {
    ...deps,
    locate: async () => ({
      found: true,
      confidence: 0.95,
      // The locator answers in a 0–1000 square, so "the whole picture" is that
      // square — not the image's pixel dimensions.
      boxX: 0,
      boxY: 0,
      boxWidth: 1000,
      boxHeight: 1000,
      candidates: 1,
    }),
  };
  const tooBig = await executeAnnotate(
    wholeImage,
    { target: "the person on the left" },
    started(),
  );
  check(
    "a box covering the whole picture is refused",
    tooBig.status === "error",
    tooBig.summary,
  );
}

reset();
{
  const unsure: AnnotationExecutorDeps = {
    ...deps,
    locate: async () => ({ found: true, confidence: 0.2, ...PEOPLE.left, candidates: 1 }),
  };
  const guess = await executeAnnotate(unsure, { target: "the person on the left" }, started());
  check("a low-confidence match is not drawn", guess.status === "error", guess.summary);
}

// ═══ Pronoun targets ══════════════════════════════════════════════════════
// The model passed `target: "that"` for "draw a border around the person on
// the left" and the locator went looking for the word, which can only fail.
console.log(`${String.fromCharCode(10)}— pronoun targets —`);
reset();
{
  const nothingYet = await executeAnnotate(deps, { target: "that" }, started());
  check(
    "a pronoun with nothing in memory asks what to draw around",
    nothingYet.status === "error" && /what should i draw around/i.test(nothingYet.summary),
    nothingYet.summary,
  );
  check(
    "and does not search the screen for the word",
    !/couldn't find/i.test(nothingYet.summary),
    nothingYet.summary,
  );

  await executeAnnotate(deps, { target: "the person on the left" }, started());
  const known = await executeAnnotate(deps, { target: "that" }, started());
  check(
    "a pronoun after something is drawn resolves to it",
    known.status === "success",
    known.summary,
  );
  check(
    "and does not draw a second shape on the same thing",
    data(known).annotationCount === 1,
    String(data(known).annotationCount),
  );
}

// ═══ Native failure ═══════════════════════════════════════════════════════
console.log("\n— when the native side says no —");
reset();
{
  manager.refuse = true;
  const denied = await executeAnnotate(deps, { target: "the person on the left" }, started());
  check("a native failure is a failed result", denied.status === "error", denied.summary);
  check(
    "and is not reported as verified",
    denied.evidence?.verified !== true,
    String(denied.evidence?.verified),
  );
  check("and leaves nothing behind", manager.live(scope).length === 0, `${manager.live(scope).length}`);
}

// ═══ Scope ════════════════════════════════════════════════════════════════
console.log("\n— scope —");
reset();
{
  const created = await executeAnnotate(deps, { target: "the person on the left" }, started());
  const id = String(data(created).annotationId);

  scope = { accountId: "acct-B", conversationId: "conv-1" };
  const otherAccount = await executeUpdateAnnotation(
    deps,
    { annotation_id: id, colour: "red" },
    started(),
  );
  check("another account cannot change it", otherAccount.status === "error", otherAccount.summary);

  scope = { accountId: "acct-A", conversationId: "conv-2" };
  const otherConversation = await executeRemoveAnnotation(
    deps,
    { annotation_id: id },
    started(),
  );
  check(
    "another conversation cannot remove it",
    otherConversation.status === "error",
    otherConversation.summary,
  );

  scope = { accountId: "acct-A", conversationId: "conv-1" };
  check(
    "and it is still there",
    manager.live(scope).length === 1,
    `${manager.live(scope).length}`,
  );
}

// ═══ Permissions ══════════════════════════════════════════════════════════
console.log("\n— permissions —");
{
  const ids = [
    "screen.annotate",
    "screen.update_annotation",
    "screen.remove_annotation",
    "screen.clear_annotations",
  ];
  check(
    "every annotation capability exists in the registry",
    ids.every((id) => Boolean(getCapability(id))),
    ids.filter((id) => !getCapability(id)).join(", ") || `${ids.length} capabilities`,
  );
  check(
    "and none of them ever asks permission",
    ids.every((id) => permissionFor(id).tier === "none"),
    ids.filter((id) => permissionFor(id).tier !== "none").join(", ") || "zero prompts",
  );
}

// == Provider box order ====================================================
// A transposed box is indistinguishable from a valid one whenever both
// readings are internally consistent -- exactly the case for a tall subject.
// The physical run produced a plausible rectangle shifted left of the person,
// top edge aligned, right edge cutting through them: an axis swap, not an
// offset. So the order is declared by the adapter that knows it.
console.log(`${String.fromCharCode(10)}-- provider box order --`);
{
  const { canonicalBoxOrder, modelGeometryFromBox2d } = await import(
    "../src/services/visionCoords"
  );

  // The left figure in the generated test image, as a normalised box of the
  // 1280x800 source: x 240-420, y 110-740.
  const yxyx = [138, 188, 925, 328];
  const xyxy = [188, 138, 328, 925];

  check(
    "the canonical order is Gemini's, and passes through untouched",
    JSON.stringify(canonicalBoxOrder(yxyx, "yxyx")) === JSON.stringify(yxyx),
    JSON.stringify(canonicalBoxOrder(yxyx, "yxyx")),
  );
  check(
    "a provider that emits xyxy converts to the same box",
    JSON.stringify(canonicalBoxOrder(xyxy, "xyxy")) === JSON.stringify(yxyx),
    JSON.stringify(canonicalBoxOrder(xyxy, "xyxy")),
  );

  const fromGemini = modelGeometryFromBox2d(canonicalBoxOrder(yxyx, "yxyx"), 1000, "visual-content");
  const fromOpenAI = modelGeometryFromBox2d(canonicalBoxOrder(xyxy, "xyxy"), 1000, "visual-content");
  check(
    "both providers resolve to the same rectangle",
    JSON.stringify(fromGemini?.box) === JSON.stringify(fromOpenAI?.box),
    `${JSON.stringify(fromGemini?.box)} vs ${JSON.stringify(fromOpenAI?.box)}`,
  );
  check(
    "and it is the left figure, not a transposed one",
    Boolean(fromGemini) && fromGemini!.box.x === 188 && fromGemini!.box.width === 140,
    JSON.stringify(fromGemini?.box),
  );
  check(
    "reading xyxy as yxyx is what drew the wrong rectangle",
    modelGeometryFromBox2d(xyxy, 1000, "visual-content")?.box.x === 138,
    JSON.stringify(modelGeometryFromBox2d(xyxy, 1000, "visual-content")?.box),
  );

  const { readFileSync: readSrc } = await import("node:fs");
  const openai = readSrc("src/services/OpenAIVisionService.ts", "utf8");
  const contentFn = openai.slice(
    openai.indexOf("export async function openaiLocateContent"),
    openai.indexOf("export async function openaiLocateClickTarget"),
  );
  check(
    "a standing person is not rejected as a grid-column sliver",
    Boolean(modelGeometryFromBox2d(yxyx, 1000, "visual-content")) &&
      modelGeometryFromBox2d(yxyx, 1000, "ui-control") === null,
    "the guard applies to controls only",
  );
  check(
    "the annotation adapter asks for the content category",
    (await import("node:fs"))
      .readFileSync("src/features/capabilities/frontendExecutors.ts", "utf8")
      .includes('modelGeometryFromBox2d(detection.box_2d, 1000, "visual-content")'),
    "visual-content",
  );
  check(
    "the OpenAI content locator declares and converts its own order",
    contentFn.includes('canonicalBoxOrder(parsed.box_2d, "xyxy")'),
    "converted at the adapter",
  );
}

console.log(`\n${"-".repeat(74)}`);
console.log(failed === 0 ? "all passed" : `${failed} FAILED`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failed === 0 ? 0 : 1);
