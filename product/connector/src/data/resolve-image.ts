/**
 * Image hydration primitive — turn an image_id into a DerivedImage row.
 *
 * Per decision C.30b: when a derived row carries `image_id` (inspire_passage,
 * customer_story, trip_card), the public projection wraps the joined image
 * record so widgets can render the visual without a second round-trip.
 *
 * Returns `null` when the image is missing (FK is ON DELETE SET NULL across
 * the derived tables, so a NULL image_id or a deleted row both surface as
 * `null` here — callers project that into the public schema's nullable
 * `image` field).
 */

import type pg from 'pg';
import { DerivedImageSchema, type DerivedImage } from '@swoop/common';

export async function resolveImageById(
  client: pg.PoolClient,
  id: number | null | undefined,
): Promise<DerivedImage | null> {
  if (id === null || id === undefined) return null;
  const res = await client.query(
    `SELECT id, canonical_url, alt_text, description,
            COALESCE(subject_tags, '{}') AS subject_tags,
            COALESCE(mood_tags,    '{}') AS mood_tags,
            COALESCE(region_tags,  '{}') AS region_tags
     FROM image
     WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  const candidate: DerivedImage = {
    id: row.id as number,
    canonicalUrl: row.canonical_url as string,
    altText: (row.alt_text ?? null) as string | null,
    description: (row.description ?? null) as string | null,
    subjectTags: (row.subject_tags ?? []) as string[],
    moodTags: (row.mood_tags ?? []) as string[],
    regionTags: (row.region_tags ?? []) as string[],
  };
  return DerivedImageSchema.parse(candidate);
}

/**
 * Batched variant — hydrates a set of image_ids in a single query and
 * returns a Map<id, DerivedImage>. Caller threads the map per row when
 * projecting. Avoids N round-trips when a tool returns many rows.
 */
export async function resolveImagesByIds(
  client: pg.PoolClient,
  ids: ReadonlyArray<number | null | undefined>,
): Promise<Map<number, DerivedImage>> {
  const resolved = new Map<number, DerivedImage>();
  const cleanIds = Array.from(
    new Set(
      ids.filter(
        (i): i is number => typeof i === 'number' && Number.isFinite(i) && i > 0,
      ),
    ),
  );
  if (cleanIds.length === 0) return resolved;

  const res = await client.query(
    `SELECT id, canonical_url, alt_text, description,
            COALESCE(subject_tags, '{}') AS subject_tags,
            COALESCE(mood_tags,    '{}') AS mood_tags,
            COALESCE(region_tags,  '{}') AS region_tags
     FROM image
     WHERE id = ANY($1::int[])`,
    [cleanIds],
  );
  for (const row of res.rows) {
    const candidate: DerivedImage = {
      id: row.id as number,
      canonicalUrl: row.canonical_url as string,
      altText: (row.alt_text ?? null) as string | null,
      description: (row.description ?? null) as string | null,
      subjectTags: (row.subject_tags ?? []) as string[],
      moodTags: (row.mood_tags ?? []) as string[],
      regionTags: (row.region_tags ?? []) as string[],
    };
    resolved.set(candidate.id, DerivedImageSchema.parse(candidate));
  }
  return resolved;
}
