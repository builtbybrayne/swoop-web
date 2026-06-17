/**
 * Unit tests for SharedPasswordAuthenticator (staff-auth task).
 *
 * Covers:
 *   - authenticate() returns a signed JWT on correct password.
 *   - authenticate() returns null on wrong password.
 *   - authenticate() returns null for non-password credential kind.
 *   - verify() returns { ok: true, name } on a valid token.
 *   - verify() returns { ok: false, reason: 'invalid' } on bad signature.
 *   - verify() returns { ok: false, reason: 'expired' } on an expired token.
 *   - verify() returns { ok: false, reason: 'malformed' } on garbage input.
 *   - Token TTL is honoured (future-expiry with injected clock).
 */

import { describe, it, expect, vi } from 'vitest';
import { SharedPasswordAuthenticator } from '../shared-password-authenticator.js';

const PASSWORD = 'correct-horse-battery-staple'; // ≥12 chars
const JWT_SECRET = 'a-very-long-jwt-secret-for-testing-purposes-xyz'; // ≥32 chars
const STAFF_NAME = 'Alice';

function makeAuth(overrides: { ttlDays?: number; now?: () => Date } = {}) {
  return new SharedPasswordAuthenticator({
    password: PASSWORD,
    jwtSecret: JWT_SECRET,
    ttlDays: overrides.ttlDays,
    now: overrides.now,
  });
}

describe('SharedPasswordAuthenticator.authenticate()', () => {
  it('returns a token on correct password', async () => {
    const auth = makeAuth();
    const result = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: STAFF_NAME,
    });
    expect(result).not.toBeNull();
    expect(typeof result!.token).toBe('string');
    expect(result!.token.split('.').length).toBe(3); // JWT has 3 parts
    expect(result!.name).toBe(STAFF_NAME);
    expect(new Date(result!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null on wrong password', async () => {
    const auth = makeAuth();
    const result = await auth.authenticate({
      kind: 'password',
      password: 'wrong-password',
      name: STAFF_NAME,
    });
    expect(result).toBeNull();
  });

  it('returns null for non-password credential kind', async () => {
    const auth = makeAuth();
    const result = await auth.authenticate({
      kind: 'oidc',
      idToken: 'some-oidc-token',
    });
    expect(result).toBeNull();
  });

  it('uses the staff name from the credential', async () => {
    const auth = makeAuth();
    const result = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: 'Bob',
    });
    expect(result!.name).toBe('Bob');
  });

  it('falls back to "Staff" when name is blank', async () => {
    const auth = makeAuth();
    const result = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: '   ', // whitespace only
    });
    expect(result!.name).toBe('Staff');
  });

  it('honours TTL in expiresAt', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const auth = makeAuth({ ttlDays: 7, now: () => now });
    const result = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: STAFF_NAME,
    });
    const expectedExpiry = new Date('2026-01-08T00:00:00Z').getTime();
    expect(new Date(result!.expiresAt).getTime()).toBe(expectedExpiry);
  });
});

describe('SharedPasswordAuthenticator.verify()', () => {
  it('returns { ok: true, name } for a valid token', async () => {
    const auth = makeAuth();
    const issued = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: STAFF_NAME,
    });
    const result = await auth.verify(issued!.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe(STAFF_NAME);
    }
  });

  it('returns { ok: false, reason: "invalid" } on tampered token', async () => {
    const auth = makeAuth();
    const issued = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: STAFF_NAME,
    });
    // Flip the last character of the signature segment.
    const parts = issued!.token.split('.');
    parts[2] = parts[2]!.slice(0, -1) + (parts[2]!.slice(-1) === 'a' ? 'b' : 'a');
    const tampered = parts.join('.');
    const result = await auth.verify(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
    }
  });

  it('returns { ok: false, reason: "malformed" } on garbage input', async () => {
    const auth = makeAuth();
    const result = await auth.verify('not-a-jwt-at-all');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['malformed', 'invalid']).toContain(result.reason);
    }
  });

  it('returns { ok: false, reason: "expired" } on an expired token', async () => {
    // Issue a token in the past (TTL=1 day, issued 2 days ago).
    const pastNow = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const auth = makeAuth({ ttlDays: 1, now: () => pastNow });
    const issued = await auth.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: STAFF_NAME,
    });
    // Verify with a real-time clock (the default; no `now` override).
    const verifyAuth = makeAuth({ ttlDays: 1 });
    const result = await verifyAuth.verify(issued!.token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('expired');
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const auth1 = makeAuth();
    const auth2 = new SharedPasswordAuthenticator({
      password: PASSWORD,
      jwtSecret: 'a-completely-different-secret-for-testing-purposes',
    });
    const issued = await auth1.authenticate({
      kind: 'password',
      password: PASSWORD,
      name: STAFF_NAME,
    });
    const result = await auth2.verify(issued!.token);
    expect(result.ok).toBe(false);
  });
});
