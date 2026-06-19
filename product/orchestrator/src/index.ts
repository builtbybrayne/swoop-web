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
 * Now wired (post the original B.t5 slice):
 *   - Warm session pool (B.t10; disabled by default, WARM_POOL_SIZE=0).
 *   - Observability event sink (chunk F / F-c) — selected by EVENT_SINK,
 *     registered via setEventSink below.
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
import pg from 'pg';
import {
  InMemoryRunner,
  Runner,
  BaseSessionService,
  InMemoryArtifactService,
  InMemoryMemoryService,
} from '@google/adk';
import { emitErrorRaised, messageOf, setEventSink } from '@swoop/common';
import {
  FsHandoffStore,
  loadAllToolDescriptions,
  resolveEventSink,
  sweepHandoffs,
  type MailerConfig,
} from '@swoop/connector';

import { loadConfig } from './config/index.js';
import { createPromptLoader } from './agent/prompt-loader.js';
import { buildOrchestratorAgent } from './agent/factory.js';
import { createRunnerRegistry } from './agent/runner-registry.js';
import { buildMemoryAgent } from './agent/memory-agent.js';
import { loadMemoryPrompts } from './agent/memory-prompt-loader.js';
import {
  loadGreetingPrompt,
  resolveGreetingPromptPath,
} from './agent/greeting-prompt-loader.js';
import { setupConnector } from './connector/index.js';
import {
  createSessionStore,
  startWarmPool,
  PgAdkSessionService,
  PostgresSessionStore,
  startPostgresSessionSweep,
} from './session/index.js';
import { buildServer } from './server/index.js';
import type { MemoryAgentProvider } from './server/chat.js';
import { buildTriageClassifier } from './functional-agents/triage-classifier.js';
import { SharedPasswordAuthenticator } from './auth/index.js';

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
  const memoryPrompts = loadMemoryPrompts(config.memoryPromptDirAbsolutePath);

  // Consent-triggered greeting pre-warm (consent-greeting-prewarm, PW-3).
  // Load the warm-hello instruction at boot, fail-fast on missing/empty
  // (mirrors memoryPrompts above). Threaded into the greeting runner + /chat
  // handler below.
  const greetingPrompt = loadGreetingPrompt(config);

  // Session store created BEFORE setupConnector so it can be threaded into
  // the anti-repetition bracketing on every tool dispatch
  // (planning/03-exec-crosscut-anti-repetition.md, HITL-ratified 2026-05-27).
  // Order rearrangement is safe — the session store has no connector dep.
  const sessionStore = createSessionStore({
    backend: config.SESSION_BACKEND,
    idleTtlMs: config.SESSION_TTL_IDLE_HOURS * 3_600_000,
    archiveTtlMs: config.SESSION_TTL_ARCHIVE_DAYS * 86_400_000,
    // SESSION_BACKEND=postgres needs the URL. The session factory no longer
    // reads process.env, so hand it the validated value — config/load.ts has
    // already resolved DATABASE_URL → ORCHESTRATOR_DATABASE_URL. Empty string
    // for non-postgres backends, which ignore it.
    databaseUrl: config.ORCHESTRATOR_DATABASE_URL,
  });

  const connector = await setupConnector({
    config,
    descriptions: toolDescriptions,
    sessionStore,
  });

  // T3-4: pass the connector client so buildOrchestratorAgent can read the
  // active sales-memory set per-turn inside the async InstructionProvider.
  const { agent } = await buildOrchestratorAgent({
    config,
    promptLoader,
    tools: connector.tools,
    connectorClient: connector.client,
    memoryLoadedHeader: memoryPrompts.loadedHeader,
  });

  // staff-auth + T3-3 — staff authenticator and the Opus memory-agent provider.
  // Both are gated on STAFF_AUTH_ENABLED: with it off, visitor sessions are the
  // only path and the memory feature is dark (provider stays undefined → /chat
  // never routes to the memory agent). With it on, staff can authenticate and,
  // once in memory mode, reach the Opus memory agent.
  //
  // The provider is a factory (not a prebuilt agent): the staff token is bound
  // into the connector memory tools per memory-mode entry (sm-4), and the token
  // is per-session, so the agent is built fresh each time with the current
  // turn's validated token + name.
  let staffAuthenticator: SharedPasswordAuthenticator | null = null;
  let memoryAgentProvider: MemoryAgentProvider | undefined;
  if (config.STAFF_AUTH_ENABLED) {
    staffAuthenticator = new SharedPasswordAuthenticator({
      password: config.STAFF_AUTH_PASSWORD,
      jwtSecret: config.STAFF_JWT_SECRET,
      ttlDays: config.STAFF_JWT_TTL_DAYS,
    });
    memoryAgentProvider = ({ staffToken, staffName }) =>
      buildMemoryAgent({
        config,
        promptLoader,
        connectorClient: connector.client,
        staffToken,
        staffName,
        memoryPrompts,
      });
  }

  // Layer-2 functional agent (B.t7). Separate ADK LlmAgent running on a
  // different (cheaper) model — getModelFor(config, 'classifier') resolves
  // to FUNCTIONAL_CLASSIFIER_MODEL (Haiku by default). Proves the
  // two-layer agent model end-to-end. Placeholder pending G.t0 HITL
  // flow-mapping.
  const triageClassifier = buildTriageClassifier({ config });

  // Build the ADK runner. When SESSION_BACKEND=postgres we replace the
  // InMemoryRunner's hardcoded InMemorySessionService with PgAdkSessionService
  // (B.t13 — ADK Layer 2 durability). For all other backends InMemoryRunner
  // suffices (its internal InMemorySessionService is the default).
  //
  // Runner (the ADK base class) is used directly so we can inject a custom
  // sessionService; InMemoryRunner doesn't accept one (it hardcodes the
  // in-memory variant). Both InMemoryArtifactService and InMemoryMemoryService
  // stay in-memory — they're ADK internals we don't use for Puma state.
  let postgresPool: pg.Pool | undefined;
  let stopSessionSweep: (() => void) | undefined;

  let runner: InstanceType<typeof Runner>;
  if (config.SESSION_BACKEND === 'postgres') {
    const dbUrl = config.ORCHESTRATOR_DATABASE_URL;
    postgresPool = new pg.Pool({
      connectionString: dbUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      application_name: 'swoop-orchestrator',
      options: `-c statement_timeout=5000`,
    });
    postgresPool.on('error', (err) => {
      console.error(`[orchestrator] postgres session pool error: ${messageOf(err)}`);
    });

    const pgAdkSessionService = new PgAdkSessionService({
      pool: postgresPool,
      appName: ORCHESTRATOR_APP_NAME,
    });

    runner = new Runner({
      agent,
      appName: ORCHESTRATOR_APP_NAME,
      sessionService: pgAdkSessionService as unknown as InstanceType<typeof BaseSessionService>,
      artifactService: new InMemoryArtifactService(),
      memoryService: new InMemoryMemoryService(),
    });

    stopSessionSweep = startPostgresSessionSweep({
      store: sessionStore as PostgresSessionStore,
      pool: postgresPool,
      idleTtlMs: config.SESSION_TTL_IDLE_HOURS * 3_600_000,
      archiveTtlMs: config.SESSION_TTL_ARCHIVE_DAYS * 86_400_000,
    });
  } else {
    runner = new InMemoryRunner({ agent, appName: ORCHESTRATOR_APP_NAME });
  }

  // Dev/test model picker (M-PICK-1): a lazy per-model runner registry that
  // reuses the default runner's sessionService. `getRunner` returns the default
  // runner unless the picker is enabled AND the requested id is allow-listed.
  // Off by default (MODEL_PICKER_ALLOWLIST empty / NODE_ENV=production).
  const runnerRegistry = createRunnerRegistry({
    defaultRunner: runner,
    defaultModelId: config.ORCHESTRATOR_MODEL,
    defaultThinking: config.ORCHESTRATOR_THINKING_ENABLED,
    modelOverridesEnabled: config.modelPickerEnabled,
    thinkingOverridesEnabled: config.thinkingPickerEnabled,
    allowlist: config.MODEL_PICKER_ALLOWLIST,
    buildAgentFor: (modelId, thinkingEnabled) =>
      buildOrchestratorAgent({
        config,
        promptLoader,
        tools: connector.tools,
        modelId,
        thinkingEnabled,
        // Match the primary build path above so picker turns load the per-turn
        // sales-memory block too. Without these, every dev model-picker turn
        // ran against a different agent shape than production (memory block
        // absent) — a post-merge gap: M-PICK added buildAgentFor (2026-06-16),
        // sales-memory T3-4 added these two params to the primary call only.
        connectorClient: connector.client,
        memoryLoadedHeader: memoryPrompts.loadedHeader,
      }),
    // Per-model runners reuse the default runner's sessionService so a session
    // bootstrapped under the default is found whichever model the turn routes
    // to. Artifact/memory services are ADK internals Puma doesn't use for state.
    buildRunner: (agent) =>
      new Runner({
        agent,
        appName: ORCHESTRATOR_APP_NAME,
        sessionService: runner.sessionService,
        artifactService: new InMemoryArtifactService(),
        memoryService: new InMemoryMemoryService(),
      }),
  });

  // Consent-triggered greeting pre-warm (consent-greeting-prewarm, PW-5).
  // A dedicated orchestrator agent + runner for the one warm-hello turn fired on
  // consent. It INHERITS the deploy's global ORCHESTRATOR_THINKING_ENABLED and
  // overrides ONLY ORCHESTRATOR_EFFORT to the lowest value ('low').
  //
  // Why inherit thinking + drop only effort (Alastair, 2026-06-18, superseding
  // the original thinking-OFF design): effort is a per-request param, NOT part
  // of the cached system prefix, whereas the thinking config IS baked into the
  // cached prefix (the RL.3 silent-working belt is only injected when thinking
  // is off). Keeping thinking aligned with the conversation means the greeting
  // warms the SAME prompt-cache prefix turn 1 hits — forcing thinking off would
  // have warmed a different prefix and wasted the cache win. Lowest effort still
  // keeps the hello fast ("there's nothing to think about").
  //
  // The agent is otherwise identical to the conversational one (same prompt,
  // tools, skills, sales-memory header). The runner SHARES the default runner's
  // sessionService (same as the M-PICK sibling runners above), so the greeting
  // warms the visitor's REAL ADK session — the hello + any load_skill land in
  // the same event log that /session/:id/history replays. Built AFTER `runner`
  // so its sessionService exists. Only the greeting turn routes here.
  const { agent: greetingAgent } = await buildOrchestratorAgent({
    config: { ...config, ORCHESTRATOR_EFFORT: 'low' },
    promptLoader,
    tools: connector.tools,
    connectorClient: connector.client,
    memoryLoadedHeader: memoryPrompts.loadedHeader,
  });
  const greetingRunner = new Runner({
    agent: greetingAgent,
    appName: ORCHESTRATOR_APP_NAME,
    sessionService: runner.sessionService,
    artifactService: new InMemoryArtifactService(),
    memoryService: new InMemoryMemoryService(),
  });

  // F-c — register the durable event sink (planning/03-exec-observability-c.md).
  // Reuse the postgres session pool when present; otherwise provision a small
  // dedicated pool for EVENT_SINK=postgres (the config refine guarantees the URL).
  let eventPool: pg.Pool | undefined;
  if (config.EVENT_SINK === 'postgres' && postgresPool === undefined) {
    eventPool = new pg.Pool({
      connectionString: config.ORCHESTRATOR_DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      application_name: 'swoop-orchestrator-events',
      options: `-c statement_timeout=5000`,
    });
    eventPool.on('error', (err) => {
      console.error(`[orchestrator] event-log pool error: ${messageOf(err)}`);
    });
  }
  setEventSink(
    resolveEventSink({ mode: config.EVENT_SINK, pool: postgresPool ?? eventPool }),
  );

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
    getRunner: runnerRegistry.getRunner,
    modelPicker: config.modelPickerEnabled
      ? { defaultModelId: config.ORCHESTRATOR_MODEL, modelIds: config.MODEL_PICKER_ALLOWLIST }
      : undefined,
    allocator,
    onSessionCreated,
    handoffStore,
    mailerConfig,
    staffAuthenticator,
    memoryAgentProvider,
    greetingRunner,
    greetingPrompt,
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
    if (config.modelPickerEnabled) {
      console.log(
        `[orchestrator] model picker (dev/test): ENABLED — orchestrator overridable to [${config.MODEL_PICKER_ALLOWLIST.join(', ')}]`,
      );
    }
    console.log(`[orchestrator] triage classifier model: ${triageClassifier.modelId}`);
    console.log(
      `[orchestrator] staff auth: ${
        config.STAFF_AUTH_ENABLED
          ? `enabled — memory agent model: ${config.MEMORY_AGENT_MODEL}`
          : 'disabled (set STAFF_AUTH_ENABLED=true to enable staff memory authoring)'
      }`,
    );
    console.log(`[orchestrator] connector: ${connector.client.url}`);
    console.log(
      `[orchestrator] connector tools discovered: [${connector.discoveredNames.join(', ')}] ` +
        `(${connector.tools.length} exposed to model)`,
    );
    console.log(`[orchestrator] agent: ${agent.name} (tools: ${agent.tools.length})`);
    console.log(
      `[orchestrator] greeting pre-warm: ENABLED (low-effort runner, honours thinking flag, shared session) — ` +
        `prompt ${resolveGreetingPromptPath(config)} (${greetingPrompt.length} chars)`,
    );
    console.log(`[orchestrator] session backend: ${config.SESSION_BACKEND}`);
    console.log(
      `[orchestrator] event sink: ${config.EVENT_SINK}` +
        `${config.EVENT_SINK === 'postgres' ? ` (event_log; pool ${postgresPool ? 'shared with sessions' : 'dedicated'})` : ''}`,
    );
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
    if (retentionSweepInitialTimer !== undefined) clearInterval(retentionSweepInitialTimer);
    // Stop postgres session sweeper if running.
    if (stopSessionSweep !== undefined) stopSessionSweep();
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
    // Close the postgres pool (B.t13) after warm pool drains.
    if (postgresPool !== undefined) {
      postgresPool.end().catch((err) => {
        console.warn('[orchestrator] postgres pool close failed during shutdown:', err);
      });
    }
    if (eventPool !== undefined) {
      eventPool.end().catch((err) => {
        console.warn('[orchestrator] event-log pool close failed during shutdown:', err);
      });
    }
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
