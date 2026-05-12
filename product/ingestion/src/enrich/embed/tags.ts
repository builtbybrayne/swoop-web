/**
 * Tag taxonomy embedding pass — the cheapest pass; runs first to verify
 * the Voyage client end-to-end before committing to expensive ones.
 *
 * Source: 79 rows in `tag` (per C.t3 ingestion of `ntag`).
 * Operation: embed `title + ' ' + (alias || '') + ' ' + (type || '')`,
 * UPSERT into `tag.embedding`.
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-pass design — A. Tag taxonomy embed".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import { contentHash } from '../hash.js';
import { embedInBatches, GeminiClient } from '../gemini.js';
import { toPgVectorLiteral } from '../pool.js';

const SOURCE_TYPE = 'tag';

interface TagRow {
  id: number;
  title: string;
  alias: string | null;
  type: string;
  /** Stored content_hash on the row, or null if never embedded. */
  storedHash: string | null;
}

export interface EmbedTagsOptions {
  client: pg.PoolClient;
  embeddingClient: GeminiClient;
  ledger: CostLedger;
  /** Optional row limit (testing). */
  limit?: number;
  /** Dry-run: read source rows + plan, never call Gemini, never write. */
  dryRun?: boolean;
}

export interface EmbedTagsResult {
  rowsConsidered: number;
  rowsEmbedded: number;
  rowsSkipped: number;
  estimatedTokens: number;
}

/**
 * Read the 79-ish active tag rows. Returns rows sorted by id for stable
 * ordering across runs (deterministic batches → deterministic hashes).
 */
export async function readTagRows(
  client: pg.PoolClient,
  limit?: number,
): Promise<TagRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  const result = await client.query<{
    id: number;
    title: string;
    alias: string | null;
    type: string;
    has_embedding: boolean;
  }>(
    `SELECT id, title, alias, type, embedding IS NOT NULL AS has_embedding
     FROM tag
     WHERE is_active = TRUE
     ORDER BY id
     ${limitClause}`,
  );
  // We don't store the hash on tag (no content_hash column on the simple
  // domain tables — only the derived tables have it). For embed-domain-rows
  // passes, idempotency is by `embedding IS NULL`. Re-running will skip rows
  // that already carry an embedding. Re-embedding requires a manual
  // `UPDATE tag SET embedding = NULL` first.
  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    alias: r.alias,
    type: r.type,
    storedHash: r.has_embedding ? 'present' : null,
  }));
}

export function tagEmbeddingInputText(row: { title: string; alias: string | null; type: string }): string {
  return `${row.title} ${row.alias ?? ''} ${row.type ?? ''}`.replace(/\s+/g, ' ').trim();
}

export async function embedTags(opts: EmbedTagsOptions): Promise<EmbedTagsResult> {
  const rows = await readTagRows(opts.client, opts.limit);
  const todo = rows.filter((r) => r.storedHash === null);

  let estimatedTokens = 0;
  for (const r of todo) estimatedTokens += approxTokenCount(tagEmbeddingInputText(r));

  if (opts.dryRun) {
    return {
      rowsConsidered: rows.length,
      rowsEmbedded: 0,
      rowsSkipped: rows.length - todo.length,
      estimatedTokens,
    };
  }

  if (todo.length === 0) {
    return { rowsConsidered: rows.length, rowsEmbedded: 0, rowsSkipped: rows.length, estimatedTokens: 0 };
  }

  const out = await embedInBatches(opts.embeddingClient, todo, tagEmbeddingInputText, {
    batchSize: 100,
    concurrency: 2, // tiny pass, no benefit from higher concurrency.
    shouldAbort: () => opts.ledger.shouldAbort(),
    onBatchComplete: (tokens) => opts.ledger.recordEmbedding('gemini:tag', tokens, 1),
  });

  // UPSERT-style update: write the embedding inline. The `tag` table doesn't
  // have a content_hash column (per migrations 002), so re-runs short-circuit
  // via "embedding IS NOT NULL".
  for (const { item, embedding } of out) {
    const literal = toPgVectorLiteral(embedding);
    await opts.client.query(
      `UPDATE tag SET embedding = $1::halfvec(3072), modified_at = NOW() WHERE id = $2`,
      [literal, item.id],
    );
    // Inject a hash also into a side-channel? No — for tag the simple "is
    // embedding null" gate is enough; the hash machinery is for derived tables
    // where prose changes drive re-embeds. Tags rarely change.
  }

  return {
    rowsConsidered: rows.length,
    rowsEmbedded: out.length,
    rowsSkipped: rows.length - todo.length,
    estimatedTokens,
  };
}

/**
 * Compute the content hash for a tag row. Exported so tests can verify
 * idempotency without round-tripping through Postgres.
 */
export function tagContentHash(row: { title: string; alias: string | null; type: string }): string {
  return contentHash(tagEmbeddingInputText(row), SOURCE_TYPE);
}
