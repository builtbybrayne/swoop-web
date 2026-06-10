/**
 * Hybrid retrieval over `inform_chunk`. Powers `lookup`.
 *
 * Cosine + ts_rank fused via RRF, k=60. No filter narrowing — the question
 * shape is whatever the visitor asked, and topic narrowing happens via
 * cosine alignment with the right chunk, not via structured filters.
 */

import type pg from 'pg';
import { InformChunkPublicSchema, type InformChunkPublic } from '@swoop/common';

import { buildHybridSearchSql } from './hybrid-search.js';
import { provenanceFields } from './provenance.js';

export interface FindInformChunksOptions {
  /**
   * Chunk uuids to omit — anti-repetition. Orchestrator supplies from
   * `SessionState.seenItems.inform_chunk`. Per
   * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
   */
  excludeIds?: ReadonlyArray<string>;
  limit: number;
}

export async function findInformChunksByQuestion(
  client: pg.PoolClient,
  embedding: number[],
  query: string,
  opts: FindInformChunksOptions,
): Promise<InformChunkPublic[]> {
  // Anti-repetition: apply id-exclusion inside both CTEs so excluded chunks
  // never compete for the top-50 RRF candidate slots. Empty-array safe via
  // `<> ALL($N::uuid[])`. The exclude list rides as bind $4 (after embedding,
  // query, limit).
  const binds: unknown[] = [`[${embedding.join(',')}]`, query, opts.limit];
  let excludeFilter = '';
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push([...opts.excludeIds]);
    excludeFilter = `AND id <> ALL($${binds.length}::uuid[])`;
  }

  const sql = buildHybridSearchSql({
    vectorCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM inform_chunk
      WHERE embedding IS NOT NULL ${excludeFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT 50
    `,
    textCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
      FROM inform_chunk
      WHERE tsv @@ websearch_to_tsquery('english', $2) ${excludeFilter}
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
      LIMIT 50
    `,
    outerSelect: `
      SELECT ic.id, ic.question, ic.text, ic.canonical_url,
             COALESCE(ic.topic_tags, '{}') AS topic_tags,
             ic.source_title, ic.source_published_at,
             fused.rrf_score
      FROM fused
      JOIN inform_chunk ic ON ic.id = fused.id
    `,
    tail: `ORDER BY fused.rrf_score DESC LIMIT $3`,
  });

  const res = await client.query(sql, binds);
  return res.rows.map((r) =>
    InformChunkPublicSchema.parse({
      id: r.id as string,
      question: r.question as string | null,
      text: r.text as string,
      canonicalUrl: r.canonical_url as string | null,
      topicTags: (r.topic_tags ?? []) as string[],
      ...provenanceFields(r),
    }),
  );
}
