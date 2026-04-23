/**
 * Translator pipeline — public entry point.
 *
 * Composes the three stages defined in planning/03-exec-agent-runtime-t4.md:
 *   1. `adkEventsToParts` — maps ADK native events to MessagePart parts,
 *      including `<fyi>` extraction from plain text via BlockParser.
 *   2. `filterReasoning` — strips reasoning parts from the outbound stream,
 *      handing them to the session sink (B.t2) before discarding.
 *
 * Callers (B.t5 SSE writer, B.t7 vertical-slice harness) do:
 *
 *   for await (const part of translateAdkStream(adkEvents, { onFiltered })) {
 *     writeSseEvent(part);
 *   }
 *
 * Stateless per turn (see B.6). Holds no references between turns. The
 * BlockParser + tool-input map are scoped to a single call.
 */

import type { MessagePart } from '@swoop/common';

import { adkEventsToParts } from './adk-to-parts.js';
import { filterReasoning } from './reasoning-filter.js';
import type { AdkEvent, FilteredPartSink } from './types.js';

export { BlockParser } from './block-parser.js';
export { adkEventsToParts } from './adk-to-parts.js';
export { filterReasoning } from './reasoning-filter.js';
export type { AdkEvent, FilteredPartSink } from './types.js';

export interface TranslateOptions {
  /**
   * Called synchronously for every part removed from the outbound stream
   * (reasoning parts today). B.t2 wires this to the session-history
   * accumulator. Default: no-op.
   */
  readonly onFiltered?: FilteredPartSink;
  /** Clock source; overridable for deterministic tests. */
  readonly now?: () => Date;
}

/**
 * Turn an ADK event stream into an outbound-ready MessagePart stream.
 * Guarantees: no part with `type === 'reasoning'` is ever yielded.
 */
export async function* translateAdkStream(
  source: AsyncIterable<AdkEvent>,
  opts: TranslateOptions = {},
): AsyncGenerator<MessagePart, void, void> {
  const mapped = adkEventsToParts(source, { now: opts.now });
  yield* filterReasoning(mapped, opts.onFiltered);
}
