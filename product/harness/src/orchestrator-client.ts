/**
 * Thin HTTP client over Puma's orchestrator (B.t5 endpoints).
 *
 * Three responsibilities:
 *   1. `createSession()` — POST /session → { sessionId, disclosureCopyVersion }.
 *   2. `grantConsent()`  — PATCH /session/:id/consent with { granted, copyVersion }.
 *   3. `sendMessage()`   — POST /chat, consume the SSE stream, aggregate utter
 *      text + tool-call records, return the aggregated payload for assertions.
 *
 * Session deletion is intentionally omitted: the orchestrator's idle sweeper
 * eventually cleans up, and each scenario starts a fresh session anyway.
 *
 * Error handling: every method throws on non-2xx. The runner catches and
 * records the failure against the scenario; the CLI itself never crashes on a
 * single scenario failure (per H.13 non-gating posture).
 */

const DEFAULT_BASE_URL = 'http://localhost:8080';

export interface OrchestratorSession {
  readonly sessionId: string;
  readonly disclosureCopyVersion: string;
}

export interface AggregatedResponse {
  /** Concatenation of all `text` parts delivered during the turn. */
  readonly utterText: string;
  /** Every tool-call part the server emitted — shape is orchestrator-defined. */
  readonly toolCalls: readonly unknown[];
  /** Every raw MessagePart observed on the wire (for debugging / H.t3). */
  readonly rawParts: readonly unknown[];
}

export interface OrchestratorClientOptions {
  readonly baseUrl?: string;
  /** Turn timeout in ms. Puma turns take 3–10s; 60s leaves margin. */
  readonly turnTimeoutMs?: number;
}

export class OrchestratorClient {
  private readonly baseUrl: string;
  private readonly turnTimeoutMs: number;

  constructor(opts: OrchestratorClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.turnTimeoutMs = opts.turnTimeoutMs ?? 60_000;
  }

  async createSession(): Promise<OrchestratorSession> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      throw new Error(
        `POST /session failed: ${res.status} ${res.statusText} — ${await safeBody(res)}`,
      );
    }
    const json = (await res.json()) as {
      sessionId?: unknown;
      disclosureCopyVersion?: unknown;
    };
    if (
      typeof json.sessionId !== 'string' ||
      typeof json.disclosureCopyVersion !== 'string'
    ) {
      throw new Error(
        `POST /session returned unexpected shape: ${JSON.stringify(json)}`,
      );
    }
    return {
      sessionId: json.sessionId,
      disclosureCopyVersion: json.disclosureCopyVersion,
    };
  }

  async grantConsent(
    sessionId: string,
    copyVersion: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/session/${encodeURIComponent(sessionId)}/consent`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granted: true, copyVersion }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `PATCH /session/:id/consent failed: ${res.status} ${res.statusText} — ${await safeBody(res)}`,
      );
    }
  }

  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<AggregatedResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.turnTimeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ sessionId, message }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`POST /chat fetch failed: ${reason}`);
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      throw new Error(
        `POST /chat failed: ${res.status} ${res.statusText} — ${await safeBody(res)}`,
      );
    }

    try {
      return await consumeSseStream(res.body);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// SSE consumer. Puma's wire format:
//   `data: <MessagePart-json>\n\n`  for each part
//   `event: done\ndata: {}\n\n`     when the turn finishes cleanly
//   `event: error\ndata: {...}\n\n` for mid-stream faults
// ---------------------------------------------------------------------------

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
): Promise<AggregatedResponse> {
  const decoder = new TextDecoder();
  const reader = body.getReader();

  let buffer = '';
  let utterText = '';
  const toolCalls: unknown[] = [];
  const rawParts: unknown[] = [];
  let errored: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const event = parseSseFrame(frame);
      if (!event) continue;

      if (event.event === 'done') {
        // Clean end of turn.
        return { utterText, toolCalls, rawParts };
      }
      if (event.event === 'error') {
        errored = event.data;
        break;
      }

      // Default: `data:` line is a MessagePart JSON.
      try {
        const part = JSON.parse(event.data) as { type?: unknown };
        rawParts.push(part);
        if (
          typeof part === 'object' &&
          part !== null &&
          typeof (part as { type?: unknown }).type === 'string'
        ) {
          const typed = part as { type: string; text?: unknown };
          if (typed.type === 'text' && typeof typed.text === 'string') {
            utterText += typed.text;
          } else if (typed.type === 'tool-call') {
            toolCalls.push(part);
          }
        }
      } catch {
        // Malformed JSON on the wire — ignore for scaffold; H.t3 might
        // want to surface this explicitly.
      }
    }

    if (errored) break;
  }

  if (errored) {
    throw new Error(`SSE error frame from /chat: ${errored}`);
  }

  // Stream ended without an explicit `done` event — return what we have.
  return { utterText, toolCalls, rawParts };
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  const lines = frame.split('\n');
  let eventName = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice('data:'.length).trim();
    }
  }
  if (data.length === 0 && eventName === 'message') return null;
  return { event: eventName, data };
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return '<body unreadable>';
  }
}
