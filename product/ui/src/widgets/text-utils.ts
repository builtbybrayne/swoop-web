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
