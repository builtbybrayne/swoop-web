// product/ui/src/runtime/orchestrator-adapter.ts
//
// AI SDK v6 transport for the Puma orchestrator (chunk B).
//
// Shape:
//   - Session bootstrap + tier-1 consent grant happen inside the D.t4
//     `<OpeningScreen />` (see disclosure/use-consent.ts). By the time any
//     `/chat` request is issued, a session id is already sitting in
//     `sessionStorage`; this transport only reads it.
//   - Every user submit POSTs to `${VITE_ORCHESTRATOR_URL}/chat` with the
//     session id header and a minimal body shaped for the orchestrator's
//     `POST /chat` contract (`{sessionId, message}` — see
//     `product/orchestrator/src/server/chat.ts`). Only the latest user-text
//     is sent; the orchestrator reconstructs history server-side from
//     session state.
//   - The orchestrator replies with `text/event-stream`. Each `data:` line
//     is a JSON `MessagePart` (`@swoop/common` streaming union). A
//     terminating `event: done` signals normal end-of-turn; `event: error`
//     signals a mid-stream fault.
//   - This adapter bridges that protocol to AI SDK v6's `ChatTransport`
//     contract, translating `MessagePart` → `UIMessageChunk` so
//     `@assistant-ui/react-ai-sdk`'s runtime sees its native event shape.
//
// Why hand-rolled (not `DefaultChatTransport`):
//   - `DefaultChatTransport` speaks the AI SDK's stream-chunk-over-SSE
//     protocol by default. The orchestrator emits its own part schema (B.t5,
//     planning/02-impl-agent-runtime.md §2.5), which is canonical.
//   - Subclassing `HttpChatTransport` and overriding `processResponseStream`
//     would work, but we also need to reshape the request body (AI SDK sends
//     `{messages:[...]}`, orchestrator wants `{sessionId, message}`). Owning
//     `sendMessages` end-to-end is clearer than splitting the two halves
//     across a base class and an override.
//
// References:
//   - planning/02-impl-chat-surface.md §2.1, §2.5
//   - planning/02-impl-agent-runtime.md §2.5 (+ §2.5a for data-fyi)
//   - planning/03-exec-chat-surface-t1.md §Key implementation notes
//   - planning/03-exec-chat-surface-t4.md §"Continue triggers bootstrap"

import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

/** Key used to persist the session id in tab-scoped storage. */
export const SESSION_STORAGE_KEY = "swoop.session.id";

/** Header name the orchestrator expects for the session id (see chunk B). */
export const SESSION_HEADER = "x-swoop-session-id";

// ---------------------------------------------------------------------------
// Error emitter (D.t5)
// ---------------------------------------------------------------------------
// assistant-ui's thread state surfaces errored messages, but the specifics of
// detecting "did the most recent turn fail" through its pre-1.0 API is
// brittle. A module-scoped emitter — the adapter reports errors at the exact
// moment they happen — gives `useRuntimeErrors` a reliable signal without
// poking at assistant-ui internals.
//
// One emitter per module instance is fine; the adapter is a singleton in
// practice (App memoises it). No cleanup needed on unmount — subscribers are
// responsible for detaching their own listeners.

type AdapterErrorListener = (err: unknown) => void;
const adapterErrorListeners = new Set<AdapterErrorListener>();

/** Subscribe to runtime errors emitted by the orchestrator transport. Returns
 *  an unsubscribe fn. D.t5's `useRuntimeErrors` is the primary consumer. */
export function subscribeAdapterErrors(listener: AdapterErrorListener): () => void {
  adapterErrorListeners.add(listener);
  return () => {
    adapterErrorListeners.delete(listener);
  };
}

/** Broadcast an error to all adapter-error listeners. Exposed so that sibling
 *  runtime code (consent bootstrap / refresh flows) can route failures
 *  through the same channel the transport uses — keeps D.t5's banner the
 *  single UI surface for anything that might go wrong with orchestrator
 *  comms, irrespective of which code path triggered it. */
export function emitAdapterError(err: unknown): void {
  for (const listener of adapterErrorListeners) {
    try {
      listener(err);
    } catch (inner) {
      // eslint-disable-next-line no-console
      console.error("[orchestrator-adapter] error listener threw:", inner);
    }
  }
}

/**
 * Resolve the orchestrator base URL from Vite env. Falls back to localhost for
 * local dev so the UI still boots if `.env.local` is missing.
 */
export function getOrchestratorUrl(): string {
  const url = import.meta.env.VITE_ORCHESTRATOR_URL;
  if (typeof url === "string" && url.length > 0) return url;
  return "http://localhost:8080";
}

/**
 * Read the current session id from sessionStorage, if any. Tab-scoped: a new
 * tab gets a fresh conversation.
 */
export function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    // sessionStorage can throw in locked-down privacy contexts — degrade to
    // "no id yet". D.t5 will surface this to the user; for D.t4 the consent
    // gate prevents us ever reaching `/chat` without an id on happy paths.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator MessagePart — narrow structural copies. We deliberately do NOT
// import from `@swoop/common` here: this file runs in the browser via Vite,
// and a runtime import of the common package would drag in Zod schemas we
// don't need to validate against (the orchestrator is the schema authority).
// The shapes below mirror `product/ts-common/src/streaming.ts`; any drift
// there that affects the wire format is a chunk-B concern and will surface
// as a mapping error here.
// ---------------------------------------------------------------------------

interface OrchestratorTextPart {
  readonly type: "text";
  readonly text: string;
}

interface OrchestratorReasoningPart {
  readonly type: "reasoning";
  readonly text: string;
}

interface OrchestratorToolCallInputStreaming {
  readonly type: "tool-call";
  readonly state: "input-streaming";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly inputFragment?: string;
}

interface OrchestratorToolCallInputAvailable {
  readonly type: "tool-call";
  readonly state: "input-available";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

interface OrchestratorToolCallOutputAvailable {
  readonly type: "tool-call";
  readonly state: "output-available";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly isError?: boolean;
}

type OrchestratorToolCallPart =
  | OrchestratorToolCallInputStreaming
  | OrchestratorToolCallInputAvailable
  | OrchestratorToolCallOutputAvailable;

interface OrchestratorDataFyiPart {
  readonly type: "data-fyi";
  readonly data: { readonly message: string; readonly timestamp: string };
}

type OrchestratorMessagePart =
  | OrchestratorTextPart
  | OrchestratorReasoningPart
  | OrchestratorToolCallPart
  | OrchestratorDataFyiPart;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pull the latest user-text out of AI SDK's message history. assistant-ui
 * hands us the full conversation on every submit; the orchestrator only
 * wants the newest user turn (it reconstructs context from session state).
 *
 * "Text" is the concatenation of every text-typed part on the newest user
 * message. In practice there's only ever one, but the AI SDK's part array
 * can in principle hold multiple text parts (e.g. when pasted as chunks),
 * so join them with a single space to preserve intent.
 */
function extractLatestUserMessage<TMessage extends UIMessage>(
  messages: readonly TMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const text = msg.parts
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join(" ")
      .trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

/**
 * Minimal SSE parser: splits the incoming byte stream on `\n\n` event
 * boundaries and yields `{event, data}` records. Strictly line-oriented per
 * RFC-ish SSE; we only care about `event:` and `data:` lines (the
 * orchestrator doesn't emit `id:` or `retry:`).
 *
 * Kept local rather than pulling in `eventsource-parser` — one producer, one
 * consumer, both under our control. A dependency is overkill.
 */
async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }, void, void> {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let event = "message";
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
          // Ignore comments (`:heartbeat`) and anything else.
        }
        if (dataLines.length > 0 || event !== "message") {
          yield { event, data: dataLines.join("\n") };
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
    // Flush tail — not expected from a well-formed stream but defensive.
    const tail = buffer.trim();
    if (tail.length > 0) {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of tail.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length > 0 || event !== "message") {
        yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Small id factory for AI SDK chunk ids. assistant-ui uses these to pair
 * `text-start` / `text-delta` / `text-end` events for a single streaming
 * text block. We scope one id per orchestrator turn by default (all text
 * parts in a turn collapse into one assistant text block) which matches
 * assistant-ui's rendering model.
 */
function makeTextId(): string {
  // crypto.randomUUID is widely supported in modern browsers; fall back to
  // Math.random for the unlikely miss (old Safari < 15.4).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `txt-${crypto.randomUUID()}`;
  }
  return `txt-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * Translate a single orchestrator `MessagePart` into zero-or-more AI SDK
 * `UIMessageChunk` events, writing to `controller`.
 *
 * Text parts are special-cased: AI SDK expects a `text-start` before any
 * `text-delta`, so we track whether the current text run has been opened via
 * the `textState` closure. Callers flush it with `closeTextRun()` when the
 * turn ends.
 *
 * Tool-call lifecycle mapping:
 *   input-streaming  → tool-input-start (first time) + optional tool-input-delta
 *   input-available  → tool-input-available (fires `start` synth if we haven't)
 *   output-available → tool-output-available (no extra synth needed; the
 *                      prior `input-available` already closed the input half)
 */
function translatePart(
  part: OrchestratorMessagePart,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  textState: { id: string | null },
  toolCallsSeen: Set<string>,
): void {
  switch (part.type) {
    case "text": {
      if (part.text.length === 0) return;
      if (textState.id === null) {
        textState.id = makeTextId();
        controller.enqueue({ type: "text-start", id: textState.id });
      }
      controller.enqueue({
        type: "text-delta",
        id: textState.id,
        delta: part.text,
      });
      return;
    }
    case "reasoning": {
      // Orchestrator strips reasoning on the wire (chunk B §2.4 invariant);
      // if one does arrive it's a translator bug. Log loudly and drop — the
      // dev-mode ReasoningGuard in `parts/reasoning-guard.tsx` catches any
      // that slip through on the renderer side too (defence in depth).
      // eslint-disable-next-line no-console
      console.error(
        "[orchestrator-adapter] reasoning part leaked onto the wire — translator bug (see chunk B §2.4 filterReasoning).",
        part,
      );
      return;
    }
    case "tool-call": {
      if (part.state === "input-streaming") {
        if (!toolCallsSeen.has(part.toolCallId)) {
          toolCallsSeen.add(part.toolCallId);
          controller.enqueue({
            type: "tool-input-start",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
          });
        }
        if (typeof part.inputFragment === "string" && part.inputFragment.length > 0) {
          controller.enqueue({
            type: "tool-input-delta",
            toolCallId: part.toolCallId,
            inputTextDelta: part.inputFragment,
          });
        }
        return;
      }
      if (part.state === "input-available") {
        if (!toolCallsSeen.has(part.toolCallId)) {
          // The orchestrator can elide the input-streaming phase entirely
          // for tools that only emit a complete call. AI SDK still expects a
          // `tool-input-start` before `tool-input-available`, so synthesise
          // one if we haven't seen this id yet.
          toolCallsSeen.add(part.toolCallId);
          controller.enqueue({
            type: "tool-input-start",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
          });
        }
        controller.enqueue({
          type: "tool-input-available",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        return;
      }
      // output-available
      controller.enqueue({
        type: "tool-output-available",
        toolCallId: part.toolCallId,
        output: part.output,
      });
      return;
    }
    case "data-fyi": {
      // `parts/index.ts` registers `data.by_name.fyi`, so the chunk type AI
      // SDK must emit is `data-fyi` with the payload on `.data`. Matches the
      // AI SDK v6 `DataUIMessageChunk` shape (see ai/dist: `type: `data-${NAME}``).
      controller.enqueue({
        type: "data-fyi",
        data: part.data,
      } as UIMessageChunk);
      return;
    }
    default: {
      // Unknown part type — log and ignore. Forward-compat: a new
      // orchestrator part shouldn't crash the client.
      // eslint-disable-next-line no-console
      console.warn("[orchestrator-adapter] unknown part type, ignoring:", part);
      return;
    }
  }
}

/**
 * Factory: builds the AI SDK transport that `useChatRuntime` feeds into the
 * assistant-ui runtime. Implements `ChatTransport` directly, bridging the
 * AI SDK's wire expectations to the orchestrator's canonical SSE format.
 *
 * By the time we're here, D.t4's consent handshake has already populated
 * `sessionStorage` with a session id the orchestrator will accept. If the id
 * is somehow missing (sessionStorage locked down, cleared between renders),
 * `sendMessages` throws — the thrown error propagates into AI SDK's
 * `onError` channel and D.t5 will render it.
 */
export function createOrchestratorTransport<
  TMessage extends UIMessage = UIMessage,
>(): ChatTransport<TMessage> {
  const baseUrl = getOrchestratorUrl();
  const endpoint = `${baseUrl}/chat`;

  return {
    async sendMessages({ messages, abortSignal, headers: extraHeaders, body: extraBody }) {
      const sessionId = readStoredSessionId();
      if (!sessionId) {
        // Should be impossible on a consented surface — the UI gates the
        // Thread behind `hasConsented`, which is only true once the session
        // id is written. Guard defensively; D.t5 surfaces a clean failure
        // mode via the [session_not_found] marker.
        const err = new Error(
          "Orchestrator /chat failed [session_not_found]: no session id in storage.",
        );
        emitAdapterError(err);
        throw err;
      }

      const latestUserMessage = extractLatestUserMessage(messages);
      if (latestUserMessage === null) {
        const err = new Error(
          "No user-text to send — transport was invoked without a non-empty user message.",
        );
        emitAdapterError(err);
        throw err;
      }

      // Intentionally do NOT attach `SESSION_HEADER` to `/chat`. The
      // orchestrator's chat handler reads `sessionId` from the JSON body
      // (chat.ts line ~72) and ignores any header. Adding one would trigger
      // a CORS preflight rejection — the orchestrator's CORS middleware
      // (server/index.ts `corsMiddleware`) only allows `Content-Type` and
      // `Accept` in Access-Control-Allow-Headers. The export is kept for
      // consumers that wire it manually (e.g. future authenticated routes).
      // (SESSION_HEADER referenced below to silence the unused-warning.)
      void SESSION_HEADER;
      void sessionId;

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      // `ChatRequestOptions.headers` may be a plain record or `Headers`.
      if (extraHeaders) {
        if (extraHeaders instanceof Headers) {
          extraHeaders.forEach((v, k) => {
            headers[k] = v;
          });
        } else {
          for (const [k, v] of Object.entries(extraHeaders)) {
            headers[k] = v;
          }
        }
      }

      const body = JSON.stringify({
        ...(extraBody ?? {}),
        sessionId,
        message: latestUserMessage,
      });

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          body,
          signal: abortSignal,
        });
      } catch (err) {
        // fetch rejects on DNS failure, connection refused, network down, etc.
        // Leave AbortError alone — that's user-initiated cancellation, not
        // something D.t5 should surface.
        if (err instanceof Error && err.name === "AbortError") throw err;
        emitAdapterError(err);
        throw err;
      }

      if (!response.ok || response.body === null) {
        // Surface the orchestrator's JSON error envelope
        // (`{error:{code,message}}` — see errors.ts `sendError`) in the
        // thrown message so AI SDK's onError sees something useful. Embed
        // a `[<code>]` marker D.t5's `classifyError` can detect without
        // parsing — `rate_limited` is inferred from status 429 when the body
        // omits a canonical code.
        let detail = `${response.status} ${response.statusText}`;
        let code: string | undefined;
        try {
          const errJson = (await response.json()) as
            | { error?: { code?: string; message?: string } }
            | undefined;
          if (errJson?.error?.code) code = errJson.error.code;
          if (errJson?.error?.message) detail = `${detail}: ${errJson.error.message}`;
        } catch {
          // No JSON body — fall through with the status line.
        }
        if (!code && response.status === 429) code = "rate_limited";
        if (!code && response.status === 404) code = "session_not_found";
        const marker = code ? ` [${code}]` : "";
        const err = new Error(`Orchestrator /chat failed${marker}: ${detail}`);
        emitAdapterError(err);
        throw err;
      }

      // Build a ReadableStream<UIMessageChunk> lazily. We emit a `start`
      // frame synchronously so assistant-ui can open the assistant message
      // before any parts arrive, then pull SSE events and translate.
      const sseStream = response.body;

      return new ReadableStream<UIMessageChunk>({
        async start(controller) {
          const textState: { id: string | null } = { id: null };
          const toolCallsSeen = new Set<string>();

          const closeTextRun = (): void => {
            if (textState.id !== null) {
              controller.enqueue({ type: "text-end", id: textState.id });
              textState.id = null;
            }
          };

          try {
            controller.enqueue({ type: "start" });
            controller.enqueue({ type: "start-step" });

            for await (const evt of parseSseStream(sseStream)) {
              if (evt.event === "done") {
                // Normal end-of-turn. Close any in-flight text run and fall
                // through to the `finish` frames below.
                break;
              }
              if (evt.event === "error") {
                // Mid-stream fault. Orchestrator payload shape:
                //   {message: string, code: string}
                // (see orchestrator/src/server/errors.ts `writeSseError`).
                let errText = "Orchestrator stream error.";
                let code: string | undefined;
                try {
                  const parsed = JSON.parse(evt.data) as {
                    message?: string;
                    code?: string;
                  };
                  if (parsed.message) errText = parsed.message;
                  if (parsed.code) code = parsed.code;
                } catch {
                  // Fall through with generic message.
                }
                // Prefix with `[stream]` so `classifyError` routes this to
                // `stream_drop`; keep any upstream `[<code>]` marker too so
                // a canonical code wins (e.g. session_not_found mid-stream
                // still routes to `session_expired`).
                const marker = code ? `[${code}] ` : "";
                errText = `[stream] ${marker}${errText}`;
                closeTextRun();
                controller.enqueue({ type: "error", errorText: errText });
                controller.enqueue({ type: "finish-step" });
                controller.enqueue({ type: "finish", finishReason: "error" });
                controller.close();
                emitAdapterError(new Error(errText));
                return;
              }
              // Default event type: a MessagePart.
              if (evt.data.length === 0) continue;
              let part: OrchestratorMessagePart;
              try {
                part = JSON.parse(evt.data) as OrchestratorMessagePart;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(
                  "[orchestrator-adapter] SSE data was not valid JSON, skipping:",
                  evt.data,
                  err,
                );
                continue;
              }
              translatePart(part, controller, textState, toolCallsSeen);
            }

            closeTextRun();
            controller.enqueue({ type: "finish-step" });
            controller.enqueue({ type: "finish", finishReason: "stop" });
            controller.close();
          } catch (err) {
            // AbortError: the user cancelled (or runtime tore down). Emit an
            // abort frame so assistant-ui can settle state cleanly.
            if (err instanceof Error && err.name === "AbortError") {
              closeTextRun();
              controller.enqueue({ type: "abort" });
              controller.close();
              return;
            }
            closeTextRun();
            // Reader/parse failures mid-stream — e.g. connection drop,
            // malformed frames — are `stream_drop` from the user's POV.
            const base = err instanceof Error ? err.message : String(err);
            const msg = base.startsWith("[stream]") ? base : `[stream] ${base}`;
            controller.enqueue({ type: "error", errorText: msg });
            emitAdapterError(new Error(msg));
            controller.error(err);
          }
        },
        cancel() {
          // User aborted or runtime released the stream — cancel the
          // upstream fetch body so we don't keep the socket open.
          void sseStream.cancel().catch(() => {
            // Already closed — not a real failure.
          });
        },
      });
    },

    async reconnectToStream() {
      // The orchestrator's `/chat` endpoint is request-scoped: each POST
      // opens a fresh SSE stream tied to that agent turn. There's no
      // persistent server-side stream to rejoin, so reconnection is a
      // no-op. Returning `null` tells AI SDK "no active stream to resume".
      return null;
    },
  };
}
