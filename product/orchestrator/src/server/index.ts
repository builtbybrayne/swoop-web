/**
 * Server wiring — B.t5.
 *
 * Composes the orchestrator's HTTP surface by registering every route on an
 * Express app:
 *
 *   POST   /session                - bootstrap a session
 *   PATCH  /session/:id/consent    - grant / withdraw tier-1 consent
 *   DELETE /session/:id            - explicit session close
 *   POST   /chat                   - SSE streaming chat turn
 *
 * CORS is applied globally at the wiring layer so every endpoint stays in
 * sync (and so OPTIONS preflights succeed uniformly). Origin policy comes
 * from `config.CORS_ALLOWED_ORIGINS`. The development default already
 * includes `http://localhost:5173` (see config/schema.ts).
 *
 * The `buildServer` factory accepts its collaborators explicitly (agent,
 * session store, runner) so tests can drive the full HTTP surface with a
 * stubbed runner + in-memory store, never touching Anthropic.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import type { BaseSessionService, Runner } from '@google/adk';
import type { HandoffStore, MailerConfig } from '@swoop/connector';

import type { SessionAllocator, SessionStore } from '../session/index.js';
import { createSessionBootstrapHandler } from './session-bootstrap.js';
import {
  createConsentHandler,
  createSessionDeleteHandler,
} from './consent.js';
import { createChatHandler, type MemoryAgentProvider } from './chat.js';
import { createSessionPingHandler } from './session-ping.js';
import { createSessionHistoryHandler } from './session-history.js';
import { createHandoffSubmitHandler } from './handoff-submit.js';
import { createModelsHandler } from './models.js';
import { DISCLOSURE_COPY_VERSION } from './errors.js';
import type { TriageClassifier } from '../functional-agents/triage-classifier.js';
import {
  createStaffAuthHandler,
  createStaffAuthRateLimiter,
} from './staff-auth.js';
import type { StaffAuthenticator } from '@swoop/common';

export interface BuildServerDeps {
  readonly sessionStore: SessionStore;
  readonly runner: Runner;
  readonly corsAllowedOrigins: readonly string[];
  /** Package version for /healthz. */
  readonly version: string;
  /** Clock injection for tests. */
  readonly now?: () => Date;
  /**
   * Called after a Puma session is created so the caller (src/index.ts)
   * can seed the matching ADK session. Tests stub this out.
   */
  readonly onSessionCreated?: (sessionId: string) => Promise<void> | void;
  /** Disclosure copy version string; defaults to the constant in errors.ts. */
  readonly disclosureCopyVersion?: string;
  /** User id attached to ADK sessions — anonymous in Phase 1. */
  readonly userId?: string;
  /**
   * Layer-2 triage classifier (B.t7). Optional — when present, /chat runs
   * it before each turn. When absent (unit tests of the HTTP surface), the
   * /chat handler skips the pre-turn classification step entirely.
   */
  readonly triageClassifier?: TriageClassifier;
  /**
   * Session allocator (B.t10). When supplied, `POST /session` routes claims
   * through it so warm-pool hits / misses are accounted for. When omitted,
   * the handler falls through to `sessionStore.create` + `onSessionCreated`
   * — used by tests and by the zero-pool path when `startWarmPool` returned
   * a `DirectAllocator` that the caller chose not to thread in.
   */
  readonly allocator?: SessionAllocator;
  /**
   * Durable handoff store (E.t3). When supplied, `POST /handoff/submit` is
   * registered. When omitted (e.g. unit tests of unrelated routes), the
   * endpoint is not registered — callers receive a 404.
   */
  readonly handoffStore?: HandoffStore;
  /**
   * Mailer config (E.t3). Required alongside `handoffStore`. The mailer
   * itself is built per-request inside `submitHandoff`; this config carries
   * the recipient + transport + templates dir.
   */
  readonly mailerConfig?: MailerConfig;
  /**
   * Dev/test model-picker resolver (M-PICK-1). When present, `/chat` routes
   * each turn's `model` override through it (falling back to `runner`). Built in
   * src/index.ts from the runner registry; absent in unit tests.
   * See planning/03-exec-crosscut-test-mode-model-picker.md.
   */
  readonly getRunner?: (modelId?: string) => Promise<Runner>;
  /**
   * Dev/test model-picker catalogue (M-PICK-5). Present ONLY when the picker is
   * enabled (`config.modelPickerEnabled`); when present, `GET /models` is
   * registered. Undefined in production / unit tests → no route.
   */
  readonly modelPicker?: {
    readonly defaultModelId: string;
    readonly modelIds: readonly string[];
  };
  /**
   * Staff authenticator (staff-auth task). When supplied (STAFF_AUTH_ENABLED=true),
   * `POST /staff/auth` is registered and validates the shared password.
   * When null/omitted, the route is still registered but returns 503 so
   * the endpoint is not a surprise 404 on misconfigured deploys.
   *
   * Design: the dep is typed as `StaffAuthenticator | null` (not optional)
   * to force the caller to be explicit about the feature state. `null` =
   * feature disabled; `undefined` = not wired yet (treated as null).
   */
  readonly staffAuthenticator?: StaffAuthenticator | null;
  /**
   * Memory-agent provider (T3-3 / sm-1). Factory that builds the Opus memory
   * agent bound to a validated staff token + name. Passed straight through to
   * the /chat handler, which only ever invokes it on the staff + memory-mode
   * path. Absent → memory feature not wired (visitor-only deploys, tests of
   * the conversational surface).
   */
  readonly memoryAgentProvider?: MemoryAgentProvider;
}

export function buildServer(deps: BuildServerDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // Security headers (Sec-2). Registered BEFORE all other middleware so every
  // response — including CORS preflights and error replies — carries them.
  // The surface is iframe-embedded by Swoop's host page, so:
  //   - `frame-ancestors` is the load-bearing CSP directive (allow embedding
  //     from the configured allow-list, deny everything else).
  //   - X-Frame-Options is explicitly NOT set: CSP frame-ancestors supersedes
  //     it, and X-Frame-Options can't express a multi-origin allow-list, so
  //     keeping it on would silently override the CSP on legacy browsers.
  // Tight config: only the directives the compliance bundle calls for; default
  // helmet kitchen-sink is intentionally not enabled to keep the surface
  // boring and reviewable.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'frame-ancestors': frameAncestorsFor(deps.corsAllowedOrigins),
        },
      },
      strictTransportSecurity: {
        maxAge: 15552000, // 180 days, no preload — conservative
        includeSubDomains: true,
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // CSP frame-ancestors covers iframe policy; X-Frame-Options would
      // conflict on legacy browsers because it can't express a multi-origin
      // allow-list. See note above.
      frameguard: false,
    }),
  );

  // JSON body parser — applies to /session, /consent; /chat is also JSON
  // (no multipart). Size cap keeps the surface boring. Lowered from 64kb
  // to 16kb (R4-server, 2026-04-30 review) — paired with the per-field
  // CHAT_MESSAGE_MAX cap on `ChatRequestSchema.message` (8_000 chars) so
  // the body limit comfortably exceeds the field limit while still
  // rejecting any vaguely abusive payload before parsing.
  app.use(express.json({ limit: '16kb' }));

  // Minimal hand-rolled CORS. We avoid the `cors` npm package to keep the
  // dep surface small; the logic is short enough to own.
  app.use(corsMiddleware(deps.corsAllowedOrigins));

  registerRoutes(app, deps);
  return app;
}

/**
 * Build the CSP `frame-ancestors` source list from the CORS allow-list. Falls
 * back to `'none'` if nothing is configured (no host page may embed) — the
 * orchestrator is iframe-embedded by Swoop's host, so an empty list is a
 * deploy-time misconfiguration, not a legitimate state.
 */
function frameAncestorsFor(origins: readonly string[]): string[] {
  if (origins.length === 0) return ["'none'"];
  return [...origins];
}

export function registerRoutes(app: Express, deps: BuildServerDeps): void {
  const sharedDeps = { sessionStore: deps.sessionStore, now: deps.now };

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'orchestrator', version: deps.version });
  });

  app.post(
    '/session',
    createSessionBootstrapHandler({
      sessionStore: deps.sessionStore,
      disclosureCopyVersion: deps.disclosureCopyVersion ?? DISCLOSURE_COPY_VERSION,
      onSessionCreated: deps.onSessionCreated,
      allocator: deps.allocator,
      staffAuthenticator: deps.staffAuthenticator,
    }),
  );

  app.patch('/session/:id/consent', createConsentHandler(sharedDeps));
  app.delete('/session/:id', createSessionDeleteHandler(sharedDeps));
  // D.t6 proactive-preflight probe. Always 200 — verdict in body.
  app.get('/session/:id/ping', createSessionPingHandler(sharedDeps));
  // B.t11 — server-side history projection (rehydration on iframe remount).
  // 200 + parts on known session, 404 on unknown, 500 on translator/adk
  // failure. Reuses the runner's ADK session service so the same event log
  // that fed the live SSE feeds the rehydration response. Interface-typed
  // against `BaseSessionService` so the post-M4 swap to a Postgres-backed
  // SessionService (B.22) needs zero changes to the handler.
  app.get(
    '/session/:id/history',
    createSessionHistoryHandler({
      sessionStore: deps.sessionStore,
      sessionService: deps.runner.sessionService as BaseSessionService,
      appName: deps.runner.appName,
      userId: deps.userId,
      now: deps.now,
    }),
  );

  app.post(
    '/chat',
    createChatHandler({
      sessionStore: deps.sessionStore,
      runner: deps.runner,
      userId: deps.userId,
      now: deps.now,
      corsAllowedOrigins: deps.corsAllowedOrigins,
      triageClassifier: deps.triageClassifier,
      getRunner: deps.getRunner,
      staffAuthenticator: deps.staffAuthenticator,
      memoryAgentProvider: deps.memoryAgentProvider,
    }),
  );

  // Dev/test model picker (M-PICK-5). Registered only when enabled — the route
  // does not exist in production (src/index.ts gates `modelPicker` to undefined).
  if (deps.modelPicker) {
    app.get(
      '/models',
      createModelsHandler({
        defaultModelId: deps.modelPicker.defaultModelId,
        modelIds: deps.modelPicker.modelIds,
      }),
    );
  }

  // E.t3 — only register the handoff-submit route when both deps are
  // supplied. The mailer config carries the master `enabled` switch, so
  // boot-time wiring decides whether the route is even discoverable.
  if (deps.handoffStore && deps.mailerConfig) {
    app.post(
      '/handoff/submit',
      createHandoffSubmitHandler({
        sessionStore: deps.sessionStore,
        handoffStore: deps.handoffStore,
        mailerConfig: deps.mailerConfig,
        now: deps.now,
      }),
    );
  }

  // staff-auth — always register so the route is not a surprise 404.
  // The handler returns 503 when STAFF_AUTH_ENABLED=false (authenticator=null).
  // Rate limiter is applied FIRST so brute-force hits 429 before the handler
  // even parses the body — no password comparison on a locked-out IP.
  app.post(
    '/staff/auth',
    createStaffAuthRateLimiter(),
    createStaffAuthHandler({
      authenticator: deps.staffAuthenticator ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------
// CORS — hand-rolled.
//
// Behaviour:
//   - Echo the Origin header back if it's in the allow list.
//   - Short-circuit OPTIONS preflights with 204 + allow headers.
//   - Never emit `*` — production-grade posture from day one (per B.t5
//     handoff note in the Tier 3 plan).
// ---------------------------------------------------------------------------

function corsMiddleware(
  allowedOrigins: readonly string[],
): (req: Request, res: Response, next: NextFunction) => void {
  const allowSet = new Set(allowedOrigins);
  return function cors(req, res, next) {
    const origin = req.header('Origin');
    if (origin && allowSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
