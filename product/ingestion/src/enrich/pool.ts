/**
 * Postgres pool helper for the enrich pass.
 *
 * Mirrors the connector's `withPgClient` pattern (product/connector/src/data/pool.ts)
 * — borrow-and-release via a callback so leaks are hard to write — but lives
 * in @swoop/ingestion to keep the workspace boundary clean. Importing
 * @swoop/connector from @swoop/ingestion would couple the ETL package to the
 * service package's whole dep tree (Express, MCP SDK, helmet) for one
 * function. Plan: planning/03-exec-c-t3a.md §"Outputs — pool.ts".
 *
 * `statement_timeout` is set via libpq `options` startup param to side-step
 * the `on('connect')` race that produced a deprecation warning during
 * connector smoke testing (see discoveries.md 2026-05-01 + gotchas.md).
 */

import pg from 'pg';

let cached: pg.Pool | undefined;

export interface EnrichPoolConfig {
  databaseUrl: string;
  /** Default 4 — ETL passes are concurrency-bounded by Voyage / Haiku, not Postgres. */
  poolMax?: number;
  /** Default 30s. */
  idleTimeoutMs?: number;
  /** Default 60s — ETL queries (large SELECTs, batched inserts) want more headroom than the service default of 10s. */
  statementTimeoutMs?: number;
}

export function buildEnrichPoolConfig(c: EnrichPoolConfig): pg.PoolConfig {
  return {
    connectionString: c.databaseUrl,
    max: c.poolMax ?? 4,
    idleTimeoutMillis: c.idleTimeoutMs ?? 30_000,
    application_name: 'swoop-enrich',
    options: `-c statement_timeout=${c.statementTimeoutMs ?? 60_000}`,
  };
}

export function getEnrichPool(c: EnrichPoolConfig): pg.Pool {
  if (cached) return cached;
  const pool = new pg.Pool(buildEnrichPoolConfig(c));
  pool.on('error', (err) => {
    console.error(`[enrich/pool] idle pg error: ${err instanceof Error ? err.message : err}`);
  });
  cached = pool;
  return pool;
}

export async function withEnrichClient<T>(
  c: EnrichPoolConfig,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getEnrichPool(c);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closeEnrichPool(): Promise<void> {
  const pool = cached;
  cached = undefined;
  if (pool) await pool.end();
}

export function _resetEnrichPoolForTesting(): void {
  cached = undefined;
}

/**
 * Serialise a number[] embedding into pgvector's text format.
 *
 * pgvector accepts `[0.1,0.2,...]` (no spaces, square brackets). The native
 * `pg` driver doesn't ship a vector type adaptor, so we cast to text and let
 * Postgres parse it via `::vector(1024)` in the SQL.
 */
export function toPgVectorLiteral(embedding: ReadonlyArray<number>): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Parse pgvector's text format back into number[]. Lenient on whitespace.
 */
export function fromPgVectorLiteral(literal: string | null | undefined): number[] | null {
  if (!literal) return null;
  const trimmed = literal.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(',').map((s) => Number(s.trim()));
}
