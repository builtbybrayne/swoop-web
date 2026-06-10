/**
 * Render-layer HTML entity decode.
 *
 * Defensive safety net for any text field that may carry HTML entities
 * (e.g. `&rsquo;`, `&mdash;`, `&#8217;`) that the ingestion-side decoder
 * (`product/ingestion/src/enrich/chunk.ts`) didn't catch — or that
 * arrived via a data path that bypasses chunk.ts entirely.
 *
 * React renders text children verbatim: entities like `&rsquo;` display
 * as the literal 7-character sequence, not as a right single quote. Wrap
 * any text field sourced from CMS / blog / customer-review prose with
 * this helper before rendering.
 *
 * Implementation uses `he` (canonical HTML5 entity codec, MIT, zero
 * transitive deps). Same dep consolidates ingestion-side decoding +
 * harness-side encoding — see chunk.ts (decode) and view-transcript.ts
 * (encode).
 */

import { decode } from "he";

/**
 * Decode HTML entities in a text string. Returns empty string for
 * null/undefined input so call sites can stay terse:
 *
 *     <p>{decodeHtmlEntities(passage.text)}</p>
 */
export function decodeHtmlEntities(text: string | null | undefined): string {
  if (text == null) return "";
  return decode(text);
}

/**
 * Truncate a string for single-line anchor copy — the
 * "Find out more about {sourceTitle} →" pattern from the retrieval-provenance
 * plan (planning/03-exec-crosscut-magical-poincare-retrieval-provenance.md
 * §1.4). Cuts at a word boundary when one falls in the final stretch of the
 * window, appends a single-character ellipsis.
 *
 * Call AFTER `decodeHtmlEntities` — decoding first means an entity can never
 * be sliced mid-sequence, and the visible length is what gets measured.
 */
export function truncateText(text: string, maxChars = 60): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const window = trimmed.slice(0, maxChars);
  const lastSpace = window.lastIndexOf(" ");
  // Only respect the word boundary when it keeps a substantial prefix —
  // otherwise one long unbroken word would truncate to almost nothing.
  const cut = lastSpace > maxChars * 0.6 ? window.slice(0, lastSpace) : window;
  return `${cut.trimEnd()}…`;
}
