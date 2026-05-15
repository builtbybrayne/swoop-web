/**
 * Compose `tour_card` rows from the populated `tour` + `tour_item` data.
 *
 * Mirrors `compose/trip-card.ts` with three deliberate shifts forced by the
 * source shape (C.focused-shamir-1 / 2):
 *   - `tour.description` is NULL on every source row — vibe_line is derived
 *     from the parent page's `summary` (preferred) or `intro_text` (fallback).
 *   - No `tour.duration` / `tour.group_size_max` / `tour.from_price` — those
 *     columns stay NULL; `day_count = COUNT(tour_item)` is the day signal,
 *     and `duration_days` is populated from it for query-shape parity with
 *     trip_card.
 *   - Image fallback happens here (not in the ETL): `tour.image_id` first,
 *     then the parent page's own `image_id` (the page's hero image, kept on
 *     the page domain table). The MariaDB `image_page` junction isn't
 *     preserved in puma_dev — it gets consumed into `lookups.imagePageFirst`
 *     at ETL time for trip image resolution (trip pre-resolves; tour doesn't
 *     because the original transform was deliberately minimal). `page.image_id`
 *     is the next-best fallback and is populated for all 3 tour rows whose
 *     `tour.image_id` is null (verified against puma_dev on 2026-05-15).
 *
 * Region derivation mirrors C.brave-pare-2 — the tour's parent page's
 * area-typed ntag intersected with `area.alias`, lowest `area.id` wins.
 *
 * Embedding text rule: `headline + ' ' + vibe_line + ' ' + first 500 chars of
 * day_text`. day_text is the concatenation of all tour_item titles + (stripped)
 * bodies — the corpus that distinguishes one tour from another semantically.
 *
 * Plan: planning/03-exec-crosscut-find-options-v2-backfill.md §2.2.
 */

import type pg from 'pg';
import { contentHash } from '../hash.js';
import { stripHtml } from '../chunk.js';

const SOURCE_TYPE = 'tour_card';

interface TourRow {
  id: number;
  slug: string | null;
  title: string;
  canonical_url: string;
  page_id: number | null;
  intro_text: string | null;
  summary: string | null;
  region_name: string | null;
  day_count: number;
  day_text: string | null;
  image_id_resolved: number | null;
  activity_aliases: string[];
}

export interface ComposeTourCardOptions {
  client: pg.PoolClient;
  truncate?: boolean;
  dryRun?: boolean;
}

export interface ComposeTourCardResult {
  rowsInserted: number;
}

/**
 * vibe_line derivation. Prefers the page's `summary` (curated short pitch)
 * over `intro_text` (longer; we take the first sentence-ish). Both are CMS
 * authored prose — strip HTML before use.
 */
function vibeFromPage(summary: string | null, introText: string | null): string {
  if (summary && summary.trim()) {
    return stripHtml(summary).trim();
  }
  if (introText && introText.trim()) {
    const stripped = stripHtml(introText);
    const firstSentence = /(.{30,200}?[.!?])\s/.exec(stripped);
    if (firstSentence) return firstSentence[1]!.trim();
    return stripped.slice(0, 160).trim();
  }
  return '';
}

export async function composeTourCard(
  opts: ComposeTourCardOptions,
): Promise<ComposeTourCardResult> {
  if (opts.dryRun) return { rowsInserted: 0 };
  if (opts.truncate !== false) await opts.client.query(`TRUNCATE tour_card`);

  const tours = (
    await opts.client.query<TourRow>(
      `SELECT
         t.id,
         t.slug,
         t.title,
         t.canonical_url,
         t.page_id,
         p.intro_text,
         p.summary,
         area_lookup.region_name,
         (SELECT COUNT(*)::int FROM tour_item ti WHERE ti.tour_id = t.id) AS day_count,
         (SELECT string_agg(
              COALESCE(ti.title, '') || ' ' || COALESCE(ti.description, ''),
              E'\\n' ORDER BY ti.position NULLS LAST, ti.id)
          FROM tour_item ti WHERE ti.tour_id = t.id) AS day_text,
         COALESCE(t.image_id, p.image_id) AS image_id_resolved,
         COALESCE(
           (SELECT array_agg(tg.alias ORDER BY tg.id)
            FROM tag tg
            WHERE tg.id = ANY(p.ntag_ids) AND tg.type = 'activity'),
           '{}'::text[]
         ) AS activity_aliases
       FROM tour t
       LEFT JOIN page p ON p.id = t.page_id
       LEFT JOIN LATERAL (
         SELECT a.name AS region_name
         FROM area a
         JOIN tag tg ON tg.alias = a.alias
         WHERE tg.id = ANY(p.ntag_ids)
           AND tg.type = 'area'
         ORDER BY a.id ASC
         LIMIT 1
       ) area_lookup ON true
       WHERE t.canonical_url IS NOT NULL`,
    )
  ).rows;

  let rowsInserted = 0;
  for (const t of tours) {
    const headline = t.title.trim();
    const vibe = vibeFromPage(t.summary, t.intro_text);
    const dayTextStripped = t.day_text ? stripHtml(t.day_text).slice(0, 500) : '';
    const embedInput = `${headline} ${vibe} ${dayTextStripped}`.trim();
    const hash = contentHash(embedInput, SOURCE_TYPE);
    const durationDays = t.day_count > 0 ? t.day_count : null;

    await opts.client.query(
      `INSERT INTO tour_card
         (id, slug, headline, vibe_line, region, day_count, duration_days,
          group_size_max, from_price, currency_code, image_id, accommodation_style,
          activity_tags, canonical_url, content_hash, tsv)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, $8, NULL,
               $9, $10, $11,
               to_tsvector('english', $3 || ' ' || COALESCE($4, '') || ' ' || COALESCE($5, '')))
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         headline = EXCLUDED.headline,
         vibe_line = EXCLUDED.vibe_line,
         region = EXCLUDED.region,
         day_count = EXCLUDED.day_count,
         duration_days = EXCLUDED.duration_days,
         image_id = EXCLUDED.image_id,
         activity_tags = EXCLUDED.activity_tags,
         canonical_url = EXCLUDED.canonical_url,
         content_hash = EXCLUDED.content_hash,
         tsv = EXCLUDED.tsv,
         modified_at = NOW()`,
      [
        t.id,
        t.slug,
        headline,
        vibe || null,
        t.region_name,
        t.day_count,
        durationDays,
        t.image_id_resolved,
        t.activity_aliases ?? [],
        t.canonical_url,
        hash,
      ],
    );
    rowsInserted += 1;
  }

  return { rowsInserted };
}
