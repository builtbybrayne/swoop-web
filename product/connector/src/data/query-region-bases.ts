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
import { trimCmsDecorativeWhitespace } from './text-utils.js';

export interface QueryRegionBaseCardsOptions {
  region?: string | null;
  /**
   * Region-base (area) ids to omit (e.g. items shown in earlier turns).
   * Empty / undefined means no exclusion. Per C.focused-shamir-5.
   */
  excludeIds?: number[];
  limit: number;
}

/**
 * Pass the source prose through full (trim + empty→undefined only). The UI
 * handles visible clamping + an inline "Read more" affordance per
 * planning/03-exec-crosscut-brave-pare-card-expandable-prose.md. Server-side
 * truncation was the previous behaviour and is removed here: cards must not
 * silently truncate without an option to expand.
 *
 * Trailing/leading decorative whitespace from the WYSIWYG editor (e.g.
 * `&nbsp;<br></p>` from the San Pedro de Atacama page — 296 of 590 pages
 * carry this kind of artefact) is stripped to keep both the rendered output
 * and the UI's overflow detection clean.
 */
function vibeLineFromSource(
  text: string | null | undefined,
): string | undefined {
  return trimCmsDecorativeWhitespace(text);
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
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push(opts.excludeIds);
    whereClauses.push(`a.id <> ALL($${binds.length}::int[])`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  // Implicit floors per decisions C.bf-4 + C.bf-5:
  //   - trip_count >= 1 (no trips → can't recommend as a base)
  //   - canonical_url IS NOT NULL (no page hub → no deep-link)
  // These apply regardless of caller filter input.
  const sql = `
    ${REGION_BASE_SELECT}
    ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
    ORDER BY RANDOM(), a.id
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);
  return mapRegionBaseRows(client, res.rows);
}

/**
 * Shared region-base CTE + SELECT block. ONE definition for both the filter
 * and by-id paths so the projection can never drift between them. The
 * INNER JOINs carry the C.bf-4/C.bf-5 floors (page hub + >=1 trip) — an id
 * whose area lacks either returns no row, which is correct: show_options
 * can only re-surface what find_options could have offered.
 */
const REGION_BASE_SELECT = `
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
`;

/**
 * Hydrate full region-base cards for an explicit id list — the
 * `show_options` by-id path (goofy-goldstine find/show split,
 * C.goofy-goldstine-12). Returns rows in DB order; the caller re-sorts to
 * its input order.
 */
export async function queryRegionBaseCardsByIds(
  client: pg.PoolClient,
  ids: number[],
): Promise<RegionBaseProposalCard[]> {
  if (ids.length === 0) return [];
  const sql = `
    ${REGION_BASE_SELECT}
    WHERE a.id = ANY($1::int[])
  `;
  const res = await client.query(sql, [ids]);
  return mapRegionBaseRows(client, res.rows);
}

/**
 * Shared row → RegionBaseProposalCard projection (filter + by-id paths).
 */
async function mapRegionBaseRows(
  client: pg.PoolClient,
  rows: Array<Record<string, unknown>>,
): Promise<RegionBaseProposalCard[]> {
  // Defensive — the SQL's INNER JOIN to area_page already enforces canonical_url
  // is non-null, but a defensive filter here too keeps the boundary explicit.
  const usableRows = rows.filter((r) => r.canonical_url != null);

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
