-- 008_image_tag_columns.sql
-- ----------------------------------------------------------------------------
-- C.t6 + C.t3a fold — image tag-classification columns.
--
-- Per HITL ratification 2026-05-02: fold C.t3a's image-annotation classifier
-- into C.t6's Vision call. One Claude Vision call per image now produces six
-- outputs (description + annotation + four tag arrays) instead of two.
-- C.t3a's separate Haiku-text-only classifier retires; this migration adds
-- the four tag-array columns the unified Vision call writes back to.
--
-- Columns added to the `image` domain table:
--
--   subject_tags   TEXT[]   what's in the picture: granite, ice, lenga forest,
--                           guanaco, refugio, kayak, hiker, etc. Vocabulary
--                           shaped by the prompt; not a closed enum.
--   mood_tags      TEXT[]   emotional/aesthetic register: vast, intimate,
--                           dramatic, golden-hour, raw, serene, overcast, etc.
--   region_tags    TEXT[]   geographic/place identifiers: torres-del-paine,
--                           fitz-roy, perito-moreno, antarctica, etc. Lower-
--                           case-hyphenated to match `ntag` taxonomy slugs.
--   tags           TEXT[]   free-form descriptive tags — bucket for anything
--                           that doesn't fit the three above.
--
-- All four arrays carry NOT NULL semantics-via-default-empty (DEFAULT '{}'),
-- matching the existing `page.ntag_ids` / `image.alt_text` convention. GIN
-- indexes per array support the `illustrate` filter narrowing path
-- (cardinality-bounded sets; GIN is the right index type for array @>).
--
-- Forward-only per decision C.31. Single SQL file. Idempotent re-run via
-- IF NOT EXISTS on every statement.
-- ----------------------------------------------------------------------------

ALTER TABLE image
  ADD COLUMN IF NOT EXISTS subject_tags TEXT[] DEFAULT '{}';

ALTER TABLE image
  ADD COLUMN IF NOT EXISTS mood_tags    TEXT[] DEFAULT '{}';

ALTER TABLE image
  ADD COLUMN IF NOT EXISTS region_tags  TEXT[] DEFAULT '{}';

ALTER TABLE image
  ADD COLUMN IF NOT EXISTS tags         TEXT[] DEFAULT '{}';

COMMENT ON COLUMN image.subject_tags IS
  'Vision-pass subject tags (what is in the picture). Populated by C.t6 unified Vision call per HITL 2026-05-02.';
COMMENT ON COLUMN image.mood_tags IS
  'Vision-pass mood/aesthetic tags. Populated by C.t6 unified Vision call per HITL 2026-05-02.';
COMMENT ON COLUMN image.region_tags IS
  'Vision-pass region/place tags (lowercase-hyphenated, ntag-style). Populated by C.t6 unified Vision call per HITL 2026-05-02.';
COMMENT ON COLUMN image.tags IS
  'Vision-pass free-form descriptive tags. Populated by C.t6 unified Vision call per HITL 2026-05-02.';

CREATE INDEX IF NOT EXISTS image_subject_tags_gin
  ON image USING GIN (subject_tags);

CREATE INDEX IF NOT EXISTS image_mood_tags_gin
  ON image USING GIN (mood_tags);

CREATE INDEX IF NOT EXISTS image_region_tags_gin
  ON image USING GIN (region_tags);

CREATE INDEX IF NOT EXISTS image_tags_gin
  ON image USING GIN (tags);
