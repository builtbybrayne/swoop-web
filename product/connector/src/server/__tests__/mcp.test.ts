/**
 * Tests for the connector's MCP-over-HTTP surface.
 *
 * Boots the Express app via supertest, drives an MCP client over the
 * SDK's `StreamableHTTPClientTransport`, and verifies:
 *   - `tools/list` returns exactly the no-op `ping` tool (the C.t1 surface).
 *   - Calling `ping` returns the expected `{ ok, version }` payload.
 *
 * We use a real MCP client (not raw JSON-RPC) so the test doubles as a
 * smoke check on the transport contract — anything that breaks the round-
 * trip (incorrect content-type, missing session header, etc.) surfaces here.
 *
 * Verifies HITL Q4 ratification: HTTP MCP surface stands up NOW with a
 * no-op ping tool that responds with `{ok: true, version: <pkg version>}`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { buildApp } from '../app.js';

/** Throw-on-touch pool — these tests never hit /readyz. */
function makeThrowingPool(): pg.Pool {
  return new Proxy({} as pg.Pool, {
    get() {
      throw new Error('test bug: pool unexpectedly accessed');
    },
  });
}

let server: Server | undefined;
let baseUrl: string | undefined;

beforeEach(async () => {
  const app = buildApp({
    pool: makeThrowingPool(),
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
  it('lists exactly the ping tool', async () => {
    const tools = await withMcpClient(async (client) => client.listTools());
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]?.name).toBe('ping');
    // Description carries the C.t1 / C.t4 lineage so future agents reading
    // `mcp inspect` know this tool is throwaway.
    expect(tools.tools[0]?.description).toMatch(/C\.t1|C\.t4|no-op/i);
  });

  it('ping tool returns ok: true with a version string', async () => {
    const result = await withMcpClient(async (client) =>
      client.callTool({ name: 'ping', arguments: {} }),
    );
    // Verify via the structured-content channel — that's the load-bearing
    // signal Sonnet would consume in production.
    const structured = (result.structuredContent ?? {}) as { ok?: boolean; version?: string };
    expect(structured.ok).toBe(true);
    expect(typeof structured.version).toBe('string');
    expect(structured.version!.length).toBeGreaterThan(0);
  });

  it('rejects /mcp requests without an active session', async () => {
    // Hit /mcp directly with a non-initialize body — should 400.
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
