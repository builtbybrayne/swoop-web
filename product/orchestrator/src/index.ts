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
import { emitErrorRaised, messageOf } from '@swoop/common';
import {
  FsHandoffStore,
  loadAllToolDescriptions,
  sweepHandoffs,
  type MailerConfig,
} from '@swoop/connector';

import { loadConfig } from './config/index.js';
import { createPromptLoader } from './agent/prompt-loader.js';
import { buildOrchestratorAgent } from './agent/factory.js';
import { setupConnector } from './connector/index.js';
import { createSessionStore, startWarmPool } from './session/index.js';
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

  const promptLoader = createPromptLoader(config.systemPromptDirAbsolutePath, config.isProduction);
  // Touch the loader once now so a missing/unreadable file fails at startup,
  // not on the first user turn.
  const initialPrompt = promptLoader.load();

  // Load every tool's description.md eagerly per HITL Q3 ratification (C.t4):
  // fail-fast if any of the eight is missing/empty. Same contract on both
  // sides of the wire — the connector loads its own copy at boot, the
  // orchestrator's adapter consumes the same files for its FunctionTool
  // registrations.
  const toolDescriptions = loadAllToolDescriptions(config.toolsPromptDirAbsolutePath);

  // Session store created BEFORE setupConnector so it can be threaded into
  // the anti-repetition bracketing on every tool dispatch
  // (planning/03-exec-crosscut-anti-repetition.md, HITL-ratified 2026-05-27).
  // Order rearrangement is safe — the session store has no connector dep.
  const sessionStore = createSessionStore({
    backend: config.SESSION_BACKEND,
    idleTtlMs: config.SESSION_TTL_IDLE_HOURS * 3_600_000,
    archiveTtlMs: config.SESSION_TTL_ARCHIVE_DAYS * 86_400_000,
  });

  const connector = await setupConnector({
    config,
    descriptions: toolDescriptions,
    sessionStore,
  });

  const { agent } = await buildOrchestratorAgent({ config, promptLoader, tools: connector.tools });

  // Layer-2 functional agent (B.t7). Separate ADK LlmAgent running on a
  // different (cheaper) model — getModelFor(config, 'classifier') resolves
  // to FUNCTIONAL_CLASSIFIER_MODEL (Haiku by default). Proves the
  // two-layer agent model end-to-end. Placeholder pending G.t0 HITL
  // flow-mapping.
  const triageClassifier = buildTriageClassifier({ config });

  // InMemoryRunner owns its own ADK session service. /chat uses `runAsync`
  // which expects an ADK session keyed by (appName, userId, sessionId); we
  // pre-create one in `onSessionCreated` after every `POST /session` so
  // turns can flow without a per-turn session-creation round trip.
  const runner = new InMemoryRunner({ agent, appName: ORCHESTRATOR_APP_NAME });

  const version = readPackageVersion(config.packageRoot);

  // ADK-side provisioning hook — used both by the warm pool (every pre-warm)
  // and by `POST /session`'s direct-create fallthrough path. Seeds the
  // matching ADK session so `/chat`'s `runner.runAsync` finds it keyed on
  // (appName, userId, sessionId).
  const onSessionCreated = async (sessionId: string): Promise<void> => {
    await runner.sessionService.createSession({
      appName: ORCHESTRATOR_APP_NAME,
      userId: ANONYMOUS_USER_ID,
      sessionId,
      state: {},
    });
  };

  // Warm pool (B.t10). With `WARM_POOL_SIZE=0` (default), this returns a
  // `DirectAllocator` — the `POST /session` path is unchanged in behaviour.
  // With size > 0, pre-warms to target before the server starts listening
  // so the first visitor sees a hit.
  const allocator = await startWarmPool({
    config,
    sessionStore,
    onSessionCreated,
  });

  // E.t3 — handoff store + mailer config. The store is currently
  // file-backed under <packageRoot>/var/handoffs/ as an interim until
  // chunk E.t2 proper settles the durable backend — Cloud SQL Postgres
  // per E.10 + C.18 + C.23 (Firestore was the original target but is
  // dropped project-wide). The mailer is shaped from env vars; the
  // master `enabled` switch defaults off until Julie confirms sales-
  // inbox + SMTP creds.
  const handoffStoreDir = path.join(config.packageRoot, 'var', 'handoffs');
  const handoffStore = new FsHandoffStore(handoffStoreDir);
  const mailerConfig: MailerConfig = {
    enabled: config.HANDOFF_EMAIL_ENABLED,
    templatesDirAbsolutePath: config.handoffTemplatesDirAbsolutePath,
    fromAddress: config.HANDOFF_EMAIL_FROM,
    qualifiedRecipient: config.HANDOFF_EMAIL_TO_QUALIFIED,
    referredOutRecipient: config.HANDOFF_EMAIL_TO_REFERRED_OUT,
    smtp: {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER ? { user: config.SMTP_USER } : {}),
      ...(config.SMTP_PASS ? { pass: config.SMTP_PASS } : {}),
    },
  };

  const app = buildServer({
    sessionStore,
    runner,
    corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
    version,
    userId: ANONYMOUS_USER_ID,
    triageClassifier,
    allocator,
    onSessionCreated,
    handoffStore,
    mailerConfig,
  });

  // E.t6 — handoff retention sweeper.
  // Interim in-process interval. The CLI external-trigger path (`npm run
  // sweep:handoffs --workspace @swoop/connector`) is independent of this
  // wiring — it runs one sweep regardless. Cloud Run Job + Cloud Scheduler
  // will replace the interval at swap time (E.t2 proper) but the same
  // `sweepHandoffs(deps)` function is the unit-of-work either way.
  let retentionSweepInterval: NodeJS.Timeout | undefined;
  let retentionSweepInitialTimer: NodeJS.Timeout | undefined;
  if (config.HANDOFF_RETENTION_SWEEP_ENABLED) {
    // First sweep fires after the initial delay so boot logs stay clean.
    retentionSweepInitialTimer = setTimeout(() => {
      // Errors are emitted as `handoff.retention.sweep.failed` events
      // inside sweepHandoffs; catch here is a no-op safety net.
      void sweepHandoffs({ store: handoffStore }).catch(() => {});
    }, config.HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS);
    retentionSweepInitialTimer.unref?.();

    // Recurring cadence.
    retentionSweepInterval = setInterval(() => {
      void sweepHandoffs({ store: handoffStore }).catch(() => {});
    }, config.HANDOFF_RETENTION_SWEEP_INTERVAL_MS);
    retentionSweepInterval.unref?.();
  }

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
    console.log(
      `[orchestrator] warm pool size: ${config.WARM_POOL_SIZE} (ttl ${config.WARM_POOL_TTL_MINUTES}min) — ` +
        `${config.WARM_POOL_SIZE === 0 ? 'disabled (direct allocator)' : 'pre-warmed'}`,
    );
    console.log(`[orchestrator] cors allowed origins: [${config.CORS_ALLOWED_ORIGINS.join(', ')}]`);
    console.log(
      `[orchestrator] handoff store: file-backed at ${handoffStoreDir} ` +
        `(interim — Cloud SQL Postgres swap targeted in chunk E.t2 per E.10 + C.18)`,
    );
    console.log(
      `[orchestrator] handoff mailer: ${
        config.HANDOFF_EMAIL_ENABLED ? `enabled, sending to ${config.HANDOFF_EMAIL_TO_QUALIFIED}` : 'disabled (set HANDOFF_EMAIL_ENABLED=true to flip)'
      }`,
    );
    console.log(
      `[orchestrator] handoff retention sweeper: ${
        config.HANDOFF_RETENTION_SWEEP_ENABLED
          ? `enabled, interval=${Math.round(config.HANDOFF_RETENTION_SWEEP_INTERVAL_MS / 1000)}s, ` +
            `initialDelay=${Math.round(config.HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS / 1000)}s, ` +
            `policy={qualified:360d, referred_out:360d, disqualified:90d, inconclusive:90d}`
          : 'disabled (set HANDOFF_RETENTION_SWEEP_ENABLED=true to flip)'
      }`,
    );
    console.log(`[orchestrator] env: ${config.NODE_ENV} (prompt hot-reload: ${config.isProduction ? 'off' : 'on'})`);
  });

  const shutdown = (signal: string) => {
    // Human-facing: operator sees the signal in local dev / Cloud Run logs.
    // Not an event — the process is on its way out and per-signal shutdown
    // notifications would only clutter the structured stream.
    console.log(`[orchestrator] ${signal} received, shutting down.`);
    // Stop retention sweeper timers first so an in-flight sweep doesn't fight
    // shutdown for the file lock.
    if (retentionSweepInterval !== undefined) clearInterval(retentionSweepInterval);
    if (retentionSweepInitialTimer !== undefined) clearTimeout(retentionSweepInitialTimer);
    // Drop warm-pool entries first — they own session records in the store,
    // and we want those deleted before the process exits so nothing leaks
    // into a long-lived backend (when one eventually replaces in-memory).
    allocator.stop().catch((err) => {
      console.warn('[orchestrator] warm pool stop failed during shutdown:', err);
    });
    connector.client.close().catch((err) => {
      emitErrorRaised({
        sessionId: 'unknown',
        actor: 'system',
        errorType: 'connector_close_failed',
        chunk: 'B',
        err,
      });
    });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // Stack-preferring sanitisedContext: orchestrator startup failure is
  // operator-facing, so the full trace beats just `err.message`.
  emitErrorRaised({
    sessionId: 'unknown',
    actor: 'system',
    errorType: 'orchestrator_startup_failed',
    chunk: 'B',
    sanitisedContext:
      err instanceof Error ? err.stack ?? err.message : String(err),
  });
  // Also stderr so the operator sees the full trace at process exit.
  console.error('[orchestrator] fatal startup error:', err);
  process.exit(1);
});
