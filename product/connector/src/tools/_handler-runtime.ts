/**
 * Shared handler runtime — pre-empts the 8x try/catch repetition (H4 cousin).
 *
 * Per planning/03-exec-c-t4.md §"Error handling — the shared helper". Wraps
 * a handler body in: input validation, body execution, output validation,
 * one `tool.invoked` event per call (Q5 — single shared event with toolName
 * discriminator).
 *
 * Output envelope mirrors what the orchestrator's `parseToolResult` (H4)
 * expects: `{ ok: true, value: T } | { ok: false, code, detail }`. The MCP
 * registration shim wraps this into the SDK's `{ structuredContent }` /
 * `{ isError: true, content: [...] }` shape.
 */

import { z } from 'zod';
import {
  emitErrorRaised,
  emitEvent,
  messageOf,
  type EventActor,
} from '@swoop/common';

export type HandlerErrorCode =
  | 'tool_input_invalid'
  | 'tool_output_invalid'
  | 'handler_threw';

export interface HandlerOk<T> {
  readonly ok: true;
  readonly value: T;
}
export interface HandlerErr {
  readonly ok: false;
  readonly code: HandlerErrorCode;
  readonly detail: string;
}
export type HandlerResult<T> = HandlerOk<T> | HandlerErr;

/**
 * Per-call observability hook. Default = `tool.invoked` envelope via emitEvent.
 * Tests substitute a capture function.
 */
export type ToolInvokedSink = (event: {
  toolName: string;
  ok: boolean;
  elapsedMs: number;
  outputCount?: number;
  errorKind?: HandlerErrorCode;
}) => void;

export interface HandlerRuntimeDeps {
  /** Session id for envelope correlation. */
  readonly sessionId: string;
  /** Test-injectable clock; default `() => new Date()`. */
  readonly now?: () => Date;
  /** Test-injectable sink; default emits `tool.invoked` via `emitEvent`. */
  readonly sink?: ToolInvokedSink;
  /** Actor for emitted events; default `'connector'`. */
  readonly actor?: EventActor;
}

/** Count rows in a tool's output object. Looks for the standard collection
 * fields the conversational tools use; falls back to 0 for utility tools
 * like `handoff` / `handoff_submit`. */
export function countOutputRows(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  for (const key of ['passages', 'stories', 'proofs', 'chunks', 'cards', 'images', 'tips', 'hotels', 'trips']) {
    const arr = v[key];
    if (Array.isArray(arr)) return arr.length;
  }
  return undefined;
}

/**
 * Run a tool handler body with input + output validation and one tool.invoked
 * event per call. Each tool registration in `tools/index.ts` calls this once
 * to wrap its body.
 *
 * Behaviour mirror of the C.t4 plan:
 *   - Input validation failure → `{ok:false, code:'tool_input_invalid'}` +
 *     event with `errorKind`.
 *   - Body throw → `{ok:false, code:'handler_threw'}` + event +
 *     `error.raised` envelope (so observability stream catches both shapes).
 *   - Output validation failure (defence in depth) →
 *     `{ok:false, code:'tool_output_invalid'}` + event.
 *   - Success → `{ok:true, value}` + event with outputCount.
 */
export async function runHandler<S extends z.ZodTypeAny, T extends z.ZodTypeAny>(
  toolName: string,
  inputSchema: S,
  outputSchema: T,
  body: (input: z.infer<S>) => Promise<z.infer<T>>,
  rawInput: unknown,
  deps: HandlerRuntimeDeps,
): Promise<HandlerResult<z.infer<T>>> {
  const now = deps.now ?? (() => new Date());
  const actor = deps.actor ?? 'connector';
  const startedAt = now().getTime();

  const emit = (
    ok: boolean,
    outputCount?: number,
    errorKind?: HandlerErrorCode,
  ): void => {
    const elapsedMs = Math.max(0, now().getTime() - startedAt);
    if (deps.sink) {
      deps.sink({ toolName, ok, elapsedMs, outputCount, errorKind });
      return;
    }
    emitEvent({
      eventType: 'tool.invoked',
      eventVersion: 1,
      timestamp: now().toISOString(),
      sessionId: deps.sessionId,
      turnIndex: null,
      actor,
      payload: {
        toolName,
        elapsedMs,
        ok,
        ...(outputCount !== undefined ? { outputCount } : {}),
        ...(errorKind ? { errorKind } : {}),
      },
    });
  };

  // 1. Input validation
  const parsedInput = inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const detail = JSON.stringify(parsedInput.error.issues).slice(0, 500);
    emit(false, undefined, 'tool_input_invalid');
    return { ok: false, code: 'tool_input_invalid', detail };
  }

  // 2. Body execution
  let output: z.infer<T>;
  try {
    output = await body(parsedInput.data as z.infer<S>);
  } catch (err) {
    emit(false, undefined, 'handler_threw');
    emitErrorRaised({
      sessionId: deps.sessionId,
      actor,
      errorType: `tool_handler_threw:${toolName}`,
      chunk: 'C',
      err,
      now,
    });
    return { ok: false, code: 'handler_threw', detail: messageOf(err) };
  }

  // 3. Output validation (defence in depth — primitives validate already)
  const parsedOutput = outputSchema.safeParse(output);
  if (!parsedOutput.success) {
    const detail = JSON.stringify(parsedOutput.error.issues).slice(0, 500);
    emit(false, undefined, 'tool_output_invalid');
    return { ok: false, code: 'tool_output_invalid', detail };
  }

  emit(true, countOutputRows(parsedOutput.data));
  return { ok: true, value: parsedOutput.data };
}

/**
 * Map a `HandlerResult` into the MCP SDK's tool-result shape. Used by the
 * registration shim in `tools/index.ts`.
 */
export function toMcpToolResult<T>(
  result: HandlerResult<T>,
): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown; isError?: true } {
  if (result.ok) {
    const text = JSON.stringify(result.value);
    return {
      content: [{ type: 'text', text }],
      structuredContent: result.value as unknown,
    };
  }
  const errorBody = { ok: false, code: result.code, detail: result.detail };
  return {
    content: [{ type: 'text', text: JSON.stringify(errorBody) }],
    structuredContent: errorBody,
    isError: true,
  };
}
