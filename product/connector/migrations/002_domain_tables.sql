-- 002_domain_tables.sql
-- ----------------------------------------------------------------------------
-- Domain entity tables for the Puma derived store.
--
-- These are the post-cleanup mirrors of Swoop's source dump tables, plus the
-- WordPress blog ingest tables. Mostly 1:1 with source post-clean per
-- planning/02-impl-retrieval-and-data.md §2.5; column lists per
-- planning/03-exec-c-t2.md §"Schema design — Postgres".
--
-- Conventions:
--   - INTEGER ids match source ids where 1:1 with a source row (trip, page,
--     contentblock, image, blog_post, faqitem, ntag-derived `tag`).
--   - TEXT for free-form prose; vector(1024) for embedding columns — locked
--     to Voyage-3 (1024d) per decision C.18. pgvector cannot ALTER COLUMN
--     TYPE for vector width, so a model swap means dropping + recreating
--     every embedding column AND rebuilding all 9 HNSW indexes. Pre-launch
--     that's cheap; post-launch it's a re-embed-everything migration.
--   - DECIMAL for currency-priced fields (no floats for money).
--   - canonical_url stored as TEXT; populated at ETL via canonical_url() (005)
--     for rows that carry override_url + alias directly. For trips, populated
--     via JOIN to page (the trip-side ETL design call lives in C.t3).
--   - created_at / modified_at preserved for ETL diffs only; not exposed to
--     the agent's tool surface.
--   - Audit columns, soft-delete columns, swooper_* PII (decision C.14),
--     adventurousness (decision C.17) are dropped at ETL boundary — they don't
--     appear here.
--   - Profile pagetype (decision C.27) and test pages (decision C.28) are
--     filtered at ETL boundary; the schema is pagetype-agnostic.
--
-- Forward-only — no DROPs, no down migrations (decision C.31).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Geography
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS country (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  alias        TEXT,
  iso_code     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS area (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  alias        TEXT,
  country_id   INTEGER REFERENCES country(id),
  parent_area_id INTEGER REFERENCES area(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS location (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  alias        TEXT,
  area_id      INTEGER REFERENCES area(id),
  country_id   INTEGER REFERENCES country(id),
  latitude     DECIMAL(9, 6),
  longitude    DECIMAL(9, 6),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  alias        TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Tag (derived from `ntag` per decision C.17 — legacy `tag` is dead)
--
-- 79 active rows across 5 dimensions: interest / area / activity / trip-type /
-- style. Embedding populated by C.t3a; near-zero cost (79 rows) and unlocks
-- find_tags_by_utterance per Tier 2 §2.4.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tag (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  alias        TEXT UNIQUE,
  type         TEXT NOT NULL CHECK (type IN ('interest', 'area', 'activity', 'trip-type', 'style')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  embedding    vector(1024),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Image (per Al's 2026-04-29 spec — single annotated table, source-of-truth-
-- agnostic. Annotation columns populated by the C.t6 image annotation pipeline.)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS image (
  id                 INTEGER PRIMARY KEY,
  canonical_url      TEXT NOT NULL,
  alt_text           TEXT,
  description        TEXT,
  tags               TEXT[] DEFAULT '{}',
  subject_tags       TEXT[] DEFAULT '{}',
  mood_tags          TEXT[] DEFAULT '{}',
  region_tags        TEXT[] DEFAULT '{}',
  width              INTEGER,
  height             INTEGER,
  original_filename  TEXT,
  embedding          vector(1024),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  modified_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Page — the dominant content surface (decision C.29). After ETL filtering of
-- Profile (C.27) + test pages (C.28) + accommodation/ship/itinerary/trip-
-- anchored pagetypes, ~482 content-relevant pages remain.
--
-- canonical_url denormalised at ETL via canonical_url(override_url, alias).
-- pagetype_title denormalised for query convenience (avoids a join when
-- filtering by pagetype name).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS page (
  id              INTEGER PRIMARY KEY,
  pagetype_id     INTEGER,
  pagetype_title  TEXT,
  title           TEXT NOT NULL,
  alias           TEXT,
  override_url    TEXT,
  canonical_url   TEXT NOT NULL UNIQUE,
  intro_text      TEXT,
  summary         TEXT,
  image_id        INTEGER REFERENCES image(id) ON DELETE SET NULL,
  bannerimage_id  INTEGER REFERENCES image(id) ON DELETE SET NULL,
  ntag_ids        INTEGER[] DEFAULT '{}',
  parent_id       INTEGER REFERENCES page(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  modified_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Contentblock — joined to page via page_id. ETL-time subtype derivation:
-- subtypes derived from which `contentblock_*` junction the row appears in
-- (customerreview, customertip, image, carousel, pressreview, partnercomment,
-- tour, trip, when_to_travel, reviewcarousel). Pure UI plumbing skipped
-- (navigationcard, settings, page cross-link).
--
-- Customerreview / customertip / pressreview source tables are dangling in
-- the dump (decision C.26). The contentblock rows persist regardless; the
-- find_someone_who tool ships only if Swoop releases a redacted export.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contentblock (
  id           INTEGER PRIMARY KEY,
  page_id      INTEGER REFERENCES page(id),
  position     INTEGER,
  subtype      TEXT NOT NULL,
  title        TEXT,
  subheading   TEXT,
  text         TEXT,
  image_id     INTEGER REFERENCES image(id) ON DELETE SET NULL,
  cta_text     TEXT,
  cta_url      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Chunk — 46 rows of small reusable CMS prose blocks. type_id resolved at
-- ETL via JOIN to its type table; persisted as denormalised type_name.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chunk (
  id           INTEGER PRIMARY KEY,
  type_name    TEXT,
  title        TEXT,
  text         TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- FAQ
--
-- 928 rows of real Q&A. Per the C.t0 finding: `title` is the question column,
-- `content` is the answer.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS faqitem (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,        -- the question
  content      TEXT NOT NULL,        -- the answer
  faqset_id    INTEGER,
  position     INTEGER,
  embedding    vector(1024),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  modified_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Trip — placeholder shape pending trips ingestion firming up (per the C.t2
-- "trip side stays thin" guardrail). canonical_url populated at ETL via
-- JOIN to page; NULL if a trip lacks a page.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trip (
  id                    INTEGER PRIMARY KEY,
  slug                  TEXT UNIQUE,
  title                 TEXT NOT NULL,
  subtitle              TEXT,
  region_id             INTEGER REFERENCES area(id),
  country_id            INTEGER REFERENCES country(id),
  duration_days         INTEGER,
  from_price            DECIMAL(10, 2),
  currency_code         TEXT,
  description           TEXT,
  includes              TEXT,
  excludes              TEXT,
  accommodation_style   TEXT,
  ntag_ids              INTEGER[] DEFAULT '{}',
  image_id              INTEGER REFERENCES image(id) ON DELETE SET NULL,
  canonical_url         TEXT,
  page_id               INTEGER REFERENCES page(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  modified_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Tour + tour_item — group-tour catalogue. Junction-flat per the dump's
-- tours / tour_items.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tour (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT UNIQUE,
  title               TEXT NOT NULL,
  subtitle            TEXT,
  duration_days       INTEGER,
  group_size_max      INTEGER,
  from_price          DECIMAL(10, 2),
  currency_code       TEXT,
  description         TEXT,
  region_id           INTEGER REFERENCES area(id),
  ntag_ids            INTEGER[] DEFAULT '{}',
  image_id            INTEGER REFERENCES image(id) ON DELETE SET NULL,
  canonical_url       TEXT,
  page_id             INTEGER REFERENCES page(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  modified_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tour_item (
  id          INTEGER PRIMARY KEY,
  tour_id     INTEGER NOT NULL REFERENCES tour(id),
  position    INTEGER,
  day_label   TEXT,
  title       TEXT,
  description TEXT
);

-- ----------------------------------------------------------------------------
-- Hotel + hotel_pricing + hotel_room — accommodation catalogue.
-- Lean schema; trip-side details settle when trips ingestion lands.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hotel (
  id            INTEGER PRIMARY KEY,
  slug          TEXT UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  location_id   INTEGER REFERENCES location(id),
  area_id       INTEGER REFERENCES area(id),
  page_id       INTEGER REFERENCES page(id),
  canonical_url TEXT,
  star_rating   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  modified_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotel_room (
  id            INTEGER PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotel(id),
  name          TEXT,
  description   TEXT,
  capacity      INTEGER
);

CREATE TABLE IF NOT EXISTS hotel_pricing (
  id            INTEGER PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotel(id),
  room_id       INTEGER REFERENCES hotel_room(id),
  season        TEXT,
  price         DECIMAL(10, 2),
  currency_code TEXT
);

-- ----------------------------------------------------------------------------
-- Vessel + cabin + cabintype — cruise context only (Patagonia has limited
-- cruise content but the schema needs to carry it for completeness).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vessel (
  id            INTEGER PRIMARY KEY,
  slug          TEXT UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  page_id       INTEGER REFERENCES page(id),
  canonical_url TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  modified_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cabintype (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS cabin (
  id            INTEGER PRIMARY KEY,
  vessel_id     INTEGER NOT NULL REFERENCES vessel(id),
  cabintype_id  INTEGER REFERENCES cabintype(id),
  name          TEXT,
  description   TEXT,
  capacity      INTEGER
);

-- ----------------------------------------------------------------------------
-- Blog corpus (ingested separately from the SQL dump per
-- planning/03-exec-blog-ingest.md). 5y rolling window applied at fetch time.
--
-- primary_job + secondary_jobs populated by Haiku classifier in C.t3a.
-- is_patagonia false for Easter Island / Mendoza outliers.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blog_post (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  excerpt             TEXT,
  content             TEXT,
  featured_image_url  TEXT,
  categories          TEXT[] DEFAULT '{}',
  tags                TEXT[] DEFAULT '{}',
  ntag_ids            INTEGER[] DEFAULT '{}',
  canonical_url       TEXT NOT NULL,
  primary_job         TEXT CHECK (primary_job IN ('inspire', 'mirror', 'reassure', 'inform', 'multi', 'none')),
  secondary_jobs      TEXT[] DEFAULT '{}',
  is_patagonia        BOOLEAN DEFAULT TRUE,
  published_at        TIMESTAMPTZ,
  modified_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS blog_chunk (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  blog_post_id  INTEGER NOT NULL REFERENCES blog_post(id),
  chunk_index   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  embedding     vector(1024),
  content_hash  TEXT NOT NULL,
  UNIQUE (blog_post_id, chunk_index)
);

-- Note: blog_chunk.id is a generated identity, so it is not stable across
-- full reloads. Derived rows referencing blog_chunk should use
-- (blog_post_id, chunk_index) as the cross-reload-stable key when re-
-- resolution is needed (or rely on content_hash for idempotency, which is
-- what C.t3a does).

-- ----------------------------------------------------------------------------
-- Column comments — the why where it isn't obvious from name + type
-- ----------------------------------------------------------------------------

COMMENT ON COLUMN image.canonical_url IS
  'Source-of-truth-agnostic image URL; provider-agnostic per 2026-04-29 spec (decision C.15).';
COMMENT ON COLUMN image.subject_tags IS
  'Annotation tag array (subjects: glacier, wildlife, etc.); populated by C.t6 image annotation pipeline.';
COMMENT ON COLUMN image.mood_tags IS
  'Annotation tag array (atmosphere: serene, dramatic, etc.); populated by C.t6 image annotation pipeline.';
COMMENT ON COLUMN image.region_tags IS
  'Annotation tag array (region slugs: torres-del-paine, etc.); populated by C.t6 image annotation pipeline.';
COMMENT ON COLUMN blog_post.primary_job IS
  'Job classification (Inspire/Mirror/Reassure/Inform/multi/none); populated by Haiku classifier in C.t3a.';
COMMENT ON COLUMN tag.type IS
  'ntag dimension: interest / area / activity / trip-type / style. 79 active tags total (decision C.17).';
