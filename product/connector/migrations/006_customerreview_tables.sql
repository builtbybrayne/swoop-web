-- 006_customerreview_tables.sql
-- ----------------------------------------------------------------------------
-- Customerreview source tables — added 2026-04-30 after Swoop granted the
-- `customerreview_tables_-_swoop-patagonia_prod.sql` dump (decision C.26
-- graduated from "conditional" to "shipping").
--
-- These mirror the upstream MariaDB `customerreview` + `customerreview_trip`
-- tables. They feed `customer_story.text` + `persona_summary` (and the
-- corresponding `persona_embedding`) at C.t3a — this migration is shape-only;
-- ETL population lives in C.t3 / C.t3a.
--
-- PII stance (decision C.26, 2026-04-30): these reviews are public domain —
-- already published on Swoop's customer-facing website. **Ingest as-is**: no
-- NER scrubbing, no name/location column drops, no regex flagging. Names,
-- locations, inline specialist mentions all preserved. The privacy fence
-- around the prose itself is much smaller than the privacy fence around the
-- customer record they came from.
--
-- Customertip is NOT in this round — separate Swoop ask outstanding. The 119
-- `contentblock_customertip` junction rows continue to dangle for now.
--
-- Audit columns from upstream NOT carried forward: `created_by_id`,
-- `modified_by_id`, `deleted_by_id`, `deleted_by`, `deleted` — they reference
-- `user` (not in dump) and add no value to the derived store. `created` +
-- `modified` are kept for ETL diff completeness per the disposable-ETL theme.
--
-- Forward-only — no DROPs, no down migrations (decision C.31). Conventions
-- match 002_domain_tables.sql: INTEGER ids from upstream (not auto-generated),
-- ON DELETE SET NULL on optional FKs, UNIQUE constraints on natural keys.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customerreview (
  id                  INTEGER PRIMARY KEY,
  content             TEXT NOT NULL,
  name                TEXT,
  date                TIMESTAMPTZ,
  location            TEXT,
  is_published        BOOLEAN NOT NULL DEFAULT FALSE,
  title               TEXT,
  image_id            INTEGER REFERENCES image(id) ON DELETE SET NULL,
  feedbacksnippet_id  INTEGER,
  created             TIMESTAMPTZ,
  modified            TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- customerreview_trip — junction linking customer reviews to trips. 163 rows
-- in the 2026-04-30 dump across 2,563 reviews; most reviews are not yet
-- attached to a trip upstream (they live on contentblock_customerreview
-- instead, which is a separate junction we already model via contentblock).
--
-- ETL: ingest 1:1; downstream `customer_story` synthesis at C.t3a may join
-- against this to anchor a story to a specific trip when one is named.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customerreview_trip (
  id                INTEGER PRIMARY KEY,
  customerreview_id INTEGER NOT NULL REFERENCES customerreview(id) ON DELETE CASCADE,
  trip_id           INTEGER NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  position          INTEGER,
  UNIQUE (customerreview_id, trip_id)
);

-- ----------------------------------------------------------------------------
-- Indexes — seasonal filtering + ETL is_published gate. Covered indexes from
-- the FK + UNIQUE on customerreview_trip make extra indexes unnecessary
-- there.
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS customerreview_date_idx
  ON customerreview (date);

CREATE INDEX IF NOT EXISTS customerreview_is_published_idx
  ON customerreview (is_published);

-- ----------------------------------------------------------------------------
-- Column comments — the why where it isn't obvious from name + type
-- ----------------------------------------------------------------------------

COMMENT ON COLUMN customerreview.content IS
  'Review prose; feeds customer_story.text at C.t3a. Public-domain — already published on Swoop''s customer-facing website (decision C.26, 2026-04-30); ingested as-is, no scrubbing.';
COMMENT ON COLUMN customerreview.name IS
  'Reviewer''s full name. NOT redacted; public per decision C.26 (2026-04-30) — these reviews are already on Swoop''s website. ~100% populated upstream.';
COMMENT ON COLUMN customerreview.date IS
  'Date of trip / submission. ~99.9% populated upstream; used for seasonal filtering.';
COMMENT ON COLUMN customerreview.location IS
  'Reviewer''s home country, free text. ~92% populated upstream.';
COMMENT ON COLUMN customerreview.is_published IS
  'Upstream publication flag; ETL filters to TRUE only.';
COMMENT ON COLUMN customerreview.title IS
  'Truncated content preview from upstream (first ~20 chars), NOT a real title. Do not trust as a heading.';
COMMENT ON COLUMN customerreview.image_id IS
  'Optional reviewer-supplied image. Sparse (~5.8% populated upstream).';
COMMENT ON COLUMN customerreview.feedbacksnippet_id IS
  'FK target table not in dump; populated for ~80% of rows but reference is unresolvable. Kept for forensic value; ETL ignores.';
COMMENT ON COLUMN customerreview_trip.position IS
  'Ordering hint when multiple reviews surface against a single trip page.';
