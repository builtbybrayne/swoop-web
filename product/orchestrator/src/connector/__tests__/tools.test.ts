/**
 * Unit tests for the B.t3 connector adapter.
 *
 * Scope (planning/03-exec-agent-runtime-t3.md §"Tests"):
 *   - Input validation rejects malformed args with a structured error.
 *   - Output validation rejects malformed responses with a structured error.
 *   - Retry wrapper retries on 5xx / transport errors and does NOT retry on
 *     4xx or Zod validation errors.
 *
 * We mock the ConnectorClient — nothing hits the network. The live end-to-end
 * round-trip is covered by B.t7's integration test, which runs the stub
 * connector under test-fixtures/ alongside the orchestrator.
 */

import { describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';

import type { CallToolRawResult, ConnectorClient } from '../client.js';
import { isRetryableError, withRetry } from '../retry.js';
import { __testing } from '../tools.js';

const { TOOL_SPECS, invokeTool } = __testing;

function specFor(name: string) {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`test setup: unknown tool spec "${name}"`);
  return spec;
}

function stubClient(overrides: Partial<ConnectorClient> = {}): ConnectorClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockRejectedValue(new Error('callTool not stubbed')),
    close: vi.fn().mockResolvedValue(undefined),
    url: 'http://stub/mcp',
    ...overrides,
  };
}

describe('invokeTool — input validation', () => {
  it('returns an input_validation error when required args are missing', async () => {
    const client = stubClient();
    // `search` requires `query`; pass nothing.
    const result = await invokeTool(client, specFor('search'), {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('input_validation');
    expect(result.error.toolName).toBe('search');
    // Zod issues are surfaced so the agent / logs can see WHY it rejected.
    expect(Array.isArray(result.error.details)).toBe(true);
    // Critically: the connector was never hit.
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('returns an input_validation error when entityTypes contains an unknown value', async () => {
    const client = stubClient();
    const result = await invokeTool(client, specFor('search'), {
      query: 'torres del paine',
      entityTypes: ['trip', 'totally-not-a-type'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('input_validation');
    expect(client.callTool).not.toHaveBeenCalled();
  });
});

describe('invokeTool — output validation', () => {
  it('returns an output_validation error when the connector omits required fields', async () => {
    const client = stubClient({
      callTool: vi.fn().mockResolvedValue({
        // Missing `totalMatches` and `hits[].score` — should fail parse.
        structuredContent: { hits: [{ entityType: 'trip', id: 'x', slug: 'x', title: 't', summary: 's' }] },
      } satisfies CallToolRawResult),
    });

    const result = await invokeTool(client, specFor('search'), { query: 'w trek' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('output_validation');
    expect(result.error.toolName).toBe('search');
    expect(Array.isArray(result.error.details)).toBe(true);
  });

  it('accepts a valid structuredContent payload and returns it parsed', async () => {
    const payload = {
      hits: [
        {
          entityType: 'trip',
          id: 't_1',
          slug: 'w-trek',
          title: 'W Trek',
          summary: 'Five days on the W.',
          score: 0.9,
        },
      ],
      totalMatches: 1,
    };
    const client = stubClient({
      callTool: vi.fn().mockResolvedValue({ structuredContent: payload } satisfies CallToolRawResult),
    });

    const result = await invokeTool(client, specFor('search'), { query: 'w trek' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(payload);
  });

  it('falls back to parsing a text content block when structuredContent is absent', async () => {
    const payload = { hits: [], totalMatches: 0 };
    const client = stubClient({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      } satisfies CallToolRawResult),
    });

    const result = await invokeTool(client, specFor('search'), { query: 'nothing' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(payload);
  });
});

describe('invokeTool — connector-level errors', () => {
  it('returns a connector_error when the MCP result has isError: true', async () => {
    const client = stubClient({
      callTool: vi.fn().mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'catalogue unavailable' }],
      } satisfies CallToolRawResult),
    });

    const result = await invokeTool(client, specFor('search'), { query: 'w trek' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('connector_error');
    expect(result.error.message).toBe('catalogue unavailable');
  });

  it('returns a transport_error when callTool throws', async () => {
    const client = stubClient({
      callTool: vi.fn().mockRejectedValue(new Error('socket hang up')),
    });

    const result = await invokeTool(client, specFor('search'), { query: 'w trek' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('transport_error');
    expect(result.error.message).toContain('socket hang up');
  });
});

describe('withRetry + isRetryableError', () => {
  const synchronousSleep = () => Promise.resolve();
  const zeroJitter = () => 0;

  it('retries on 5xx responses up to the configured limit then throws', async () => {
    const err500 = Object.assign(new Error('bad gateway'), { status: 502 });
    const fn = vi.fn().mockRejectedValue(err500);

    await expect(
      withRetry(fn, { retries: 3, sleep: synchronousSleep, random: zeroJitter }),
    ).rejects.toBe(err500);
    // 1 initial attempt + 3 retries = 4 calls.
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('retries on network errors (ECONNREFUSED surfaced via error.cause.code)', async () => {
    const netErr = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(netErr)
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce('ok');

    const out = await withRetry(fn, { retries: 3, sleep: synchronousSleep, random: zeroJitter });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry 4xx responses', async () => {
    const err400 = Object.assign(new Error('bad request'), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err400);

    await expect(
      withRetry(fn, { retries: 3, sleep: synchronousSleep, random: zeroJitter }),
    ).rejects.toBe(err400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry Zod validation errors', async () => {
    // Use an actual ZodError so the `err.name === "ZodError"` check fires.
    let zodErr: ZodError | undefined;
    try {
      z.object({ query: z.string() }).parse({});
    } catch (err) {
      zodErr = err as ZodError;
    }
    if (!zodErr) throw new Error('test setup: expected Zod parse to throw');

    const fn = vi.fn().mockRejectedValue(zodErr);

    await expect(
      withRetry(fn, { retries: 3, sleep: synchronousSleep, random: zeroJitter }),
    ).rejects.toBe(zodErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry AbortError (timeout)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fn = vi.fn().mockRejectedValue(abortErr);

    await expect(
      withRetry(fn, { retries: 3, sleep: synchronousSleep, random: zeroJitter }),
    ).rejects.toBe(abortErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isRetryableError returns false for non-Errors and opaque objects', () => {
    expect(isRetryableError('boom')).toBe(false);
    expect(isRetryableError({})).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});
