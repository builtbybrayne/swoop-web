/**
 * Integration tests for POST /staff/auth (staff-auth task).
 *
 * Uses supertest to drive the full Express surface. Covers:
 *   - 200 with { token, name, expiresAt } on correct password.
 *   - 401 on wrong password.
 *   - 400 on missing / invalid body.
 *   - 503 when authenticator is null (STAFF_AUTH_ENABLED=false).
 *   - 429 after MAX_ATTEMPTS failed requests from the same IP.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner } from '@google/adk';

import { buildServer } from '../index.js';
import { InMemorySessionStore } from '../../session/index.js';
import { SharedPasswordAuthenticator } from '../../auth/shared-password-authenticator.js';

const PASSWORD = 'correct-horse-battery-staple';
const JWT_SECRET = 'a-very-long-jwt-secret-for-testing-purposes-xyz';

/**
 * Build a minimal Express app with just enough deps to exercise /staff/auth.
 * The runner stub only needs to satisfy the type; /staff/auth never calls it.
 */
function makeApp(withAuth: boolean): Express {
  const sessionStore = new InMemorySessionStore();
  const stubRunner = {
    appName: 'test',
    sessionService: { getSession: async () => null } as unknown as Runner['sessionService'],
    runAsync: async function* () {},
  } as unknown as Runner;

  const authenticator = withAuth
    ? new SharedPasswordAuthenticator({ password: PASSWORD, jwtSecret: JWT_SECRET })
    : null;

  return buildServer({
    sessionStore,
    runner: stubRunner,
    corsAllowedOrigins: [],
    version: '0.0.0-test',
    staffAuthenticator: authenticator,
  });
}

describe('POST /staff/auth', () => {
  describe('when STAFF_AUTH_ENABLED=true (authenticator wired)', () => {
    let app: Express;
    beforeEach(() => {
      // Fresh app each test so the rate-limiter resets between tests.
      app = makeApp(true);
    });

    it('returns 200 + { token, name, expiresAt } on correct password', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({ password: PASSWORD, name: 'Alice' });
      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.split('.').length).toBe(3);
      expect(res.body.name).toBe('Alice');
      expect(typeof res.body.expiresAt).toBe('string');
    });

    it('returns 401 on wrong password', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({ password: 'wrong-password', name: 'Alice' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
    });

    it('returns 400 on missing password field', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({ name: 'Alice' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('returns 400 on missing name field', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({ password: PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('returns 400 on empty body', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('returns 400 on unknown extra fields (strict schema)', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({ password: PASSWORD, name: 'Alice', extra: 'field' });
      expect(res.status).toBe(400);
    });

    it('rate-limits after 5 failed attempts', async () => {
      // Make 5 failed attempts (wrong password). The 6th should hit 429.
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/staff/auth')
          .send({ password: 'wrong', name: 'Attacker' });
      }
      const res = await request(app)
        .post('/staff/auth')
        .send({ password: 'wrong', name: 'Attacker' });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('rate_limited');
    });
  });

  describe('when STAFF_AUTH_ENABLED=false (authenticator=null)', () => {
    let app: Express;
    beforeEach(() => {
      app = makeApp(false);
    });

    it('returns 503 with staff_auth_disabled code', async () => {
      const res = await request(app)
        .post('/staff/auth')
        .send({ password: PASSWORD, name: 'Alice' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('staff_auth_disabled');
    });
  });
});
