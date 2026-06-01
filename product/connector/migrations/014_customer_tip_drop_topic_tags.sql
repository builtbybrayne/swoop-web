-- 014_customer_tip_drop_topic_tags.sql
-- ----------------------------------------------------------------------------
-- Drop customer_tip.topic_tags — find_tips no longer tags tips.
--
-- Rationale (HITL 2026-06-01): topic_tags did NO retrieval work. find_tips
-- retrieves purely via hybrid search (content embedding + tsv RRF, k=60); the
-- tags were SELECT-ed and returned as metadata but never filtered or ranked on
-- (the only structured narrowing is the optional `region`). For a small, fuzzy
-- corpus the tip text itself is the topic signal — a coarse 8-label taxonomy
-- added a Haiku classify pass, an enum to maintain, and zero retrieval lift.
-- So we removed the topic concept entirely and stripped the classifier to
-- region-only (renamed tip-topic → tip-region). See planning/decisions.md
-- C.tip-5. region, classified_at, embedding and tsv are all retained.
--
-- Forward-only — no DOWN migration (decision C.31). IF EXISTS so re-application
-- is a no-op.
-- ----------------------------------------------------------------------------

BEGIN;

-- The GIN index existed only to support topic-tag filtering, which never shipped.
DROP INDEX IF EXISTS customer_tip_topic_tags_gin;

ALTER TABLE customer_tip DROP COLUMN IF EXISTS topic_tags;

-- classified_at now gates the region-only classifier, not topic tagging.
COMMENT ON COLUMN customer_tip.classified_at IS
  'NULL until the tip-region classifier has written region. The classify idempotency gate (re-runs skip already-classified rows unless content_hash changed).';

COMMIT;
