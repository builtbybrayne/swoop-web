// -----------------------------------------------------------------------------
// @swoop/common/image — canonical image URL + page-as-hub helpers.
//
// Pure-function utility module shared by ETL (C.t3 / C.t6 / blog ingest), MCP
// tool handlers (C.t4), and any future widget-side rendering. Encodes two
// load-bearing rules from the chunk-C plan + 2026-04-29 discoveries:
//
//   1. Canonical URL construction (decision C.15): `override_url || alias`,
//      empty string treated as absent, prefixed with the Swoop production host
//      for full URLs. Mirrors the SQL `canonical_url(override_url, alias)`
//      function in migration 005 — if either rule changes, the other follows
//      in the same commit.
//
//   2. Imgix render-param composition (decision C.41 — see planning/
//      decisions.md): renderable image URLs are composed at runtime by
//      prepending the imgix tenant host and appending a default param string
//      callers can override per call. ETL stores the bare filename URL only.
//
//   3. Page-as-hub image resolution (decision C.16): direct image join wins
//      (`image_trip`, `image_location`, etc.); falls back to page-attached
//      images via `record.page_id`; otherwise empty. Short-circuits at the
//      first non-empty layer — never returns the union.
//
// All exports are pure functions. No I/O, no DOM, no Postgres — the helpers
// compose over already-fetched data. Callers own the fetch.
//
// JSDoc on every export names the decision it implements + (where relevant)
// the SQL function it mirrors, so a future agent maintaining either side has
// the cross-reference at hand.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * Swoop's imgix tenant host. Single tenant; constant rather than env var so
 * the value can't drift between orchestrator + connector reading different
 * `.env` files. If Swoop ever migrates imgix tenants the change is one line.
 *
 * Decision C.42 — see planning/decisions.md.
 */
export const IMGIX_HOST = "https://swoop-patagonia.imgix.net";

/**
 * Swoop's production website host. Used by `pageUrl()` to compose the full
 * clickable URL the agent surfaces to a visitor when the conversational move
 * is "go see this page on the Swoop site". Trailing slash is part of the
 * constant — callers concatenate the path-only `canonicalUrl()` directly.
 *
 * Decision C.15.
 */
export const SWOOP_PATAGONIA_HOST = "https://www.swoop-patagonia.com/";

/**
 * Default imgix render parameters applied when the caller passes no
 * overrides. Calibrated for "looks good in chat-inline + small hero
 * variants without baking in a specific width/height".
 *
 * - `auto=format,enhance,compress` — content-aware delivery format,
 *   subtle enhancement, and compression. `enhance` lifts muted Patagonia
 *   palettes without washing them out at this q level; if Swoop's brand
 *   review later disagrees, drop to `auto=format,compress`.
 * - `fit=crop` — cap by aspect rather than letterboxing.
 * - `q=80` — visually-lossless ceiling.
 *
 * Decision C.41 — see planning/decisions.md. Per-call overrides flow
 * through the second arg to `imgixUrl()`; defaults set the floor only.
 */
export const DEFAULT_IMGIX_PARAMS =
  "auto=format,enhance,compress&fit=crop&q=80";

// -----------------------------------------------------------------------------
// canonicalUrl + pageUrl — URL composition (decision C.15)
// -----------------------------------------------------------------------------

/**
 * Record-shape contract for any source row that carries `override_url` +
 * `alias`. Used by trip / page / hotel / location / tour / vessel rows alike;
 * the universal fallback rule per 2026-04-29 discovery.
 */
export interface CanonicalUrlInput {
  override_url?: string | null;
  alias: string | null;
}

/**
 * Returns the path-only canonical URL fragment for a record (e.g.
 * `chile/torres-del-paine/hiking/w-trek/original`). Mirrors the SQL
 * `canonical_url(override_url, alias)` function in migration 005 exactly:
 *
 *   - `override_url` wins when present and non-empty (empty string is
 *     treated as absent — the dump carries `''` rather than `NULL` for
 *     some rows).
 *   - Otherwise falls back to `alias`.
 *   - Returns `null` if both are absent / empty.
 *
 * Callers that want the full URL prepend `SWOOP_PATAGONIA_HOST` themselves
 * or use `pageUrl()` (the convenience wrapper).
 *
 * Decision C.15. Mirrors SQL `canonical_url()` — if either changes the
 * other follows in the same commit.
 */
export function canonicalUrl(input: CanonicalUrlInput): string | null {
  const override = input.override_url;
  if (typeof override === "string" && override !== "") return override;
  const alias = input.alias;
  if (typeof alias === "string" && alias !== "") return alias;
  return null;
}

/**
 * Convenience wrapper over `canonicalUrl()` that returns the full URL
 * (host + path) for any record carrying `override_url` + `alias`. Used by
 * tool handlers + UI when the visitor-facing surface needs an absolute URL
 * rather than a path fragment.
 *
 * Returns `null` if the record has neither an `override_url` nor an
 * `alias` — caller decides how to render absence (skip the link, log a
 * data-quality issue, etc.).
 *
 * Per HITL Q3 (2026-05-01 ratification): ships as a thin wrapper rather
 * than forcing every consumer to inline the host concatenation.
 *
 * Decision C.15.
 */
export function pageUrl(input: CanonicalUrlInput): string | null {
  const path = canonicalUrl(input);
  if (path === null) return null;
  return `${SWOOP_PATAGONIA_HOST}${path}`;
}

// -----------------------------------------------------------------------------
// imgixUrl — render-param composition
// -----------------------------------------------------------------------------

/**
 * Builds a full imgix-served URL for a stored filename. The default param
 * set is applied unless the caller passes their own param string.
 *
 *   imgixUrl("torres-del-paine-sunrise.jpg")
 *     -> "https://swoop-patagonia.imgix.net/torres-del-paine-sunrise.jpg
 *         ?auto=format,enhance,compress&fit=crop&q=80"
 *
 *   imgixUrl("hero.jpg", "auto=format&w=1600&h=900")
 *     -> "https://swoop-patagonia.imgix.net/hero.jpg
 *         ?auto=format&w=1600&h=900"
 *
 * Filename should be the bare `file.name` value as stored in the source
 * `file` table (per the 2026-04-29 two-table image discovery). Callers that
 * already hold the full imgix-prefixed `image.canonical_url` from Postgres
 * can either compose render params via this helper (passing the filename
 * substring) or append a `?<params>` suffix directly — both are valid.
 *
 * `params` is treated as an opaque querystring fragment; the helper does
 * no parsing or validation. Callers that need stronger guarantees can
 * compose `URLSearchParams` upstream and pass `.toString()`.
 *
 * Decision C.41.
 */
export function imgixUrl(filename: string, params?: string): string {
  const query = params ?? DEFAULT_IMGIX_PARAMS;
  return `${IMGIX_HOST}/${filename}?${query}`;
}

// -----------------------------------------------------------------------------
// resolveImageSet — page-as-hub resolution (decision C.16)
// -----------------------------------------------------------------------------

/**
 * Record-shape contract for `resolveImageSet()`. Encodes both the direct
 * image join (e.g. `image_trip` rows materialised into `directImageIds`)
 * and the page-as-hub fallback (`pageId` keyed into `pageImageIds`).
 *
 * - `directImageIds` is the result of fetching the entity's direct image
 *   junction table (e.g. `SELECT image_id FROM image_trip WHERE
 *   trip_id = $1 ORDER BY position`).
 * - `pageId` is the entity's `page_id` column value (or `null` if the
 *   entity isn't hubbed against a page).
 * - `pageImageIds` is a lookup of `page_id -> image_id[]` for whichever
 *   pages the caller pre-fetched.
 *
 * The shape matches what tool handlers + ETL code already pull from
 * Postgres; callers slot already-fetched join data in. The function does
 * not fetch.
 */
export interface ImageSetRecord {
  /** Image ids from the direct join table (e.g. `image_trip`). May be empty. */
  directImageIds: number[];
  /** The entity's `page_id` value, or null if not page-hubbed. */
  pageId: number | null;
}

/** Lookup: `page_id -> image_id[]` (caller-fetched from `image_page`). */
export type PageImageLookup = ReadonlyMap<number, readonly number[]>;

/**
 * Resolves the image-id set for a record per the page-as-hub fallback
 * chain (decision C.16, 2026-04-29 discovery):
 *
 *   1. If the record has a non-empty direct image join (e.g. trip has
 *      `image_trip` rows, location has `image_location` rows), return
 *      those ids.
 *   2. Else if `record.pageId` is set AND the page-image lookup carries
 *      a non-empty entry for it, return those ids.
 *   3. Else return an empty array.
 *
 * **Short-circuits at the first non-empty layer** — page-attached images
 * are never added on top of direct-join images, even when both paths
 * resolve. Per 2026-04-29 discovery, trips have BOTH paths; the helper
 * returns the direct-join set and stops. If a future use case wants the
 * union (e.g. "show every image we have for this trip") it's a separate
 * helper, not an option flag here. Per HITL Q5 (2026-05-01 ratification):
 * this short-circuit is the documented contract.
 *
 * Pure function over already-fetched data — no I/O. Callers decide what
 * counts as "fetched" + own the SQL.
 *
 * Decision C.16. Matches the Tier 2 §2.6 `resolve_image_set` primitive.
 */
export function resolveImageSet(
  record: ImageSetRecord,
  pageImageIds: PageImageLookup,
): readonly number[] {
  if (record.directImageIds.length > 0) {
    return record.directImageIds;
  }
  if (record.pageId !== null) {
    const fromPage = pageImageIds.get(record.pageId);
    if (fromPage !== undefined && fromPage.length > 0) {
      return fromPage;
    }
  }
  return [];
}
