/**
 * Per-tool handler dependency bag — the surface every handler body consumes.
 *
 * Wired once at registration time (`tools/index.ts`); tests inject their own
 * implementations and never touch the pool / Voyage client.
 */

import type pg from 'pg';
import type { EmbedQueryFn } from '../data/embed-query.js';

export interface ToolHandlerDeps {
  /**
   * Borrow-and-release a PoolClient for the duration of fn. Tools call this
   * once per primitive composition; the runtime guarantees release on throw.
   */
  withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  /** Embed a visitor utterance into the 1024d Voyage-3 search vector. */
  embedQuery: EmbedQueryFn;
}
