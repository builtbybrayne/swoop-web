/**
 * Hybrid retrieval over `trust_proof`. Powers `find_proof`.
 *
 * Cosine + ts_rank fused via RRF, k=60. Optional `topic` filter is a
 * structured B-tree narrowing applied inside both CTEs (pre-RRF).
 */

import type pg from 'pg';
import {
  TrustProofPublicSchema,
  type TrustProofPublic,
  type TrustProofTopic,
} from '@swoop/common';

import { buildHybridSearchSql } from './hybrid-search.js';

export interface FindTrustProofsOptions {
  topic?: TrustProofTopic | null;
  /**
   * Proof uuids to omit — anti-repetition. Orchestrator supplies from
   * `SessionState.seenItems.trust_proof`. Per
   * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
   */
  excludeIds?: ReadonlyArray<string>;
  limit: number;
}

export async function findTrustProofsByConcern(
  client: pg.PoolClient,
  embedding: number[],
  query: string,
  opts: FindTrustProofsOptions,
): Promise<TrustProofPublic[]> {
  const binds: unknown[] = [`[${embedding.join(',')}]`, query, opts.limit];
  const filterClauses: string[] = [];
  if (opts.topic) {
    binds.push(opts.topic);
    filterClauses.push(`topic = $${binds.length}`);
  }
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push([...opts.excludeIds]);
    filterClauses.push(`id <> ALL($${binds.length}::uuid[])`);
  }
  const whereFilter =
    filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

  const sql = buildHybridSearchSql({
    vectorCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM trust_proof
      WHERE embedding IS NOT NULL ${whereFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT 50
    `,
    textCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
      FROM trust_proof
      WHERE tsv @@ websearch_to_tsquery('english', $2) ${whereFilter}
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
      LIMIT 50
    `,
    outerSelect: `
      SELECT tp.id, tp.topic, tp.claim, tp.evidence, tp.canonical_url, fused.rrf_score
      FROM fused
      JOIN trust_proof tp ON tp.id = fused.id
    `,
    tail: `ORDER BY fused.rrf_score DESC LIMIT $3`,
  });

  const res = await client.query(sql, binds);
  return res.rows.map((r) =>
    TrustProofPublicSchema.parse({
      id: r.id as string,
      topic: r.topic as TrustProofTopic,
      claim: r.claim as string,
      evidence: r.evidence as string,
      canonicalUrl: r.canonical_url as string | null,
    }),
  );
}
