/**
 * Removing a name greeting the model was told not to write.
 *
 * The instruction not to use the user's name is a request; this is the
 * guarantee. It was needed: with the cooldown active and the prompt saying
 * "do NOT use it in this reply", the reply still came back
 * "Hey Robera, opened a youtube search for …".
 *
 * Its own module so it stays a pure string function — testable without pulling
 * in the presenter and half the application with it.
 */

/**
 * Strip a forbidden name from the vocative positions of a reply.
 *
 * Only a leading greeting and a trailing ", Robera" are touched. A mid-sentence
 * occurrence is left alone: the name may genuinely be part of the content (a
 * file named after them), and mangling that is worse than an extra greeting.
 */
export function stripGreetingName(
  text: string,
  /** The name to remove, or null when this reply is allowed to use it. */
  forbiddenName: string | null,
): string {
  if (!forbiddenName) return text;
  const name = forbiddenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text.replace(
    new RegExp(
      `^\\s*(?:hey|hi|hello|yo|ok(?:ay)?|alright)?[,\\s]*${name}\\s*[,—:-]+\\s*`,
      "i",
    ),
    "",
  );
  out = out.replace(new RegExp(`[,\\s]+${name}\\s*([.!?])\\s*$`, "i"), "$1");
  // Re-capitalise: chopping "Hey Robera, " off leaves a lowercase sentence.
  return out.replace(/^([a-z])/, (c) => c.toUpperCase()).trim() || text;
}
