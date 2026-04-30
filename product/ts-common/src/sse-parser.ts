// -----------------------------------------------------------------------------
// SSE frame parser — canonical implementation for the Puma orchestrator wire
// format.
//
// Origin: code-review 2026-04-30 H5 (planning/03-exec-crosscut-shared-sse-parser-fix.md).
// Two near-identical parsers had drifted apart between
//   - `@swoop/harness/src/orchestrator-client.ts` (`parseSseFrame` +
//     `consumeSseStream`)
//   - `@swoop/ui/src/runtime/orchestrator-adapter.ts` (`parseSseStream`)
// Both lifted into this single canonical implementation.
//
// Wire format produced by `orchestrator/server/chat.ts:writeSsePart`:
//   `data: <MessagePart-json>\n\n`            for each emitted part
//   `event: done\ndata: {}\n\n`               at clean turn end
//   `event: error\ndata: {...}\n\n`           on mid-stream fault
//
// Parser policy (matches the SSE spec narrowly enough for our usage):
//   - Frames are terminated by `\n\n`. Bytes are buffered across chunk reads
//     so multi-byte UTF-8 sequences split across chunks are handled by the
//     stream-mode `TextDecoder`.
//   - Inside each frame, lines are split on `\n`. Lines starting with `:`
//     are SSE comments and silently dropped.
//   - `event: <name>` sets the frame's event field (trimmed once on the
//     leading single space per SSE convention).
//   - `data: <value>` lines accumulate; multiple data lines join with `\n`
//     (matches the SSE spec — text after `data:` keeps its leading single
//     space stripped, no other whitespace is altered).
//   - Frames carrying neither an event nor any data are skipped.
//   - `event: done` and `event: error` are NOT special-cased here. Consumers
//     handle terminal/event semantics in their own loop body.
// -----------------------------------------------------------------------------

export interface SseFrame {
  /** Event name from `event:` line, or `null` when the frame had no event
   *  field (caller decides default — typically `'message'`). */
  readonly event: string | null;
  /** Concatenated `data:` payload, multi-line lines joined with `\n`. */
  readonly data: string;
  /** Optional SSE `id:` field — not currently emitted by the orchestrator
   *  but parsed defensively for forward compatibility. */
  readonly id?: string;
}

/**
 * Strip a single leading space if present after the field name colon. SSE
 * spec §9.2.6: when a field has a value, if the first character is a U+0020
 * SPACE it is removed.
 */
function stripLeadingSpace(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}

/**
 * Parse one SSE frame's textual content (everything between two `\n\n`
 * boundaries) into a structured `SseFrame`. Returns `null` for frames that
 * carry no useful payload (no event field, no data lines, or comments only).
 */
function parseFrameText(raw: string): SseFrame | null {
  let event: string | null = null;
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith(":")) {
      // SSE comment — silently dropped.
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      // SSE spec: a line with no colon is treated as the field name with an
      // empty value. The orchestrator never emits this; ignore.
      continue;
    }
    const field = line.slice(0, colon);
    const value = stripLeadingSpace(line.slice(colon + 1));
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        id = value;
        break;
      // `retry:` and unknown fields are ignored.
      default:
        break;
    }
  }

  if (event === null && dataLines.length === 0 && id === undefined) {
    return null;
  }
  const frame: SseFrame = {
    event,
    data: dataLines.join("\n"),
    ...(id === undefined ? {} : { id }),
  };
  return frame;
}

/**
 * Parse an SSE byte stream into a sequence of `SseFrame`s. Accepts either a
 * `ReadableStream<Uint8Array>` (browser/Node fetch body shape) or any
 * `AsyncIterable<Uint8Array>` (e.g. test fixtures, custom transports).
 *
 * Buffering behaviour:
 *   - Bytes are decoded with `TextDecoder('utf-8', stream: true)`, which
 *     handles multi-byte characters split across chunk boundaries.
 *   - The buffer is split on `\n\n`; whatever remains after the last
 *     boundary is held over for the next read.
 *   - On stream close, any non-empty tail (lacking a terminal `\n\n`) is
 *     decoded one last time and parsed as a final frame. Well-formed SSE
 *     streams shouldn't hit this path; defensive against early close.
 */
export async function* parseSseFrames(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<SseFrame, void, unknown> {
  const decoder = new TextDecoder("utf-8");
  const iterable = toAsyncIterable(stream);
  let buffer = "";

  try {
    for await (const chunk of iterable) {
      buffer += decoder.decode(chunk, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrameText(raw);
        if (frame !== null) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }
    // Flush decoder + any trailing partial frame.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const frame = parseFrameText(buffer);
      if (frame !== null) yield frame;
    }
  } finally {
    // Best-effort lock release for ReadableStream callers — no-op for plain
    // async iterables. We don't want to swallow a `ReadableStream` reader
    // that the caller still owns (we created our own via getReader inside
    // toAsyncIterable when given a stream), so the iterable cleanup happens
    // in toAsyncIterable's `return` handler instead.
  }
}

/**
 * Bridge a `ReadableStream<Uint8Array>` to an async iterable. Pass-through
 * when the input is already an `AsyncIterable`.
 *
 * For the `ReadableStream` path we acquire a reader, yield Uint8Array chunks
 * until exhausted, and release the lock on cleanup (including early
 * generator return / throw).
 */
function toAsyncIterable(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (typeof (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function") {
    return source as AsyncIterable<Uint8Array>;
  }
  const stream = source as ReadableStream<Uint8Array>;
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const reader = stream.getReader();
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          const { value, done } = await reader.read();
          if (done) return { value: undefined, done: true };
          return { value, done: false };
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          try {
            reader.releaseLock();
          } catch {
            // already released — ignore
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}
