/**
 * Tiny template renderer for handoff email bodies (E.t3).
 *
 * Substitutes `{{path.to.field}}` placeholders against a flat or nested
 * data object. Walks dotted paths through nested objects. Missing or
 * non-stringifiable values render as the empty string.
 *
 * Deliberate non-features:
 *   - No conditional sections (`{{#if}} … {{/if}}`). Verdict branching is
 *     handled in the mailer by selecting the right template file.
 *   - No iteration over arrays. The mailer pre-formats arrays into
 *     human-readable strings exposed at known top-level keys
 *     (e.g. `visitorActivities`, `wishlistFormatted`).
 *   - No HTML escaping. The mailer sends plain-text email; no `<` / `>` to
 *     guard against. If we ever ship HTML email, swap in a renderer that
 *     escapes by default.
 *
 * Substitution syntax:
 *   - `{{key}}` — top-level field.
 *   - `{{nested.key}}` — dotted path. Each segment is an object key.
 *   - Whitespace inside the braces is tolerated: `{{ key }}`.
 *   - Allowed characters in paths: alphanumerics, `_`, `.`. Anything else
 *     leaves the placeholder as-is so a literal `{{` in the template is
 *     preserved.
 */

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Render a template string by substituting `{{path}}` placeholders against
 * the supplied data object.
 *
 * Missing values become empty strings, NOT the literal `{{path}}` — the
 * caller is responsible for ensuring the data object has every key the
 * template references. Tests assert this contract end-to-end.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, path: string) => {
    const value = walkPath(data, path);
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function walkPath(root: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
