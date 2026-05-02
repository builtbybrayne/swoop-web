/**
 * Compose `trip_card` rows from active/surfaceable `trip` rows.
 *
 * Filter per the C.t0 + C.t3 finding: active trips only (deleted IS NULL,
 * publishstate is filtered upstream by C.t3 already so trip table contains
 * the surfaceable subset).
 *
 * Plan: planning/03-exec-c-t3a.md §"E. Compose derived tables — trip_card".
 *
 * Embedding content rule (per Tier 2 §"trip_card" sketch + Plan §"trip_card"
 * sub-decision): `headline + ' ' + vibe_line + ' ' + first 500 chars of
 * description`. The vibe_line is computed at ETL (composed from a leading
 * sentence of description, or subtitle, or a synthetic fallback).
 */

import type pg from 'pg';
import { contentHash } from '../hash.js';
import { stripHtml } from '../chunk.js';

const SOURCE_TYPE = 'trip_card';

interface TripRow {
  id: number;
  slug: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  duration_days: number | null;
  from_price: string | null;
  currency_code: string | null;
  accommodation_style: string | null;
  ntag_ids: number[];
  image_id: number | null;
  canonical_url: string | null;
  region_name: string | null;
  activity_aliases: string[];
}

export interface ComposeTripCardOptions {
  client: pg.PoolClient;
  truncate?: boolean;
  dryRun?: boolean;
}

export interface ComposeTripCardResult {
  rowsInserted: number;
}

function vibeFromDescription(description: string | null): string {
  if (!description) return '';
  const stripped = stripHtml(description);
  // First sentence-ish (first chunk before period or 200 chars).
  const firstSentence = /(.{30,200}?[.!?])\s/.exec(stripped);
  if (firstSentence) return firstSentence[1]!.trim();
  return stripped.slice(0, 160).trim();
}

export async function composeTripCard(
  opts: ComposeTripCardOptions,
): Promise<ComposeTripCardResult> {
  if (opts.dryRun) return { rowsInserted: 0 };
  if (opts.truncate !== false) await opts.client.query(`TRUNCATE trip_card`);

  // Pull trips with optional joined region (via area), and aggregated
  // activity tag aliases (via ntag).
  const trips = (
    await opts.client.query<TripRow>(
      `SELECT
         t.id, t.slug, t.title, t.subtitle, t.description, t.duration_days,
         t.from_price, t.currency_code, t.accommodation_style, t.ntag_ids,
         t.image_id, t.canonical_url,
         a.name AS region_name,
         coalesce(
           (SELECT array_agg(tg.alias ORDER BY tg.id)
            FROM tag tg
            WHERE tg.id = ANY(t.ntag_ids) AND tg.type = 'activity'),
           '{}'::text[]
         ) AS activity_aliases
       FROM trip t
       LEFT JOIN area a ON a.id = t.region_id
       WHERE t.canonical_url IS NOT NULL`,
    )
  ).rows;

  let rowsInserted = 0;
  for (const t of trips) {
    const headline = t.title.trim();
    const vibe = vibeFromDescription(t.description) || (t.subtitle?.trim() ?? '');
    const desc = stripHtml(t.description ?? '').slice(0, 500);
    const embedInput = `${headline} ${vibe} ${desc}`.trim();
    const hash = contentHash(embedInput, SOURCE_TYPE);
    const canonicalUrl = t.canonical_url ?? `https://www.swoop-patagonia.com/${t.slug ?? ''}`;
    const fromPrice = t.from_price !== null ? Number(t.from_price) : null;

    await opts.client.query(
      `INSERT INTO trip_card
         (id, slug, headline, vibe_line, region, duration_days, from_price,
          currency_code, image_id, accommodation_style, activity_tags,
          canonical_url, content_hash, tsv)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               to_tsvector('english', $3 || ' ' || $4 || ' ' || $5))
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         headline = EXCLUDED.headline,
         vibe_line = EXCLUDED.vibe_line,
         region = EXCLUDED.region,
         duration_days = EXCLUDED.duration_days,
         from_price = EXCLUDED.from_price,
         currency_code = EXCLUDED.currency_code,
         image_id = EXCLUDED.image_id,
         accommodation_style = EXCLUDED.accommodation_style,
         activity_tags = EXCLUDED.activity_tags,
         canonical_url = EXCLUDED.canonical_url,
         content_hash = EXCLUDED.content_hash,
         tsv = EXCLUDED.tsv,
         modified_at = NOW()`,
      [
        t.id,
        t.slug,
        headline,
        vibe,
        t.region_name,
        t.duration_days,
        fromPrice,
        t.currency_code,
        t.image_id,
        t.accommodation_style,
        t.activity_aliases ?? [],
        canonicalUrl,
        hash,
      ],
    );
    rowsInserted += 1;
  }

  return { rowsInserted };
}
