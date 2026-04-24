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
import type { Runner } from '@google/adk';

import type { SessionStore } from '../session/index.js';
import { createSessionBootstrapHandler } from './session-bootstrap.js';
import {
  createConsentHandler,
  createSessionDeleteHandler,
} from './consent.js';
import { createChatHandler } from './chat.js';
import { createSessionPingHandler } from './session-ping.js';
import { DISCLOSURE_COPY_VERSION } from './errors.js';
import type { TriageClassifier } from '../functional-agents/triage-classifier.js';

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
}

export function buildServer(deps: BuildServerDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // JSON body parser — applies to /session, /consent; /chat is also JSON
  // (no multipart). Size cap keeps the surface boring.
  app.use(express.json({ limit: '64kb' }));

  // Minimal hand-rolled CORS. We avoid the `cors` npm package to keep the
  // dep surface small; the logic is short enough to own.
  app.use(corsMiddleware(deps.corsAllowedOrigins));

  registerRoutes(app, deps);
  return app;
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
    }),
  );

  app.patch('/session/:id/consent', createConsentHandler(sharedDeps));
  app.delete('/session/:id', createSessionDeleteHandler(sharedDeps));
  // D.t6 proactive-preflight probe. Always 200 — verdict in body.
  app.get('/session/:id/ping', createSessionPingHandler(sharedDeps));

  app.post(
    '/chat',
    createChatHandler({
      sessionStore: deps.sessionStore,
      runner: deps.runner,
      userId: deps.userId,
      now: deps.now,
      corsAllowedOrigins: deps.corsAllowedOrigins,
      triageClassifier: deps.triageClassifier,
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
