/**
 * Per-source-table transformations for the SQL-transform pipeline.
 *
 * Each transformation is a pure function: takes a raw DumpRow (one row from
 * the MariaDB dump) plus the pre-loaded lookups, and returns either:
 *   - A target-row object ready to upsert into the corresponding domain
 *     table.
 *   - `null`, meaning the row is filtered out (with a `reason` recorded
 *     elsewhere by the caller).
 *
 * Filters live HERE, in transform code, not in Postgres views (decision
 * C.35 — "Shape A" per the C.t3 plan §"Filters: where they live").
 *
 * No clever-cleverness — every transform is straightforward field-mapping
 * with at most one or two computed columns. The whole layer is disposable
 * (theme 5 — when Swoop's source schema changes in late 2026 we rewrite
 * affected functions; nothing else changes).
 *
 * Calibration (C.t3 plan §"Calibration check"): every column populated here
 * traces to a derived-table column that backs a tool that serves a
 * conversational job. If you add a column without that justification,
 * you've drifted bottom-up. Stop and re-anchor.
 */

import type { DumpRow } from './parser.js';
import type { Lookups } from './lookups.js';
import { numOrNull, strOrNull } from './lookups.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per discoveries.md 2026-04-29: pagetype 20 is Profile (specialist bios). */
const PAGETYPE_PROFILE_ID = 20;

const SWOOP_HOST = 'https://www.swoop-patagonia.com/';
const IMGIX_HOST = 'https://swoop-patagonia.imgix.net/';

/**
 * Test-page filter (decision C.28). Conservative: only obviously-test
 * artefacts. Run against MariaDB at C.t0 confirmed no real pages match.
 */
function isTestPage(alias: string | null, title: string | null): boolean {
  const hayAlias = (alias ?? '').toLowerCase();
  const hayTitle = (title ?? '').toLowerCase();
  if (/(^|\/)test(\/|-|$)/.test(hayAlias)) return true;
  if (/^test\b/.test(hayTitle)) return true;
  return false;
}

/** Skip-rule for soft-deleted rows. tinyint(1) is 1/0; treat both null and 0 as not-deleted. */
function isDeleted(v: unknown): boolean {
  return typeof v === 'number' && v !== 0;
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export function transformCountry(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const name = strOrNull(row.values.title);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    alias: strOrNull(row.values.alias),
    iso_code: strOrNull(row.values.iso_3),
  };
}

export function transformArea(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const name = strOrNull(row.values.title);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    alias: strOrNull(row.values.alias),
    // Source `area` doesn't have country_id / parent_area_id at the column
    // level — country comes via the page hierarchy (out of scope for C.t3).
    country_id: null,
    parent_area_id: null,
  };
}

export function transformLocation(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const name = strOrNull(row.values.title);
  if (id === null || name === null) return null;
  // lat / lng arrive as strings ("varchar(255)") in the dump; coerce to numeric
  // for our DECIMAL(9,6) target columns. Empty / non-numeric → null.
  const lat = parseDecimalOrNull(row.values.latitude);
  const lng = parseDecimalOrNull(row.values.longitude);
  return {
    id,
    name,
    alias: strOrNull(row.values.alias),
    area_id: null, // No area_id column on source location; left null.
    country_id: null,
    latitude: lat,
    longitude: lng,
  };
}

export function transformActivity(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const title = strOrNull(row.values.title);
  if (id === null || title === null) return null;
  // Source `activity` is per-trip-per-area data, not first-class records;
  // many rows share the same `title`. We dedupe by id (which is unique) and
  // accept that the `activity` domain table will hold all rows. Light-touch.
  return {
    id,
    name: title,
    alias: null, // No alias on source.
    description: null,
  };
}

// ---------------------------------------------------------------------------
// Tag (ntag → tag) — decision C.32: legacy `tag` excluded entirely.
// ---------------------------------------------------------------------------

const VALID_TAG_TYPES = new Set(['interest', 'area', 'activity', 'trip-type', 'style']);

export function transformNtag(row: DumpRow): Record<string, unknown> | null {
  const id = numOrNull(row.values.id);
  const title = strOrNull(row.values.title);
  const alias = strOrNull(row.values.alias);
  const type = strOrNull(row.values.type);
  if (id === null || title === null || alias === null || type === null) return null;
  if (!VALID_TAG_TYPES.has(type)) return null;
  const isActive = numOrNull(row.values.is_active);
  // is_active is tinyint(1); treat null as active per the migration default.
  const active = isActive === null ? true : isActive !== 0;
  if (!active) return null;
  return {
    id,
    title,
    alias,
    type,
    is_active: true,
  };
}

// ---------------------------------------------------------------------------
// Image (image JOIN file → image)
// ---------------------------------------------------------------------------

export function transformImage(row: DumpRow, lookups: Lookups): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  if (id === null) return null;

  // image.image_id → file.id (source schema; the column is `image_id` ON THE
  // image TABLE pointing into `file`. Yes that naming is unfortunate.)
  const fileId = numOrNull(row.values.image_id);
  if (fileId === null) return null;
  const file = lookups.fileById.get(fileId);
  if (!file) return null; // file row missing or not an image extension.

  // Construct imgix-prefixed URL. Render-variant params are NOT applied at
  // ETL — they're applied at read-time per Tier 2 §2.6. ETL stores the bare
  // filename URL.
  const canonical_url = `${IMGIX_HOST}${file.name}`;
  const tagIds = lookups.ntagsByEntity.get('image')?.get(id) ?? [];

  return {
    id,
    canonical_url,
    alt_text: null, // C.t6 populates from caption / annotation pipeline.
    description: strOrNull(row.values.description), // ~47.5% upstream, primes C.t6.
    tags: [], // C.t6 populates with subject/mood/region tag arrays.
    subject_tags: [],
    mood_tags: [],
    region_tags: [],
    width: parseIntOrNull(row.values.width),
    height: parseIntOrNull(row.values.height),
    original_filename: file.name,
    // embedding intentionally absent — populated by C.t3a; ON CONFLICT does
    // NOT include it in the UPDATE clause to avoid clobbering.
    ntag_ids: tagIds, // Stored in `tags` is the convention per the migration; but
    // the migration's `image` table doesn't have `ntag_ids` — it has `tags`,
    // `subject_tags`, `mood_tags`, `region_tags`. We park the polymorphic
    // ntag_ids here for the upsert helper; it's dropped at the column-list
    // boundary (only declared columns are written). See upsert.ts.
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface PageTransformResult {
  row: Record<string, unknown> | null;
  /** Reason for filtering, if filtered. Used for the per-table skip tally. */
  reason?: 'deleted' | 'profile_pagetype' | 'test_page' | 'missing_id' | 'missing_canonical';
}

export function transformPage(row: DumpRow, lookups: Lookups): PageTransformResult {
  if (isDeleted(row.values.deleted)) return { row: null, reason: 'deleted' };

  const id = numOrNull(row.values.id);
  if (id === null) return { row: null, reason: 'missing_id' };

  const pagetypeId = numOrNull(row.values.pagetype_id);
  if (pagetypeId === PAGETYPE_PROFILE_ID) {
    return { row: null, reason: 'profile_pagetype' };
  }

  const alias = strOrNull(row.values.alias);
  const title = strOrNull(row.values.title);
  if (isTestPage(alias, title)) {
    return { row: null, reason: 'test_page' };
  }

  // canonical_url construction. Per discoveries.md 2026-04-29 + C.15:
  // override_url || alias, prefixed with the production host.
  const overrideUrl = strOrNull(row.values.override_url);
  const slug = overrideUrl ?? alias;
  if (slug === null) return { row: null, reason: 'missing_canonical' };
  const canonical_url = `${SWOOP_HOST}${slug}`;

  const imageId = numOrNull(row.values.image_id);
  const bannerId = numOrNull(row.values.banner_id);
  const tagIds = lookups.ntagsByEntity.get('page')?.get(id) ?? [];

  return {
    row: {
      id,
      pagetype_id: pagetypeId,
      pagetype_title: pagetypeId !== null ? lookups.pagetypeById.get(pagetypeId) ?? null : null,
      title: title ?? '(untitled)',
      alias,
      override_url: overrideUrl,
      canonical_url,
      intro_text: strOrNull(row.values.intro_text),
      summary: strOrNull(row.values.summary),
      image_id: imageId,
      bannerimage_id: bannerId,
      ntag_ids: tagIds,
      parent_id: numOrNull(row.values.parent_id),
    },
  };
}

// ---------------------------------------------------------------------------
// Contentblock
// ---------------------------------------------------------------------------

export function transformContentblock(
  row: DumpRow,
  lookups: Lookups,
  subtype: string,
): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  if (id === null) return null;
  // Skip pure UI plumbing per C.t3 plan §"Contentblock":
  if (subtype === 'navigationcard' || subtype === 'settings' || subtype === 'page') {
    return null;
  }
  const tagIds = lookups.ntagsByEntity.get('contentblock')?.get(id) ?? [];
  return {
    id,
    page_id: numOrNull(row.values.page_id),
    position: numOrNull(row.values.position),
    subtype,
    title: strOrNull(row.values.title),
    subheading: strOrNull(row.values.subheading),
    text: strOrNull(row.values.text),
    image_id: null, // Source contentblock doesn't carry a hero image_id directly.
    cta_text: strOrNull(row.values.cta_text),
    cta_url: strOrNull(row.values.cta_url) ?? strOrNull(row.values.cta_link),
    ntag_ids: tagIds,
  };
}

// ---------------------------------------------------------------------------
// Chunk (small reusable CMS prose blocks; 46 rows)
// ---------------------------------------------------------------------------

export function transformChunk(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const text = strOrNull(row.values.content);
  if (id === null || text === null) return null;
  return {
    id,
    type_name: strOrNull(row.values.alias), // Source `alias` = type discriminator
    title: strOrNull(row.values.title),
    text,
  };
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export function transformFaqItem(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const title = strOrNull(row.values.title);
  const content = strOrNull(row.values.content);
  if (id === null || title === null || content === null) return null;
  // faqset_id presence filters orphans; if absent, skip.
  const faqsetId = numOrNull(row.values.faqset_id);
  if (faqsetId === null) return null;
  return {
    id,
    title,
    content,
    faqset_id: faqsetId,
    position: numOrNull(row.values.position),
  };
}

// ---------------------------------------------------------------------------
// Trip
// ---------------------------------------------------------------------------

export interface TripTransformResult {
  row: Record<string, unknown> | null;
  reason?: 'deleted' | 'missing_id' | 'missing_title';
}

export function transformTrip(
  row: DumpRow,
  lookups: Lookups,
  pageCanonicalById: Map<number, string>,
): TripTransformResult {
  if (isDeleted(row.values.deleted)) return { row: null, reason: 'deleted' };
  const id = numOrNull(row.values.id);
  if (id === null) return { row: null, reason: 'missing_id' };
  const title = strOrNull(row.values.title);
  if (title === null) return { row: null, reason: 'missing_title' };

  // Trip image resolution (decision C.36 — image_trip first, image_page
  // fallback per HITL ratification 2026-05-01 Q4).
  const pageId = numOrNull(row.values.page_id);
  const imageId =
    lookups.imageTripFirst.get(id) ??
    (pageId !== null ? lookups.imagePageFirst.get(pageId) ?? null : null);

  const currencyId = numOrNull(row.values.currency_id);
  const currency_code = currencyId !== null ? lookups.currencyById.get(currencyId) ?? null : null;
  const basePrice = parseDecimalOrNull(row.values.base_price);

  const canonical_url = pageId !== null ? pageCanonicalById.get(pageId) ?? null : null;
  const tagIds = lookups.ntagsByEntity.get('trip')?.get(id) ?? [];
  const slug = strOrNull(row.values.alias);

  return {
    row: {
      id,
      slug,
      title,
      subtitle: null,
      region_id: null, // Trip → region via ntags_lookup (area-typed tag), not direct FK.
      country_id: null,
      duration_days: parseDurationDays(row.values.duration),
      from_price: basePrice,
      currency_code,
      // C.t3 §"daybyday": concatenated into trip.description in trip.ts;
      // here we leave it null and let the daybyday pass overwrite later.
      description: null,
      includes: strOrNull(row.values.includes),
      excludes: strOrNull(row.values.excludes),
      accommodation_style: null,
      ntag_ids: tagIds,
      image_id: imageId,
      canonical_url,
      page_id: pageId,
    },
  };
}

// ---------------------------------------------------------------------------
// Tour (source `tours` → target `tour`) + tour_item
// ---------------------------------------------------------------------------

export function transformTour(row: DumpRow): Record<string, unknown> | null {
  // Source `tours` doesn't have a `deleted` flag; trust the table.
  const id = numOrNull(row.values.id);
  const title = strOrNull(row.values.title);
  if (id === null || title === null) return null;
  return {
    id,
    slug: null, // Source has no alias on tours.
    title,
    subtitle: null,
    duration_days: null,
    group_size_max: null,
    from_price: null,
    currency_code: null,
    description: strOrNull(row.values.description),
    region_id: null,
    ntag_ids: [],
    image_id: numOrNull(row.values.image_id),
    canonical_url: null,
    page_id: null,
  };
}

export function transformTourItem(row: DumpRow): Record<string, unknown> | null {
  const id = numOrNull(row.values.id);
  const tourId = numOrNull(row.values.tour_id);
  if (id === null || tourId === null) return null;
  return {
    id,
    tour_id: tourId,
    position: numOrNull(row.values.position),
    day_label: null,
    title: strOrNull(row.values.title),
    description: strOrNull(row.values.body),
  };
}

// ---------------------------------------------------------------------------
// Hotel + hotel_room (mapped from hotel) + hotel_pricing
// ---------------------------------------------------------------------------

export function transformHotel(
  row: DumpRow,
  lookups: Lookups,
  pageCanonicalById: Map<number, string>,
): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const name = strOrNull(row.values.title);
  if (id === null || name === null) return null;
  const pageId = numOrNull(row.values.page_id);
  return {
    id,
    slug: strOrNull(row.values.alias),
    name,
    description: null,
    location_id: numOrNull(row.values.location_id),
    area_id: null,
    page_id: pageId,
    canonical_url: pageId !== null ? pageCanonicalById.get(pageId) ?? null : null,
    star_rating: null,
  };
}

// ---------------------------------------------------------------------------
// Vessel + cabintype + cabin
// ---------------------------------------------------------------------------

export function transformVessel(
  row: DumpRow,
  pageCanonicalById: Map<number, string>,
): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const name = strOrNull(row.values.title);
  if (id === null || name === null) return null;
  const pageId = numOrNull(row.values.page_id);
  return {
    id,
    slug: strOrNull(row.values.alias),
    name,
    description: null,
    page_id: pageId,
    canonical_url: pageId !== null ? pageCanonicalById.get(pageId) ?? null : null,
  };
}

export function transformCabintype(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const name = strOrNull(row.values.title);
  if (id === null || name === null) return null;
  return { id, name, description: null };
}

export function transformCabin(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const vesselId = numOrNull(row.values.vessel_id);
  if (id === null || vesselId === null) return null;
  return {
    id,
    vessel_id: vesselId,
    cabintype_id: numOrNull(row.values.cabintype_id),
    name: strOrNull(row.values.title),
    description: strOrNull(row.values.cabin_details),
    capacity: null,
  };
}

// ---------------------------------------------------------------------------
// Customerreview + customerreview_trip (from supplementary dump)
// ---------------------------------------------------------------------------

export function transformCustomerReview(row: DumpRow): Record<string, unknown> | null {
  if (isDeleted(row.values.deleted)) return null;
  const id = numOrNull(row.values.id);
  const content = strOrNull(row.values.content);
  if (id === null || content === null) return null;
  // is_published filter per migration 006 comment + C.t3 §"customerreview".
  const isPub = numOrNull(row.values.is_published);
  if (isPub === null || isPub === 0) return null;
  return {
    id,
    content,
    name: strOrNull(row.values.name),
    date: strOrNull(row.values.date),
    location: strOrNull(row.values.location),
    is_published: true,
    title: strOrNull(row.values.title),
    image_id: numOrNull(row.values.image_id),
    feedbacksnippet_id: numOrNull(row.values.feedbacksnippet_id),
    created: strOrNull(row.values.created),
    modified: strOrNull(row.values.modified),
  };
}

export function transformCustomerReviewTrip(row: DumpRow): Record<string, unknown> | null {
  const id = numOrNull(row.values.id);
  const reviewId = numOrNull(row.values.customerreview_id);
  const tripId = numOrNull(row.values.trip_id);
  if (id === null || reviewId === null || tripId === null) return null;
  return {
    id,
    customerreview_id: reviewId,
    trip_id: tripId,
    position: numOrNull(row.values.position),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDecimalOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v: unknown): number | null {
  const n = parseDecimalOrNull(v);
  if (n === null) return null;
  return Math.trunc(n);
}

/**
 * Source `trip.duration` is varchar(255). Best-effort parse into integer days.
 * Common shapes: "8", "8 days", "8-10", "8 nights", "0". We extract the first
 * integer; if absent, return null.
 */
function parseDurationDays(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /(\d+)/.exec(v);
  if (!m) return null;
  return parseInt(m[1]!, 10);
}
