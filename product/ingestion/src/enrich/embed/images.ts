/**
 * Image embedding pass — text-only.
 *
 * Per the 2026-04-29 image text-field discovery: ~47.5% of images carry
 * `description`. Those embed cheaply via Voyage. The remaining ~52% wait for
 * C.t6's vision pass (which writes `description`); a follow-up enrich run
 * picks them up.
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-pass design — embed/images.ts" +
 * §"Open questions" #C.40 (boundary with C.t6).
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import { embedInBatches, VoyageClient } from '../voyage.js';
import { toPgVectorLiteral } from '../pool.js';

interface ImageRow {
  id: number;
  description: string;
  alt_text: string | null;
}

export interface EmbedImagesOptions {
  client: pg.PoolClient;
  voyage: VoyageClient;
  ledger: CostLedger;
  limit?: number;
  dryRun?: boolean;
}

export interface EmbedImagesResult {
  rowsConsidered: number;
  rowsEmbedded: number;
  rowsSkippedNoText: number;
  rowsSkippedAlreadyEmbedded: number;
  estimatedTokens: number;
}

export async function readImagesNeedingEmbedding(
  client: pg.PoolClient,
  limit?: number,
): Promise<ImageRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  // Embed only rows with non-empty description AND no embedding yet.
  const result = await client.query<{ id: number; description: string; alt_text: string | null }>(
    `SELECT id, description, alt_text
     FROM image
     WHERE embedding IS NULL
       AND description IS NOT NULL
       AND length(trim(description)) > 0
     ORDER BY id
     ${limitClause}`,
  );
  return result.rows;
}

export async function countImagesWithoutText(client: pg.PoolClient): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM image
     WHERE description IS NULL OR length(trim(description)) = 0`,
  );
  return Number(r.rows[0]?.n ?? '0');
}

export function imageEmbeddingInputText(row: ImageRow): string {
  // alt_text is a useful hint; concatenate where present so the embedding
  // captures both the dense description and the SEO/screenreader caption.
  return `${row.description.trim()} ${row.alt_text ?? ''}`.trim();
}

export async function embedImages(opts: EmbedImagesOptions): Promise<EmbedImagesResult> {
  const todo = await readImagesNeedingEmbedding(opts.client, opts.limit);
  const skippedNoText = await countImagesWithoutText(opts.client);

  let tokens = 0;
  for (const r of todo) tokens += approxTokenCount(imageEmbeddingInputText(r));

  if (opts.dryRun) {
    return {
      rowsConsidered: todo.length,
      rowsEmbedded: 0,
      rowsSkippedNoText: skippedNoText,
      rowsSkippedAlreadyEmbedded: 0,
      estimatedTokens: tokens,
    };
  }
  if (todo.length === 0) {
    return {
      rowsConsidered: 0,
      rowsEmbedded: 0,
      rowsSkippedNoText: skippedNoText,
      rowsSkippedAlreadyEmbedded: 0,
      estimatedTokens: 0,
    };
  }

  const out = await embedInBatches(opts.voyage, todo, imageEmbeddingInputText, {
    batchSize: 128,
    concurrency: 4,
    shouldAbort: () => opts.ledger.shouldAbort(),
    onBatchComplete: (t) => opts.ledger.recordVoyage('voyage:image', t, 1),
  });

  for (const { item, embedding } of out) {
    await opts.client.query(
      `UPDATE image SET embedding = $1::vector(1024), modified_at = NOW() WHERE id = $2`,
      [toPgVectorLiteral(embedding), item.id],
    );
  }

  return {
    rowsConsidered: todo.length,
    rowsEmbedded: out.length,
    rowsSkippedNoText: skippedNoText,
    rowsSkippedAlreadyEmbedded: 0,
    estimatedTokens: tokens,
  };
}
