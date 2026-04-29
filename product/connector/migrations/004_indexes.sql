-- 004_indexes.sql
-- ----------------------------------------------------------------------------
-- Indexes per planning/02-impl-retrieval-and-data.md §2.5 +
-- planning/03-exec-c-t2.md §"Indexes".
--
--   - HNSW (vector_cosine_ops) on every embedding column for sub-ms ANN.
--   - GIN (tsvector) on every retrieval-bound prose column.
--   - GIN (array) on subject/mood/region tags + ntag id arrays.
--   - GIN (gin_trgm_ops) on entity-name columns for typo-tolerant fuzzy match.
--   - B-tree on the obvious query keys.
--   - B-tree on content_hash for idempotent re-embedding lookups.
--
-- HNSW uses the package defaults (m=16, ef_construction=64); tunable post-
-- launch if recall/latency demand it. Cosine distance is the default for the
-- embedding model we'll lock to (Voyage-3 candidate).
-- ----------------------------------------------------------------------------

-- ============================================================================
-- HNSW indexes on embedding columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS tag_embedding_hnsw
  ON tag USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS image_embedding_hnsw
  ON image USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS faqitem_embedding_hnsw
  ON faqitem USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS blog_chunk_embedding_hnsw
  ON blog_chunk USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS inspire_passage_embedding_hnsw
  ON inspire_passage USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS customer_story_persona_embedding_hnsw
  ON customer_story USING hnsw (persona_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS trust_proof_embedding_hnsw
  ON trust_proof USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS inform_chunk_embedding_hnsw
  ON inform_chunk USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS trip_card_embedding_hnsw
  ON trip_card USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- GIN tsvector indexes on retrieval-bound prose
-- ============================================================================

CREATE INDEX IF NOT EXISTS inspire_passage_tsv_gin
  ON inspire_passage USING gin (tsv);

CREATE INDEX IF NOT EXISTS customer_story_tsv_gin
  ON customer_story USING gin (tsv);

CREATE INDEX IF NOT EXISTS trust_proof_tsv_gin
  ON trust_proof USING gin (tsv);

CREATE INDEX IF NOT EXISTS inform_chunk_tsv_gin
  ON inform_chunk USING gin (tsv);

CREATE INDEX IF NOT EXISTS trip_card_tsv_gin
  ON trip_card USING gin (tsv);

-- ============================================================================
-- GIN array indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS image_subject_tags_gin
  ON image USING gin (subject_tags);

CREATE INDEX IF NOT EXISTS image_mood_tags_gin
  ON image USING gin (mood_tags);

CREATE INDEX IF NOT EXISTS image_region_tags_gin
  ON image USING gin (region_tags);

CREATE INDEX IF NOT EXISTS page_ntag_ids_gin
  ON page USING gin (ntag_ids);

CREATE INDEX IF NOT EXISTS blog_post_ntag_ids_gin
  ON blog_post USING gin (ntag_ids);

CREATE INDEX IF NOT EXISTS trip_ntag_ids_gin
  ON trip USING gin (ntag_ids);

CREATE INDEX IF NOT EXISTS tour_ntag_ids_gin
  ON tour USING gin (ntag_ids);

CREATE INDEX IF NOT EXISTS inspire_passage_ntag_ids_gin
  ON inspire_passage USING gin (ntag_ids);

CREATE INDEX IF NOT EXISTS inform_chunk_topic_tags_gin
  ON inform_chunk USING gin (topic_tags);

CREATE INDEX IF NOT EXISTS trip_card_activity_tags_gin
  ON trip_card USING gin (activity_tags);

-- ============================================================================
-- pg_trgm GIN indexes on entity-name columns (typo-tolerant fuzzy match)
-- ============================================================================

CREATE INDEX IF NOT EXISTS location_name_trgm
  ON location USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS area_name_trgm
  ON area USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS country_name_trgm
  ON country USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS hotel_name_trgm
  ON hotel USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS vessel_name_trgm
  ON vessel USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS activity_name_trgm
  ON activity USING gin (name gin_trgm_ops);

-- ============================================================================
-- B-tree indexes on query keys
-- ============================================================================

CREATE INDEX IF NOT EXISTS contentblock_page_id_idx
  ON contentblock (page_id);

CREATE INDEX IF NOT EXISTS contentblock_subtype_idx
  ON contentblock (subtype);

CREATE INDEX IF NOT EXISTS blog_chunk_blog_post_id_idx
  ON blog_chunk (blog_post_id);

CREATE INDEX IF NOT EXISTS blog_post_primary_job_idx
  ON blog_post (primary_job);

CREATE INDEX IF NOT EXISTS page_pagetype_id_idx
  ON page (pagetype_id);

CREATE INDEX IF NOT EXISTS inspire_passage_region_idx
  ON inspire_passage (region);

CREATE INDEX IF NOT EXISTS customer_story_region_idx
  ON customer_story (region);

CREATE INDEX IF NOT EXISTS trust_proof_topic_idx
  ON trust_proof (topic);

CREATE INDEX IF NOT EXISTS trip_card_region_idx
  ON trip_card (region);

CREATE INDEX IF NOT EXISTS trip_card_duration_days_idx
  ON trip_card (duration_days);

-- ============================================================================
-- B-tree on content_hash for idempotent re-embedding
-- ============================================================================

CREATE INDEX IF NOT EXISTS inspire_passage_content_hash_idx
  ON inspire_passage (content_hash);

CREATE INDEX IF NOT EXISTS customer_story_content_hash_idx
  ON customer_story (content_hash);

CREATE INDEX IF NOT EXISTS trust_proof_content_hash_idx
  ON trust_proof (content_hash);

CREATE INDEX IF NOT EXISTS inform_chunk_content_hash_idx
  ON inform_chunk (content_hash);

CREATE INDEX IF NOT EXISTS trip_card_content_hash_idx
  ON trip_card (content_hash);

CREATE INDEX IF NOT EXISTS blog_chunk_content_hash_idx
  ON blog_chunk (content_hash);
