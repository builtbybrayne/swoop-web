-- 011_tour_card.sql
--
-- Derived job-shaped table for tour cards — the v2 find_options tour tranche.
-- Mirrors trip_card (003_derived_tables.sql §"trip_card") with three deliberate
-- shifts driven by the source data:
--   1. `day_count` is the honest day-signal — the source `tours` table carries
--      no duration column; `dayCount = COUNT(tour_item)` is what we have.
--      `duration_days` is still emitted (populated from day_count) so the
--      query-shape stays symmetric with trip_card.
--   2. `from_price`, `currency_code`, `group_size_max`, `accommodation_style`
--      stay NULL on every row today (no source columns) — future-proofed in
--      the schema so a Swoop-side population doesn't need another migration.
--   3. `embedding halfvec(3072)` from the start — post-009 Gemini-3072d shape.
--
-- Plan: planning/03-exec-crosscut-find-options-v2-backfill.md §2.1.
-- Decision: C.focused-shamir-2 (proposed; logged on merge).

BEGIN;

CREATE TABLE IF NOT EXISTS tour_card (
  id                  INTEGER PRIMARY KEY REFERENCES tour(id),
  slug                TEXT UNIQUE,
  headline            TEXT NOT NULL,
  vibe_line           TEXT,
  region              TEXT,
  day_count           INTEGER,
  duration_days       INTEGER,
  group_size_max      INTEGER,
  from_price          DECIMAL(10, 2),
  currency_code       TEXT,
  image_id            INTEGER REFERENCES image(id) ON DELETE SET NULL,
  accommodation_style TEXT,
  activity_tags       TEXT[] DEFAULT '{}',
  canonical_url       TEXT NOT NULL,
  embedding           halfvec(3072),
  tsv                 tsvector,
  content_hash        TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  modified_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes mirror trip_card's footprint, inlined here (rather than in
-- 004_indexes.sql) to keep the migration self-contained.
CREATE INDEX IF NOT EXISTS tour_card_embedding_hnsw
  ON tour_card USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS tour_card_tsv_gin
  ON tour_card USING gin (tsv);

CREATE INDEX IF NOT EXISTS tour_card_activity_tags_gin
  ON tour_card USING gin (activity_tags);

CREATE INDEX IF NOT EXISTS tour_card_region_idx
  ON tour_card (region);

CREATE INDEX IF NOT EXISTS tour_card_day_count_idx
  ON tour_card (day_count);

CREATE INDEX IF NOT EXISTS tour_card_from_price_idx
  ON tour_card (from_price);

COMMIT;
