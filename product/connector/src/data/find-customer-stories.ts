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

  return res.rows.map((r) =>
    CustomerStoryPublicSchema.parse({
      id: r.id as string,
      text: r.text as string,
      personaSummary: r.persona_summary as string,
      canonicalUrl: r.canonical_url as string | null,
      region: r.region as string | null,
      image: r.image_id ? (images.get(r.image_id as number) ?? null) : null,
    }),
  );
}
