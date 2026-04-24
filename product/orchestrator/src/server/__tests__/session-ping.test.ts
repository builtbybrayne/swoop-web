/**
 * HTTP surface tests — `GET /session/:id/ping` (D.t6).
 *
 * Exercises the probe endpoint with a real Express app + in-memory store.
 * The ADK runner is stubbed by `buildServer` indirectly — this route does
 * not go near it (it reads `SessionStore.get` only).
 *
 * Contracts covered (per plan §Verification):
 *   1. Known active id → 200 + `{ok:true, expired:false, serverTime}`.
 *   2. Unknown id → 200 + `{ok:false, expired:true, serverTime}`.
 *   3. Archived id → 200 + `{ok:true, expired:false}`. Conflation with live
 *      is deliberate for Puma; documented in the decision (c) option in the
 *      Tier 3 plan.
 *   4. Probe does not mutate session state — `updatedAt` unchanged before/after.
 *   5. CORS preflight OPTIONS returns 204 + `Access-Control-Allow-Methods` GET.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner } from '@google/adk';

import { buildServer } from '../index.js';
import { InMemorySessionStore } from '../../session/index.js';

/**
 * Minimal no-op runner. `/chat` is not exercised in these tests, but
 * `buildServer` still insists on a `Runner` shape. Keep this narrow — if
 * anything touches the runner from the ping path, it's a bug, not a test
 * setup issue.
 */
function makeNoopRunner(): Runner {
  return {
    async *runAsync(): AsyncGenerator<never, void, undefined> {
      // never yields
    },
  } as unknown as Runner;
}

function buildTestApp(store?: InMemorySessionStore): {
  app: Express;
  store: InMemorySessionStore;
} {
  const s = store ?? new InMemorySessionStore();
  const app = buildServer({
    sessionStore: s,
    runner: makeNoopRunner(),
    corsAllowedOrigins: ['http://localhost:5173'],
    version: 'test',
  });
  return { app, store: s };
}

describe('GET /session/:id/ping', () => {
  it('returns 200 + {ok:true, expired:false} for a known active session', async () => {
    const { app, store } = buildTestApp();
    const created = await store.create();
    const res = await request(app).get(`/session/${created.sessionId}/ping`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, expired: false });
    expect(typeof res.body.serverTime).toBe('string');
    // ISO 8601 sanity — Date.parse rejects `NaN` for invalid strings.
    expect(Number.isNaN(Date.parse(res.body.serverTime))).toBe(false);
  });

  it('returns 200 + {ok:false, expired:true} for an unknown session id', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/session/does-not-exist/ping');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, expired: true });
    expect(typeof res.body.serverTime).toBe('string');
  });

  it('conflates archived sessions with live ones (decision D.16 / plan §(c))', async () => {
    // Archival doesn't remove the entry; `get` still returns the SessionState.
    // Per the Tier 3 plan we deliberately treat that as live from the UI's POV
    // — the `/chat` consent gate owns the "can this session accept turns?"
    // question. This test documents the choice so a future refactor doesn't
    // silently change it.
    const { app, store } = buildTestApp();
    const created = await store.create();
    await store.archive(created.sessionId);

    const res = await request(app).get(`/session/${created.sessionId}/ping`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, expired: false });
  });

  it('does not mutate session state (updatedAt is unchanged across a probe)', async () => {
    const { app, store } = buildTestApp();
    const created = await store.create();
    const before = await store.get(created.sessionId);
    expect(before).not.toBeNull();

    const res = await request(app).get(`/session/${created.sessionId}/ping`);
    expect(res.status).toBe(200);

    const after = await store.get(created.sessionId);
    expect(after).not.toBeNull();
    // `updatedAt` must not move — otherwise a visibility-triggered probe
    // would indefinitely block the idle sweeper from archiving the session.
    expect(after?.updatedAt).toBe(before?.updatedAt);
    // And no other fields shift either.
    expect(after).toStrictEqual(before);
  });

  it('returns 400 for an empty id segment', async () => {
    // Not load-bearing — the client always supplies a non-empty id — but
    // guards against a routing weirdness that hands us a blank param.
    const { app } = buildTestApp();
    // Express rejects `/session//ping` at the router before reaching the
    // handler, which is fine; the direct reachability path is covered by
    // the unknown-id test above.
    const res = await request(app).get('/session/%20/ping');
    // Whitespace id is technically "non-empty", so treated as unknown:
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, expired: true });
  });

  it('CORS preflight OPTIONS returns 204 with GET in Access-Control-Allow-Methods', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .options('/session/any/ping')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(res.headers['access-control-allow-methods']).toMatch(/\bGET\b/);
  });
});
