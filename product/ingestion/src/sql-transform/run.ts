/**
 * SQL-transform pipeline runner — orchestrates the full ETL.
 *
 * Plan: planning/03-exec-c-t3.md §"Order of operations" (CLI body).
 * HITL ratification 2026-05-01 — Option B (Node CLI translator) confirmed.
 *
 * Two-pass strategy:
 *
 *   Pass 1 (lookups.ts) — pre-load small lookup maps from the dump:
 *     currency, file (image rows only), pagetype, ntags_lookup
 *     (filtered + aggregated), image_trip + image_page (first-by-position).
 *
 *   Pass 2 (this file) — stream the dump again, dispatch each row through
 *     the matching transformation, batch-upsert to Postgres.
 *
 * Two passes is fine — the parser does ~600K rows in ~4s on a laptop. The
 * alternative (single pass that buffers needs-deferred rows) would be more
 * code, less legible, and the 4s pre-pass is a non-issue against the 1–5
 * minute total budget.
 *
 * Order of writes inside Pass 2 is also load-bearing: rows that reference
 * other domain tables via FKs must wait until those FKs are populated. We
 * stream-and-buffer per-table, then flush in topologically-correct order at
 * the end. For the dump's table layout (consult Sequel Ace's emit order)
 * the CREATE TABLE statements come in a deterministic order, but INSERT
 * statements aren't guaranteed FK-safe. So we read the entire dump into
 * per-table row buffers and flush in our own order.
 *
 * Memory cost: the largest tables are `ntags_lookup` (157K rows, but we
 * filter to 7K useful ones during lookup-build), `file` (135K, also
 * filtered), `daybyday` (88K, raw rows kept until daybyday → trip pass),
 * `image` (13K), `contentblock` (10K). Total raw row bytes well under
 * a few hundred MB on a laptop — fine.
 */

import type pg from 'pg';
import { streamDump, type DumpRow } from './parser.js';
import { loadLookups, type Lookups, numOrNull, strOrNull } from './lookups.js';
import { upsertBatch, DEFAULT_BATCH_SIZE } from './upsert.js';
import {
  transformActivity,
  transformArea,
  transformCabin,
  transformCabintype,
  transformChunk,
  transformContentblock,
  transformCountry,
  transformCustomerReview,
  transformCustomerReviewTrip,
  transformCustomerTip,
  transformFaqItem,
  transformHotel,
  transformImage,
  transformLocation,
  transformNtag,
  transformPage,
  transformTour,
  transformTourItem,
  transformTrip,
  transformVessel,
} from './transformations.js';

export interface RunOptions {
  client: pg.PoolClient;
  /** Path to the main MariaDB dump (`content-data-swoop-patagonia_prod.sql`). */
  dumpPath: string;
  /** Optional supplementary dump for `customerreview` + `customerreview_trip`. */
  customerReviewDumpPath?: string;
  /** Optional supplementary dump for `customertip` (find_tips source). */
  customerTipDumpPath?: string;
  /** Subset of target tables to process. If absent, all tables are processed. */
  only?: Set<string>;
  /** If true, parse + log counts but skip writes. */
  dryRun?: boolean;
  /** Custom log sink — defaults to console.log. */
  log?: (line: string) => void;
}

export interface TableTally {
  rowsIn: number;
  rowsOut: number;
  skipped: { reason: string; count: number }[];
}

export interface RunResult {
  /** Per-target-table tally. */
  tables: Record<string, TableTally>;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Subtype-junction tables — used to derive contentblock.subtype.
// ---------------------------------------------------------------------------

const CONTENTBLOCK_SUBTYPE_TABLES: Record<string, string> = {
  contentblock_customerreview: 'customerreview',
  contentblock_customertip: 'customertip',
  contentblock_image: 'image',
  contentblock_carousel: 'carousel',
  contentblock_carousel_item: 'carousel_item',
  contentblock_pressreview: 'pressreview',
  contentblock_partnercomment: 'partnercomment',
  contentblock_tour: 'tour',
  contentblock_trip: 'trip',
  contentblock_when_to_travel: 'when_to_travel',
  contentblock_reviewcarousel: 'reviewcarousel',
  contentblock_reviewcarousel_review: 'reviewcarousel_review',
  contentblock_navigationcard: 'navigationcard',
  contentblock_settings: 'settings',
  contentblock_page: 'page',
};

// ---------------------------------------------------------------------------
// Column lists — must match the migration shape exactly. The upsert helper
// only writes the columns named here; everything else in the row object is
// silently dropped at the SQL boundary. Avoids accidental column leak +
// makes "what does this transformation own?" auditable in one place.
// ---------------------------------------------------------------------------

const COLS = {
  country: ['id', 'name', 'alias', 'iso_code'] as const,
  area: ['id', 'name', 'alias', 'country_id', 'parent_area_id'] as const,
  location: ['id', 'name', 'alias', 'area_id', 'country_id', 'latitude', 'longitude'] as const,
  activity: ['id', 'name', 'alias', 'description'] as const,
  tag: ['id', 'title', 'alias', 'type', 'is_active'] as const,
  image: [
    'id', 'canonical_url', 'alt_text', 'description',
    'tags', 'subject_tags', 'mood_tags', 'region_tags',
    'width', 'height', 'original_filename',
  ] as const,
  page: [
    'id', 'pagetype_id', 'pagetype_title', 'title', 'alias', 'override_url',
    'canonical_url', 'intro_text', 'summary', 'image_id', 'bannerimage_id',
    'ntag_ids', 'parent_id',
  ] as const,
  contentblock: [
    'id', 'page_id', 'position', 'subtype', 'title', 'subheading', 'text',
    'image_id', 'cta_text', 'cta_url',
  ] as const,
  chunk: ['id', 'type_name', 'title', 'text'] as const,
  faqitem: ['id', 'title', 'content', 'faqset_id', 'position'] as const,
  trip: [
    'id', 'slug', 'title', 'subtitle', 'region_id', 'country_id',
    'duration_days', 'from_price', 'currency_code', 'description',
    'includes', 'excludes', 'accommodation_style', 'ntag_ids',
    'image_id', 'canonical_url', 'page_id',
  ] as const,
  tour: [
    'id', 'slug', 'title', 'subtitle', 'duration_days', 'group_size_max',
    'from_price', 'currency_code', 'description', 'region_id', 'ntag_ids',
    'image_id', 'canonical_url', 'page_id',
  ] as const,
  tour_item: ['id', 'tour_id', 'position', 'day_label', 'title', 'description'] as const,
  hotel: [
    'id', 'slug', 'name', 'description', 'location_id', 'area_id', 'page_id',
    'canonical_url', 'star_rating',
  ] as const,
  vessel: ['id', 'slug', 'name', 'description', 'page_id', 'canonical_url'] as const,
  cabintype: ['id', 'name', 'description'] as const,
  cabin: ['id', 'vessel_id', 'cabintype_id', 'name', 'description', 'capacity'] as const,
  customerreview: [
    'id', 'content', 'name', 'date', 'location', 'is_published', 'title',
    'image_id', 'feedbacksnippet_id', 'created', 'modified',
  ] as const,
  customerreview_trip: ['id', 'customerreview_id', 'trip_id', 'position'] as const,
  // customer_tip — base columns only. The enrich pipeline owns topic_tags /
  // region (per-row classify) + embedding / tsv / classified_at; those are NOT
  // listed here, so flushBuffer's column-restricted upsert never clobbers them
  // on conflict (theme 5 idempotency).
  customer_tip: [
    'id', 'source_provenance', 'source_id', 'text', 'author_name',
    'source_created_at', 'content_hash',
  ] as const,
} as const;

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function run(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const start = Date.now();

  // ---- Pre-flight: confirm migrations are applied. -----------------------
  const sentinel = await opts.client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.customerreview') IS NOT NULL AS exists`,
  );
  if (!sentinel.rows[0]?.exists) {
    throw new Error(
      'Migration 006 not applied (customerreview table missing). Run `npm run migrate:up --workspace @swoop/connector` first.',
    );
  }

  log(`[etl:sql] starting; dump=${opts.dumpPath}`);
  log(`[etl:sql] pass 1 — building lookup tables`);

  const lookups = await loadLookups(opts.dumpPath);
  log(
    `[etl:sql]   currency=${lookups.currencyById.size} file=${lookups.fileById.size}` +
      ` pagetype=${lookups.pagetypeById.size} ntag-entities=${[...lookups.ntagsByEntity.values()].reduce((s, m) => s + m.size, 0)}` +
      ` image_trip=${lookups.imageTripFirst.size} image_page=${lookups.imagePageFirst.size}`,
  );

  log(`[etl:sql] pass 2 — streaming + transforming + upserting`);

  // Per-source-table buffers. Filled during the second stream pass; flushed
  // in topologically-correct order at the end.
  const buffers = makeEmptyBuffers();
  const subtypeByContentblockId = new Map<number, string>();
  const dayByDayByTripId = new Map<number, { day: number; text: string }[]>();

  for await (const row of streamDump(opts.dumpPath)) {
    routeRow(row, buffers, subtypeByContentblockId, dayByDayByTripId, lookups);
  }
  if (opts.customerReviewDumpPath) {
    log(`[etl:sql]   reading supplementary dump=${opts.customerReviewDumpPath}`);
    for await (const row of streamDump(opts.customerReviewDumpPath)) {
      routeRow(row, buffers, subtypeByContentblockId, dayByDayByTripId, lookups);
    }
  }
  if (opts.customerTipDumpPath) {
    log(`[etl:sql]   reading supplementary dump=${opts.customerTipDumpPath}`);
    for await (const row of streamDump(opts.customerTipDumpPath)) {
      routeRow(row, buffers, subtypeByContentblockId, dayByDayByTripId, lookups);
    }
  }

  // ---- Compose final rows that need cross-table data. --------------------

  // Page must transform before trip (trip needs page.canonical_url).
  const pageOut = transformPagesAndCollectCanonical(buffers.page, lookups);
  const tripOut = transformTripsWithDayByDay(
    buffers.trip,
    lookups,
    pageOut.canonicalById,
    dayByDayByTripId,
  );

  const tables: Record<string, TableTally> = {};

  // ---- Flush in FK-safe topological order. -------------------------------
  // country / area / location / activity / tag / image are leaf-ish (image
  // refs nothing in the domain). page references image (FK). contentblock
  // references page + image. trip / tour / hotel / vessel reference page +
  // image. cabin references vessel / cabintype.

  const filter = opts.only ?? new Set<string>();
  const want = (t: string) => filter.size === 0 || filter.has(t);

  // Track populated id sets so FK rules can nullify (or drop) dangling
  // refs in downstream tables. These are populated lazily as each table
  // flushes, so the order of work below mirrors FK direction.
  const keptCountryIds = new Set<number>();
  const keptAreaIds = new Set<number>();
  const keptLocationIds = new Set<number>();
  const keptPageIds = new Set<number>();
  const keptImageIds = new Set<number>();
  const keptTripIds = new Set<number>();
  const keptHotelIds = new Set<number>();
  const keptVesselIds = new Set<number>();
  const keptCabintypeIds = new Set<number>();
  const keptTourIds = new Set<number>();
  const keptCustomerReviewIds = new Set<number>();

  if (want('country')) {
    tables.country = await flushBuffer(opts, 'country', COLS.country, buffers.country, transformCountry);
    populateKeptIds(buffers.country, transformCountry, keptCountryIds);
  }

  if (want('area')) {
    tables.area = await flushBuffer(opts, 'area', COLS.area, buffers.area, transformArea);
    populateKeptIds(buffers.area, transformArea, keptAreaIds);
  }

  if (want('location')) {
    tables.location = await flushBuffer(opts, 'location', COLS.location, buffers.location, transformLocation);
    populateKeptIds(buffers.location, transformLocation, keptLocationIds);
  }

  if (want('activity'))
    tables.activity = await flushBuffer(opts, 'activity', COLS.activity, buffers.activity, transformActivity);

  if (want('tag'))
    tables.tag = await flushBuffer(opts, 'tag', COLS.tag, buffers.ntag, transformNtag);

  // Pre-flight: build the image transformation results to know which image
  // ids are populated, so downstream FKs to image can be nulled if dangling.
  const imageRows: Record<string, unknown>[] = [];
  let imageDropped = 0;
  for (const r of buffers.image) {
    const out = transformImage(r, lookups);
    if (out === null) {
      imageDropped++;
      continue;
    }
    imageRows.push(out);
  }
  for (const r of imageRows) keptImageIds.add(r.id as number);

  if (want('image')) {
    if (!opts.dryRun) {
      await writeBatches(opts.client, 'image', COLS.image, imageRows);
    }
    tables.image = {
      rowsIn: buffers.image.length,
      rowsOut: imageRows.length,
      skipped: imageDropped > 0 ? [{ reason: 'filter', count: imageDropped }] : [],
    };
  }

  if (want('page')) {
    // Nullify image_id / bannerimage_id where target image wasn't loaded.
    let nulledImageRefs = 0;
    pageOut.rows = pageOut.rows.map((row) => {
      let mutated = false;
      const out = { ...row };
      const im = row.image_id as number | null;
      if (im !== null && !keptImageIds.has(im)) {
        out.image_id = null;
        mutated = true;
      }
      const bm = row.bannerimage_id as number | null;
      if (bm !== null && !keptImageIds.has(bm)) {
        out.bannerimage_id = null;
        mutated = true;
      }
      if (mutated) nulledImageRefs++;
      return out;
    });
    if (nulledImageRefs > 0) {
      pageOut.skipped.push({ reason: 'orphan_image_nulled', count: nulledImageRefs });
    }

    // Two-pass: page.parent_id is a self-referencing FK. Inside a single
    // multi-row INSERT, child rows can land before their parents — non-
    // deferrable FK then rejects. Insert with parent_id=NULL first, then
    // run a separate UPDATE pass to wire up the parent_id values.
    const passOneRows = pageOut.rows.map((row) => ({ ...row, parent_id: null }));
    if (!opts.dryRun) {
      await writeBatches(opts.client, 'page', COLS.page, passOneRows);
      // Second pass: UPDATE parent_id by id. Batch into chunks of 500 for
      // statement size budget.
      const idToParent = pageOut.rows
        .filter((r) => r.parent_id !== null)
        .map((r) => [r.id, r.parent_id] as [number, number]);
      for (let i = 0; i < idToParent.length; i += DEFAULT_BATCH_SIZE) {
        const batch = idToParent.slice(i, i + DEFAULT_BATCH_SIZE);
        const params: unknown[] = [];
        const cases: string[] = [];
        const ids: string[] = [];
        for (const [id, parent] of batch) {
          params.push(id, parent);
          const idIdx = params.length - 1;
          const parentIdx = params.length;
          cases.push(`WHEN id = $${idIdx} THEN $${parentIdx}::INTEGER`);
          ids.push(`$${idIdx}`);
        }
        await opts.client.query(
          `UPDATE page SET parent_id = CASE ${cases.join(' ')} END WHERE id IN (${ids.join(', ')})`,
          params,
        );
      }
    }
    tables.page = {
      rowsIn: pageOut.rowsIn,
      rowsOut: pageOut.rows.length,
      skipped: pageOut.skipped,
    };
    for (const r of pageOut.rows) keptPageIds.add(r.id as number);
  }

  if (want('contentblock')) {
    tables.contentblock = await flushBuffer(
      opts,
      'contentblock',
      COLS.contentblock,
      buffers.contentblock,
      (r) => {
        const id = numOrNull(r.values.id);
        if (id === null) return null;
        const sub = subtypeByContentblockId.get(id);
        if (!sub) return null; // No subtype junction → drop (UI plumbing or unknown).
        return transformContentblock(r, lookups, sub);
      },
      [
        { column: 'page_id', validIds: keptPageIds, mode: 'nullify' },
        { column: 'image_id', validIds: keptImageIds, mode: 'nullify' },
      ],
    );
  }

  if (want('chunk'))
    tables.chunk = await flushBuffer(opts, 'chunk', COLS.chunk, buffers.chunk, transformChunk);

  if (want('faqitem'))
    tables.faqitem = await flushBuffer(opts, 'faqitem', COLS.faqitem, buffers.faqitem, transformFaqItem);

  if (want('trip')) {
    // Apply FK rules to the prebuilt trip rows: nullify image_id, page_id
    // when targets weren't loaded. Custom shape (we don't go through
    // flushBuffer for trip because daybyday concatenation already happened).
    let imageNulled = 0;
    let pageNulled = 0;
    tripOut.rows = tripOut.rows.map((row) => {
      const out = { ...row };
      const im = row.image_id as number | null;
      if (im !== null && !keptImageIds.has(im)) {
        out.image_id = null;
        imageNulled++;
      }
      const pg = row.page_id as number | null;
      if (pg !== null && !keptPageIds.has(pg)) {
        out.page_id = null;
        pageNulled++;
      }
      return out;
    });
    if (imageNulled > 0) tripOut.skipped.push({ reason: 'fk_nulled_image_id', count: imageNulled });
    if (pageNulled > 0) tripOut.skipped.push({ reason: 'fk_nulled_page_id', count: pageNulled });
    tables.trip = await flushPrebuilt(opts, 'trip', COLS.trip, tripOut.rows, tripOut.skipped);
    for (const r of tripOut.rows) keptTripIds.add(r.id as number);
  }

  if (want('tour')) {
    // Tour identity comes from the parent contentblock's page
    // (C.focused-shamir-1): tours.content_block_id → contentblock.page_id →
    // page.{title,alias,canonical_url}. pageById is built from the kept page
    // rows, so a tour whose page was filtered upstream drops cleanly.
    const pageById = new Map<
      number,
      { title: string; alias: string | null; canonical_url: string }
    >();
    for (const r of pageOut.rows) {
      pageById.set(r.id as number, {
        title: r.title as string,
        alias: r.alias as string | null,
        canonical_url: r.canonical_url as string,
      });
    }
    const tourOut = transformToursWithPages(buffers.tours, lookups, pageById);
    // FK rule: nullify image_id where the target image wasn't loaded. page_id
    // needs no rule — transformTour only emits tours whose page is kept.
    let imageNulled = 0;
    tourOut.rows = tourOut.rows.map((row) => {
      const im = row.image_id as number | null;
      if (im !== null && !keptImageIds.has(im)) {
        imageNulled++;
        return { ...row, image_id: null };
      }
      return row;
    });
    if (imageNulled > 0) tourOut.skipped.push({ reason: 'fk_nulled_image_id', count: imageNulled });
    tables.tour = await flushPrebuilt(opts, 'tour', COLS.tour, tourOut.rows, tourOut.skipped);
    for (const r of tourOut.rows) keptTourIds.add(r.id as number);
  }
  if (want('tour_item')) {
    tables.tour_item = await flushBuffer(
      opts,
      'tour_item',
      COLS.tour_item,
      buffers.tour_items,
      transformTourItem,
      [{ column: 'tour_id', validIds: keptTourIds, mode: 'drop' }],
    );
  }

  if (want('hotel')) {
    tables.hotel = await flushBuffer(
      opts,
      'hotel',
      COLS.hotel,
      buffers.hotel,
      (r) => transformHotel(r, lookups, pageOut.canonicalById),
      [
        { column: 'page_id', validIds: keptPageIds, mode: 'nullify' },
        { column: 'location_id', validIds: keptLocationIds, mode: 'nullify' },
      ],
    );
    for (const r of buffers.hotel) {
      const out = transformHotel(r, lookups, pageOut.canonicalById);
      if (out) keptHotelIds.add(out.id as number);
    }
  }

  if (want('vessel')) {
    tables.vessel = await flushBuffer(
      opts,
      'vessel',
      COLS.vessel,
      buffers.vessel,
      (r) => transformVessel(r, pageOut.canonicalById),
      [{ column: 'page_id', validIds: keptPageIds, mode: 'nullify' }],
    );
    for (const r of buffers.vessel) {
      const out = transformVessel(r, pageOut.canonicalById);
      if (out) keptVesselIds.add(out.id as number);
    }
  }
  if (want('cabintype')) {
    tables.cabintype = await flushBuffer(opts, 'cabintype', COLS.cabintype, buffers.cabintype, transformCabintype);
    populateKeptIds(buffers.cabintype, transformCabintype, keptCabintypeIds);
  }
  if (want('cabin'))
    tables.cabin = await flushBuffer(opts, 'cabin', COLS.cabin, buffers.cabin, transformCabin, [
      { column: 'vessel_id', validIds: keptVesselIds, mode: 'drop' },
      { column: 'cabintype_id', validIds: keptCabintypeIds, mode: 'nullify' },
    ]);

  if (want('customerreview')) {
    tables.customerreview = await flushBuffer(
      opts,
      'customerreview',
      COLS.customerreview,
      buffers.customerreview,
      transformCustomerReview,
      [{ column: 'image_id', validIds: keptImageIds, mode: 'nullify' }],
    );
    for (const r of buffers.customerreview) {
      const out = transformCustomerReview(r);
      if (out) keptCustomerReviewIds.add(out.id as number);
    }
  }
  if (want('customerreview_trip'))
    tables.customerreview_trip = await flushBuffer(
      opts,
      'customerreview_trip',
      COLS.customerreview_trip,
      buffers.customerreview_trip,
      transformCustomerReviewTrip,
      [
        { column: 'customerreview_id', validIds: keptCustomerReviewIds, mode: 'drop' },
        { column: 'trip_id', validIds: keptTripIds, mode: 'drop' },
      ],
    );

  // customer_tip (find_tips). No FK rules — the table references nothing. The
  // column-restricted upsert (COLS.customer_tip) preserves enrich-owned
  // columns (embedding / tsv / topic_tags / region / classified_at) on
  // conflict. Skipped silently when migration 013 isn't applied (sentinel
  // below only hard-requires customerreview / migration 006).
  if (want('customer_tip')) {
    const tipSentinel = await opts.client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.customer_tip') IS NOT NULL AS exists`,
    );
    if (tipSentinel.rows[0]?.exists) {
      tables.customer_tip = await flushBuffer(
        opts,
        'customer_tip',
        COLS.customer_tip,
        buffers.customertip,
        transformCustomerTip,
      );
    } else {
      log(`[etl:sql]   customer_tip table absent (migration 013 not applied) — skipping`);
    }
  }

  const durationMs = Date.now() - start;

  log(`[etl:sql] done in ${(durationMs / 1000).toFixed(2)}s`);
  for (const [name, tally] of Object.entries(tables)) {
    const skipSummary = tally.skipped.length
      ? ` skipped=${tally.skipped.map((s) => `${s.reason}:${s.count}`).join(',')}`
      : '';
    log(`[etl:sql]   ${name}: ${tally.rowsOut}/${tally.rowsIn}${skipSummary}`);
  }

  return { tables, durationMs };
}

// ---------------------------------------------------------------------------
// Buffer construction + dispatch
// ---------------------------------------------------------------------------

interface Buffers {
  country: DumpRow[];
  area: DumpRow[];
  location: DumpRow[];
  activity: DumpRow[];
  ntag: DumpRow[];
  image: DumpRow[];
  page: DumpRow[];
  contentblock: DumpRow[];
  chunk: DumpRow[];
  faqitem: DumpRow[];
  trip: DumpRow[];
  tours: DumpRow[];
  tour_items: DumpRow[];
  hotel: DumpRow[];
  vessel: DumpRow[];
  cabintype: DumpRow[];
  cabin: DumpRow[];
  customerreview: DumpRow[];
  customerreview_trip: DumpRow[];
  customertip: DumpRow[];
}

function makeEmptyBuffers(): Buffers {
  return {
    country: [], area: [], location: [], activity: [], ntag: [],
    image: [], page: [], contentblock: [], chunk: [], faqitem: [],
    trip: [], tours: [], tour_items: [], hotel: [], vessel: [],
    cabintype: [], cabin: [], customerreview: [], customerreview_trip: [],
    customertip: [],
  };
}

function routeRow(
  row: DumpRow,
  buffers: Buffers,
  subtypeByContentblockId: Map<number, string>,
  dayByDayByTripId: Map<number, { day: number; text: string }[]>,
  _lookups: Lookups,
): void {
  const t = row.table;

  // Direct domain-table targets.
  if (t === 'country') buffers.country.push(row);
  else if (t === 'area') buffers.area.push(row);
  else if (t === 'location') buffers.location.push(row);
  else if (t === 'activity') buffers.activity.push(row);
  else if (t === 'ntag') buffers.ntag.push(row);
  else if (t === 'image') buffers.image.push(row);
  else if (t === 'page') buffers.page.push(row);
  else if (t === 'contentblock') buffers.contentblock.push(row);
  else if (t === 'chunk') buffers.chunk.push(row);
  else if (t === 'faqitem') buffers.faqitem.push(row);
  else if (t === 'trip') buffers.trip.push(row);
  else if (t === 'tours') buffers.tours.push(row);
  else if (t === 'tour_items') buffers.tour_items.push(row);
  else if (t === 'hotel') buffers.hotel.push(row);
  else if (t === 'vessel') buffers.vessel.push(row);
  else if (t === 'cabintype') buffers.cabintype.push(row);
  else if (t === 'cabin') buffers.cabin.push(row);
  else if (t === 'customerreview') buffers.customerreview.push(row);
  else if (t === 'customerreview_trip') buffers.customerreview_trip.push(row);
  // `customertip` (singular) is the find_tips source table. Checked here,
  // BEFORE the CONTENTBLOCK_SUBTYPE_TABLES block — that block keys on
  // `contentblock_customertip` (the junction), a different table name, so
  // there's no collision, but the explicit ordering keeps intent obvious.
  else if (t === 'customertip') buffers.customertip.push(row);

  // Subtype-junction tables — derive contentblock.subtype.
  else if (t in CONTENTBLOCK_SUBTYPE_TABLES) {
    const subtype = CONTENTBLOCK_SUBTYPE_TABLES[t]!;
    const cbId = numOrNull(row.values.contentblock_id);
    if (cbId !== null && !subtypeByContentblockId.has(cbId)) {
      subtypeByContentblockId.set(cbId, subtype);
    }
  }

  // daybyday — aggregate per trip per the C.t3 plan §"daybyday: column on
  // trip, not its own table" + HITL Q2: concatenate to trip.description.
  else if (t === 'daybyday') {
    if (numOrNull(row.values.deleted) !== null && numOrNull(row.values.deleted) !== 0) return;
    const type = strOrNull(row.values.type);
    const tripId = numOrNull(row.values.trip_id);
    if (type !== 'presale' || tripId === null) return;
    const dayStart = numOrNull(row.values.day_start) ?? 0;
    const text =
      strOrNull(row.values.site_text) ??
      strOrNull(row.values.pre_sale_text) ??
      strOrNull(row.values.text);
    if (text === null) return;
    let arr = dayByDayByTripId.get(tripId);
    if (!arr) {
      arr = [];
      dayByDayByTripId.set(tripId, arr);
    }
    arr.push({ day: dayStart, text });
  }

  // Anything else (currency, file, pagetype, ntags_lookup, image_trip,
  // image_page, swooper_*, partner*, tripvariant, season, adventurousness,
  // pressreview, etc.) — silently dropped at routing.
}

// ---------------------------------------------------------------------------
// Page two-pass — build canonical_url map alongside the upsert rows so trip
// transformation can resolve trip.canonical_url via trip.page_id.
// ---------------------------------------------------------------------------

interface PageBuildResult {
  rows: Record<string, unknown>[];
  skipped: { reason: string; count: number }[];
  rowsIn: number;
  canonicalById: Map<number, string>;
}

function transformPagesAndCollectCanonical(
  rawPages: DumpRow[],
  lookups: Lookups,
): PageBuildResult {
  // Build first, dedupe by canonical_url after — the migration constrains
  // page.canonical_url UNIQUE. The source dump occasionally carries multiple
  // page rows with the same `override_url || alias` (legacy records, alt
  // versions). Keep the lowest id; count the rest as `dup_canonical`. The
  // `canonicalById` map for trip→page resolution is populated for ALL kept
  // ids (including duplicates' lowest-id winner) and for filtered duplicates
  // (so trips referencing the dup-loser still resolve to the same URL).
  const all: Record<string, unknown>[] = [];
  const canonicalById = new Map<number, string>();
  const skipCounts: Record<string, number> = {};

  for (const r of rawPages) {
    const result = transformPage(r, lookups);
    if (result.row === null) {
      const k = result.reason ?? 'unknown';
      skipCounts[k] = (skipCounts[k] ?? 0) + 1;
      continue;
    }
    all.push(result.row);
    const id = result.row.id as number;
    const url = result.row.canonical_url as string;
    // Always populate canonicalById so trips can resolve their canonical URL
    // regardless of which sibling page row "wins" the unique constraint.
    canonicalById.set(id, url);
  }

  // Dedupe by canonical_url, keeping the lowest id.
  const byUrl = new Map<string, Record<string, unknown>>();
  for (const row of all) {
    const url = row.canonical_url as string;
    const id = row.id as number;
    const existing = byUrl.get(url);
    if (!existing || (existing.id as number) > id) {
      byUrl.set(url, row);
    }
  }
  let rows = [...byUrl.values()];
  const dups = all.length - rows.length;
  if (dups > 0) skipCounts['dup_canonical'] = (skipCounts['dup_canonical'] ?? 0) + dups;

  // Null out parent_id where the parent isn't in the populated set. Source
  // dump can carry parent references to Profile pages / test pages / soft-
  // deleted rows that we filtered out — leaving the FK in would violate the
  // self-referential foreign key constraint.
  const keptIds = new Set(rows.map((r) => r.id as number));
  let orphanParents = 0;
  rows = rows.map((row) => {
    const parentId = row.parent_id as number | null;
    if (parentId !== null && !keptIds.has(parentId)) {
      orphanParents++;
      return { ...row, parent_id: null };
    }
    return row;
  });
  if (orphanParents > 0) {
    skipCounts['orphan_parent_nulled'] = (skipCounts['orphan_parent_nulled'] ?? 0) + orphanParents;
  }

  return {
    rows,
    skipped: Object.entries(skipCounts).map(([reason, count]) => ({ reason, count })),
    rowsIn: rawPages.length,
    canonicalById,
  };
}

// ---------------------------------------------------------------------------
// Trip transform — pulls in daybyday concatenation per HITL Q2.
// ---------------------------------------------------------------------------

interface TripBuildResult {
  rows: Record<string, unknown>[];
  skipped: { reason: string; count: number }[];
  rowsIn: number;
}

function transformTripsWithDayByDay(
  rawTrips: DumpRow[],
  lookups: Lookups,
  pageCanonicalById: Map<number, string>,
  dayByDayByTripId: Map<number, { day: number; text: string }[]>,
): TripBuildResult {
  const rows: Record<string, unknown>[] = [];
  const skipCounts: Record<string, number> = {};

  for (const r of rawTrips) {
    const result = transformTrip(r, lookups, pageCanonicalById);
    if (result.row === null) {
      const k = result.reason ?? 'unknown';
      skipCounts[k] = (skipCounts[k] ?? 0) + 1;
      continue;
    }
    const id = result.row.id as number;
    const days = dayByDayByTripId.get(id);
    if (days && days.length > 0) {
      // Concatenate per HITL Q2: order by day_start, join with double-newline.
      days.sort((a, b) => a.day - b.day);
      result.row.description = days
        .map((d) => `Day ${d.day}: ${d.text.trim()}`)
        .join('\n\n');
    }
    rows.push(result.row);
  }

  return {
    rows,
    skipped: Object.entries(skipCounts).map(([reason, count]) => ({ reason, count })),
    rowsIn: rawTrips.length,
  };
}

// ---------------------------------------------------------------------------
// Tour transform — resolves identity (title / slug / canonical_url) from the
// parent contentblock's page. Bespoke (not flushBuffer) so the skip tally can
// name reasons. Per C.focused-shamir-1 / the 2026-05-14 addendum in
// 03-exec-c-t3.md.
// ---------------------------------------------------------------------------

interface TourBuildResult {
  rows: Record<string, unknown>[];
  skipped: { reason: string; count: number }[];
  rowsIn: number;
}

function transformToursWithPages(
  rawTours: DumpRow[],
  lookups: Lookups,
  pageById: Map<number, { title: string; alias: string | null; canonical_url: string }>,
): TourBuildResult {
  const rows: Record<string, unknown>[] = [];
  const skipCounts: Record<string, number> = {};

  for (const r of rawTours) {
    const result = transformTour(r, lookups, pageById);
    if (result.row === null) {
      const k = result.reason ?? 'unknown';
      skipCounts[k] = (skipCounts[k] ?? 0) + 1;
      continue;
    }
    rows.push(result.row);
  }

  return {
    rows,
    skipped: Object.entries(skipCounts).map(([reason, count]) => ({ reason, count })),
    rowsIn: rawTours.length,
  };
}

// ---------------------------------------------------------------------------
// Buffer flush helpers
// ---------------------------------------------------------------------------

/**
 * Tables with a UNIQUE secondary key beyond `id`. Tracking them here lets the
 * generic flush dedupe by that natural key — keeps `tag.alias UNIQUE`,
 * `trip.slug UNIQUE`, etc. from blowing up on multi-row inserts where the
 * source dump carries colliding aliases.
 */
const SECONDARY_UNIQUE_KEY: Record<string, string> = {
  tag: 'alias',
  trip: 'slug',
  tour: 'slug',
  hotel: 'slug',
  vessel: 'slug',
};

/**
 * Per-FK enforcement spec.
 *
 * - `column`: name of the FK column on the row.
 * - `validIds`: the set of ids in the parent table we've populated.
 * - `mode`: 'nullify' (set FK to null if dangling) or 'drop' (drop the row
 *           if the parent isn't loaded — used for NOT NULL FKs in junctions).
 */
interface FkRule {
  column: string;
  validIds: ReadonlySet<number>;
  mode: 'nullify' | 'drop';
}

async function flushBuffer<R extends Record<string, unknown>>(
  opts: RunOptions,
  table: string,
  columns: readonly string[],
  rawRows: DumpRow[],
  fn: (r: DumpRow) => R | null,
  fks?: readonly FkRule[],
): Promise<TableTally> {
  const transformed: R[] = [];
  let dropped = 0;
  for (const r of rawRows) {
    const out = fn(r);
    if (out === null) {
      dropped++;
      continue;
    }
    transformed.push(out);
  }

  // Apply FK rules: nullify dangling soft-FKs, drop rows with missing
  // hard-FKs. Tracked as `fk_nulled_<col>` / `fk_drop_<col>` skip reasons.
  const fkSkipCounts: Record<string, number> = {};
  const afterFk: R[] = [];
  for (const r of transformed) {
    let row = r;
    let drop = false;
    if (fks) {
      for (const rule of fks) {
        const v = row[rule.column];
        if (v === null || v === undefined) continue;
        const present = typeof v === 'number' && rule.validIds.has(v);
        if (present) continue;
        if (rule.mode === 'drop') {
          fkSkipCounts[`fk_drop_${rule.column}`] = (fkSkipCounts[`fk_drop_${rule.column}`] ?? 0) + 1;
          drop = true;
          break;
        } else {
          row = { ...row, [rule.column]: null };
          fkSkipCounts[`fk_nulled_${rule.column}`] = (fkSkipCounts[`fk_nulled_${rule.column}`] ?? 0) + 1;
        }
      }
    }
    if (!drop) afterFk.push(row);
  }

  // Dedupe within-batch by primary id (a single source row id reused twice
  // is rare but possible across the two dumps; this is also belt-and-braces
  // against future supplementary dumps overlapping the main dump).
  const byId = new Map<unknown, R>();
  for (const r of afterFk) byId.set(r.id, r);
  let final = [...byId.values()];
  const dupId = afterFk.length - final.length;

  // Dedupe by secondary unique key if applicable.
  const secondaryKey = SECONDARY_UNIQUE_KEY[table];
  let dupSecondary = 0;
  if (secondaryKey) {
    const bySecondary = new Map<unknown, R>();
    const noKey: R[] = [];
    for (const r of final) {
      const v = r[secondaryKey];
      if (v === null || v === undefined) {
        noKey.push(r);
        continue;
      }
      const existing = bySecondary.get(v);
      if (!existing || ((r.id as number) < (existing.id as number))) {
        bySecondary.set(v, r);
      }
    }
    const before = final.length;
    final = [...bySecondary.values(), ...noKey];
    dupSecondary = before - final.length;
  }

  const skipped: { reason: string; count: number }[] = [];
  if (dropped > 0) skipped.push({ reason: 'filter', count: dropped });
  if (dupId > 0) skipped.push({ reason: 'dup_id', count: dupId });
  if (dupSecondary > 0) skipped.push({ reason: `dup_${secondaryKey}`, count: dupSecondary });
  for (const [reason, count] of Object.entries(fkSkipCounts)) {
    skipped.push({ reason, count });
  }

  const tally: TableTally = {
    rowsIn: rawRows.length,
    rowsOut: final.length,
    skipped,
  };
  if (!opts.dryRun) {
    await writeBatches(opts.client, table, columns, final);
  }
  return tally;
}

async function flushPrebuilt(
  opts: RunOptions,
  table: string,
  columns: readonly string[],
  rows: Record<string, unknown>[],
  skipped: { reason: string; count: number }[],
): Promise<TableTally> {
  const tally: TableTally = {
    rowsIn: rows.length + skipped.reduce((s, x) => s + x.count, 0),
    rowsOut: rows.length,
    skipped,
  };
  if (!opts.dryRun) {
    await writeBatches(opts.client, table, columns, rows);
  }
  return tally;
}

/**
 * Helper to thread "what ids did this transformation keep?" out alongside the
 * flush. Mirrors what flushBuffer's transform pass does internally — running
 * the transform fn over rawRows and collecting the surviving ids. Cheap (the
 * transform fns are pure).
 */
function populateKeptIds(
  rawRows: DumpRow[],
  fn: (r: DumpRow) => Record<string, unknown> | null,
  out: Set<number>,
): void {
  for (const r of rawRows) {
    const t = fn(r);
    if (t === null) continue;
    const id = t.id;
    if (typeof id === 'number') out.add(id);
  }
}

async function writeBatches<R extends Record<string, unknown>>(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly R[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += DEFAULT_BATCH_SIZE) {
    const batch = rows.slice(i, i + DEFAULT_BATCH_SIZE);
    await upsertBatch(client, {
      table,
      conflictKeys: ['id'],
      columns,
      rows: batch,
    });
  }
}
