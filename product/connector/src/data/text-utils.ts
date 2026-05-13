// product/connector/src/data/text-utils.ts
//
// Boundary text-cleanup helpers for CMS-authored prose. The connector
// passes WYSIWYG HTML through (trust boundary: CMS, not visitor — see
// planning/03-exec-crosscut-brave-pare-render-cms-html.md), but the
// editor team's HTML routinely carries trailing decorative whitespace
// (`<br>`, `&nbsp;`, empty paragraphs) from key-press patterns at edit
// time. That decorative whitespace inflates the rendered DOM height
// without contributing visible text, which can produce false-positive
// overflow detection in `<ExpandableProse>`.
//
// Per Al 2026-05-13 ("is it trimming whitespace correctly?"). 296 of
// 590 pages with content in puma_dev (50%) carry trailing `&nbsp;`/`<br>`
// — systemic enough to deserve a shared helper.

/**
 * Strip trailing decorative whitespace from a CMS HTML blob. Removes
 * combinations of `<br>` tags, `&nbsp;` entities, and plain whitespace
 * that appear at the very end of the content — optionally inside a
 * trailing `</p>` or other closing tag.
 *
 * Examples:
 *   "<p>Hello.&nbsp;<br></p>"         → "<p>Hello.</p>"
 *   "<p>Hello.</p><br>\n"             → "<p>Hello.</p>"
 *   "<p>Hello.</p>&nbsp;&nbsp;"       → "<p>Hello.</p>"
 *   "<p>Hello.</p><p>&nbsp;</p>"      → "<p>Hello.</p>"  (empty trailing <p>)
 *   "<p>  Hello.  </p>"               → "<p>  Hello.  </p>" (interior space preserved)
 *
 * Leading decorative whitespace is also stripped — same patterns at the
 * start of the content.
 *
 * Returns `undefined` when input is null/undefined/empty/whitespace-only
 * after the strip (so callers can omit the field on schema).
 */
export function trimCmsDecorativeWhitespace(
  text: string | null | undefined,
): string | undefined {
  if (text === null || text === undefined) return undefined;
  let s = String(text);

  // Strip trailing decorative junk inside (or after) the final closing tag.
  // Pattern matches one or more of: <br[/]?>, &nbsp;, whitespace; optionally
  // followed by a closing tag like </p>. Loops to handle nested
  // patterns like "<br>&nbsp;</p>".
  let prev: string;
  do {
    prev = s;
    // Trailing whitespace + &nbsp; + <br> + empty <p>/<div></p>/</div>
    // Strip in layers: outer whitespace, then trailing closing-tag with empty inside.
    s = s
      .replace(/(\s|&nbsp;|<br\s*\/?>)+(<\/(?:p|div|span)>)\s*$/gi, '$2')
      .replace(/<(p|div|span)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>\s*$/gi, '')
      .replace(/(\s|&nbsp;|<br\s*\/?>)+$/gi, '');
  } while (s !== prev);

  // Same treatment at the start.
  do {
    prev = s;
    s = s
      .replace(/^\s*(<(?:p|div|span)>)(\s|&nbsp;|<br\s*\/?>)+/gi, '$1')
      .replace(/^\s*<(p|div|span)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '')
      .replace(/^(\s|&nbsp;|<br\s*\/?>)+/gi, '');
  } while (s !== prev);

  s = s.trim();
  return s.length === 0 ? undefined : s;
}
