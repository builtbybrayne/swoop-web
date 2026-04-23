/**
 * Reasoning filter — unconditional.
 *
 * Per planning/02-impl-agent-runtime.md §2.4:
 *   "`<reasoning>` is never emitted to the browser. Reasoning blocks (or
 *   `reasoning` parts if ADK emits them natively) are PERSISTED to session
 *   history for agent memory (§2.6) but STRIPPED from the outbound SSE
 *   stream. Chunk D never sees reasoning in the wire. If it does, that's a
 *   translator bug."
 *
 * The filter is agnostic to the upstream source of the reasoning part:
 *   - ADK `THOUGHT` event (`Part.thought === true`) — B.t5 / ClaudeLlm maps
 *     Anthropic thinking blocks to this shape,
 *   - AI SDK v5 `reasoning` part (if ever produced by a future LLM shim),
 *   - `<reasoning>` text extracted from free text by the block parser
 *     (not used today — see B.9 in decisions.md — but the filter stays
 *     source-agnostic so the invariant holds if that ever changes).
 *
 * Contract:
 *   - Input: async iterator of MessagePart (any shape).
 *   - Output: async iterator of MessagePart with `type === 'reasoning'`
 *     removed.
 *   - Side effect: every filtered reasoning part is passed to `sink(part)`
 *     before being dropped. Session history persistence (B.t2) hooks that
 *     sink. A no-op sink is the correct default for isolated runs.
 */

import type { MessagePart } from '@swoop/common';

import type { FilteredPartSink } from './types.js';

/**
 * Strip reasoning parts from a part stream. Reasoning is handed to `sink`
 * before being dropped.
 */
export async function* filterReasoning(
  source: AsyncIterable<MessagePart>,
  sink: FilteredPartSink = () => {},
): AsyncGenerator<MessagePart, void, void> {
  for await (const part of source) {
    if (part.type === 'reasoning') {
      sink(part);
      continue;
    }
    yield part;
  }
}
