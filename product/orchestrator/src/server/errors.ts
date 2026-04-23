/**
 * Shared HTTP / SSE error surface for the orchestrator server (B.t5).
 *
 * Split responsibilities:
 *   - Pre-stream: validation, session lookup, consent gate. Map to plain HTTP
 *     status codes with a structured JSON body.
 *   - Mid-stream: the SSE is already open; we emit a structured `error`
 *     event and close cleanly. Callers (chat.ts) get a single helper so we
 *     never half-write a record on the wire.
 *
 * The `code` field is a stable machine-readable discriminator. Chunk D's UI
 * uses these to decide whether to retry, prompt for consent, or surface the
 * error inline. Human message is the model-free description the UI may show
 * as-is.
 */

import type { Response } from 'express';

export const DISCLOSURE_COPY_VERSION = 'v1';

/**
 * Canonical error code set. Extended with new values as new failure modes
 * land — keep this union narrow so chunk D has an exhaustive switch.
 */
export type OrchestratorErrorCode =
  | 'session_not_found'
  | 'consent_required'
  | 'invalid_request'
  | 'message_empty'
  | 'internal_error'
  | 'stream_aborted';

export interface OrchestratorErrorBody {
  error: {
    code: OrchestratorErrorCode;
    message: string;
  };
}

export function errorBody(
  code: OrchestratorErrorCode,
  message: string,
): OrchestratorErrorBody {
  return { error: { code, message } };
}

/** Pre-stream: write a JSON body + status and end the response. */
export function sendError(
  res: Response,
  status: number,
  code: OrchestratorErrorCode,
  message: string,
): void {
  if (res.headersSent) {
    // Something already flushed — can't legitimately send a status now.
    // Fall back to closing; the connection tear-down is the best signal.
    res.end();
    return;
  }
  res.status(status).json(errorBody(code, message));
}

/**
 * Mid-stream: emit an SSE `error` event and close the stream. Callers pass
 * an already-open `Response`; we never re-initialise the headers here.
 */
export function writeSseError(
  res: Response,
  code: OrchestratorErrorCode,
  message: string,
): void {
  const payload = JSON.stringify({ code, message });
  res.write(`event: error\n`);
  res.write(`data: ${payload}\n\n`);
}
