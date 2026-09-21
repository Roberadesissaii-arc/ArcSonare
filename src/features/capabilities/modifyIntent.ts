/**
 * "Fix this file" is not "create this file".
 *
 * The registry says so, the prompt says so, and a large model gets it right.
 * A small one routes "fix the bug in the Python file you made" to
 * `filesystem.create_file`, which finds the file already there and asks whether
 * to overwrite it. The user says yes — and gets asked again, because the
 * approved write is a *replacement* of a file they wanted *edited*, so the
 * answer never satisfies the request that produced it.
 *
 * Prose in a prompt cannot close that, because the failure is the model not
 * reading the prose. This closes it deterministically: when a create lands on a
 * file that exists and the sentence that produced it asked for a change, the
 * user is not asked anything. The model is told to use the editing tool.
 *
 * Deliberately narrow. It fires only when all three are true:
 *
 *   - the capability is a create/write,
 *   - the target already exists,
 *   - the request reads as "change what is there", not "make a new one".
 *
 * "Write me a fresh notes.txt" over an existing notes.txt is a real overwrite
 * question and still gets asked.
 */

/**
 * Verbs that mean "the thing exists and should end up different".
 *
 * Matched against the user's sentence, not against the arguments: the arguments
 * are what the model chose, and the model's choice is the thing being second-
 * guessed here.
 */
const MODIFY_VERBS =
  /\b(fix|modify|edit|update|change|correct|repair|adjust|patch|refactor|rename\s+the\s+variable|add\s+(?:a\s+)?(?:comment|docstring|type|error\s+handling|logging)|remove\s+the|delete\s+the\s+line|replace\s+the)\b/i;

/**
 * Phrases that mean "make a new one", which override the verbs above.
 *
 * "Rewrite it from scratch" contains no create verb and would otherwise read as
 * a modification; it is a replacement, and replacing content the user did not
 * ask to keep is exactly what the overwrite question is for.
 */
const REPLACE_PHRASES =
  /\b(from\s+scratch|start\s+over|blank|empty\s+file|brand[-\s]new|replace\s+(?:the\s+)?(?:whole|entire)\s+file|overwrite\s+it|wipe)\b/i;

/**
 * Whether the sentence asks for an existing thing to be changed.
 *
 * A verb is required. "The file you just made" refers to something that exists
 * but instructs nothing, and treating a bare reference as a modification would
 * turn a genuine "write me a new one over that" into a silent edit.
 */
export function isModifyIntent(request: string): boolean {
  const text = (request ?? "").trim();
  if (!text) return false;
  if (REPLACE_PHRASES.test(text)) return false;
  return MODIFY_VERBS.test(text);
}

const CREATE_CAPABILITIES = new Set([
  "filesystem.create_file",
  "filesystem.write_text_file",
]);

/**
 * Whether a create that hit an existing file should be redirected rather than
 * turned into an overwrite question.
 */
export function shouldRedirectToModify(input: {
  capabilityId: string;
  request: string;
  /** The `reason` the native result gave — only `already-exists` qualifies. */
  reason?: string;
}): boolean {
  if (!CREATE_CAPABILITIES.has(input.capabilityId)) return false;
  if (input.reason !== "already-exists") return false;
  return isModifyIntent(input.request);
}

/**
 * What the model is told instead of what the user would have been asked.
 *
 * Names the path and both tools, because the correction has to be actionable in
 * one turn — a vaguer "use a different tool" produces another create.
 */
export function modifyRedirectMessage(path: string): string {
  return [
    `"${path}" already exists, and the request was to change it, not to replace it.`,
    "Do not create it again and do not ask about overwriting.",
    `Call filesystem.read_for_edit with path "${path}", then filesystem.modify_file`,
    "with based_on_hash from that read and the smallest patch that does the job",
    '(patch = {kind: "replace-text", oldText, newText}).',
  ].join(" ");
}
