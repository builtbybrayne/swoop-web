// -----------------------------------------------------------------------------
// SSE frame parser — coverage for the canonical implementation lifted into
// `@swoop/common` per H5 (planning/03-exec-crosscut-shared-sse-parser-fix.md).
//
// Cases exercised:
//   - single-frame happy path with `data:` only
//   - multiple frames separated by `\n\n`
//   - multi-line `data:` joined with `\n`
//   - `event:` field present and absent
//   - `event: done` / `event: error` (parser does NOT special-case)
//   - mid-frame chunk boundary (the buffering edge case)
//   - empty / data-less frames (skip)
//   - SSE comment lines (`: heartbeat`) silently dropped
//   - UTF-8 multi-byte character split across chunk boundaries
// -----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { parseSseFrames, type SseFrame } from "../sse-parser.js";

const enc = new TextEncoder();

/** Build a `ReadableStream<Uint8Array>` that emits each provided string as
 *  a discrete chunk — lets us simulate network arrival boundaries. */
function streamOfChunks(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[i++];
      controller.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk);
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): Promise<SseFrame[]> {
  const out: SseFrame[] = [];
  for await (const f of parseSseFrames(stream)) out.push(f);
  return out;
}

describe("parseSseFrames", () => {
  it("parses a single-frame happy path with data only (event = null)", async () => {
    const frames = await collect(streamOfChunks(['data: {"type":"text","text":"hi"}\n\n']));
    expect(frames).toEqual([{ event: null, data: '{"type":"text","text":"hi"}' }]);
  });

  it("parses multiple frames separated by \\n\\n", async () => {
    const wire =
      'data: {"type":"text","text":"a"}\n\n' +
      'data: {"type":"text","text":"b"}\n\n' +
      "event: done\ndata: {}\n\n";
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([
      { event: null, data: '{"type":"text","text":"a"}' },
      { event: null, data: '{"type":"text","text":"b"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("joins multi-line `data:` with \\n", async () => {
    const wire = "data: line one\ndata: line two\ndata: line three\n\n";
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([{ event: null, data: "line one\nline two\nline three" }]);
  });

  it("handles `event:` present and absent", async () => {
    const wire =
      "event: custom\ndata: payload\n\n" +
      "data: bare\n\n";
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([
      { event: "custom", data: "payload" },
      { event: null, data: "bare" },
    ]);
  });

  it("does NOT special-case `event: done` or `event: error` (consumer concern)", async () => {
    const wire =
      "event: done\ndata: {}\n\n" +
      'event: error\ndata: {"code":"x"}\n\n';
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([
      { event: "done", data: "{}" },
      { event: "error", data: '{"code":"x"}' },
    ]);
  });

  it("buffers across mid-frame chunk boundaries", async () => {
    // The orchestrator can flush at arbitrary boundaries; the parser must
    // re-assemble across reads.
    const frames = await collect(
      streamOfChunks([
        'data: {"type":"te',
        'xt","text":"hel',
        'lo"}\n\n' + "data: ",
        '{"type":"text","text":"world"}\n\n',
      ]),
    );
    expect(frames).toEqual([
      { event: null, data: '{"type":"text","text":"hello"}' },
      { event: null, data: '{"type":"text","text":"world"}' },
    ]);
  });

  it("skips empty / payload-less frames silently", async () => {
    // Note: a frame consisting solely of `\n` between the boundary markers
    // produces an empty raw string after the split. parseFrameText returns
    // null for it.
    const wire = "\n\n" + "data: real\n\n";
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([{ event: null, data: "real" }]);
  });

  it("silently drops SSE comment lines (`: heartbeat`)", async () => {
    const wire =
      ": this is a comment\n\n" +
      ": heartbeat\ndata: real\n\n";
    const frames = await collect(streamOfChunks([wire]));
    // First frame is comments-only → null; second carries data.
    expect(frames).toEqual([{ event: null, data: "real" }]);
  });

  it("handles UTF-8 multi-byte characters split across chunks", async () => {
    // The € sign is 0xE2 0x82 0xAC in UTF-8. Split the bytes across two
    // chunks to exercise streaming TextDecoder behaviour.
    const allBytes = enc.encode("data: price €5\n\n");
    const cut = (() => {
      // Find the first byte of "€" (0xE2). Cut between 0xE2 and 0x82.
      for (let idx = 0; idx < allBytes.length; idx++) {
        if (allBytes[idx] === 0xe2) return idx + 1;
      }
      throw new Error("test setup: € byte not found");
    })();
    const a = allBytes.slice(0, cut);
    const b = allBytes.slice(cut);
    const frames = await collect(streamOfChunks([a, b]));
    expect(frames).toEqual([{ event: null, data: "price €5" }]);
  });

  it("preserves a leading single space being stripped (per SSE spec)", async () => {
    // `data: hello` carries a single leading space after the colon. The parser
    // strips exactly one space; further leading whitespace is preserved as-is.
    const wire = "data:  two-spaces-prefix\n\n";
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([{ event: null, data: " two-spaces-prefix" }]);
  });

  it("flushes a non-terminated trailing frame at end of stream", async () => {
    // Defensive: if the upstream closes mid-frame, surface what we have.
    const wire = "data: trailing"; // no \n\n
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([{ event: null, data: "trailing" }]);
  });

  it("accepts an AsyncIterable<Uint8Array> directly (no ReadableStream)", async () => {
    async function* source(): AsyncGenerator<Uint8Array> {
      yield enc.encode("data: from-async-iter\n\n");
    }
    const frames = await collect(source());
    expect(frames).toEqual([{ event: null, data: "from-async-iter" }]);
  });

  it("captures the SSE `id:` field when present", async () => {
    const wire = "id: abc\nevent: ping\ndata: hello\n\n";
    const frames = await collect(streamOfChunks([wire]));
    expect(frames).toEqual([{ event: "ping", data: "hello", id: "abc" }]);
  });
});
