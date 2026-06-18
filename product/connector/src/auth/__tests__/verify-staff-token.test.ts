/**
 * Unit tests for buildStaffTokenVerifier (sm-t2-auth hardening).
 *
 * Generates real tokens in-test using jose SignJWT + the shared constants from
 * @swoop/common — the same constants the orchestrator uses to sign.
 * No live API, no DB, fully self-contained.
 *
 * Covers:
 *   - Valid token: resolves (void) without throwing.
 *   - Tampered/invalid-signature: rejects.
 *   - Expired token: rejects.
 *   - Wrong issuer: rejects.
 *   - Wrong audience: rejects.
 *   - Token signed with a different secret: rejects.
 *   - Missing token (undefined): rejects.
 *   - Blank token (empty/whitespace): rejects.
 */

import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { STAFF_JWT_ISSUER, STAFF_JWT_AUDIENCE, STAFF_JWT_ALG } from '@swoop/common';
import { buildStaffTokenVerifier } from '../verify-staff-token.js';

const SECRET = 'a-very-long-staff-jwt-secret-for-testing-xyz'; // ≥ 32 chars
const OTHER_SECRET = 'completely-different-secret-for-testing-abc123'; // ≥ 32 chars

/** Encode a secret string to the Uint8Array jose expects for HMAC. */
function encodeSecret(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Build a valid signed JWT using the shared constants (mirrors the orchestrator signer). */
async function signToken(overrides: {
  secret?: string;
  issuer?: string;
  audience?: string;
  alg?: string;
  expiredAt?: Date;
  expiresIn?: string;
} = {}): Promise<string> {
  const secret = encodeSecret(overrides.secret ?? SECRET);
  const alg = overrides.alg ?? STAFF_JWT_ALG;
  const issuer = overrides.issuer ?? STAFF_JWT_ISSUER;
  const audience = overrides.audience ?? STAFF_JWT_AUDIENCE;

  let builder = new SignJWT({ name: 'Alice', version: 1 })
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt();

  if (overrides.expiredAt) {
    // Issue at a time 2 days before expiredAt, then expire 1 ms after issuedAt
    // so the token is instantly expired relative to real wall-clock time.
    builder = builder
      .setIssuedAt(overrides.expiredAt)
      .setExpirationTime(new Date(overrides.expiredAt.getTime() + 1)); // 1ms TTL
  } else {
    builder = builder.setExpirationTime(overrides.expiresIn ?? '30d');
  }

  return builder.sign(secret);
}

describe('buildStaffTokenVerifier', () => {
  const assertStaffToken = buildStaffTokenVerifier(SECRET);

  it('resolves without throwing for a valid token', async () => {
    const token = await signToken();
    await expect(assertStaffToken(token)).resolves.toBeUndefined();
  });

  it('rejects a tampered (invalid-signature) token', async () => {
    const token = await signToken();
    // Flip the last character of the signature segment.
    const parts = token.split('.');
    parts[2] = parts[2]!.slice(0, -1) + (parts[2]!.slice(-1) === 'a' ? 'b' : 'a');
    const tampered = parts.join('.');
    await expect(assertStaffToken(tampered)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    // Issue the token in the past so it is already expired.
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const token = await signToken({ expiredAt: pastDate });
    await expect(assertStaffToken(token)).rejects.toThrow();
  });

  it('rejects a token with a wrong issuer', async () => {
    const token = await signToken({ issuer: 'wrong-issuer' });
    await expect(assertStaffToken(token)).rejects.toThrow();
  });

  it('rejects a token with a wrong audience', async () => {
    const token = await signToken({ audience: 'wrong-audience' });
    await expect(assertStaffToken(token)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken({ secret: OTHER_SECRET });
    // assertStaffToken is bound to SECRET, not OTHER_SECRET — signature mismatch.
    await expect(assertStaffToken(token)).rejects.toThrow();
  });

  it('rejects when token is undefined', async () => {
    await expect(assertStaffToken(undefined)).rejects.toThrow(
      /missing or blank/,
    );
  });

  it('rejects when token is an empty string', async () => {
    await expect(assertStaffToken('')).rejects.toThrow(/missing or blank/);
  });

  it('rejects when token is whitespace only', async () => {
    await expect(assertStaffToken('   ')).rejects.toThrow(/missing or blank/);
  });
});
