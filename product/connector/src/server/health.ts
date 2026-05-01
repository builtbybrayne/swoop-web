/**
 * Health endpoints — liveness vs readiness split.
 *
 * Pattern matches Cloud Run / Kubernetes conventions so the eventual
 * deploy (M4, post-Thomas IAM grant) doesn't need a redesign:
 *
 *   - /healthz: process is alive. Synchronous. No DB call. Cheap. The
 *     orchestrator / load-balancer pings this to decide whether to send
 *     traffic at all.
 *
 *   - /readyz: process can serve traffic. Runs `SELECT 1` against the
 *     pool with a 1s budget. Returns 200 if green, 503 if the DB is
 *     unreachable / slow / paused. The orchestrator pings this to
 *     decide whether to *try this instance specifically* — if the
 *     pool is melted, fail the readiness probe and let traffic shift
 *     to a healthy peer.
 *
 * Not part of the MCP surface. These are vanilla HTTP endpoints the
 * server mounts alongside `/mcp`.
 */

import type { Request, Response } from 'express';
import type pg from 'pg';

const READINESS_TIMEOUT_MS = 1_000;

/** Plain liveness — the process is responsive. */
export function healthzHandler(_req: Request, res: Response): void {
  res.json({ status: 'ok', service: 'swoop-connector' });
}

/**
 * Build a readiness handler bound to a specific pool. Closure-captured
 * so the handler stays a plain `(req, res) => void` Express callback.
 */
export function buildReadyzHandler(pool: pg.Pool): (req: Request, res: Response) => Promise<void> {
  return async function readyzHandler(_req: Request, res: Response): Promise<void> {
    try {
      // Race the SELECT 1 against a 1s timeout. If pg's pool can't even
      // hand us a client in 1s, we're not ready — better to fail the
      // probe and let the load balancer route around us.
      const result = await Promise.race([
        pool.query('SELECT 1::int AS one').then(() => 'ok' as const),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), READINESS_TIMEOUT_MS),
        ),
      ]);
      if (result === 'ok') {
        res.json({ status: 'ready', db: 'ok' });
      } else {
        res.status(503).json({ status: 'not_ready', db: 'timeout' });
      }
    } catch (err) {
      res.status(503).json({
        status: 'not_ready',
        db: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
