/**
 * Connector service entrypoint — boots Express + the MCP-over-HTTP surface
 * + the Postgres pool + health endpoints, then listens on
 * `config.CONNECTOR_PORT`.
 *
 * Implements C.t1 per planning/03-exec-c-t1.md. Surface today:
 *   - GET /healthz    — liveness, no DB call
 *   - GET /readyz     — readiness, runs SELECT 1 against the pool
 *   - ALL /mcp        — MCP-over-HTTP with one no-op `ping` tool
 *
 * The eight intent-named tools register in C.t4. Until then, the
 * orchestrator continues to talk to the stub at :3001; this service
 * boots independently on :3002 (configurable via CONNECTOR_PORT).
 *
 * SIGTERM / SIGINT close the pool, then the HTTP server. 5s grace
 * window before a hard exit.
 */

import { config as loadDotenv } from 'dotenv';
// Override pre-set env vars (e.g. an empty DATABASE_URL injected by the
// host shell) — same fix the orchestrator uses for ANTHROPIC_API_KEY,
// per gotchas.md.
loadDotenv({ override: true });

import { loadConfig } from '../config/index.js';
import { getPool, closePool } from '../data/pool.js';
import { buildEmbedQuery } from '../data/embed-query.js';
import { loadAllToolDescriptions, ALL_TOOL_NAMES } from '../tools/index.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Open the pool eagerly so a misconfigured DATABASE_URL surfaces at
  // boot, not on the first /readyz probe.
  const pool = getPool(config);

  // Load all eight tool descriptions at boot — fail-fast on any missing /
  // empty file (per HITL Q3 ratification: ALL 8, not just the 5
  // conversational; development-time visibility).
  const descriptions = loadAllToolDescriptions(config.toolsPromptDirAbsolutePath);
  const embedQuery = buildEmbedQuery(config);

  const app = buildApp({ pool, embedQuery, descriptions, capturedAt: config.PRICES_CAPTURED_AT });

  const server = app.listen(config.CONNECTOR_PORT, () => {
    console.log(`[connector] ready on http://localhost:${config.CONNECTOR_PORT}`);
    console.log(`[connector] MCP endpoint: http://localhost:${config.CONNECTOR_PORT}/mcp`);
    console.log(`[connector] health: /healthz (liveness) + /readyz (readiness)`);
    console.log(
      `[connector] pool: max=${config.PG_POOL_MAX} idle=${config.PG_POOL_IDLE_MS}ms ` +
        `statement_timeout=${config.PG_STATEMENT_TIMEOUT_MS}ms`,
    );
    console.log(`[connector] tools: ${ALL_TOOL_NAMES.join(', ')}`);
    console.log(
      `[connector] descriptions loaded from: ${config.toolsPromptDirAbsolutePath}`,
    );
    console.log(`[connector] env: ${config.NODE_ENV}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`[connector] ${signal} received, shutting down.`);
    server.close(() => {
      closePool()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error('[connector] error closing pool:', err);
          process.exit(1);
        });
    });
    setTimeout(() => {
      console.error('[connector] graceful shutdown timed out — forcing exit.');
      process.exit(1);
    }, 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[connector] fatal startup error:', err);
  process.exit(1);
});
