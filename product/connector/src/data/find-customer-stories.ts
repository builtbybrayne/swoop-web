/**
 * Persona-shaped retrieval over `customer_story`. Powers `find_someone_who`.
 *
 * Per decision C.30: cosine similarity on `persona_embedding` is the ONLY
 * matching mechanism. No tsvector / hybrid retrieval — Mirror matches by
 * who-they-are, not by what-they-said. Optional `region` filter narrows
 * the candidate set first.
 */

import type pg from 'pg';
import { CustomerStoryPublicSchema, type CustomerStoryPublic } from '@swoop/common';

import { resolveImagesByIds } from './resolve-image.js';

export interface FindCustomerStoriesOptions {
  region?: string | null;
  /**
   * Story uuids to omit — anti-repetition. Orchestrator supplies from
   * `SessionState.seenItems.customer_story`. Per
   * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
   */
  excludeIds?: ReadonlyArray<string>;
  /**
   * Image canonical URLs already shown — anti-repetition. Embedded images
   * that match a shown URL get blanked on output; the story prose still
   * surfaces. Per HITL Q5 ("never show the same picture twice") + Q6.
   */
  excludeImageCanonicalUrls?: ReadonlyArray<string>;
  limit: number;
}

export async function findCustomerStoriesByPersonaSignal(
  client: pg.PoolClient,
  embedding: number[],
  opts: FindCustomerStoriesOptions,
): Promise<CustomerStoryPublic[]> {
  const filterClauses: string[] = ['persona_embedding IS NOT NULL'];
  const binds: unknown[] = [`[${embedding.join(',')}]`, opts.limit];

  if (opts.region) {
    binds.push(`%${opts.region}%`);
    filterClauses.push(`region ILIKE $${binds.length}`);
  }
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push([...opts.excludeIds]);
    filterClauses.push(`id <> ALL($${binds.length}::uuid[])`);
  }

  const sql = `
    SELECT id, text, canonical_url, region, persona_summary, image_id
    FROM customer_story
    WHERE ${filterClauses.join(' AND ')}
    ORDER BY persona_embedding <=> $1::vector
    LIMIT $2
  `;
  const res = await client.query(sql, binds);

  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  // Anti-repetition: blank embedded images whose canonical_url is already
  // shown; story prose still surfaces.
  const excludeImageUrls = new Set<string>(opts.excludeImageCanonicalUrls ?? []);

  return res.rows.map((r) => {
    const candidateImage = r.image_id
      ? (images.get(r.image_id as number) ?? null)
      : null;
    const imageToProject =
      candidateImage && excludeImageUrls.has(candidateImage.canonicalUrl)
        ? null
        : candidateImage;
    return CustomerStoryPublicSchema.parse({
      id: r.id as string,
      text: r.text as string,
      personaSummary: r.persona_summary as string,
      canonicalUrl: r.canonical_url as string | null,
      region: r.region as string | null,
      image: imageToProject,
    });
  });
}
