/**
 * ADK Event stream -> shared `MessagePart` stream.
 *
 * Stateless *between* turns (per B.6 — "inside the orchestrator, stateless-
 * per-turn"). Within a turn the mapper keeps a BlockParser instance so that
 * `<fyi>` spans can straddle ADK partial-text events. At turn boundary
 * (turnComplete or iterator exhaustion), the parser is flushed and
 * discarded.
 *
 * Input: async iterator of `AdkEvent` (== @google/adk `Event`, which extends
 *   LlmResponse with `content?.parts?: Part[]` from @google/genai).
 *
 * Output: async iterator of `MessagePart` (@swoop/common `streaming.ts`),
 *   matching AI SDK v5 `message.parts` shape.
 *
 * Mapping rules (resolved by spike B.9):
 *   - `Part.thought === true` with text       -> ReasoningPart.
 *     These are later stripped by reasoning-filter.ts before SSE.
 *   - `Part.text` (plain, thought !== true)   -> fed through BlockParser,
 *     which emits TextPart(s) and DataFyiPart(s) (`<fyi>` side-channel).
 *   - `Part.functionCall` (name + args)       -> ToolCallPart{ state: 'input-available' }.
 *     ADK doesn't ship a streaming "input-streaming" delta for function calls
 *     in v1.0.0 — the call arrives complete. If a future ADK version adds
 *     streamed argument deltas, we plumb 'input-streaming' in here; the
 *     downstream `MessagePart` discriminator already supports it.
 *   - `Part.functionResponse` (name + response) -> ToolCallPart{ state: 'output-available' }.
 *     `input` is carried forward by toolName matching the most recent
 *     input-available from earlier in the same turn; if unseen (defensive)
 *     we emit with `input: undefined`.
 *   - `errorCode` / `errorMessage` on LlmResponse -> emitted as a TextPart
 *     prefixed `[error] ` for observability; the SSE writer (B.t5) decides
 *     whether to surface this to the user or convert it to an SSE `error:`
 *     event. The translator does not drop errors silently.
 *   - `turnComplete === true` flushes the BlockParser.
 *
 * Non-goals:
 *   - Observability events (chunk F). The translator focuses on the
 *     user-facing stream.
 *   - Widget hydration payload shape (chunk D decides how `data-fyi` and
 *     `tool-call` parts render).
 *   - Consent / triage state changes (B.t2 / chunk E).
 */

import type { MessagePart, ToolCallPart } from '@swoop/common';

import { BlockParser } from './block-parser.js';
import type { AdkEvent } from './types.js';

/**
 * Core mapper. Consumes ADK events and yields MessageParts. Handles `<fyi>`
 * extraction from plain-text parts via BlockParser.
 */
export async function* adkEventsToParts(
  source: AsyncIterable<AdkEvent>,
  opts: { now?: () => Date } = {},
): AsyncGenerator<MessagePart, void, void> {
  const parser = new BlockParser({ now: opts.now });
  // Track the most recent tool call per `id` so we can attach `input` to the
  // matching output-available part. ADK's FunctionCall doesn't ship a
  // lifecycle-state field; it's two distinct events (call then response).
  const toolInputsById = new Map<string, { name: string; input: unknown }>();

  for await (const event of source) {
    // 1. Surface error envelopes (never drop silently).
    if (event.errorCode || event.errorMessage) {
      yield {
        type: 'text',
        text: `[error${event.errorCode ? `:${event.errorCode}` : ''}] ${event.errorMessage ?? ''}`.trim(),
      };
      // Errors can arrive alongside partial content; fall through to process
      // whatever content block (if any) accompanied the error.
    }

    const parts = event.content?.parts;
    if (parts) {
      for (const part of parts) {
        // Function call -> ToolCallPart, input-available.
        if (part.functionCall) {
          const fc = part.functionCall;
          // Per @google/genai.FunctionCall: `id`, `name`, `args` are optional
          // at type level but in practice populated by the model. Fall back
          // to a synthetic id so the downstream Zod schema (which requires
          // `toolCallId: string`) never fails.
          const toolCallId = fc.id ?? `call-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
          const toolName = fc.name ?? 'unknown';
          const input = fc.args ?? {};
          toolInputsById.set(toolCallId, { name: toolName, input });
          const tc: ToolCallPart = {
            type: 'tool-call',
            state: 'input-available',
            toolCallId,
            toolName,
            input,
          };
          yield tc;
          continue;
        }

        // Function response -> ToolCallPart, output-available.
        if (part.functionResponse) {
          const fr = part.functionResponse;
          const toolCallId = fr.id ?? `resp-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
          const toolName = fr.name ?? 'unknown';
          const prior = toolInputsById.get(toolCallId);
          const input = prior?.input;
          const output = fr.response ?? {};
          const tc: ToolCallPart = {
            type: 'tool-call',
            state: 'output-available',
            toolCallId,
            toolName,
            input,
            output,
          };
          yield tc;
          continue;
        }

        // Thought text -> ReasoningPart (later stripped from outbound).
        // `Part.thought === true` with `Part.text` populated is how ADK /
        // genai surface model reasoning. ClaudeLlm (B.t5) will map Anthropic
        // thinking blocks to this same shape.
        if (part.thought === true && typeof part.text === 'string' && part.text.length > 0) {
          yield { type: 'reasoning', text: part.text };
          continue;
        }

        // Plain text -> through the block parser. This is where `<fyi>`
        // extraction happens.
        if (typeof part.text === 'string' && part.text.length > 0) {
          const emitted = parser.feed(part.text);
          for (const p of emitted) yield p;
          continue;
        }

        // Other part kinds (inlineData, fileData, executableCode, etc.) are
        // not in the Puma outbound contract. Silently skip — if a future
        // content type matters, extend this switch + the shared schema.
      }
    }

    if (event.turnComplete === true) {
      for (const p of parser.end()) yield p;
      // Reset for any subsequent events on the same iterator (defensive; the
      // caller should close out the turn at turnComplete).
      toolInputsById.clear();
    }
  }

  // Iterator exhausted without an explicit turnComplete (e.g. connection
  // dropped, test fixture with no final marker). Flush the parser so we
  // don't swallow a mid-`<fyi>` buffer.
  for (const p of parser.end()) yield p;
}
