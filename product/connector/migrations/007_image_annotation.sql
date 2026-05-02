-- 007_image_annotation.sql
-- ----------------------------------------------------------------------------
-- C.t6 — image annotation augmentation column.
--
-- Per HITL ratification 2026-05-01 (Q2): keep both `image.description` AND a
-- new `image.annotation` column. Two separate columns, both searchable. The
-- annotation is an *augmentation* — it is NEVER allowed to overwrite an
-- upstream curated `description`.
--
-- Per HITL Q1: a single Claude Vision call returns BOTH outputs:
--   - `description`  — journey-shaped paragraph (mood, scale, named landmarks,
--                      time of day, presence of people, activity). Written to
--                      `image.description` ONLY when the upstream column is
--                      NULL or whitespace-only. ~6.7K rows in scope.
--   - `annotation`   — generic descriptive text shaped for full-text search.
--                      Written to this new `image.annotation` column for
--                      EVERY processed row, regardless of upstream description.
--
-- The annotation column powers tsvector retrieval in `lookup` / `find_options`
-- when the agent's intent is closer to "what does this image literally show?"
-- — a search-engine shape — rather than the journey-shaped retrieval that
-- the description + embedding columns serve.
--
-- Forward-only per decision C.31. The accompanying GIN tsvector index uses
-- `to_tsvector('english', annotation)` directly (functional index) — there is
-- no dedicated `tsv` column on the `image` domain table the way the derived
-- tables carry one (003_derived_tables.sql). This stays consistent with the
-- "domain-table indexes are minimal; derived tables hold the heavyweight
-- retrieval shape" pattern in 004_indexes.sql.
-- ----------------------------------------------------------------------------

ALTER TABLE image
  ADD COLUMN IF NOT EXISTS annotation TEXT;

COMMENT ON COLUMN image.annotation IS
  'Generic descriptive annotation text for full-text retrieval; populated by C.t6 image annotation pipeline. Augmentation, never overwrites upstream description. Indexed via image_annotation_tsv_gin (functional index on to_tsvector(''english'', annotation)).';

CREATE INDEX IF NOT EXISTS image_annotation_tsv_gin
  ON image USING gin (to_tsvector('english', annotation));
