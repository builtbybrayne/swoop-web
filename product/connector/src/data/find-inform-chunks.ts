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

export interface FindInformChunksOptions {
  limit: number;
}

export async function findInformChunksByQuestion(
  client: pg.PoolClient,
  embedding: number[],
  query: string,
  opts: FindInformChunksOptions,
): Promise<InformChunkPublic[]> {
  const sql = buildHybridSearchSql({
    vectorCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM inform_chunk
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 50
    `,
    textCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
      FROM inform_chunk
      WHERE tsv @@ websearch_to_tsquery('english', $2)
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
      LIMIT 50
    `,
    outerSelect: `
      SELECT ic.id, ic.question, ic.text, ic.canonical_url,
             COALESCE(ic.topic_tags, '{}') AS topic_tags,
             fused.rrf_score
      FROM fused
      JOIN inform_chunk ic ON ic.id = fused.id
    `,
    tail: `ORDER BY fused.rrf_score DESC LIMIT $3`,
  });

  const res = await client.query(sql, [
    `[${embedding.join(',')}]`,
    query,
    opts.limit,
  ]);
  return res.rows.map((r) =>
    InformChunkPublicSchema.parse({
      id: r.id as string,
      question: r.question as string | null,
      text: r.text as string,
      canonicalUrl: r.canonical_url as string | null,
      topicTags: (r.topic_tags ?? []) as string[],
    }),
  );
}
