/**
 * Image retrieval by semantic similarity. Powers `illustrate`.
 *
 * **2026-05-18 simplification** (Tier 3 addendum on `03-exec-c-t4.md`):
 * ranking is **cosine ANN on `image.embedding` only**. The annotation prose
 * (1–2 keyword-rich sentences authored by C.t6's Vision pass) embeds the
 * scene's content, mood, and named subjects together; cosine over that
 * substrate carries the load.
 *
 * The earlier shape — AND-gating the cosine ANN behind exact-string overlap
 * across `subject_tags` / `mood_tags` / `region_tags` / `tags` — was
 * librarian-shaped against a prose substrate. The agent doesn't know the
 * (model-invented) tag vocabulary; visitor keywords ("torres del paine",
 * "glaciers", "mountains") rarely overlap tag values verbatim
 * (`torres-del-paine`, `glacier`, `granite`/`peak`); the prose embedding
 * carries the semantic match the tag-overlap gate was suppressing.
 *
 * The **future** facet-aware version (parked in inbox.md 2026-05-18) would
 * give each image multiple per-facet embeddings (mood / content / region /
 * activity), and the tool surface would let the agent express axis-specific
 * intent. Until then, single-embedding cosine ANN against the annotation is
 * the workhorse.
 *
 * `regionSlug` is retained as an optional hard filter on `region_tags @>
 * ARRAY[$slug]`. It's a **no-op today** (every image's `region_tags` is
 * empty per the 2026-05-18 finding that the Vision call's in-message
 * reminder asked the model for prose only), and lights up automatically
 * when a future annotation re-run populates the column. Forward-compatible
 * with the v2 / facet-aware version.
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

/**
 * Rank annotated images by cosine similarity to the supplied query
 * `embedding` (a 3072-d Gemini vector per C.46). Returns the top
 * `opts.limit` rows.
 *
 * Rows without an `embedding` are silently excluded — they have no signal
 * to rank on.
 *
 * If `opts.regionSlug` is supplied, the result is further constrained to
 * images whose `region_tags` contains that slug as an array element.
 * Today this filter is a no-op (the column is empty across the corpus);
 * it lights up if/when `region_tags` is populated.
 */
export async function findImagesByKeywords(
  client: pg.PoolClient,
  embedding: number[],
  opts: FindImagesByKeywordsOptions,
): Promise<ImageRow[]> {
  const clauses: string[] = ['embedding IS NOT NULL'];
  const binds: unknown[] = [`[${embedding.join(',')}]`];

  if (opts.regionSlug) {
    binds.push([opts.regionSlug]);
    clauses.push(`region_tags @> $${binds.length}`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  // Per-canonical_url dedup. The corpus carries multiple `image` rows
  // pointing at the same imgix URL (the 3-kayak case observed in dev —
  // distinct rows, identical content). Inner DISTINCT ON keeps the
  // closest-cosine row per URL; outer wrapper re-orders by distance and
  // applies the visitor-facing limit. NULL canonical_url shouldn't occur
  // (column is NOT NULL on the `image` table), so no edge-case there.
  const sql = `
    SELECT * FROM (
      SELECT DISTINCT ON (canonical_url)
        id, canonical_url, alt_text, description,
        (embedding <=> $1::vector) AS distance
      FROM image
      WHERE ${clauses.join(' AND ')}
      ORDER BY canonical_url, (embedding <=> $1::vector) ASC
    ) deduped
    ORDER BY distance ASC
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
