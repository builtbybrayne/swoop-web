/**
 * Postgres pool singleton — the load-bearing artefact of C.t1.
 *
 * Every future SQL/vector primitive borrows a client through `withPgClient`.
 * Direct `pool.connect()` is forbidden in caller code: it leaks clients on
 * error paths and bypasses the statement-timeout setup. See planning/03-exec-c-t1.md
 * §"Outputs" + §"Anti-pattern guard".
 *
 * Tunables (see config/schema.ts):
 *   - PG_POOL_MAX:               max concurrent connections (default 10).
 *   - PG_POOL_IDLE_MS:           idle eviction window (default 30s).
 *   - PG_STATEMENT_TIMEOUT_MS:   per-connection statement-timeout backstop
 *                                (default 10s; ETL paths may want longer
 *                                via per-connection override).
 *
 * Lifecycle:
 *   - `getPool(config)` lazily creates the pool on first call. Subsequent
 *     calls return the same instance (per process — Node's module cache
 *     gives us the singleton for free).
 *   - `closePool()` calls `pool.end()` and clears the cached instance. Wired
 *     to SIGTERM / SIGINT in the server entrypoint. Idempotent — calling
 *     twice is a no-op.
 *
 * Why memoise inside this module rather than passing the pool around as DI:
 * Node's module cache means a single import gives all callers the same
 * instance. Tests that need isolation either set DATABASE_URL to point at a
 * fresh DB then close the pool between tests, or skip if no DATABASE_URL is
 * present (the integration-test gate below). The borrow-and-release pattern
 * via `withPgClient` makes lifecycle bugs obvious.
 */

import pg from 'pg';
import type { Config } from '../config/index.js';

let cachedPool: pg.Pool | undefined;

/**
 * Build the pool config from the validated Config object.
 * Exported for testability.
 */
export function buildPoolConfig(config: Config): pg.PoolConfig {
  return {
    connectionString: config.DATABASE_URL,
    max: config.PG_POOL_MAX,
    idleTimeoutMillis: config.PG_POOL_IDLE_MS,
    // `application_name` shows up in pg_stat_activity — useful for ops
    // (Cloud SQL Insights, manual pgAdmin sessions) when one of N services
    // is the one holding a long query.
    application_name: 'swoop-connector',
  };
}

/**
 * Lazily build (and memoise) the pool. Pass the validated Config so the pool
 * is constructed from the same source of truth the rest of the service uses.
 */
export function getPool(config: Config): pg.Pool {
  if (cachedPool) return cachedPool;

  const pool = new pg.Pool(buildPoolConfig(config));

  // Apply statement_timeout per connection. Cloud SQL Postgres does not
  // honour statement_timeout passed via connection options, so we set it
  // SQL-side once per checkout. The backstop is "something is very wrong;
  // kill the query" — typical agent-facing tool calls should respond in
  // <500ms via HNSW + GIN. ETL paths can override per-connection via
  // `client.query("SET LOCAL statement_timeout = ${ms}")` inside their
  // batch transactions.
  pool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${config.PG_STATEMENT_TIMEOUT_MS}`).catch((err) => {
      // We can't refuse the connection from a 'connect' handler — pg has
      // already added it to the pool. Log and let the next query surface the
      // real issue if statement_timeout actually matters here.
      console.warn(
        `[connector] failed to set statement_timeout on new connection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  });

  // Surface unexpected idle-client errors. Without this listener pg throws
  // them as `uncaughtException`, which crashes the process. We log + swallow
  // so a single hiccup doesn't bring the service down; the borrowed-client
  // path (`withPgClient`) still surfaces real errors to callers.
  pool.on('error', (err) => {
    console.error(
      `[connector] idle pg client error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  cachedPool = pool;
  return pool;
}

/**
 * Borrow-and-release a `PoolClient` for the duration of `fn`. Always
 * releases the client, even on throw. This is the primitive every future
 * data primitive will go through — it makes leak bugs hard to write.
 */
export async function withPgClient<T>(
  config: Config,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool(config);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Close the pool. Idempotent — calling twice is a no-op. Wired to SIGTERM /
 * SIGINT in the server entrypoint.
 */
export async function closePool(): Promise<void> {
  const pool = cachedPool;
  cachedPool = undefined;
  if (pool) {
    await pool.end();
  }
}

/**
 * Test-only helper. Reset the memoised pool *without* closing it. Used by
 * tests that want to swap the config under their feet. Production code
 * never calls this — use `closePool()` instead.
 */
export function _resetPoolForTesting(): void {
  cachedPool = undefined;
}
