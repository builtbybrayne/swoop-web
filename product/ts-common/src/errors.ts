// -----------------------------------------------------------------------------
// Error helpers — single shared `messageOf` lift.
//
// Closes H1 from planning/03-exec-crosscut-common-helpers-fix.md. The pattern
// `err instanceof Error ? err.message : String(err)` repeated at 16+ sites
// across all 5 runtime workspaces. The UI's classify.ts carried the most
// defensive form (Error / object-with-message / primitive / circular-safe);
// that's the one we lift here.
//
// Behaviour preserved exactly to keep the sweep a pure consolidation:
//   - Error instance → err.message.
//   - String primitive → err.
//   - Object with a string `message` property → err.message.
//   - Anything JSON.stringify-able → JSON.stringify(err).
//   - JSON.stringify throws (e.g. circular structure) → String(err).
//   - JSON.stringify returning undefined (only when input is undefined) →
//     String(err) — keeps the contract "always returns a string".
//
// Zod-error handling: a ZodError is an Error subclass and carries a `.message`
// string, so the Error-instance branch picks it up; no separate branch is
// needed. Callers that want the structured `.issues` array still reach for it
// directly.
// -----------------------------------------------------------------------------

/**
 * Best-effort string extraction from any thrown / rejected value.
 *
 * Always returns a string — never undefined, never throws. Use at the boundary
 * between "we caught something" and "we need a sanitised message for log /
 * envelope / event payload".
 *
 * Behaviour:
 *   - `Error` instance → `err.message`.
 *   - String → returned as-is.
 *   - Object with a string `.message` property → that message.
 *   - Anything else → `JSON.stringify(err)` if possible, else `String(err)`.
 *
 * For sanitisedContext slices, prefer `messageOf(err).slice(0, 500)` over the
 * older inline pattern.
 */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    // JSON.stringify(undefined) returns undefined (not a string); always
    // return something. Falls through to String(err) for those edge cases.
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
