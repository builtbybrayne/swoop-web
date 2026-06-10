-- 017_provenance_columns.sql
-- ----------------------------------------------------------------------------
-- Provenance metadata: source_title and source_published_at on derived tables.
--
-- Per planning/03-exec-crosscut-magical-poincare-retrieval-provenance.md
-- (Luke feedback L2 + D1, 2026-06-10).
--
-- WHY these two columns matter:
--   - source_title:        lets the agent surface "Find out more about {title}"
--     in widget link copy, replacing the hard-coded "Read more on
--     swoop-patagonia.com" that no longer tells the visitor what they're
--     clicking into.
--   - source_published_at: lets the agent flag how old a piece of content is,
--     particularly for pricing (Luke's "$300–350/day from my January 2011 blog
--     post" failure case).
--
-- CRITICAL — these columns are METADATA, NOT content. They MUST NOT be
-- included in any content_hash input. The embedding cache keys on content_hash;
-- adding metadata to the hash would force every corpus row to re-embed. The
-- compose layer fills them AFTER the content_hash is computed.
--
-- Population strategy (decided via Step 0 probe 2026-06-10):
--   inspire_passage / inform_chunk / trust_proof:
--     - blog_chunk provenance → source_title = blog_post.title,
--       source_published_at = blog_post.published_at (reliable, real dates).
--     - page_* / contentblock provenance → source_title = page.title,
--       source_published_at = NULL (page.created_at is ETL-timestamp, not
--       real editorial date; ships NULL, tool description teaches the rule).
--     - faq / chunk provenance → source_title = NULL, source_published_at = NULL.
--   customer_story:
--     - customerreview provenance → source_title = NULL (no titled source),
--       source_published_at = customerreview.date where non-null.
--     - blog_first_person → source_title = blog_post.title,
--       source_published_at = blog_post.published_at.
--   customer_tip: already has source_created_at (migration 013); no new column.
--     source_title is not applicable (tip records have no title).
--
-- Note: migration 016 is owned by the sibling agent (handoff-form). This
-- migration (017) is independent and applies cleanly without 016 being present.
--
-- Forward-only — no DOWN migration (decision C.31). IF NOT EXISTS throughout
-- so re-application is a no-op.
-- ----------------------------------------------------------------------------

BEGIN;

-- inspire_passage
ALTER TABLE inspire_passage
  ADD COLUMN IF NOT EXISTS source_title        TEXT,
  ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;

-- customer_story
ALTER TABLE customer_story
  ADD COLUMN IF NOT EXISTS source_title        TEXT,
  ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;

-- trust_proof
ALTER TABLE trust_proof
  ADD COLUMN IF NOT EXISTS source_title        TEXT,
  ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;

-- inform_chunk
ALTER TABLE inform_chunk
  ADD COLUMN IF NOT EXISTS source_title        TEXT,
  ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;

-- Column comments: the why
COMMENT ON COLUMN inspire_passage.source_title IS
  'Human-readable title of the source page or blog post. Shown as widget anchor copy ("Find out more about {title}"). NULL for FAQ / CMS-chunk sources that have no user-facing title.';
COMMENT ON COLUMN inspire_passage.source_published_at IS
  'Publication date of the source. Non-null only for blog_chunk provenance (blog_post.published_at, reliable). Page-derived rows ship NULL — page.created_at is an ETL timestamp, not an editorial date.';

COMMENT ON COLUMN customer_story.source_title IS
  'Blog post title for blog_first_person provenance; NULL for customerreview rows (reviews have no titled source).';
COMMENT ON COLUMN customer_story.source_published_at IS
  'Publication date for blog_first_person provenance (blog_post.published_at). For customerreview rows, this is customerreview.date where non-null.';

COMMENT ON COLUMN trust_proof.source_title IS
  'Human-readable title of the source page or blog post. Shown as widget anchor copy.';
COMMENT ON COLUMN trust_proof.source_published_at IS
  'Publication date. Non-null only for blog_b_corp provenance (blog_post.published_at). Page-derived rows ship NULL.';

COMMENT ON COLUMN inform_chunk.source_title IS
  'Human-readable title of the source page or blog post. Shown as widget anchor copy. NULL for FAQ and CMS-chunk provenance (no user-facing title at that granularity).';
COMMENT ON COLUMN inform_chunk.source_published_at IS
  'Publication date. Non-null only for blog_practical provenance (blog_post.published_at). Page-derived rows ship NULL.';

COMMIT;
