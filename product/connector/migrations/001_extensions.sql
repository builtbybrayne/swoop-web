-- 001_extensions.sql
-- ----------------------------------------------------------------------------
-- Required Postgres extensions for the Puma derived store.
--
-- - pgvector: HNSW indexes on every `embedding` column (cosine distance).
-- - pg_trgm:  trigram fuzzy matching (location/area/country/vessel/hotel names).
-- - btree_gin: composite GIN indexes pairing scalar B-tree keys with
--             tsvector / array columns where both filtering and ranking matter.
--
-- Idempotent: rerun-safe. The derived store is throwaway (theme 5) — the
-- expected recovery from a bad migration is "drop the database, re-run all
-- migrations forward, re-run ETL". No down migrations.
--
-- Forward-only convention recorded as decision C.31 in planning/decisions.md.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
