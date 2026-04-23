/**
 * Puma orchestrator entry point — B.t5 vertical-slice composition.
 *
 * Responsibilities:
 *   1. Load .env + validate the config surface (fail-fast).
 *   2. Build the system-prompt loader.
 *   3. Connect to the MCP connector and wrap its tools for the LlmAgent.
 *   4. Instantiate the ADK LlmAgent against the Claude model shim.
 *   5. Build the session store (B.t2) using explicit config — no env reads
 *      outside ./config.
 *   6. Build an `InMemoryRunner` so /chat can drive agent turns end-to-end.
 *   7. Compose the HTTP surface (B.t5) and listen on `config.PORT`.
 *
 * Not here yet:
 *   - Warm session pool (B.t10).
 *   - Observability backbone (chunk F).
 *
 * B.t7 adds:
 *   - Layer-2 functional triage classifier (`buildTriageClassifier`) running
 *     on FUNCTIONAL_CLASSIFIER_MODEL, distinct from ORCHESTRATOR_MODEL.
 *
 * See planning/03-exec-agent-runtime-t5.md and planning/03-exec-agent-runtime-t7.md.
 */

import { config as loadDotenv } from 'dotenv';
// Override existing env vars — the host shell may have empty / placeholder values
// (e.g. Claude Code injects an empty ANTHROPIC_API_KEY) that should be replaced
// by what the package's own .env declares.
loadDotenv({ override: true });

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { InMemoryRunner } from '@google/adk';

import { loadConfig } from './config/index.js';
import { createPromptLoader } from './agent/prompt-loader.js';
import { buildOrchestratorAgent } from './agent/factory.js';
import { setupConnector } from './connector/index.js';
import { createSessionStore } from './session/index.js';
import { buildServer } from './server/index.js';
import { buildTriageClassifier } from './functional-agents/triage-classifier.js';

const ORCHESTRATOR_APP_NAME = 'puma-orchestrator';
const ANONYMOUS_USER_ID = 'anonymous';

function readPackageVersion(packageRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const promptLoader = createPromptLoader(config.systemPromptAbsolutePath, config.isProduction);
  // Touch the loader once now so a missing/unreadable file fails at startup,
  // not on the first user turn.
  const initialPrompt = promptLoader.load();

  const connector = await setupConnector(config);

  const agent = buildOrchestratorAgent({ config, promptLoader, tools: connector.tools });

  // Layer-2 functional agent (B.t7). Separate ADK LlmAgent running on a
  // different (cheaper) model — getModelFor(config, 'classifier') resolves
  // to FUNCTIONAL_CLASSIFIER_MODEL (Haiku by default). Proves the
  // two-layer agent model end-to-end. Placeholder pending G.t0 HITL
  // flow-mapping.
  const triageClassifier = buildTriageClassifier({ config });

  // Session store — explicit backend + TTL wiring (per B.t5 Tier 3 cross-task
  // cleanup: the env read in src/session/index.ts was removed, every caller
  // now passes these values from config/).
  const sessionStore = createSessionStore({
    backend: config.SESSION_BACKEND,
    idleTtlMs: config.SESSION_TTL_IDLE_HOURS * 3_600_000,
    archiveTtlMs: config.SESSION_TTL_ARCHIVE_DAYS * 86_400_000,
  });

  // InMemoryRunner owns its own ADK session service. /chat uses `runAsync`
  // which expects an ADK session keyed by (appName, userId, sessionId); we
  // pre-create one in `onSessionCreated` after every `POST /session` so
  // turns can flow without a per-turn session-creation round trip.
  const runner = new InMemoryRunner({ agent, appName: ORCHESTRATOR_APP_NAME });

  const version = readPackageVersion(config.packageRoot);

  const app = buildServer({
    sessionStore,
    runner,
    corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
    version,
    userId: ANONYMOUS_USER_ID,
    triageClassifier,
    onSessionCreated: async (sessionId) => {
      await runner.sessionService.createSession({
        appName: ORCHESTRATOR_APP_NAME,
        userId: ANONYMOUS_USER_ID,
        sessionId,
        state: {},
      });
    },
  });

  const server = app.listen(config.PORT, () => {
    console.log(`[orchestrator] ready on http://localhost:${config.PORT}`);
    console.log(`[orchestrator] system prompt loaded from ${promptLoader.path} (${initialPrompt.length} chars)`);
    console.log(`[orchestrator] model: ${config.ORCHESTRATOR_MODEL}`);
    console.log(`[orchestrator] triage classifier model: ${triageClassifier.modelId}`);
    console.log(`[orchestrator] connector: ${connector.client.url}`);
    console.log(
      `[orchestrator] connector tools discovered: [${connector.discoveredNames.join(', ')}] ` +
        `(${connector.tools.length} exposed to model)`,
    );
    console.log(`[orchestrator] agent: ${agent.name} (tools: ${agent.tools.length})`);
    console.log(`[orchestrator] session backend: ${config.SESSION_BACKEND}`);
    console.log(`[orchestrator] cors allowed origins: [${config.CORS_ALLOWED_ORIGINS.join(', ')}]`);
    console.log(`[orchestrator] env: ${config.NODE_ENV} (prompt hot-reload: ${config.isProduction ? 'off' : 'on'})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[orchestrator] ${signal} received, shutting down.`);
    connector.client.close().catch((err) => {
      console.warn('[orchestrator] connector close failed during shutdown:', err);
    });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[orchestrator] fatal startup error:', err);
  process.exit(1);
});
