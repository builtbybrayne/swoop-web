/**
 * SSE heartbeat — B.t5.
 *
 * Many proxies and ingresses (Cloud Run's front load balancer, nginx, browser
 * intermediary CDNs) silently drop SSE connections that sit idle for too
 * long. Most default around 60s; a 15s heartbeat keeps well under every
 * common threshold.
 *
 * We emit an SSE comment line (`: ping\n\n`). Comment lines are valid SSE
 * per the EventStream spec but carry no `data:` or `event:` — they never
 * fire a client handler, so chunk D's renderer doesn't need to filter them.
 *
 * The caller owns the lifecycle: `startHeartbeat(res)` returns a disposer
 * which MUST be called when the stream closes (normally or on error),
 * otherwise a timer leaks on the process.
 */

import type { Response } from 'express';

export const HEARTBEAT_INTERVAL_MS = 15_000;

export function startHeartbeat(
  res: Response,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    // `res.write` may reject if the socket is already gone; swallow — the
    // consumer is about to clean up anyway via the `close` hook.
    try {
      res.write(`: ping\n\n`);
    } catch {
      // no-op
    }
  }, intervalMs);
  // Don't keep the event loop alive just for heartbeats.
  timer.unref?.();
  return () => clearInterval(timer);
}
