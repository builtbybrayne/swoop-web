/**
 * Generic derived-table row embedder.
 *
 * The five derived tables (`inspire_passage`, `customer_story`, `trust_proof`,
 * `inform_chunk`, `trip_card`) all share the same shape: a `text` column +
 * an `embedding vector(1024)` column + `content_hash`. This helper embeds
 * any row whose `embedding IS NULL`, populating the `tsv` column inline via
 * `to_tsvector('english', text)` so the GIN index stays useful.
 *
 * `customer_story` is the exception — Mirror retrieval matches against
 * `persona_embedding`, not a content embedding (decision C.30). For that
 * table we embed `persona_summary` into `persona_embedding`. Caller picks
 * the right field via `embedColumn` + `textColumn`.
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-pass design — Per-source-row
 * embedding" + §"E. Compose derived tables".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount, type LedgerPassKey } from '../cost.js';
import { embedInBatches, GeminiClient } from '../gemini.js';
import { toPgVectorLiteral } from '../pool.js';

interface DerivedRow {
  id: string; // UUID
  text: string;
}

export interface EmbedDerivedTableOptions {
  client: pg.PoolClient;
  embeddingClient: GeminiClient;
  ledger: CostLedger;
  /** e.g. 'inspire_passage' */
  table: string;
  /** Field whose text is embedded — usually 'text', or 'persona_summary' for customer_story. */
  textColumn: string;
  /** Field receiving the embedding — usually 'embedding', or 'persona_embedding' for customer_story. */
  embedColumn: string;
  /** Cost-ledger key. */
  ledgerKey: LedgerPassKey;
  /** Whether to also populate `tsv = to_tsvector('english', text)` on the same row. */
  populateTsv?: boolean;
  /** ID column type — UUID for inspire_passage/customer_story/trust_proof/inform_chunk; INTEGER for trip_card. */
  idColumn?: 'uuid' | 'integer';
  limit?: number;
  dryRun?: boolean;
}

export interface EmbedDerivedTableResult {
  table: string;
  rowsConsidered: number;
  rowsEmbedded: number;
  estimatedTokens: number;
}

export async function embedDerivedTable(
  opts: EmbedDerivedTableOptions,
): Promise<EmbedDerivedTableResult> {
  const limitClause = opts.limit && opts.limit > 0 ? `LIMIT ${opts.limit}` : '';
  const r = await opts.client.query<DerivedRow>(
    `SELECT id::text AS id, ${opts.textColumn} AS text
     FROM ${opts.table}
     WHERE ${opts.embedColumn} IS NULL
       AND ${opts.textColumn} IS NOT NULL
       AND length(trim(${opts.textColumn})) > 0
     ORDER BY id
     ${limitClause}`,
  );
  const todo = r.rows;
  let estimatedTokens = 0;
  for (const row of todo) estimatedTokens += approxTokenCount(row.text);

  if (opts.dryRun) {
    return {
      table: opts.table,
      rowsConsidered: todo.length,
      rowsEmbedded: 0,
      estimatedTokens,
    };
  }
  if (todo.length === 0) {
    return { table: opts.table, rowsConsidered: 0, rowsEmbedded: 0, estimatedTokens: 0 };
  }

  const out = await embedInBatches(opts.embeddingClient, todo, (row) => row.text, {
    batchSize: 100,
    concurrency: 4,
    shouldAbort: () => opts.ledger.shouldAbort(),
    onBatchComplete: (t) => opts.ledger.recordEmbedding(opts.ledgerKey, t, 1),
  });

  // Cast id literal: UUID needs ::uuid, INTEGER cast inferred.
  const idCast = (opts.idColumn ?? 'uuid') === 'uuid' ? '::uuid' : '::integer';

  for (const { item, embedding } of out) {
    if (opts.populateTsv) {
      await opts.client.query(
        `UPDATE ${opts.table}
         SET ${opts.embedColumn} = $1::halfvec(3072),
             tsv = to_tsvector('english', ${opts.textColumn}),
             modified_at = NOW()
         WHERE id = $2${idCast}`,
        [toPgVectorLiteral(embedding), item.id],
      );
    } else {
      await opts.client.query(
        `UPDATE ${opts.table}
         SET ${opts.embedColumn} = $1::halfvec(3072),
             modified_at = NOW()
         WHERE id = $2${idCast}`,
        [toPgVectorLiteral(embedding), item.id],
      );
    }
  }

  return {
    table: opts.table,
    rowsConsidered: todo.length,
    rowsEmbedded: out.length,
    estimatedTokens,
  };
}
