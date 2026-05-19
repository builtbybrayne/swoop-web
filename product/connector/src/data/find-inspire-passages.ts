/**
 * Hybrid retrieval over `inspire_passage`. Powers `find_inspiring`.
 *
 * Cosine-distance ANN on `embedding` + ts_rank on `tsv`, fused via RRF
 * (k=60). Optional `region` filter is a simple ILIKE match on the denormalised
 * `region` column; optional `mood` filter likewise on `mood`.
 */

import type pg from 'pg';
import { InspirePassagePublicSchema, type InspirePassagePublic } from '@swoop/common';

import { buildHybridSearchSql } from './hybrid-search.js';
import { resolveImagesByIds } from './resolve-image.js';

export interface FindInspirePassagesOptions {
  region?: string | null;
  mood?: string | null;
  limit: number;
}

export async function findInspirePassages(
  client: pg.PoolClient,
  embedding: number[],
  query: string,
  opts: FindInspirePassagesOptions,
): Promise<InspirePassagePublic[]> {
  const filterClauses: string[] = [];
  const filterBinds: unknown[] = [];

  if (opts.region) {
    filterBinds.push(`%${opts.region}%`);
    filterClauses.push(`region ILIKE $${filterBinds.length + 3}`);
  }
  if (opts.mood) {
    filterBinds.push(`%${opts.mood}%`);
    filterClauses.push(`mood ILIKE $${filterBinds.length + 3}`);
  }
  const whereFilter =
    filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

  const sql = buildHybridSearchSql({
    vectorCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM inspire_passage
      WHERE embedding IS NOT NULL ${whereFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT 50
    `,
    textCte: `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
      FROM inspire_passage
      WHERE tsv @@ websearch_to_tsquery('english', $2) ${whereFilter}
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
      LIMIT 50
    `,
    outerSelect: `
      SELECT * FROM (
        SELECT DISTINCT ON (ip.canonical_url, img.canonical_url)
          ip.id, ip.text, ip.canonical_url, ip.region, ip.mood, ip.image_id, fused.rrf_score
        FROM fused
        JOIN inspire_passage ip ON ip.id = fused.id
        LEFT JOIN image img ON img.id = ip.image_id
        ORDER BY ip.canonical_url, img.canonical_url, fused.rrf_score DESC
      ) deduped
    `,
    // Per-(page-URL, image-URL) dedup: the schema's content_hash idempotency
    // dedupes by text bytes, but the same logical page often ingests as
    // multiple source rows (page.intro_text + a contentblock on the same
    // page, etc.) with near-identical prose that hash distinctly. The outer
    // subquery collapses these — DISTINCT ON keeps the highest-RRF row per
    // (page URL, image URL) pair. NULL image URL groups with NULL image URL
    // (Postgres treats NULL = NULL inside DISTINCT ON), so image-less
    // passages from the same page still collapse. Outer ORDER BY re-sorts
    // the deduped set by RRF and applies the visitor-facing limit.
    tail: `ORDER BY rrf_score DESC LIMIT $3`,
  });

  const res = await client.query(sql, [
    `[${embedding.join(',')}]`,
    query,
    opts.limit,
    ...filterBinds,
  ]);

  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  const passages: InspirePassagePublic[] = res.rows.map((r) =>
    InspirePassagePublicSchema.parse({
      id: r.id as string,
      text: r.text as string,
      canonicalUrl: r.canonical_url as string,
      region: r.region as string | null,
      mood: r.mood as string | null,
      image: r.image_id ? (images.get(r.image_id as number) ?? null) : null,
    }),
  );
  return passages;
}
