/**
 * SharedPasswordAuthenticator — v1 staff authenticator (staff-auth task).
 *
 * Implements StaffAuthenticator using a single shared password (from config)
 * and HMAC-SHA256 JWTs via `jose`. The interface is a clean swap seam: a
 * later `GoogleOidcAuthenticator` drops in at the `BuildServerDeps` wiring
 * site with NO caller changes — mirroring the HandoffStore interface→impl
 * pattern.
 *
 * Security posture:
 *   - Password compared via `crypto.timingSafeEqual` to avoid timing attacks.
 *   - JWT secret must be ≥ 32 bytes; enforced in config schema refine.
 *   - Token TTL configurable via STAFF_JWT_TTL_DAYS (default 30 days).
 *   - `verify()` never throws — any failure returns { ok: false }.
 *
 * jose is already a transitive dep (from @anthropic-ai/sdk / @google/adk)
 * and has bundled TypeScript types; no additional dep needed.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { StaffAuthenticator, StaffCredentials, StaffAuthResult, StaffVerifyResult } from '@swoop/common';
import { STAFF_JWT_ISSUER, STAFF_JWT_AUDIENCE, STAFF_JWT_ALG } from '@swoop/common';

export interface SharedPasswordAuthenticatorOptions {
  /** The shared staff password. Must match STAFF_AUTH_PASSWORD in config. */
  readonly password: string;
  /** HMAC-SHA256 JWT signing secret. Must be ≥ 32 chars. */
  readonly jwtSecret: string;
  /** Token TTL in days. Default 30. */
  readonly ttlDays?: number;
  /** Clock injection for tests. */
  readonly now?: () => Date;
}

export class SharedPasswordAuthenticator implements StaffAuthenticator {
  private readonly passwordBuf: Buffer;
  private readonly secretKey: Uint8Array;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(opts: SharedPasswordAuthenticatorOptions) {
    this.passwordBuf = Buffer.from(opts.password, 'utf8');
    // jose wants a Uint8Array for HMAC secrets.
    this.secretKey = new TextEncoder().encode(opts.jwtSecret);
    this.ttlMs = (opts.ttlDays ?? 30) * 24 * 60 * 60 * 1000;
    this.now = opts.now ?? (() => new Date());
  }

  async authenticate(credentials: StaffCredentials): Promise<StaffAuthResult | null> {
    if (credentials.kind !== 'password') {
      // This impl only handles the password variant; future OIDC impl takes
      // the 'oidc' kind. The caller wires the right impl for the right kind.
      return null;
    }

    // Timing-safe comparison prevents password-oracle timing attacks.
    // We always derive a same-length buffer from the supplied password so the
    // comparison length never leaks information about the correct password's
    // length. The HMAC over a fixed key ensures both buffers are always
    // `hashLen` bytes regardless of input length.
    const candidateBuf = Buffer.from(credentials.password, 'utf8');
    const expected = hmac32(this.passwordBuf);
    const actual = hmac32(candidateBuf);
    if (!timingSafeEqual(expected, actual)) {
      return null;
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs);

    const token = await new SignJWT({
      name: credentials.name.trim() || 'Staff',
      // `sub` is the staff member's name; version = 1 for future migration.
      version: 1,
    })
      .setProtectedHeader({ alg: STAFF_JWT_ALG })
      .setIssuer(STAFF_JWT_ISSUER)
      .setAudience(STAFF_JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.secretKey);

    return {
      token,
      name: credentials.name.trim() || 'Staff',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verify(token: string): Promise<StaffVerifyResult> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        issuer: STAFF_JWT_ISSUER,
        audience: STAFF_JWT_AUDIENCE,
        algorithms: [STAFF_JWT_ALG],
      });

      const name = typeof payload['name'] === 'string' ? payload['name'] : 'Staff';
      return { ok: true, name };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return { ok: false, reason: 'expired' };
      }
      if (
        err instanceof joseErrors.JWTInvalid ||
        err instanceof joseErrors.JWSInvalid ||
        err instanceof joseErrors.JWSSignatureVerificationFailed
      ) {
        return { ok: false, reason: 'invalid' };
      }
      // Anything else (malformed base64, etc.) → malformed.
      return { ok: false, reason: 'malformed' };
    }
  }
}

// ---------------------------------------------------------------------------
// Timing-safe helpers.
//
// `timingSafeEqual` requires both buffers to have the same byte length. We
// normalise both sides through a fixed-key HMAC-SHA256 (32 bytes) so the
// comparison is always constant-time for any input length. The key is
// module-scoped and random per process start — it doesn't need to persist
// across restarts because we never compare across processes.
// ---------------------------------------------------------------------------

const TIMING_SAFE_KEY = Buffer.from(
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
);

function hmac32(data: Buffer): Buffer {
  return createHmac('sha256', TIMING_SAFE_KEY).update(data).digest();
}
