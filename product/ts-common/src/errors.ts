// -----------------------------------------------------------------------------
// Error helpers — single shared `messageOf` lift.
//
// Closes H1 from planning/03-exec-crosscut-common-helpers-fix.md. The pattern
// `err instanceof Error ? err.message : String(err)` repeated at 16+ sites
// across all 5 runtime workspaces. The UI's classify.ts carried the most
// defensive form (Error / object-with-message / primitive / circular-safe);
// that's the one we lift here.
//
// Behaviour preserved for the common cases:
//   - Error instance with non-empty message → err.message.
//   - String primitive → err.
//   - Object with a string `message` property → err.message.
//   - Anything JSON.stringify-able → JSON.stringify(err).
//   - JSON.stringify throws (e.g. circular structure) → String(err).
//   - JSON.stringify returning undefined (only when input is undefined) →
//     String(err) — keeps the contract "always returns a string".
//
// Empty-Error-message escape hatch (added 2026-05-19, demo-day diagnostic
// hardening): Node's `AggregateError` carries inner errors in `.errors[]` but
// leaves its own `.message` empty. Hitting it from a pg ECONNREFUSED produced
// `messageOf(err) === ""`, which propagated through the connector's
// `handler_threw` envelope to a visible "schema parse failed" dev card with no
// diagnostic. When `err instanceof Error` and `err.message` is empty, fall
// back to a synthesised description: `<name>[ [<code>]][: <first inner msg>]`.
// Preserves backwards compatibility for the dominant case (non-empty message
// returned verbatim) while surfacing AggregateError / system errors that
// otherwise become silent.
//
// Zod-error handling: a ZodError is an Error subclass and carries a `.message`
// string, so the Error-instance branch picks it up; no separate branch is
// needed. Callers that want the structured `.issues` array still reach for it
// directly.
// -----------------------------------------------------------------------------

/**
 * Best-effort string extraction from any thrown / rejected value.
 *
 * Always returns a string — never undefined, never throws, never empty for
 * well-formed JS errors (an `Error` instance with a deliberately empty
 * message gets a fallback description). Use at the boundary between "we
 * caught something" and "we need a sanitised message for log / envelope /
 * event payload".
 *
 * Behaviour:
 *   - `Error` instance with non-empty message → `err.message`.
 *   - `Error` instance with empty message →
 *     `<name>[ [<code>]][: <first inner err message>]` (handles
 *     `AggregateError` from `pg` ECONNREFUSED + similar node system errors).
 *   - String → returned as-is.
 *   - Object with a string `.message` property → that message.
 *   - Anything else → `JSON.stringify(err)` if possible, else `String(err)`.
 *
 * For sanitisedContext slices, prefer `messageOf(err).slice(0, 500)` over the
 * older inline pattern.
 */
export function messageOf(err: unknown): string {
  if (err instanceof Error) {
    if (err.message) return err.message;
    return describeErrorWithoutMessage(err);
  }
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

/**
 * Build a useful description for an Error whose `.message` is empty.
 * Covers Node's `AggregateError` (where the top-level message is empty by
 * design and the inner errors carry the signal) and any subclass that sets
 * `name` + `code` without setting `message`.
 *
 * Format: `<name>` optionally followed by ` [<code>]`, optionally followed
 * by `: <first non-empty inner err message>`. The inner-error sweep stops at
 * the first non-empty match so the result stays bounded.
 */
function describeErrorWithoutMessage(err: Error): string {
  let head = err.name || "Error";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code) head += ` [${code}]`;

  // AggregateError instances expose their constituents on `.errors`.
  const inner = (err as { errors?: unknown }).errors;
  if (Array.isArray(inner)) {
    for (const e of inner) {
      let m = "";
      if (e instanceof Error) m = e.message;
      else if (typeof e === "string") m = e;
      else if (e && typeof e === "object" && "message" in e) {
        const im = (e as { message?: unknown }).message;
        if (typeof im === "string") m = im;
      }
      if (m) return `${head}: ${m}`;
    }
  }
  return head;
}
