/**
 * Tests for OrchestratorClient's per-event streaming integration.
 *
 * Coverage:
 *   - With no `observability` argument, sendMessage works as before; no sink
 *     interaction (backward compatibility).
 *   - With `observability`, each SSE frame the parser yields produces one
 *     `agent.sse.frame` event with raw `frameData` + parsed convenience
 *     fields where the frame is a recognizable part.
 *   - At stream end, `agent.response.aggregated` fires once with the
 *     accumulated utterText/toolCalls/structure + durationMs.
 *   - If the stream ends without an explicit `done` frame, the aggregated
 *     event carries `abortReason: "stream-ended-without-done"`.
 *   - If the SSE stream produces an `error` frame, the aggregated event
 *     carries `abortReason: "sse-error-frame: ..."` and the call throws.
 *   - On turn-timeout, the `timeout` event fires before the call throws.
 *
 * Mocking strategy:
 *   - `globalThis.fetch` stubbed per test.
 *   - SSE payloads constructed as Uint8Array streams via `buildSseStream`.
 *   - Sink collects emitted events into an in-memory array for assertion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  OrchestratorClient,
  type ObservabilityContext,
} from '../orchestrator-client.js';
import type { EventSink, HarnessEvent } from '../events.js';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

class MemorySink implements EventSink {
  readonly events: HarnessEvent[] = [];
  emit(event: HarnessEvent): void {
    this.events.push(event);
  }
}

function buildObservability(turnIndex = 1): ObservabilityContext & {
  sink: MemorySink;
} {
  return {
    sink: new MemorySink(),
    scenarioName: 'test-scenario',
    turnIndex,
  };
}

/**
 * Construct a `ReadableStream<Uint8Array>` that emits the given SSE-frame
 * strings sequentially. Each `frames` entry is treated as a complete frame
 * (parser handles its own delimiting).
 */
function buildSseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(enc.encode(frame));
      }
      controller.close();
    },
  });
}

function stubFetchOnce(body: ReadableStream<Uint8Array>): void {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function stubFetchNonOk(status: number, statusText: string): void {
  const response = new Response('boom', {
    status,
    statusText,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function stubFetchTimeout(): void {
  // fetch throws AbortError when controller.signal aborts. Simulate by
  // returning a never-resolving promise that respects the abort signal.
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        (err as Error & { name: string }).name = 'AbortError';
        reject(err);
      });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

// ---------------------------------------------------------------------------
// Backward compatibility — no observability, no sink interaction.
// ---------------------------------------------------------------------------

describe('OrchestratorClient sendMessage — without observability', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns AggregatedResponse without touching any sink', async () => {
    stubFetchOnce(
      buildSseStream([
        'data: {"type":"text","text":"hello"}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );
    const client = new OrchestratorClient({ baseUrl: 'http://localhost:9999' });
    const result = await client.sendMessage('sid-1', 'hi');
    expect(result.utterText).toBe('hello');
    expect(result.structure.utterPartCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// With observability — per-frame + aggregated emission.
// ---------------------------------------------------------------------------

describe('OrchestratorClient sendMessage — with observability', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits agent.sse.frame for each frame + agent.response.aggregated at end', async () => {
    stubFetchOnce(
      buildSseStream([
        'data: {"type":"text","text":"hello "}\n\n',
        'data: {"type":"text","text":"world"}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );
    const obs = buildObservability(2);
    const client = new OrchestratorClient({ baseUrl: 'http://localhost:9999' });
    await client.sendMessage('sid-1', 'hi', obs);

    const frameEvents = obs.sink.events.filter(
      (e) => e.kind === 'agent.sse.frame',
    );
    expect(frameEvents).toHaveLength(3); // 2 data + 1 done
    // Frame 1: text part.
    const f1 = frameEvents[0]!;
    if (f1.kind !== 'agent.sse.frame') throw new Error('unreachable');
    expect(f1.partType).toBe('text');
    expect(f1.text).toBe('hello ');
    expect(f1.turnIndex).toBe(2);
    // Frame 3: done.
    const f3 = frameEvents[2]!;
    if (f3.kind !== 'agent.sse.frame') throw new Error('unreachable');
    expect(f3.frameEvent).toBe('done');

    const aggregated = obs.sink.events.filter(
      (e) => e.kind === 'agent.response.aggregated',
    );
    expect(aggregated).toHaveLength(1);
    const a = aggregated[0]!;
    if (a.kind !== 'agent.response.aggregated') throw new Error('unreachable');
    expect(a.utterText).toBe('hello world');
    expect(a.structure.utterPartCount).toBe(2);
    expect(a.abortReason).toBeUndefined();
    expect(a.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures tool-call frames with toolName + toolInput convenience fields', async () => {
    stubFetchOnce(
      buildSseStream([
        'data: {"type":"tool-call","toolName":"find_options","input":{"region":"patagonia"}}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );
    const obs = buildObservability();
    const client = new OrchestratorClient({ baseUrl: 'http://localhost:9999' });
    await client.sendMessage('sid-1', 'find me options', obs);

    const frameEvents = obs.sink.events.filter(
      (e) => e.kind === 'agent.sse.frame',
    );
    expect(frameEvents).toHaveLength(2);
    const f1 = frameEvents[0]!;
    if (f1.kind !== 'agent.sse.frame') throw new Error('unreachable');
    expect(f1.partType).toBe('tool-call');
    expect(f1.toolName).toBe('find_options');
    expect(f1.toolInput).toEqual({ region: 'patagonia' });
  });

  it('aggregated event includes raw Anthropic-shaped fields for forensic inspection', async () => {
    stubFetchOnce(
      buildSseStream([
        'data: {"type":"text","text":"one"}\n\n',
        'data: {"type":"tool-call","toolName":"lookup","input":{"q":"x"}}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );
    const obs = buildObservability();
    const client = new OrchestratorClient({ baseUrl: 'http://localhost:9999' });
    await client.sendMessage('sid-1', 'hi', obs);

    const a = obs.sink.events.find((e) => e.kind === 'agent.response.aggregated');
    expect(a).toBeDefined();
    if (a?.kind !== 'agent.response.aggregated') throw new Error('unreachable');
    expect(a.toolCalls).toEqual([{ toolName: 'lookup', input: { q: 'x' } }]);
  });

  it('stream-ended-without-done sets abortReason on aggregated event', async () => {
    stubFetchOnce(
      buildSseStream([
        'data: {"type":"text","text":"truncated"}\n\n',
        // no `done` frame.
      ]),
    );
    const obs = buildObservability();
    const client = new OrchestratorClient({ baseUrl: 'http://localhost:9999' });
    await client.sendMessage('sid-1', 'hi', obs);

    const a = obs.sink.events.find((e) => e.kind === 'agent.response.aggregated');
    expect(a).toBeDefined();
    if (a?.kind !== 'agent.response.aggregated') throw new Error('unreachable');
    expect(a.abortReason).toBe('stream-ended-without-done');
    expect(a.utterText).toBe('truncated');
  });

  it('sse error frame sets abortReason + throws after aggregated emit', async () => {
    stubFetchOnce(
      buildSseStream([
        'data: {"type":"text","text":"partial"}\n\n',
        'event: error\ndata: connector blew up\n\n',
      ]),
    );
    const obs = buildObservability();
    const client = new OrchestratorClient({ baseUrl: 'http://localhost:9999' });
    await expect(client.sendMessage('sid-1', 'hi', obs)).rejects.toThrow(
      /SSE error frame/,
    );

    const a = obs.sink.events.find((e) => e.kind === 'agent.response.aggregated');
    expect(a).toBeDefined();
    if (a?.kind !== 'agent.response.aggregated') throw new Error('unreachable');
    expect(a.abortReason).toContain('sse-error-frame');
    expect(a.abortReason).toContain('connector blew up');
  });

  it('emits timeout event when fetch aborts on turn-timeout', async () => {
    stubFetchTimeout();
    const obs = buildObservability();
    const client = new OrchestratorClient({
      baseUrl: 'http://localhost:9999',
      turnTimeoutMs: 30, // tiny — triggers abort immediately
    });
    await expect(client.sendMessage('sid-1', 'hi', obs)).rejects.toThrow(
      /POST \/chat fetch failed/,
    );
    const t = obs.sink.events.find((e) => e.kind === 'timeout');
    expect(t).toBeDefined();
    if (t?.kind !== 'timeout') throw new Error('unreachable');
    expect(t.phase).toBe('turn-fetch');
    expect(t.timeoutMs).toBe(30);
  });
});
