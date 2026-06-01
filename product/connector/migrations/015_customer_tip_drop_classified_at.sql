-- 015_customer_tip_drop_classified_at.sql
-- ----------------------------------------------------------------------------
-- Drop customer_tip.classified_at — the tip classifier is gone.
--
-- Rationale (HITL 2026-06-01, decision C.tip-6): migration 014 dropped
-- topic_tags and stripped the tip classifier to region-only. We then retired
-- the region classifier entirely too — find_tips retrieves purely via hybrid
-- search (content embedding + tsv RRF), and the source `customertip` record
-- carries no region, so the pass could only ever *infer* a label the embedding
-- already encodes. With no classify pass for customer_tip, `classified_at` —
-- which existed solely as that pass's idempotency gate — is dead weight.
--
-- `region` is RETAINED: it stays as a nullable cross-corpus query dimension
-- (the same soft filter find_options / find_someone_who / find_inspiring
-- expose), populated only if source data ever starts carrying one. Embedding
-- and tsv are retained.
--
-- Forward-only — no DOWN migration (decision C.31). IF EXISTS so re-application
-- is a no-op.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE customer_tip DROP COLUMN IF EXISTS classified_at;

COMMIT;
