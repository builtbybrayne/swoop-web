/**
 * Hand-authored ADK event fixtures.
 *
 * Real ADK event capture requires a live model connection (B.t5 wires
 * Anthropic; not yet available at B.t4 execution time). Per planning/
 * 03-exec-agent-runtime-t4.md — "If you can't run a real LLM spike, run a
 * fixture-based spike — hand-author what ADK's event stream would look like
 * in each of the three scenarios, based on ADK's docs + type signatures."
 *
 * These fixtures are hand-authored to exactly match the shapes declared in:
 *   - @google/adk/dist/types/events/event.d.ts       (Event extends LlmResponse)
 *   - @google/adk/dist/types/models/llm_response.d.ts (LlmResponse.content: Content)
 *   - @google/genai Content/Part shape (parts[].text, parts[].thought,
 *     parts[].functionCall, parts[].functionResponse)
 *
 * When B.t5 lands a real ADK->Anthropic round trip, replace these with
 * captured event streams committed under fixtures/*.json.
 *
 * All fixtures use a `createEvent` helper that stamps the mandatory fields
 * (id, invocationId, author, timestamp, actions) so the translator's
 * type-checker is satisfied without repeating boilerplate in every fixture.
 */

import type { AdkEvent } from '../../types.js';

/** Counter so each fixture event has a unique id even when authored inline. */
let seq = 0;

function mkEvent(partial: Partial<AdkEvent>): AdkEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    invocationId: 'inv-test',
    author: 'puma_orchestrator',
    timestamp: 1_700_000_000_000 + seq,
    actions: {
      stateDelta: {},
      artifactDelta: {},
      requestedAuthConfigs: {},
      requestedToolConfirmations: {},
    },
    ...partial,
  } as AdkEvent;
}

/** Helper: a model-role content event with a single text Part. */
export function textEvent(text: string, opts: { partial?: boolean; turnComplete?: boolean } = {}): AdkEvent {
  return mkEvent({
    content: { role: 'model', parts: [{ text }] },
    partial: opts.partial,
    turnComplete: opts.turnComplete,
  });
}

/** Helper: a thought (reasoning) event. */
export function thoughtEvent(text: string): AdkEvent {
  return mkEvent({
    content: { role: 'model', parts: [{ text, thought: true }] },
  });
}

/** Helper: a function-call (tool-call input) event. */
export function functionCallEvent(args: {
  id: string;
  name: string;
  args: Record<string, unknown>;
}): AdkEvent {
  return mkEvent({
    content: {
      role: 'model',
      parts: [{ functionCall: { id: args.id, name: args.name, args: args.args } }],
    },
  });
}

/** Helper: a function-response (tool-call output) event. */
export function functionResponseEvent(args: {
  id: string;
  name: string;
  response: Record<string, unknown>;
}): AdkEvent {
  return mkEvent({
    content: {
      role: 'user',
      parts: [{ functionResponse: { id: args.id, name: args.name, response: args.response } }],
    },
  });
}

/** Helper: a final turn marker. */
export function turnCompleteEvent(): AdkEvent {
  return mkEvent({ turnComplete: true });
}

/** Helper: an error event (LlmResponse error envelope). */
export function errorEvent(code: string, message: string): AdkEvent {
  return mkEvent({ errorCode: code, errorMessage: message });
}

/** Drive an AsyncIterable over a fixed array of events. */
export async function* stream<T>(events: readonly T[]): AsyncGenerator<T, void, void> {
  for (const e of events) {
    yield e;
  }
}
