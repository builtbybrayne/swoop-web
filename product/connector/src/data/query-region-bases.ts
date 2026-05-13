/**
 * Structured region-base filter — pure SQL, no vector retrieval. Powers the
 * `find_options` `type: 'region_base'` variant ("use this area as a launchpad").
 *
 * A region-base is an `area` that has at least one trip recommending it AND a
 * page hub to deep-link into. Trip count drives ranking; the page-hub
 * heuristic (alias match → URL-suffix fallback) supplies the canonical URL +
 * image (per the 2026-04-29 page-as-hub pattern).
 *
 * Per Tier-3 plan `planning/03-exec-crosscut-find-options-v3-backfill.md`
 * §2.2 (task code BF-FO-v3-3) + decisions C.bf-4 (URL resolution) + C.bf-5
 * (>= 1 trip-count floor).
 */

import type pg from 'pg';
import {
  RegionBaseProposalCardSchema,
  type RegionBaseProposalCard,
} from '@swoop/common';

import { resolveImagesByIds } from './resolve-image.js';

export interface QueryRegionBaseCardsOptions {
  region?: string | null;
  limit: number;
}

/**
 * Pass the source prose through full (trim + empty→undefined only). The UI
 * handles visible clamping + an inline "Read more" affordance per
 * planning/03-exec-crosscut-brave-pare-card-expandable-prose.md. Server-side
 * truncation was the previous behaviour and is removed here: cards must not
 * silently truncate without an option to expand. Whitespace normalisation
 * stays here because empty/whitespace-only strings should land as
 * `undefined` on the schema, not as `""`.
 */
function vibeLineFromSource(
  text: string | null | undefined,
): string | undefined {
  if (text === null || text === undefined) return undefined;
  const trimmed = String(text).trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function queryRegionBaseCardsByFilter(
  client: pg.PoolClient,
  opts: QueryRegionBaseCardsOptions,
): Promise<RegionBaseProposalCard[]> {
  const whereClauses: string[] = [];
  const binds: unknown[] = [];

  if (opts.region) {
    binds.push(`%${opts.region}%`);
    const bindRef = `$${binds.length}`;
    whereClauses.push(
      `(a.alias ILIKE ${bindRef} OR a.name ILIKE ${bindRef} OR country.name ILIKE ${bindRef})`,
    );
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  // Implicit floors per decisions C.bf-4 + C.bf-5:
  //   - trip_count >= 1 (no trips → can't recommend as a base)
  //   - canonical_url IS NOT NULL (no page hub → no deep-link)
  // These apply regardless of caller filter input.
  const sql = `
    WITH area_trip_count AS (
      SELECT region_id AS area_id, COUNT(*)::int AS trip_count
      FROM trip
      WHERE region_id IS NOT NULL
      GROUP BY region_id
    ),
    area_page AS (
      -- Pick a page-hub per area: alias match first, fallback to URL suffix.
      -- Lowest page.id wins on ties.
      SELECT DISTINCT ON (a.id)
        a.id AS area_id,
        p.id AS page_id,
        p.canonical_url,
        p.image_id,
        p.summary,
        p.intro_text
      FROM area a
      LEFT JOIN page p
        ON (p.alias = a.alias AND p.parent_id IS NOT NULL)
        OR p.canonical_url LIKE '%/' || a.alias
      WHERE p.id IS NOT NULL
      ORDER BY a.id, (CASE WHEN p.alias = a.alias THEN 0 ELSE 1 END), p.id
    )
    SELECT
      a.id,
      a.alias,
      a.name AS headline,
      country.name AS country_name,
      ap.canonical_url,
      ap.image_id,
      COALESCE(ap.summary, ap.intro_text) AS vibe_line_source,
      atc.trip_count AS nearby_trips_count
    FROM area a
    LEFT JOIN country         ON country.id = a.country_id
    INNER JOIN area_page ap   ON ap.area_id = a.id
    INNER JOIN area_trip_count atc ON atc.area_id = a.id
    ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
    ORDER BY atc.trip_count DESC NULLS LAST, a.id
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);

  // Defensive — the SQL's INNER JOIN to area_page already enforces canonical_url
  // is non-null, but a defensive filter here too keeps the boundary explicit.
  const usableRows = res.rows.filter((r) => r.canonical_url != null);

  const imageIds = usableRows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return usableRows.map((r) => {
    const image = r.image_id
      ? (images.get(r.image_id as number) ?? undefined)
      : undefined;
    const vibeLine = vibeLineFromSource(
      r.vibe_line_source as string | null | undefined,
    );
    const nearbyTripsCount =
      r.nearby_trips_count !== null && r.nearby_trips_count !== undefined
        ? Number(r.nearby_trips_count)
        : 0;
    return RegionBaseProposalCardSchema.parse({
      type: 'region_base' as const,
      id: String(r.id),
      ...(r.alias != null ? { slug: r.alias as string } : {}),
      headline: r.headline as string,
      ...(vibeLine !== undefined ? { vibeLine } : {}),
      ...(r.country_name != null
        ? { region: r.country_name as string }
        : {}),
      // No price on a region-as-base — fromPrice null so UI drops the line.
      fromPrice: null,
      canonicalUrl: r.canonical_url as string,
      nearbyTripsCount,
      ...(image ? { image } : {}),
    });
  });
}
