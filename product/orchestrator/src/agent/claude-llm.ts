/**
 * Claude BaseLlm for ADK 1.0.0 — B.t5 real Anthropic wiring.
 *
 * Why this exists:
 *   Google's @google/adk@1.0.0 ships Gemini (google_llm) and Apigee proxy
 *   integrations only — no first-party Anthropic / Claude provider. Decision
 *   B.11 (planning/decisions.md) committed to a local shim over
 *   @anthropic-ai/sdk rather than a third-party community adapter.
 *
 * What B.t5 lands (this file):
 *   1. Translate ADK's `LlmRequest` (genai `Content[]` + system instruction +
 *      `toolsDict: Record<string,BaseTool>`) into an Anthropic
 *      `messages.create` streaming request.
 *   2. Consume the Anthropic stream event-by-event and yield ADK `LlmResponse`
 *      objects shaped so the B.t4 translator (`adkEventsToParts`) can route
 *      them correctly:
 *        - `text_delta` blocks        -> LlmResponse{content.parts[{text, partial:true}]}
 *        - `thinking_delta` blocks    -> LlmResponse{content.parts[{text, thought:true}]}
 *        - `tool_use` blocks at stop  -> LlmResponse{content.parts[{functionCall:{id,name,args}}]}
 *        - `message_stop` + stop_reason -> LlmResponse{turnComplete:true}
 *   3. Respect the `abortSignal` argument — Anthropic's SDK accepts a
 *      `signal` RequestOption, so cancellation flows cleanly from Express
 *      `req.on('close')` → Runner abort → Anthropic HTTP abort.
 *
 * What is still NOT wired:
 *   - `connect()` (live bidi). Puma is SSE-only (see planning/02-impl-agent-
 *     runtime.md §2.5). Left as a clear throw.
 *   - Prompt caching, thinking budgets, fine-grained tool streaming. Those
 *     are future optimisation tasks, not Puma-critical.
 *   - Image / document inputs. Puma is text-only in Phase 1.
 *
 * The translator's invariants (§B.t4):
 *   - A reasoning part reaches the SESSION SINK but never the SSE wire.
 *     Here, thinking deltas carry `Part.thought === true` so the translator's
 *     `filterReasoning` stage strips them.
 *   - Tool calls arrive via `Part.functionCall` (id + name + args). The input
 *     JSON is buffered until `content_block_stop` so we never leak a partial
 *     JSON payload into a `functionCall.args` the agent would choke on.
 *   - Errors use the LlmResponse `errorCode`/`errorMessage` envelope — the
 *     translator turns those into a visible `[error]` TextPart rather than
 *     silently dropping data.
 */

import { BaseLlm } from '@google/adk';
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk';
import type { Content, Part as GenaiPart } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  MessageCreateParamsStreaming,
  RawMessageStreamEvent,
  StopReason,
  Tool as AnthropicTool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { FunctionDeclaration } from '@google/genai';

export interface ClaudeLlmParams {
  /** Anthropic model id (e.g. 'claude-sonnet-4-5-20250929'). */
  readonly model: string;
  /** Anthropic API key. Never logged. */
  readonly apiKey: string;
  /** Max output tokens. Defaults to 2048 if not supplied. */
  readonly maxTokens?: number;
  /** Temperature (0..2). Defaults to 0.7. */
  readonly temperature?: number;
  /**
   * Optional Anthropic client override — used by tests to inject a stub so
   * `generateContentAsync` can be exercised without touching the network.
   */
  readonly client?: AnthropicClientLike;
}

/**
 * Minimal client surface we depend on. Matches the real SDK method shape for
 * `messages.create` in streaming mode. Keeping this narrow makes mocking
 * trivial and keeps us independent of the SDK's deep type graph.
 */
export interface AnthropicClientLike {
  messages: {
    create(
      body: MessageCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<RawMessageStreamEvent>>;
  };
}

export class ClaudeLlm extends BaseLlm {
  static readonly supportedModels: Array<string | RegExp> = [/^claude-/];

  private readonly client: AnthropicClientLike;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(params: ClaudeLlmParams) {
    super({ model: params.model });
    if (!params.apiKey) {
      throw new Error('ClaudeLlm requires an apiKey.');
    }
    this.maxTokens = params.maxTokens ?? 2048;
    this.temperature = params.temperature ?? 0.7;
    this.client =
      params.client ??
      (new Anthropic({ apiKey: params.apiKey }) as unknown as AnthropicClientLike);
  }

  async *generateContentAsync(
    llmRequest: LlmRequest,
    _stream?: boolean,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    const { system, messages } = splitContents(llmRequest.contents ?? []);
    const systemInstruction = resolveSystemInstruction(llmRequest, system);
    const tools = buildAnthropicTools(llmRequest.toolsDict ?? {});

    const params: MessageCreateParamsStreaming = {
      model: llmRequest.model ?? this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true,
      messages,
      ...(systemInstruction ? { system: systemInstruction } : {}),
      ...(tools.length > 0 ? { tools } : {}),
    };

    let stopReason: StopReason | null = null;

    // Per-block streaming state. Anthropic keys blocks by `index`.
    interface BlockAccumulator {
      /** Discriminator. */
      readonly kind: 'text' | 'thinking' | 'tool_use' | 'ignored';
      /** Populated for tool_use blocks only. */
      readonly id?: string;
      readonly name?: string;
      /** Partial JSON accumulator for tool_use. */
      jsonBuf: string;
    }
    const blocks = new Map<number, BlockAccumulator>();

    let stream: AsyncIterable<RawMessageStreamEvent>;
    try {
      stream = await this.client.messages.create(params, { signal: abortSignal });
    } catch (err) {
      yield errorResponse(err);
      return;
    }

    try {
      for await (const event of stream) {
        // Check for abort between events — the SDK also threads the signal
        // through the HTTP layer, but this adds a fast exit if the signal
        // fires while we're mid-iteration.
        if (abortSignal?.aborted) {
          return;
        }

        switch (event.type) {
          case 'message_start':
            // Nothing to emit; the message-level metadata isn't user-visible.
            break;

          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'text') {
              blocks.set(event.index, { kind: 'text', jsonBuf: '' });
            } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              blocks.set(event.index, { kind: 'thinking', jsonBuf: '' });
            } else if (block.type === 'tool_use') {
              blocks.set(event.index, {
                kind: 'tool_use',
                id: block.id,
                name: block.name,
                jsonBuf: '',
              });
            } else {
              // Server tool results, citations, code execution — not in
              // Puma scope. Log via the translator's error envelope only
              // if the model actually emits one (rare with our tool set).
              blocks.set(event.index, { kind: 'ignored', jsonBuf: '' });
            }
            break;
          }

          case 'content_block_delta': {
            const acc = blocks.get(event.index);
            if (!acc) break;
            const delta = event.delta;
            if (delta.type === 'text_delta' && acc.kind === 'text') {
              yield textChunkResponse(delta.text, /* thought */ false);
            } else if (delta.type === 'thinking_delta' && acc.kind === 'thinking') {
              yield textChunkResponse(delta.thinking, /* thought */ true);
            } else if (delta.type === 'input_json_delta' && acc.kind === 'tool_use') {
              acc.jsonBuf += delta.partial_json;
            }
            // `signature_delta` (thinking proof) + `citations_delta` (RAG) —
            // no user-visible output on the Puma wire, ignored here.
            break;
          }

          case 'content_block_stop': {
            const acc = blocks.get(event.index);
            if (!acc) break;
            if (acc.kind === 'tool_use' && acc.id && acc.name) {
              const args = safeParseJson(acc.jsonBuf) ?? {};
              yield functionCallResponse(acc.id, acc.name, args);
            }
            blocks.delete(event.index);
            break;
          }

          case 'message_delta':
            if (event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            break;

          case 'message_stop': {
            const finishReason = mapStopReason(stopReason);
            const resp: LlmResponse = { turnComplete: true };
            if (finishReason) resp.finishReason = finishReason;
            yield resp;
            break;
          }
        }
      }
    } catch (err) {
      // Mid-stream failure (e.g. network dropped). Surface as an error
      // envelope rather than letting the generator reject — the translator
      // turns this into a visible `[error]` part.
      yield errorResponse(err);
    }
  }

  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    // Puma is SSE-only; the Anthropic Messages API is HTTP streaming, not
    // bidi. Live connect stays out of scope (planning/02-impl-agent-runtime.md
    // §2.5).
    throw new Error(
      '[orchestrator] ClaudeLlm.connect (live bidi) is not in scope for Puma. Puma uses SSE.',
    );
  }
}

// ---------------------------------------------------------------------------
// Request translation: ADK / genai -> Anthropic Messages API.
// ---------------------------------------------------------------------------

/**
 * Split ADK's `contents` array into:
 *   - Anthropic `messages` (user + assistant turns, tool uses + results),
 *   - a free-form `system` string extracted from any `role: 'system'` entry.
 *
 * genai's `Content.role` is a string, but in ADK practice it's
 * `'user' | 'model' | 'system'` — we pass `model`→`assistant` straight through
 * and treat `system` as a prompt prefix (Anthropic has a dedicated `system`
 * field; no system role inside `messages`).
 */
function splitContents(contents: readonly Content[]): {
  system: string;
  messages: MessageParam[];
} {
  const out: MessageParam[] = [];
  const systemSegments: string[] = [];

  for (const c of contents) {
    const role = c.role;
    const parts = c.parts ?? [];
    if (role === 'system') {
      for (const p of parts) {
        if (typeof p.text === 'string') systemSegments.push(p.text);
      }
      continue;
    }
    if (parts.length === 0) continue;

    if (role === 'user') {
      const blocks = userPartsToBlocks(parts);
      if (blocks.length > 0) {
        out.push({ role: 'user', content: blocks });
      }
      continue;
    }

    // Default: assistant / model turn.
    const blocks = assistantPartsToBlocks(parts);
    if (blocks.length > 0) {
      out.push({ role: 'assistant', content: blocks });
    }
  }

  return { system: systemSegments.join('\n'), messages: out };
}

/** User turns carry plain text and/or tool results (from our agent's loop). */
function userPartsToBlocks(parts: readonly GenaiPart[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const p of parts) {
    if (p.functionResponse?.id) {
      const frId = p.functionResponse.id;
      const frResponse = p.functionResponse.response;
      const payload =
        frResponse === undefined || frResponse === null
          ? ''
          : typeof frResponse === 'string'
            ? frResponse
            : JSON.stringify(frResponse);
      const tr: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: frId,
        content: payload,
      };
      blocks.push(tr);
      continue;
    }
    if (typeof p.text === 'string' && p.text.length > 0) {
      blocks.push({ type: 'text', text: p.text });
    }
  }
  return blocks;
}

/** Assistant turns carry plain text and/or tool uses the model emitted. */
function assistantPartsToBlocks(parts: readonly GenaiPart[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const p of parts) {
    if (p.thought === true && typeof p.text === 'string') {
      // Thinking blocks in history require signature round-tripping for
      // multi-turn continuity; Puma doesn't persist signatures yet, so we
      // simply drop thinking from replay. Safe: the model doesn't need its
      // own past reasoning as input.
      continue;
    }
    if (p.functionCall && p.functionCall.id && p.functionCall.name) {
      blocks.push({
        type: 'tool_use',
        id: p.functionCall.id,
        name: p.functionCall.name,
        input: (p.functionCall.args ?? {}) as unknown,
      });
      continue;
    }
    if (typeof p.text === 'string' && p.text.length > 0) {
      blocks.push({ type: 'text', text: p.text });
    }
  }
  return blocks;
}

/**
 * Resolve the system instruction. ADK injects the agent's `instruction` into
 * `LlmRequest.config.systemInstruction` (a `Content` value). Fall back to any
 * `role: 'system'` entries surfaced by `splitContents` (useful for tests).
 */
function resolveSystemInstruction(req: LlmRequest, fallback: string): string {
  const raw = req.config?.systemInstruction;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'parts' in raw) {
    const parts = (raw as Content).parts ?? [];
    const joined = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .filter((s) => s.length > 0)
      .join('\n');
    if (joined.length > 0) return joined;
  }
  return fallback;
}

/**
 * Build Anthropic's `tools` array from ADK's `toolsDict`. We pull each tool's
 * genai `FunctionDeclaration` via `_getDeclaration()` (the ADK-public way) and
 * translate its `parameters` Schema into a JSON Schema object suitable for
 * Anthropic. For Puma's tools, `parameters` is already a JSON-Schema-like
 * object (ADK's `zodObjectToSchema` outputs one), so we forward it with a
 * minimal coercion — the `object` type wrapper is required by Anthropic even
 * if the schema is empty.
 */
/** Recursively normalise Google genai's Schema into JSON Schema draft 2020-12.
 *  Anthropic requires draft 2020-12. Genai serialises with three divergences:
 *    1. `type` as an uppercase enum string ("OBJECT", "STRING") — must be lowercase.
 *    2. Numeric constraints (`minLength`, `maxLength`, `minItems`, `maxItems`,
 *       `minimum`, `maximum`, `minProperties`, `maxProperties`) serialised as
 *       strings — must be numbers.
 *    3. `exclusiveMinimum` / `exclusiveMaximum` as draft-04 boolean companions
 *       to `minimum` / `maximum` — must be draft-2020-12 numeric exclusive bounds.
 *  Without these fixes Anthropic responds with
 *  `tools.0.custom.input_schema: JSON schema is invalid`.
 */
const NUMERIC_CONSTRAINT_KEYS = new Set([
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'minProperties',
  'maxProperties',
  'multipleOf',
  'exclusiveMinimum',
  'exclusiveMaximum',
]);

function coerceNumeric(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

function normaliseSchemaTypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseSchemaTypes);
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'type' && typeof v === 'string') {
        out[k] = v.toLowerCase();
      } else if (NUMERIC_CONSTRAINT_KEYS.has(k) && typeof v !== 'boolean') {
        out[k] = coerceNumeric(v);
      } else {
        out[k] = normaliseSchemaTypes(v);
      }
    }
    // Draft-04 → draft-2020-12 exclusive-bound migration.
    // genai emits `exclusiveMinimum: true` alongside `minimum: <n>`; Anthropic
    // wants `exclusiveMinimum: <n>` with no bare `minimum`.
    if (out.exclusiveMinimum === true && typeof out.minimum === 'number') {
      out.exclusiveMinimum = out.minimum;
      delete out.minimum;
    } else if (out.exclusiveMinimum === false) {
      delete out.exclusiveMinimum;
    }
    if (out.exclusiveMaximum === true && typeof out.maximum === 'number') {
      out.exclusiveMaximum = out.maximum;
      delete out.maximum;
    } else if (out.exclusiveMaximum === false) {
      delete out.exclusiveMaximum;
    }
    return out;
  }
  return value;
}

function buildAnthropicTools(
  toolsDict: Readonly<Record<string, { _getDeclaration(): FunctionDeclaration | undefined }>>,
): AnthropicTool[] {
  const out: AnthropicTool[] = [];
  for (const key of Object.keys(toolsDict)) {
    const tool = toolsDict[key];
    const decl = tool._getDeclaration?.();
    if (!decl) continue;
    const params = decl.parameters as Record<string, unknown> | undefined;
    const normalised = (normaliseSchemaTypes(params ?? {}) as Record<string, unknown>) ?? {};
    // `type: 'object'` last so it always overrides whatever the params carried.
    const inputSchema: AnthropicTool['input_schema'] = {
      ...normalised,
      type: 'object',
    } as AnthropicTool['input_schema'];
    out.push({
      name: decl.name ?? key,
      ...(decl.description ? { description: decl.description } : {}),
      input_schema: inputSchema,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stream helpers: shape LlmResponse objects the translator understands.
// ---------------------------------------------------------------------------

function textChunkResponse(text: string, isThought: boolean): LlmResponse {
  const part: GenaiPart = { text };
  if (isThought) part.thought = true;
  return {
    content: { role: 'model', parts: [part] },
    partial: true,
  };
}

function functionCallResponse(
  id: string,
  name: string,
  args: unknown,
): LlmResponse {
  const fc: GenaiPart = {
    functionCall: { id, name, args: (args ?? {}) as Record<string, unknown> },
  };
  return {
    content: { role: 'model', parts: [fc] },
  };
}

function errorResponse(err: unknown): LlmResponse {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'status' in err
      ? String((err as { status: unknown }).status)
      : 'anthropic_error';
  return { errorCode: code, errorMessage: message, turnComplete: true };
}

function safeParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Map Anthropic's stop_reason to ADK's `FinishReason` enum. We hand through
 * a string-shaped value; ADK's `FinishReason` is ultimately a string enum
 * downstream of genai, so the cast is safe at runtime.
 */
function mapStopReason(reason: StopReason | null): LlmResponse['finishReason'] | undefined {
  if (!reason) return undefined;
  // Anthropic reasons: end_turn, max_tokens, stop_sequence, tool_use,
  // pause_turn, refusal. Genai's FinishReason enum uses `STOP`, `MAX_TOKENS`,
  // `TOOL_USE_STOP`, etc. We use a narrow mapping; unknown values fall back
  // to `STOP` so downstream code never sees undefined for a completed turn.
  switch (reason) {
    case 'max_tokens':
      return 'MAX_TOKENS' as LlmResponse['finishReason'];
    case 'stop_sequence':
      return 'STOP' as LlmResponse['finishReason'];
    case 'tool_use':
      return 'STOP' as LlmResponse['finishReason'];
    case 'refusal':
      return 'SAFETY' as LlmResponse['finishReason'];
    case 'pause_turn':
    case 'end_turn':
    default:
      return 'STOP' as LlmResponse['finishReason'];
  }
}
