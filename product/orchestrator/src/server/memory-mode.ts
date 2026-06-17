/**
 * Memory-mode entry detection (sm-3, T3-3).
 *
 * THE SACRED INVARIANT: a staff member enters memory mode ONLY by explicitly
 * asking — never by inference. Visitor sessions are NEVER routed to the memory
 * agent. This module is the gate that decides whether a STAFF turn is an
 * explicit memory-management request.
 *
 * Design (sm-3 — explicit-only entry):
 *   - We match on a small set of explicit imperative phrases ("remember that",
 *     "save this", "add a memory", "update the memory", "forget that", …).
 *   - The match is deliberately CONSERVATIVE. A phrase that merely *resembles*
 *     a memory instruction ("I'll remember to pack warm") must NOT trip the
 *     gate. The phrases require an imperative memory-management verb directed at
 *     the agent, not incidental use of the word "remember".
 *   - The confirm-before-write step inside the memory agent is the safety net:
 *     even if a turn trips the gate, nothing is persisted until the staff member
 *     explicitly confirms. So a false positive costs one routed turn, not data.
 *
 * What this does NOT do:
 *   - It does NOT decide whether the session is staff. That is the staff-token
 *     validation in chat.ts (the only trust boundary). This function is only
 *     ever consulted AFTER `session.staff === true` is established.
 *   - Soft exit is the `finish_memory` tool call the memory agent emits,
 *     intercepted in the chat stream loop. `isExplicitMemoryExit` (below) is the
 *     HARD backstop: an explicit "leave memory mode" phrase flips the session
 *     back even if the agent never emits finish_memory, so staff can't wedge.
 */

/**
 * Explicit memory-management trigger phrases. Lowercased, matched as substrings
 * after normalising the message to lowercase + collapsing whitespace.
 *
 * Each phrase pairs an imperative verb with a memory/knowledge object so that
 * incidental uses of "remember" (e.g. "remind me to…", "I remember when…") do
 * not match. Kept as data so the set is easy to extend without touching logic.
 */
const MEMORY_TRIGGER_PHRASES: readonly string[] = [
  'remember that',
  'remember this',
  'please remember',
  'can you remember',
  'save this as a memory',
  'save that as a memory',
  'save this memory',
  'store this memory',
  'add a memory',
  'add this to memory',
  'add that to memory',
  'add to your memory',
  'note this down',
  'make a note that',
  'update the memory',
  'update that memory',
  'edit the memory',
  'edit that memory',
  'forget that',
  'forget this',
  'retire that memory',
  'remove that memory',
  'delete that memory',
  'what do you remember',
  'what memories do you have',
  'list your memories',
  'show your memories',
  'show me your memories',
  'manage memories',
  'manage your memories',
  'go into memory mode',
  'enter memory mode',
  'memory mode',
];

/**
 * Explicit memory-mode EXIT phrases (sm-3 hard backstop). When a staff session
 * is already in 'memory' mode, any of these flips it back to 'conversation'
 * deterministically — even if the memory agent never emits `finish_memory`.
 * Guarantees a staff member can always get out. Conservative by design: only
 * unambiguous "leave memory mode" / "back to testing" phrases.
 */
const MEMORY_EXIT_PHRASES: readonly string[] = [
  'exit memory mode',
  'leave memory mode',
  'quit memory mode',
  'stop memory mode',
  'exit memory',
  'done with memory',
  'done with memories',
  'finished with memory',
  'back to testing',
  'back to the agent',
  'return to testing',
  'return to the agent',
  'switch back to the agent',
];

/**
 * Normalise a message for trigger matching: lowercase, collapse internal
 * whitespace runs to a single space, trim. Keeps matching robust to casing and
 * formatting quirks without being so loose it catches unrelated text.
 */
function normalise(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Does this STAFF message explicitly ask to manage memories?
 *
 * Returns true only on an explicit imperative phrase. The caller has already
 * established `session.staff === true`; this never runs for visitor sessions.
 *
 * @param message  The raw staff message text (not the dateline-wrapped envelope).
 */
export function isExplicitMemoryRequest(message: string): boolean {
  const normalised = normalise(message);
  if (normalised.length === 0) return false;
  return MEMORY_TRIGGER_PHRASES.some((phrase) => normalised.includes(phrase));
}

/**
 * Does this STAFF message explicitly ask to LEAVE memory mode?
 *
 * The hard backstop to the memory agent's own `finish_memory` handback: the
 * orchestrator consults this only when the session is already in 'memory' mode
 * (chat.ts), and on a match flips back to 'conversation' regardless of the
 * agent. Conservative — only unambiguous exit phrases match.
 */
export function isExplicitMemoryExit(message: string): boolean {
  const normalised = normalise(message);
  if (normalised.length === 0) return false;
  return MEMORY_EXIT_PHRASES.some((phrase) => normalised.includes(phrase));
}

/** Exposed for unit tests — the canonical phrase lists. */
export const __testing = {
  MEMORY_TRIGGER_PHRASES,
  MEMORY_EXIT_PHRASES,
  normalise,
};
