/**
 * FAQ item embedding pass.
 *
 * Source: `faqitem` (~906 rows post-C.t3).
 * Operation: embed `title + ' ' + content` (Q + A as one chunk), UPSERT
 * into `faqitem.embedding`.
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-pass design — embed/faqitems.ts".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import { embedInBatches, GeminiClient } from '../gemini.js';
import { toPgVectorLiteral } from '../pool.js';
import { stripHtml } from '../chunk.js';

interface FaqRow {
  id: number;
  title: string;
  content: string;
}

export interface EmbedFaqOptions {
  client: pg.PoolClient;
  embeddingClient: GeminiClient;
  ledger: CostLedger;
  limit?: number;
  dryRun?: boolean;
}

export interface EmbedFaqResult {
  rowsConsidered: number;
  rowsEmbedded: number;
  rowsSkipped: number;
  estimatedTokens: number;
}

export async function readFaqRows(client: pg.PoolClient, limit?: number): Promise<FaqRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  const result = await client.query<{ id: number; title: string; content: string }>(
    `SELECT id, title, content
     FROM faqitem
     WHERE embedding IS NULL
     ORDER BY id
     ${limitClause}`,
  );
  return result.rows;
}

export function faqEmbeddingInputText(row: FaqRow): string {
  return `${row.title.trim()}\n\n${stripHtml(row.content).trim()}`;
}

export async function embedFaqItems(opts: EmbedFaqOptions): Promise<EmbedFaqResult> {
  const todo = await readFaqRows(opts.client, opts.limit);
  let tokens = 0;
  for (const r of todo) tokens += approxTokenCount(faqEmbeddingInputText(r));

  if (opts.dryRun) {
    return { rowsConsidered: todo.length, rowsEmbedded: 0, rowsSkipped: 0, estimatedTokens: tokens };
  }
  if (todo.length === 0) {
    return { rowsConsidered: 0, rowsEmbedded: 0, rowsSkipped: 0, estimatedTokens: 0 };
  }

  const out = await embedInBatches(opts.embeddingClient, todo, faqEmbeddingInputText, {
    // batchSize + concurrency intentionally unset — defer to env-var-overridable
    // defaults so operators can dial down for rate-limit windows.
    shouldAbort: () => opts.ledger.shouldAbort(),
    onBatchComplete: (t) => opts.ledger.recordEmbedding('gemini:faqitem', t, 1),
  });

  for (const { item, embedding } of out) {
    await opts.client.query(
      `UPDATE faqitem SET embedding = $1::halfvec(3072), modified_at = NOW() WHERE id = $2`,
      [toPgVectorLiteral(embedding), item.id],
    );
  }

  return {
    rowsConsidered: todo.length,
    rowsEmbedded: out.length,
    rowsSkipped: 0,
    estimatedTokens: tokens,
  };
}
