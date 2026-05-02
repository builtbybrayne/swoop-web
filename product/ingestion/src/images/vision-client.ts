/**
 * Thin Anthropic Vision client for the C.t6 image annotation pipeline.
 *
 * Two surfaces:
 *
 *   1. `annotateImageLive` — single-image, single-call. Used by the
 *      live-mode runner with a 5-up concurrency pool (HITL Q5) and
 *      exponential backoff on 429/5xx. Suited to small slices for
 *      prompt iteration.
 *
 *   2. `buildBatchRequest` — assemble a single `MessageBatchCreateParams`
 *      request item for an image. The runner composes many of these
 *      and submits them via `messages.batches.create` for the unbounded
 *      full-catalogue pass (HITL §"Notes for the executing agent": use
 *      Anthropic Message Batches API).
 *
 * Output shape is the JSON object specified in `prompt.md`. We rely on
 * the model returning JSON in the assistant text (per-prompt
 * instruction). Per HITL Q6 the runner Zod-parses the text against
 * `output-schema.ts`; this client is unopinionated about the shape and
 * just hands the raw text back.
 *
 * The client does not retry — retry logic lives in the runner so the
 * checkpoint can record per-attempt state. We do classify errors so
 * the runner knows whether a retry is meaningful.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ImageBlockParam,
  MessageCreateParamsNonStreaming,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { BatchCreateParams } from '@anthropic-ai/sdk/resources/messages/batches.js';

/**
 * Default model id for the annotation pass. Sonnet 4.5 has the strongest
 * vision behaviour at the time of the C.t6 plan; Haiku 4.5 is a
 * cost-tradeoff alternative for full-catalogue runs once the prompt is
 * mature. Operator-overridable via `--model=claude-haiku-4-5-20251001`.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/** Conservative output token cap; the JSON object is short. */
export const DEFAULT_MAX_TOKENS = 512;

/** Lower temperature than chat — the structured JSON should be stable. */
export const DEFAULT_TEMPERATURE = 0.2;

export interface VisionClientParams {
  apiKey: string;
  model?: string;
  /** Inject a client double for tests. */
  client?: AnthropicClientLike;
}

/**
 * Minimal SDK surface we depend on. Keeping this narrow keeps testing
 * trivial — the runner can hand a fake of this shape rather than the
 * full Anthropic class.
 */
export interface AnthropicClientLike {
  messages: {
    create(
      body: MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<{
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; [k: string]: unknown }
        | { type: 'thinking'; [k: string]: unknown }
        | { type: string; [k: string]: unknown }
      >;
      stop_reason?: string | null;
    }>;
  };
}

export interface AnnotateOk {
  ok: true;
  rawText: string;
}

export interface AnnotateErr {
  ok: false;
  /** Operator-readable reason. */
  reason: string;
  /** Whether the runner should retry (true for transient; false for terminal). */
  retryable: boolean;
}

export type AnnotateResult = AnnotateOk | AnnotateErr;

/**
 * Build the messages-array payload shared between live + batch paths.
 *
 * Vision call shape: a single user message with an `image` content
 * block (URL source) followed by a `text` block reminding the model of
 * the JSON contract. The full instruction lives in the system prompt
 * passed alongside.
 */
export function buildVisionMessageBody(args: {
  systemPrompt: string;
  imageUrl: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): MessageCreateParamsNonStreaming {
  const userBlocks: Array<TextBlockParam | ImageBlockParam> = [
    {
      type: 'image',
      source: { type: 'url', url: args.imageUrl },
    },
    {
      type: 'text',
      text:
        'Annotate this image per the system instructions. ' +
        'Return ONLY a JSON object with `description` and `annotation` keys, no preamble.',
    },
  ];

  return {
    model: args.model ?? DEFAULT_MODEL,
    max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: args.temperature ?? DEFAULT_TEMPERATURE,
    system: args.systemPrompt,
    messages: [
      {
        role: 'user',
        content: userBlocks,
      },
    ],
  };
}

/**
 * Build a single `requests[]` item for the Message Batches API.
 *
 * Per the SDK's `messages.batches.create({requests: [...]})` shape:
 * each request needs `custom_id` (echoed back in the result, used by
 * the runner to re-link the result to the source image id) and a
 * `params` object containing the message body. The body matches the
 * non-streaming shape from `buildVisionMessageBody`.
 */
export function buildBatchRequest(args: {
  imageId: number;
  systemPrompt: string;
  imageUrl: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): BatchCreateParams.Request {
  const body = buildVisionMessageBody({
    systemPrompt: args.systemPrompt,
    imageUrl: args.imageUrl,
    model: args.model,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
  });
  return {
    custom_id: `image-${args.imageId}`,
    // The Batches API accepts the same `MessageCreateParams` body shape
    // as the live `messages.create` call (sans `stream`).
    params: body as unknown as BatchCreateParams.Request['params'],
  };
}

/**
 * Live single-call annotation. Returns the raw assistant text. Caller
 * is responsible for JSON parsing + Zod validation. Errors classified
 * into transient (retryable) vs terminal.
 */
export async function annotateImageLive(args: {
  client: AnthropicClientLike;
  systemPrompt: string;
  imageUrl: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<AnnotateResult> {
  const body = buildVisionMessageBody(args);
  let response: Awaited<ReturnType<AnthropicClientLike['messages']['create']>>;
  try {
    response = await args.client.messages.create(
      body,
      args.signal ? { signal: args.signal } : undefined,
    );
  } catch (err) {
    return classifyError(err);
  }

  const text = extractAssistantText(response.content);
  if (!text) {
    return {
      ok: false,
      reason: `no_text_block (stop_reason=${response.stop_reason ?? 'null'})`,
      retryable: true,
    };
  }
  return { ok: true, rawText: text };
}

/**
 * Build a real Anthropic client from an API key. Wrapped here so tests
 * never construct one directly.
 */
export function buildClient(params: VisionClientParams): AnthropicClientLike {
  return (
    params.client ??
    (new Anthropic({ apiKey: params.apiKey }) as unknown as AnthropicClientLike)
  );
}

/**
 * Pull the first text block out of the response content array.
 * Multi-block responses are unusual on a Vision call but defensible.
 */
function extractAssistantText(
  blocks: Array<{ type: string; [k: string]: unknown }>,
): string | null {
  for (const block of blocks) {
    const maybeText = (block as { text?: unknown }).text;
    if (block.type === 'text' && typeof maybeText === 'string') {
      const text = maybeText.trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

/**
 * Classify SDK errors into retryable (5xx, 429, network) vs terminal
 * (auth, malformed request, content-policy refusal). The runner
 * retries the former with backoff; the latter become checkpoint
 * `failed` entries.
 */
function classifyError(err: unknown): AnnotateErr {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { status?: number; statusCode?: number }).statusCode;
  // Anthropic SDK exposes status on APIError; some throws (network) won't.
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) {
      return { ok: false, reason: `transient_${status}: ${message}`, retryable: true };
    }
    if (status === 400 || status === 403 || status === 404 || status === 422) {
      return { ok: false, reason: `terminal_${status}: ${message}`, retryable: false };
    }
    return { ok: false, reason: `http_${status}: ${message}`, retryable: false };
  }
  // No status: assume network blip — retryable.
  return { ok: false, reason: `network: ${message}`, retryable: true };
}
