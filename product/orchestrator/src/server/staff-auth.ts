/**
 * `POST /staff/auth` — staff authentication endpoint (staff-auth task).
 *
 * Allows a sales team member to authenticate with the shared staff password
 * and receive a JWT they can present on subsequent chat/session requests.
 *
 * Security notes:
 *   - Rate-limited via `express-rate-limit` (in-memory, per IP). This is the
 *     ONE endpoint where we do NOT defer rate limiting — it's a public
 *     password endpoint and must be lockout-protected from day one.
 *   - 429 after STAFF_AUTH_MAX_ATTEMPTS (default 5) in STAFF_AUTH_WINDOW_MS
 *     (default 15 min). Counts shared across all IPs on the same server
 *     instance; the per-IP key means each IP gets its own window.
 *   - Wrong password → 401 with a generic "invalid_credentials" code.
 *     We intentionally do NOT reveal whether the name or password was wrong.
 *   - All responses include the standard Helmet security headers inherited
 *     from the Express app's global middleware.
 *
 * Wire contract (POST body):
 *   { password: string, name: string }
 *
 * Success response (200):
 *   { token: string, name: string, expiresAt: string }
 *
 * Error responses:
 *   400 — missing / invalid body fields.
 *   401 — wrong password.
 *   429 — rate limit exceeded (Retry-After header present).
 *   503 — authenticator unavailable (STAFF_AUTH_ENABLED=false).
 */

import { rateLimit } from 'express-rate-limit';
import type { Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import type { StaffAuthenticator } from '@swoop/common';
import { sendError } from './errors.js';

// ---------------------------------------------------------------------------
// Request schema.
// ---------------------------------------------------------------------------

const StaffAuthRequestSchema = z
  .object({
    password: z.string().min(1, 'password is required'),
    name: z.string().min(1, 'name is required').max(200),
  })
  .strict();

// ---------------------------------------------------------------------------
// Rate limiter — 5 attempts per IP per 15 minutes.
//
// In-memory store is intentional: the orchestrator is a single-instance
// Cloud Run service. If horizontal scaling lands later, replace with a
// Redis-backed store. The per-IP window is conservative enough that a
// brute-force attack from a single office IP hits 429 before any realistic
// password space is covered.
//
// `standardHeaders: 'draft-7'` emits RFC-standard `RateLimit-*` headers.
// `legacyHeaders: false` suppresses the deprecated `X-RateLimit-*` set.
// ---------------------------------------------------------------------------

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

export function createStaffAuthRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_ATTEMPTS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Surface a consistent JSON error body on limit breach so the UI can
    // display a meaningful message rather than HTML from the default handler.
    handler: (_req, res) => {
      sendError(res, 429, 'rate_limited', 'Too many authentication attempts. Please wait 15 minutes and try again.');
    },
    // Skip successful requests from the rate-limit count: only failed
    // attempts (non-2xx) are charged. Prevents a successful token refresh
    // from eating into the window.
    skipSuccessfulRequests: true,
  });
}

// ---------------------------------------------------------------------------
// Route handler factory.
// ---------------------------------------------------------------------------

export interface StaffAuthDeps {
  /** The configured authenticator. Null when STAFF_AUTH_ENABLED=false. */
  readonly authenticator: StaffAuthenticator | null;
}

export function createStaffAuthHandler(
  deps: StaffAuthDeps,
): (req: Request, res: Response) => Promise<void> {
  return async function handleStaffAuth(req, res) {
    // Feature gate. When disabled (default), the route is registered but
    // always returns 503 so the endpoint is not a surprise 404 — the
    // operator misconfigured, not the caller.
    if (deps.authenticator === null) {
      sendError(res, 503, 'staff_auth_disabled', 'Staff authentication is not enabled on this deployment.');
      return;
    }

    const parsed = StaffAuthRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      sendError(res, 400, 'invalid_request', detail);
      return;
    }

    const { password, name } = parsed.data;

    const result = await deps.authenticator.authenticate({
      kind: 'password',
      password,
      name,
    });

    if (result === null) {
      // Wrong password. Generic message — never reveal which field failed.
      sendError(res, 401, 'invalid_credentials', 'Authentication failed.');
      return;
    }

    res.status(200).json({
      token: result.token,
      name: result.name,
      expiresAt: result.expiresAt,
    });
  };
}
