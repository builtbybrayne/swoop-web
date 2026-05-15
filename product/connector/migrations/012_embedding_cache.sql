-- 012_embedding_cache.sql
--
-- Embedding cache — survival layer for content-hash-keyed embeddings.
--
-- Embeddings are functions of (content, model). They are immutable artefacts
-- once computed. Storing them keyed by their natural key (content_hash) +
-- model_version, separate from any TRUNCATE-able derived table, means a
-- re-compose / re-TRUNCATE / direct DELETE on any consumer table doesn't
-- cost a re-embed: the cache survives, lookup-by-hash recovers the vector.
--
-- Plan: planning/03-exec-crosscut-embedding-cache.md.
-- Decision: C.embedding-cache-1 (proposed; logged on merge).
--
-- Cache is content-keyed, NOT FK'd to any derived table. The decoupling is
-- the point — see §1.5 of the plan ("What this does NOT change"). Derived
-- tables keep their own `embedding` columns + HNSW indexes; this cache only
-- provides cheap re-fill semantics on compose-time INSERT.

BEGIN;

CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash   TEXT NOT NULL,
  model_version  TEXT NOT NULL DEFAULT 'gemini-embedding-001',
  embedding      halfvec(3072) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (content_hash, model_version)
);

-- No HNSW index here — the cache is keyed-lookup, not similarity-search.
-- Similarity search continues to query derived tables' own embedding columns
-- via their existing HNSW indexes (per plan §1.5).

-- ----------------------------------------------------------------------------
-- Backfill from currently-embedded derived rows. Idempotent (ON CONFLICT DO
-- NOTHING). model_version assumed gemini-embedding-001 per C.46 / C.brave-
-- pare-1; if any row was embedded under a different model the cache will
-- need a manual catch-up (recorded as a constraint in plan §2.1).
--
-- Scope: 6 derived tables + blog_chunk — the 7 tables that already carry a
-- content_hash column (audit 2026-05-15). tag/faqitem/image deferred to a
-- follow-up; they need content_hash columns added first.
-- ----------------------------------------------------------------------------

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM inspire_passage WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', persona_embedding
FROM customer_story WHERE persona_embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM trust_proof WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM inform_chunk WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM trip_card WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM tour_card WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM blog_chunk WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
