/**
 * Stub MCP connector — FIXTURE ONLY. NOT SHIPPED.
 *
 * Lives under `test-fixtures/` so it stays well clear of `src/` and the tsc
 * build output. It exists to unblock B.t3 before chunk C's real connector
 * lands (planning/03-exec-agent-runtime-t3.md §"Handoff notes").
 *
 * What it does:
 *   - Boots an Express server on port 3001 (override via STUB_PORT).
 *   - Accepts POST /mcp and speaks MCP-over-HTTP via
 *     `@modelcontextprotocol/sdk/server/streamableHttp.js`.
 *   - Registers the five Puma tool names with their `@swoop/common` input
 *     schemas and returns hand-crafted, schema-valid responses built from
 *     the fixtures under `@swoop/common/fixtures`.
 *
 * What it does NOT do:
 *   - Hit real data.
 *   - Implement the full connector surface (caching, scoring, pagination).
 *   - Ship to production. `npm run build` ignores `test-fixtures/` via
 *     `tsconfig.json#include`.
 *
 * Run it:
 *   npm run dev:stub-connector            # tsx watch
 *   tsx test-fixtures/stub-connector.ts   # one-off
 */

import 'dotenv/config';

import express from 'express';
import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  GetDetailInputSchema,
  HandoffInputSchema,
  HandoffSubmitInputSchema,
  IllustrateInputSchema,
  SearchInputSchema,
  TOOL_DESCRIPTIONS,
} from '@swoop/common';
import {
  SampleHandoff,
  SampleImage,
  SampleRegion,
  SampleStory,
  SampleTour,
  SampleTrip,
} from '@swoop/common/fixtures';

const PORT = Number.parseInt(process.env.STUB_PORT ?? '3001', 10);

// ---------------------------------------------------------------------------
// Fixture responses. Hand-crafted to satisfy the Zod OutputSchemas from
// @swoop/common so the orchestrator's post-call validation passes cleanly.
// ---------------------------------------------------------------------------

const searchFixture = {
  hits: [
    {
      entityType: 'trip' as const,
      id: SampleTrip.id,
      slug: SampleTrip.slug,
      title: SampleTrip.title,
      summary: SampleTrip.summary,
      score: 0.92,
    },
    {
      entityType: 'tour' as const,
      id: SampleTour.id,
      slug: SampleTour.slug,
      title: SampleTour.title,
      summary: SampleTour.summary,
      score: 0.81,
    },
  ],
  totalMatches: 2,
};

function detailFixtureFor(entityType: 'trip' | 'tour' | 'region' | 'story', slug: string) {
  const record =
    entityType === 'trip'
      ? SampleTrip
      : entityType === 'tour'
        ? SampleTour
        : entityType === 'region'
          ? SampleRegion
          : SampleStory;
  return {
    entityType,
    record: {
      ...(record as Record<string, unknown>),
      // Echo the requested slug so tests can round-trip input → output.
      slug,
    },
  };
}

const illustrateFixture = {
  images: [
    {
      id: SampleImage.id,
      url: SampleImage.url,
      altText: SampleImage.altText,
      caption: SampleImage.summary,
    },
  ],
};

const handoffFixture = {
  status: 'widget_triggered' as const,
  widgetToken: `widget_${SampleHandoff.handoffId}`,
};

const handoffSubmitFixture = {
  status: 'accepted' as const,
  handoffId: SampleHandoff.handoffId,
};

// ---------------------------------------------------------------------------
// MCP server registration.
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: 'puma-stub-connector',
    version: '0.0.1',
  });

  server.registerTool(
    'search',
    {
      description: TOOL_DESCRIPTIONS.search,
      inputSchema: SearchInputSchema.shape,
    },
    async (_args) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(searchFixture),
        },
      ],
      structuredContent: searchFixture,
    }),
  );

  server.registerTool(
    'get_detail',
    {
      description: TOOL_DESCRIPTIONS.get_detail,
      inputSchema: GetDetailInputSchema.shape,
    },
    async ({ entityType, slug }) => {
      const payload = detailFixtureFor(entityType, slug);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    'illustrate',
    {
      description: TOOL_DESCRIPTIONS.illustrate,
      inputSchema: IllustrateInputSchema.shape,
    },
    async (_args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(illustrateFixture) }],
      structuredContent: illustrateFixture,
    }),
  );

  server.registerTool(
    'handoff',
    {
      description: TOOL_DESCRIPTIONS.handoff,
      inputSchema: HandoffInputSchema.shape,
    },
    async (_args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(handoffFixture) }],
      structuredContent: handoffFixture,
    }),
  );

  server.registerTool(
    'handoff_submit',
    {
      description: TOOL_DESCRIPTIONS.handoff_submit,
      inputSchema: HandoffSubmitInputSchema.shape,
    },
    async (_args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(handoffSubmitFixture) }],
      structuredContent: handoffSubmitFixture,
    }),
  );

  return server;
}

// ---------------------------------------------------------------------------
// Express wiring. Stateful MCP-over-HTTP: we keep a transport per session id
// so the client's `initialize` → tool call round-trip sees the same server
// state across requests. The MCP SDK's StreamableHTTPServerTransport manages
// its own internal routing; we just give it a place to live across calls.
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'stub-connector' });
});

const transports = new Map<string, StreamableHTTPServerTransport>();

app.all('/mcp', async (req, res) => {
  const sessionHeader = req.header('mcp-session-id');
  let transport: StreamableHTTPServerTransport | undefined = sessionHeader
    ? transports.get(sessionHeader)
    : undefined;

  if (!transport && req.method === 'POST' && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    };
    const server = createServer();
    await server.connect(transport);
  }

  if (!transport) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: no active session' },
      id: null,
    });
    return;
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[stub-connector] request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'stub-connector internal error' });
    }
  }
});

function isInitializeRequest(body: unknown): boolean {
  if (body && typeof body === 'object') {
    if (Array.isArray(body)) return body.some(isInitializeRequest);
    return (body as { method?: unknown }).method === 'initialize';
  }
  return false;
}

app.listen(PORT, () => {
  console.log(`[stub-connector] listening on http://localhost:${PORT}`);
  console.log(`[stub-connector] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log('[stub-connector] tools: search, get_detail, illustrate, handoff, handoff_submit');
  console.log('[stub-connector] fixtures only — not for production use');
});
