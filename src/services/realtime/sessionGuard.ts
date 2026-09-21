/**
 * Which voice session is allowed to act.
 *
 * Observed failure: the voice overlay was opened, picked up ambient room audio,
 * and created a task called "Beauty and the Beast" that nobody asked for. The
 * session had been dismissed, but `runToolCall` is async — it awaits the
 * capability, and the only `closed` check happened before that await. A tool
 * call that arrived one tick before the overlay closed still reached a
 * capability and still wrote to SQLite.
 *
 * A boolean cannot express this. The question is not "is this session closed"
 * but "is this session still the one entitled to act", and that has to be
 * re-asked after every await. So each session takes a generation number at
 * birth, and closing any session retires it.
 *
 * Deliberately dependency-free: it is the one piece of the voice stack that has
 * to be testable without WebRTC, a microphone, or the capability graph.
 */

let currentGeneration = 0;

/** A session's claim to act. Opaque — only `isCurrent` can read it. */
export interface SessionClaim {
  readonly generation: number;
}

/**
 * Start a session and retire every earlier one.
 *
 * Opening a second session must invalidate the first, or two sessions race for
 * the same microphone and both act on what they hear.
 */
export function beginSession(): SessionClaim {
  currentGeneration += 1;
  return { generation: currentGeneration };
}

/**
 * Retire a session.
 *
 * Idempotent, and safe to call on a session that was already superseded — it
 * never revives a newer one.
 */
export function endSession(claim: SessionClaim): void {
  if (claim.generation === currentGeneration) currentGeneration += 1;
}

/**
 * May this session still cause something to happen?
 *
 * Call before acting, and again after every await. Everything past this point
 * can change the user's machine.
 */
export function isCurrent(claim: SessionClaim): boolean {
  return claim.generation === currentGeneration;
}

/** Test-only: forget every session so cases do not leak into each other. */
export function resetSessionsForTest(): void {
  currentGeneration = 0;
}
