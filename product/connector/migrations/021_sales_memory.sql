-- 020_sales_memory.sql — SM.t1: sales-team agent-memory store
--
-- Two tables: current-state + append-only version history.
--
-- Design:
--   sales_memory         — current live/retired state of each memory entry.
--   sales_memory_version — append-only audit log; every mutation appends a row.
--
-- Soft-delete only: retire = status='retired' + a 'retire' version row. NEVER
-- hard-delete rows. The version table is the authority for what changed and when.
--
-- Optimistic concurrency: the `version` column on `sales_memory` is bumped on
-- every edit. The data primitive checks the passed version matches before writing;
-- a stale-version write is rejected (prevents lost-update races between two editors).
--
-- No pgvector, no embeddings: memories are a small curated list loaded whole;
-- semantic search over them adds no value. The `content` column is plain TEXT.
--
-- Author tracking: every row and every version row carries an `author` / `created_by`
-- / `updated_by` column (staff name or identifier). Wired by the data primitive;
-- validated by the MCP tool enforcement seam (TODO sm-t2-auth).

CREATE TABLE IF NOT EXISTS sales_memory (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content      TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active'
                             CONSTRAINT sales_memory_status_check
                             CHECK (status IN ('active', 'retired')),
  version      INTEGER     NOT NULL DEFAULT 1,
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stable retrieval order for agent loading: newest-first by creation (deterministic).
-- This is the index the listActive query hits.
CREATE INDEX IF NOT EXISTS sales_memory_status_created_at_idx
  ON sales_memory (status, created_at DESC)
  WHERE status = 'active';

-- Append-only version history. Every create/edit/retire/restore appends one row.
-- UNIQUE(memory_id, version) ensures version numbers never repeat per memory,
-- which in turn means a stale-version edit always loses the race cleanly.
CREATE TABLE IF NOT EXISTS sales_memory_version (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id   UUID        NOT NULL REFERENCES sales_memory(id),
  version     INTEGER     NOT NULL,
  content     TEXT        NOT NULL,
  change_kind TEXT        NOT NULL
                            CONSTRAINT sales_memory_version_change_kind_check
                            CHECK (change_kind IN ('create', 'edit', 'retire', 'restore')),
  author      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (memory_id, version)
);

-- Fast history lookup per memory (ordered by version ascending).
CREATE INDEX IF NOT EXISTS sales_memory_version_memory_id_version_idx
  ON sales_memory_version (memory_id, version);
