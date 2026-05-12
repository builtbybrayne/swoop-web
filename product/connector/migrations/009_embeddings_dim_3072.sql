-- 009_embeddings_dim_3072.sql
-- ----------------------------------------------------------------------------
-- Migrate embedding columns from vector(1024) (Voyage-3) to halfvec(3072)
-- (gemini-embedding-001).
--
-- Decision C.46 (2026-05-12) supersedes C.18.
--
-- Why halfvec(3072), not vector(3072)? pgvector's HNSW index has a hard
-- 2000-dimension cap for the `vector` type. The `halfvec` type (pgvector
-- 0.7+, IEEE 754 binary16) lifts the HNSW cap to 4000 dims and halves the
-- index memory footprint with negligible recall loss at 3072d. This is the
-- conventional pattern for Gemini-3072d on Postgres + pgvector. Documented
-- as a plan deviation in the C.t9 execution log (the plan body specified
-- vector(3072); empirical testing against pgvector 0.8.1 in puma_dev_scratch
-- proved this would fail at index-creation time).
--
-- pgvector does NOT support `ALTER COLUMN ... TYPE halfvec(N)` when the
-- source type or dimensions differ (the type's parameter is part of the
-- type identity). The idiomatic forward-only path per C.31 is DROP COLUMN +
-- ADD COLUMN. Any existing 1024d data is discarded; a re-run of the C.t3a
-- enrich pipeline at the new dimension repopulates.
--
-- Indexes that referenced the dropped columns are recreated at the new
-- type in the same transaction. Index names match migration 004; opclass
-- changes from `vector_cosine_ops` to `halfvec_cosine_ops` (forced by the
-- column type — not a similarity-semantics change; cosine is cosine).
--
-- Forward-only — no DOWN migration (decision C.31).
-- ----------------------------------------------------------------------------

BEGIN;

-- Domain tables (mirroring migration 002 declarations) -----------------------

-- tag.embedding
DROP INDEX IF EXISTS tag_embedding_hnsw;
ALTER TABLE tag DROP COLUMN embedding;
ALTER TABLE tag ADD COLUMN embedding halfvec(3072);

-- image.embedding
DROP INDEX IF EXISTS image_embedding_hnsw;
ALTER TABLE image DROP COLUMN embedding;
ALTER TABLE image ADD COLUMN embedding halfvec(3072);

-- faqitem.embedding
DROP INDEX IF EXISTS faqitem_embedding_hnsw;
ALTER TABLE faqitem DROP COLUMN embedding;
ALTER TABLE faqitem ADD COLUMN embedding halfvec(3072);

-- blog_chunk.embedding
DROP INDEX IF EXISTS blog_chunk_embedding_hnsw;
ALTER TABLE blog_chunk DROP COLUMN embedding;
ALTER TABLE blog_chunk ADD COLUMN embedding halfvec(3072);

-- Derived tables (mirroring migration 003 declarations) ----------------------

-- inspire_passage.embedding
DROP INDEX IF EXISTS inspire_passage_embedding_hnsw;
ALTER TABLE inspire_passage DROP COLUMN embedding;
ALTER TABLE inspire_passage ADD COLUMN embedding halfvec(3072);

-- customer_story.persona_embedding
DROP INDEX IF EXISTS customer_story_persona_embedding_hnsw;
ALTER TABLE customer_story DROP COLUMN persona_embedding;
ALTER TABLE customer_story ADD COLUMN persona_embedding halfvec(3072);

-- trust_proof.embedding
DROP INDEX IF EXISTS trust_proof_embedding_hnsw;
ALTER TABLE trust_proof DROP COLUMN embedding;
ALTER TABLE trust_proof ADD COLUMN embedding halfvec(3072);

-- inform_chunk.embedding
DROP INDEX IF EXISTS inform_chunk_embedding_hnsw;
ALTER TABLE inform_chunk DROP COLUMN embedding;
ALTER TABLE inform_chunk ADD COLUMN embedding halfvec(3072);

-- trip_card.embedding
DROP INDEX IF EXISTS trip_card_embedding_hnsw;
ALTER TABLE trip_card DROP COLUMN embedding;
ALTER TABLE trip_card ADD COLUMN embedding halfvec(3072);

-- Index recreation -----------------------------------------------------------
--
-- HNSW at default parameters (m=16, ef_construction=64). Cosine ops match
-- the original choice from migration 004; the `halfvec_cosine_ops` opclass
-- is the halfvec-typed equivalent of `vector_cosine_ops`.

CREATE INDEX IF NOT EXISTS tag_embedding_hnsw
  ON tag USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS image_embedding_hnsw
  ON image USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS faqitem_embedding_hnsw
  ON faqitem USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS blog_chunk_embedding_hnsw
  ON blog_chunk USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS inspire_passage_embedding_hnsw
  ON inspire_passage USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS customer_story_persona_embedding_hnsw
  ON customer_story USING hnsw (persona_embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS trust_proof_embedding_hnsw
  ON trust_proof USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS inform_chunk_embedding_hnsw
  ON inform_chunk USING hnsw (embedding halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS trip_card_embedding_hnsw
  ON trip_card USING hnsw (embedding halfvec_cosine_ops);

COMMIT;
