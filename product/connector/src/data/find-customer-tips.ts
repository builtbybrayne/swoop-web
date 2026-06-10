/**
 * Hybrid retrieval over `customer_tip`. Powers `find_tips`.
 *
 * Cosine + ts_rank fused via RRF, k=60 — the same shape as `find-inform-chunks`
 * (lookup), but against the traveller-sourced tip corpus instead of Swoop's own
 * inform_chunk guidance. The visitor's `topic` rides as the query (embedded +
 * tsquery); relevance comes purely from cosine + lexical alignment, not
 * structured tag narrowing (the "surface the data, let retrieval reason"
 * default for a small, fuzzy corpus). The tip text IS the topic signal — there
 * are no topic tags.
 *
 * The one structured narrowing we DO apply is an optional region filter:
 * `region = $r OR region IS NULL` — a region-specific ask still sees the large
 * pool of region-agnostic tips, never excludes them.
 *
 * customer_tip.id is INTEGER (carried from customertip.id upstream), so the
 * anti-repetition exclusion casts `::int[]`, not `::uuid[]`.
 */

import type pg from 'pg';
import { CustomerTipPublicSchema, type CustomerTipPublic } from '@swoop/common';

import { buildHybridSearchSql } from './hybrid-search.js';
import { provenanceFields } from './provenance.js';

export interface FindCustomerTipsOptions {
  /** Optional Patagonian sub-region filter. Region-agnostic tips always pass. */
  region?: string;
  /**
   * Tip ids to omit — anti-repetition. Orchestrator supplies from
   * `SessionState.seenItems.customer_tip`. customer_tip.id is INTEGER.
   */
  excludeIds?: ReadonlyArray<number>;
  limit: number;
}

export async function findCustomerTipsByTopic(
  client: pg.PoolClient,
  embedding: number[],
  query: string,
  opts: FindCustomerTipsOptions,
): Promise<CustomerTipPublic[]> {
  // Binds: $1 embedding, $2 query, $3 limit, then optional region + excludeIds.
  const binds: unknown[] = [`[${embedding.join(',')}]`, query, opts.limit];

  let regionFilter = '';
  if (opts.region && opts.region.trim().length > 0) {
    binds.push(opts.region.trim());
    // Region-agnostic tips (region IS NULL) always remain eligible.
    regionFilter = `AND (region = $${binds.length} OR region IS NULL)`;
  }

  let excludeFilter = '';
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push([...opts.excludeIds]);
    excludeFilter = `AND id <> ALL($${binds.length}::int[])`;
  }

  const sql = buildHybridSearchSql({
    vectorCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM customer_tip
      WHERE embedding IS NOT NULL ${regionFilter} ${excludeFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT 50
    `,
    textCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
      FROM customer_tip
      WHERE tsv @@ websearch_to_tsquery('english', $2) ${regionFilter} ${excludeFilter}
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
      LIMIT 50
    `,
    outerSelect: `
      SELECT ct.id, ct.text, ct.author_name,
             ct.region,
             ct.source_created_at AS source_published_at,
             fused.rrf_score
      FROM fused
      JOIN customer_tip ct ON ct.id = fused.id
    `,
    tail: `ORDER BY fused.rrf_score DESC LIMIT $3`,
  });

  const res = await client.query(sql, binds);
  return res.rows.map((r) =>
    CustomerTipPublicSchema.parse({
      id: r.id as number,
      text: r.text as string,
      authorName: r.author_name as string | null,
      region: r.region as string | null,
      // publishedAt ← customer_tip.source_created_at (tips have no titled
      // source, so provenanceFields never sets sourceTitle here — and
      // CustomerTipPublicSchema doesn't carry one).
      ...provenanceFields(r),
    }),
  );
}
