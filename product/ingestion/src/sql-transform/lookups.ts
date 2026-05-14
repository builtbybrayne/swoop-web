/**
 * Pre-loaded lookup tables for the SQL-transform pipeline.
 *
 * Some transformations need to resolve foreign-key-shaped data eagerly
 * during a single linear pass over the dump. Rather than holding the
 * entire dump in memory and joining at the end, we run a *first pass*
 * over the dump and build the small lookup maps that subsequent
 * transformations need. This keeps each transformation a pure
 * row-in / row-out function.
 *
 * Pre-loaded:
 *   - currency:       id → iso_3 (11 entries; per discoveries.md S1).
 *   - file:           id → { name, extension, type } for image rows
 *                     (filtered to image extensions; ~13K relevant of 135K).
 *   - pagetype:       id → title (small, denormalised onto page).
 *   - ntags_lookup:   per-(entity_type, entity_id) → tag_ids[]
 *                     (post-filter to entity_type IN (image, trip, contentblock);
 *                      ~7K relevant of 157K).
 *   - image_trip:     trip_id → first image_id ordered by position
 *                     (used for trip hero image; ~3K rows).
 *   - image_page:     page_id → first image_id ordered by position
 *                     (used for hotel / trip fallback hero image; ~6K rows).
 *   - contentblock:   id → { pageId, typeId } (used by transformTour to resolve
 *                     tour identity via the parent block's page; ~10K rows).
 *
 * Per the C.t3 plan: this is "Shape B" for ntag aggregation (pre-aggregate
 * once, write at parent-table-write time) — chosen for cleaner isolation
 * and one less UPDATE pass.
 */

import { streamDump } from './parser.js';

export interface Lookups {
  currencyById: Map<number, string>;
  fileById: Map<number, { name: string; extension: string | null; type: string | null }>;
  pagetypeById: Map<number, string>;
  ntagsByEntity: Map<string, Map<number, number[]>>; // entity_type → (entity_id → [tag_ids])
  imageTripFirst: Map<number, number>; // trip_id → image_id (lowest position)
  imagePageFirst: Map<number, number>; // page_id → image_id (lowest position)
  /**
   * Area-typed ntag.id → area.id, joined by alias. Used by `transformTrip` to
   * derive `trip.region_id` from the trip's area-typed tags. Only entries
   * where an area-typed ntag's alias matches a real `area` row's alias are
   * included; the 5 sub-area / campaign tags (Welsh, Atlantic, Fjords,
   * Multi-region tour, Valparaíso, etc.) fall out cleanly.
   *
   * Per Tier 3 plan `03-exec-crosscut-brave-pare-trip-region-id-backfill.md`
   * and decision (TBD at merge) — closes C.t3's `transformTrip` `region_id: null`
   * placeholder.
   */
  areaIdByTagId: Map<number, number>;
  /**
   * Contentblock id → its parent page id + block type id. Used by
   * `transformTour` to resolve a tour's identity — `tours.content_block_id`
   * → `contentblock.page_id` → page title/alias/canonical_url — and to filter
   * to itinerary-type blocks (`type_id = 152`). Soft-deleted contentblocks are
   * excluded, so a tour hanging off a deleted block drops cleanly.
   */
  contentblockById: Map<number, { pageId: number | null; typeId: number | null }>;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'png', 'jpeg', 'heic', 'gif', 'webp']);
const NTAGS_AGENT_ENTITY_TYPES = new Set(['image', 'trip', 'contentblock', 'video']);

export async function loadLookups(dumpPath: string): Promise<Lookups> {
  const currencyById = new Map<number, string>();
  const fileById = new Map<number, { name: string; extension: string | null; type: string | null }>();
  const pagetypeById = new Map<number, string>();
  const ntagsByEntity = new Map<string, Map<number, number[]>>();
  const imageTripFirstWithPos = new Map<number, { imageId: number; pos: number }>();
  const imagePageFirstWithPos = new Map<number, { imageId: number; pos: number }>();
  // Transient maps to derive `areaIdByTagId` post-stream. Stream order is
  // not guaranteed (area rows may arrive before or after the area-typed
  // ntag rows), so we capture both halves and join after streaming completes.
  const areaIdByAlias = new Map<string, number>();
  const areaTagAliasByTagId = new Map<number, string>();
  const contentblockById = new Map<number, { pageId: number | null; typeId: number | null }>();

  for await (const row of streamDump(dumpPath)) {
    switch (row.table) {
      case 'currency': {
        const id = numOrNull(row.values.id);
        const iso = strOrNull(row.values.iso_3);
        if (id !== null && iso !== null) currencyById.set(id, iso);
        break;
      }
      case 'file': {
        const ext = strOrNull(row.values.extension)?.toLowerCase() ?? null;
        const type = strOrNull(row.values.type);
        const isImage = (ext !== null && IMAGE_EXTENSIONS.has(ext)) ||
          (type !== null && type.startsWith('image/'));
        if (!isImage) break;
        const id = numOrNull(row.values.id);
        const name = strOrNull(row.values.name);
        if (id !== null && name !== null) {
          fileById.set(id, { name, extension: ext, type });
        }
        break;
      }
      case 'pagetype': {
        const id = numOrNull(row.values.id);
        const title = strOrNull(row.values.title);
        if (id !== null && title !== null) pagetypeById.set(id, title);
        break;
      }
      case 'ntags_lookup': {
        const entityType = strOrNull(row.values.entity_type);
        const entityId = numOrNull(row.values.entity_id);
        const tagId = numOrNull(row.values.tag_id);
        if (entityType === null || entityId === null || tagId === null) break;
        if (!NTAGS_AGENT_ENTITY_TYPES.has(entityType)) break;
        let perType = ntagsByEntity.get(entityType);
        if (!perType) {
          perType = new Map<number, number[]>();
          ntagsByEntity.set(entityType, perType);
        }
        let arr = perType.get(entityId);
        if (!arr) {
          arr = [];
          perType.set(entityId, arr);
        }
        arr.push(tagId);
        break;
      }
      case 'image_trip': {
        const tripId = numOrNull(row.values.trip_id);
        const imageId = numOrNull(row.values.image_id);
        const pos = numOrNull(row.values.position) ?? Number.MAX_SAFE_INTEGER;
        if (tripId === null || imageId === null) break;
        const existing = imageTripFirstWithPos.get(tripId);
        if (!existing || pos < existing.pos) {
          imageTripFirstWithPos.set(tripId, { imageId, pos });
        }
        break;
      }
      case 'image_page': {
        const pageId = numOrNull(row.values.page_id);
        const imageId = numOrNull(row.values.image_id);
        const pos = numOrNull(row.values.position) ?? Number.MAX_SAFE_INTEGER;
        if (pageId === null || imageId === null) break;
        const existing = imagePageFirstWithPos.get(pageId);
        if (!existing || pos < existing.pos) {
          imagePageFirstWithPos.set(pageId, { imageId, pos });
        }
        break;
      }
      case 'area': {
        // Capture area aliases for the post-stream areaIdByTagId join.
        // Soft-deleted areas are excluded — they wouldn't surface in `area`
        // table anyway, so a tag pointing to them should resolve to null.
        if (isDeleted(row.values.deleted)) break;
        const id = numOrNull(row.values.id);
        const alias = strOrNull(row.values.alias);
        if (id !== null && alias !== null) {
          areaIdByAlias.set(alias, id);
        }
        break;
      }
      case 'ntag': {
        // Capture area-typed ntag aliases for the post-stream join. Mirrors
        // `transformNtag`'s filter (type='area'); other types contribute
        // nothing to area-id resolution.
        const type = strOrNull(row.values.type);
        if (type !== 'area') break;
        const id = numOrNull(row.values.id);
        const alias = strOrNull(row.values.alias);
        const isActive = numOrNull(row.values.is_active);
        const active = isActive === null ? true : isActive !== 0;
        if (id !== null && alias !== null && active) {
          areaTagAliasByTagId.set(id, alias);
        }
        break;
      }
      case 'contentblock': {
        // Soft-deleted blocks are excluded — a tour hanging off a deleted
        // block should drop, not resolve to a stale page.
        if (isDeleted(row.values.deleted)) break;
        const id = numOrNull(row.values.id);
        if (id === null) break;
        contentblockById.set(id, {
          pageId: numOrNull(row.values.page_id),
          typeId: numOrNull(row.values.type_id),
        });
        break;
      }
    }
  }

  const imageTripFirst = new Map<number, number>();
  for (const [tripId, { imageId }] of imageTripFirstWithPos) imageTripFirst.set(tripId, imageId);
  const imagePageFirst = new Map<number, number>();
  for (const [pageId, { imageId }] of imagePageFirstWithPos) imagePageFirst.set(pageId, imageId);

  // Post-stream area-tag → area-id join. Tags whose alias has no
  // corresponding `area` row (sub-area / campaign tags like Welsh, Atlantic,
  // Fjords, Multi-region tour, Valparaíso) are silently dropped — there's no
  // single area to map them to.
  const areaIdByTagId = new Map<number, number>();
  for (const [tagId, alias] of areaTagAliasByTagId) {
    const areaId = areaIdByAlias.get(alias);
    if (areaId !== undefined) areaIdByTagId.set(tagId, areaId);
  }

  return {
    currencyById,
    fileById,
    pagetypeById,
    ntagsByEntity,
    imageTripFirst,
    imagePageFirst,
    areaIdByTagId,
    contentblockById,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Mirror of `transformations.isDeleted` to avoid the cross-module import.
// Source columns use `deleted: 1` (number) or non-empty string for the
// soft-delete signal; null / 0 / empty string mean live.
function isDeleted(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0 && v !== '0';
  return false;
}

export { numOrNull, strOrNull };
