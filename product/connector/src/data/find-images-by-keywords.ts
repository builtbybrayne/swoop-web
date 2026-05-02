/**
 * Image retrieval by keywords. Powers `illustrate`.
 *
 * Hybrid: cosine ANN on `image.embedding` UNION array overlap on the four tag
 * arrays (subject_tags / mood_tags / region_tags / tags). Per HITL Q1 +
 * 03-exec-c-t4.md §"`illustrate` and the C.t6 dependency": handler ships
 * against whatever annotation coverage exists; rows with no embedding/tags
 * just don't surface.
 *
 * Optional `regionSlug` further narrows via `region_tags @> ARRAY[$slug]`.
 */

import type pg from 'pg';
import { z } from 'zod';

const ImageRowSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  altText: z.string(),
  caption: z.string().optional(),
});
export type ImageRow = z.infer<typeof ImageRowSchema>;

export interface FindImagesByKeywordsOptions {
  regionSlug?: string | null;
  limit: number;
}

export async function findImagesByKeywords(
  client: pg.PoolClient,
  embedding: number[],
  keywords: ReadonlyArray<string>,
  opts: FindImagesByKeywordsOptions,
): Promise<ImageRow[]> {
  const tagFilter = keywords.length > 0 ? keywords : null;

  const clauses: string[] = ['embedding IS NOT NULL'];
  const binds: unknown[] = [`[${embedding.join(',')}]`];

  if (tagFilter) {
    binds.push(tagFilter);
    clauses.push(
      `(subject_tags && $${binds.length} OR mood_tags && $${binds.length} OR region_tags && $${binds.length} OR tags && $${binds.length})`,
    );
  }
  if (opts.regionSlug) {
    binds.push([opts.regionSlug]);
    clauses.push(`region_tags @> $${binds.length}`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  const sql = `
    SELECT id, canonical_url, alt_text, description
    FROM image
    WHERE ${clauses.join(' AND ')}
    ORDER BY embedding <=> $1::vector
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);
  return res.rows.map((r) =>
    ImageRowSchema.parse({
      id: String(r.id as number),
      url: r.canonical_url as string,
      altText: (r.alt_text ?? '') as string,
      caption:
        r.description !== null && r.description !== undefined
          ? (r.description as string)
          : undefined,
    }),
  );
}
