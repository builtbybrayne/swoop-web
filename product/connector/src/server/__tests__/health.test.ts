/**
 * Tests for the /healthz + /readyz endpoints.
 *
 * No real Postgres needed — readiness is exercised via the
 * `readinessHandler` injection point in `buildApp` so we can drive the
 * 200 / 503 branches deterministically without a live DB.
 *
 * Liveness is trivially synchronous and shouldn't depend on the pool;
 * the test enforces that by passing a *throwing* fake pool that would
 * crash if /healthz ever called it.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import type { Request, Response } from 'express';
import { buildApp } from '../app.js';

/**
 * A pg.Pool stand-in that throws if anything actually touches it. /healthz
 * must not query; /readyz uses the injected handler so it never gets here.
 */
function makeThrowingPool(): pg.Pool {
  return new Proxy({} as pg.Pool, {
    get() {
      throw new Error('test bug: a code path tried to use the pool');
    },
  });
}

describe('GET /healthz', () => {
  it('returns 200 ok without touching the pool', async () => {
    const app = buildApp({
      pool: makeThrowingPool(),
      readinessHandler: () => {
        throw new Error('readiness should not be called by /healthz');
      },
    });

    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'swoop-connector' });
  });
});

describe('GET /readyz', () => {
  it('returns 200 with db: ok when the readiness probe succeeds', async () => {
    const okHandler = async (_req: Request, res: Response): Promise<void> => {
      res.json({ status: 'ready', db: 'ok' });
    };
    const app = buildApp({ pool: makeThrowingPool(), readinessHandler: okHandler });

    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', db: 'ok' });
  });

  it('returns 503 when the readiness probe reports failure', async () => {
    const failHandler = async (_req: Request, res: Response): Promise<void> => {
      res.status(503).json({ status: 'not_ready', db: 'connection refused' });
    };
    const app = buildApp({ pool: makeThrowingPool(), readinessHandler: failHandler });

    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.db).toBe('connection refused');
  });
});
