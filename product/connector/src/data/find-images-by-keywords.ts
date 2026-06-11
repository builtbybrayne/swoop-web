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
 * **2026-06-11 update**: `regionSlug` is now accepted-and-ignored — the
 * `region_tags @> ARRAY[$slug]` hard filter was removed because `region_tags`
 * is 0/13,012 populated (the Vision pass never wrote it) and a supplied slug
 * therefore guarantees zero rows. The field stays in the schema so existing
 * agent calls aren't rejected; it will be wired back as a hard filter once a
 * re-annotation populates the column. Forward-compatible with the v2 /
 * facet-aware version. (2026-06-11 filter-sparsity hot patch)
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
  /**
   * Image canonical URLs already shown — anti-repetition. Keyed by
   * canonical_url (not image.id) per HITL Q5: "never show the same picture
   * twice". Two image rows pointing at the same imgix URL count as one to
   * the visitor's eye, and the dedup must follow that reality.
   *
   * Per planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
   */
  excludeCanonicalUrls?: ReadonlyArray<string>;
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
  // regionSlug accepted in opts but NOT applied as a SQL clause —
  // region_tags is 0/13,012 populated; a supplied slug guarantees zero rows.
  // (2026-06-11 filter-sparsity hot patch; lights up post re-annotation)
  const clauses: string[] = ['embedding IS NOT NULL'];
  const binds: unknown[] = [`[${embedding.join(',')}]`];

  // Anti-repetition: exclude images whose canonical_url has already been
  // shown. Keyed by URL per HITL Q5 — "never show the same picture twice".
  // Empty-array safe via `<> ALL($N::text[])`.
  if (opts.excludeCanonicalUrls && opts.excludeCanonicalUrls.length > 0) {
    binds.push([...opts.excludeCanonicalUrls]);
    clauses.push(`canonical_url <> ALL($${binds.length}::text[])`);
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
