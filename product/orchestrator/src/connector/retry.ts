/**
 * Retry wrapper for MCP transport calls (B.t3).
 *
 * Scope (planning/03-exec-agent-runtime-t3.md §2.3 + "Key implementation notes" 5):
 *   - Retries transport-level failures only: network errors (ECONNREFUSED,
 *     ETIMEDOUT, fetch TypeError) and HTTP 5xx responses surfaced by the
 *     MCP SDK.
 *   - Does NOT retry 4xx (that's the connector rejecting our input — retrying
 *     doesn't help) nor Zod validation errors (those come from our own
 *     adapter, not the network).
 *   - 3 retries after the first attempt (4 total tries).
 *   - Exponential backoff with full jitter, base 250ms, cap 4000ms.
 *
 * This module is the single source of truth for retry policy. Do not inline
 * retry loops elsewhere in the connector adapter.
 */

export interface RetryOptions {
  /** How many retries after the first attempt. Default 3 (= 4 tries total). */
  readonly retries?: number;
  /** Base delay in ms for exponential backoff. Default 250. */
  readonly baseDelayMs?: number;
  /** Cap on per-attempt sleep, in ms. Default 4000. */
  readonly maxDelayMs?: number;
  /** Hook for tests to stub the sleep. Defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Hook for tests to stub jitter. Defaults to Math.random. */
  readonly random?: () => number;
}

/**
 * Classify an error thrown by the MCP client / underlying fetch into retryable
 * vs non-retryable.
 *
 * The MCP SDK surfaces transport failures as `Error` subclasses; 4xx tool-
 * level errors come through as structured `CallToolResult` with
 * `isError: true`, NOT as thrown errors — so they don't hit this path at all.
 * That means any thrown error is a transport or protocol-level fault, and the
 * only ambiguity is whether it came from a 5xx or a 4xx upstream HTTP layer.
 *
 * We retry if:
 *   - The error looks like a network failure (Node undici `UND_ERR_*`,
 *     `ECONNREFUSED`, `ETIMEDOUT`, generic `TypeError: fetch failed`).
 *   - The error exposes an HTTP-like status and it's 5xx.
 *
 * We do NOT retry on:
 *   - HTTP 4xx statuses (client error — our call is malformed).
 *   - Zod validation errors thrown by our own adapter (`ZodError`).
 *   - AbortError from an explicit abort (timeout hit).
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Explicit abort (timeout) is a terminal failure, not a retryable transport
  // wobble — the server may be fine but slow, and we don't want to pile up
  // retries on a slow connector.
  if (err.name === 'AbortError') return false;

  // Zod validation errors bubble up from our own adapter layer. Retrying
  // can't fix malformed args or malformed responses.
  if (err.name === 'ZodError') return false;

  const statusCandidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { code?: unknown }).code,
  ];
  for (const s of statusCandidates) {
    if (typeof s === 'number') {
      if (s >= 500 && s < 600) return true;
      if (s >= 400 && s < 500) return false;
    }
  }

  // Node fetch / undici network errors tend to be TypeError('fetch failed')
  // with a `cause` containing an errno-style `code`. Be permissive: anything
  // that looks like a connection / DNS / reset failure is retryable.
  const causeCode = (err as { cause?: { code?: unknown } }).cause?.code;
  if (typeof causeCode === 'string') {
    return NETWORK_ERROR_CODES.has(causeCode);
  }

  const message = err.message ?? '';
  if (/fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message)) {
    return true;
  }

  return false;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Run `fn` with the retry policy described at the top of this module.
 *
 * Exported separately from `callTool` so the client's `listTools` startup
 * probe gets the same treatment — if chunk C's connector is still booting
 * when the orchestrator starts, we ride through the gap.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryableError(err)) {
        throw err;
      }
      const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs, random);
      await sleep(delay);
    }
  }
  // Unreachable — the loop either returns or throws — but TS can't prove it.
  throw lastErr;
}

function computeBackoff(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  // Full jitter: pick uniformly in [0, exp). Spreads retry storms.
  return Math.floor(random() * exp);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
