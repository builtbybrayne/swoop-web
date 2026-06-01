/**
 * Tests for the connector's MCP-over-HTTP surface (post-C.t4).
 *
 * Boots the Express app via supertest, drives an MCP client over the SDK's
 * `StreamableHTTPClientTransport`, and verifies the nine intent-named tools
 * are advertised + that the no-op `ping` tool is gone (per C.t4 ratification;
 * find_tips joined at the customer-tips chunk).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { buildApp } from '../app.js';
import { ALL_TOOL_NAMES, type ToolDescriptions } from '../../tools/index.js';
import type { EmbedQueryFn } from '../../data/embed-query.js';

/** Throw-on-touch pool — most tests don't hit /readyz or any tool body. */
function makeThrowingPool(): pg.Pool {
  return new Proxy({} as pg.Pool, {
    get() {
      throw new Error('test bug: pool unexpectedly accessed');
    },
  });
}

/** Fixed-vector embedQuery for tests — never calls Gemini. */
const stubEmbedQuery: EmbedQueryFn = async () => new Array(3072).fill(0);

/** Synthetic descriptions covering all nine tools. */
function makeStubDescriptions(): ToolDescriptions {
  const out: Record<string, string> = {};
  for (const name of ALL_TOOL_NAMES) {
    out[name] = `Stub description for ${name} (test fixture).`;
  }
  return Object.freeze(out as Record<(typeof ALL_TOOL_NAMES)[number], string>);
}

let server: Server | undefined;
let baseUrl: string | undefined;

beforeEach(async () => {
  const app = buildApp({
    pool: makeThrowingPool(),
    embedQuery: stubEmbedQuery,
    descriptions: makeStubDescriptions(),
    readinessHandler: (_req, res) => {
      res.json({ status: 'ready', db: 'ok' });
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
    baseUrl = undefined;
  }
});

async function withMcpClient<T>(fn: (client: McpClient) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl!}/mcp`));
  const client = new McpClient({ name: 'test-client', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

describe('MCP /mcp endpoint', () => {
  it('lists exactly the nine intent-named tools (no ping)', async () => {
    const tools = await withMcpClient(async (client) => client.listTools());
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([...ALL_TOOL_NAMES].sort());
    expect(names).not.toContain('ping');
    expect(tools.tools).toHaveLength(9);
  });

  it('each tool advertises its loaded description', async () => {
    const tools = await withMcpClient(async (client) => client.listTools());
    for (const t of tools.tools) {
      expect(t.description).toMatch(/Stub description for/);
    }
  });

  it('handoff tool returns widget_triggered + uuid widgetToken', async () => {
    const result = await withMcpClient(async (client) =>
      client.callTool({
        name: 'handoff',
        arguments: {
          verdict: 'qualified',
          // Per VERDICT-E.t1 (2026-05-13): reasonCode is constrained to the
          // QualifiedReasonCodeSchema enum on the qualified variant. The
          // pre-tightening test used a free-form placeholder which the
          // discriminated union now rejects.
          reasonCode: 'ready_booking_named_trip',
          specialistSummary: 'Visitor wants W trek in March',
          motivationAnchor: 'autumn light in Patagonia',
        },
      }),
    );
    const structured = (result.structuredContent ?? {}) as {
      status?: string;
      widgetToken?: string;
    };
    expect(structured.status).toBe('widget_triggered');
    expect(typeof structured.widgetToken).toBe('string');
    expect(structured.widgetToken!.length).toBeGreaterThan(0);
  });

  it('rejects /mcp requests without an active session', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/no active session/i);
  });
});
