-- 013_customer_tip_table.sql
-- ----------------------------------------------------------------------------
-- customer_tip — the surface behind the `find_tips` tool (the 9th MCP tool).
--
-- Per planning/03-exec-customer-tips-tool.md (HITL-ratified 2026-05-27). This
-- is a SECOND shape of the Inform job: where `lookup` / inform_chunk serves
-- Swoop's own authoritative practical guidance, `find_tips` serves
-- traveller-sourced practical wisdom — short, first-person, attributed.
--
-- Why a SEPARATE derived table (not reusing inform_chunk or customer_story):
--   - The conversational register is distinct: a tip is a fellow-traveller's
--     voice ("I wish I'd packed…"), surfaced WITH attribution, not Swoop's
--     institutional answer. Mixing them into inform_chunk would blur the
--     provenance the tool description leans on.
--   - Mirror's customer_story is persona-shaped (persona_embedding); tips are
--     topic-shaped (content embedding + topic_tags). Different retrieval axis.
--
-- Source: MariaDB `swoop_patagonia.customertip` (singular; 47 live rows as of
-- the 2026-05-27 Step-0 audit). Unlike the five C.t2 derived tables, this one
-- is NOT produced by a compose pass — sql-transform writes the base columns
-- (text / author_name / source_created_at / content_hash) directly, then the
-- enrich pipeline fills topic_tags + region (per-row classify, NO aggregation)
-- and embedding + tsv (the generic embedDerivedTable embed-derived pass).
--
-- id is INTEGER, carried straight from customertip.id upstream (mirrors the
-- trip_card convention). content_hash = sha256(text || '|' || version),
-- version=1 — the idempotent re-embedding key (theme 5).
--
-- Column-type notes:
--   - embedding halfvec(3072) directly (post-009 / decision C.46 shape; no
--     vector(1024) intermediate — this table is born after the 3072d swap).
--   - tsv tsvector, populated by the embed-derived pass (populateTsv:true).
--   - ntag_ids INTEGER[] carried for shape-symmetry with the other derived
--     tables; empty for v1 (tips have no upstream ntag junction).
--   - region nullable — most tips are region-agnostic; the classifier fills
--     it only where the text names a clear Patagonian sub-region.
--
-- Forward-only — no DOWN migration (decision C.31). IF NOT EXISTS throughout
-- so re-application is a no-op.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS customer_tip (
  id                INTEGER PRIMARY KEY,        -- carried from customertip.id upstream
  source_provenance TEXT NOT NULL DEFAULT 'customertip' CHECK (
    source_provenance IN ('customertip')
  ),
  source_id         TEXT NOT NULL,             -- TEXT for symmetry with the other derived tables (stringified customertip.id)
  text              TEXT NOT NULL,             -- the tip itself (first-person traveller prose)
  author_name       TEXT,                      -- traveller display name (customertip.name, trimmed); nullable when blank
  topic_tags        TEXT[] DEFAULT '{}',       -- 8-topic taxonomy, filled by the tip-topic classifier
  region            TEXT,                      -- optional Patagonian sub-region, filled by the classifier where extractable
  ntag_ids          INTEGER[] DEFAULT '{}',    -- shape-symmetry only; empty for v1
  source_created_at TIMESTAMPTZ,               -- customertip.created (2016–2025)
  embedding         halfvec(3072),             -- populated by the embed-derived enrich pass
  tsv               tsvector,                  -- populated alongside the embedding (populateTsv:true)
  content_hash      TEXT NOT NULL,             -- sha256(text || '|' || version); idempotent re-embedding key
  classified_at     TIMESTAMPTZ,               -- NULL until the tip-topic classifier has run; the classify idempotency gate
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  modified_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Indexes — mirror the per-table conventions in migration 004 / 009.
-- ----------------------------------------------------------------------------

-- HNSW for sub-ms ANN over the content embedding (halfvec opclass, post-009).
CREATE INDEX IF NOT EXISTS customer_tip_embedding_hnsw
  ON customer_tip USING hnsw (embedding halfvec_cosine_ops);

-- GIN tsvector for the lexical half of hybrid (RRF) retrieval.
CREATE INDEX IF NOT EXISTS customer_tip_tsv_gin
  ON customer_tip USING gin (tsv);

-- GIN array for topic-tag filtering.
CREATE INDEX IF NOT EXISTS customer_tip_topic_tags_gin
  ON customer_tip USING gin (topic_tags);

-- B-tree on region for the optional region filter (region = $r OR region IS NULL).
CREATE INDEX IF NOT EXISTS customer_tip_region_idx
  ON customer_tip (region);

-- B-tree on content_hash for idempotent re-embedding lookups.
CREATE INDEX IF NOT EXISTS customer_tip_content_hash_idx
  ON customer_tip (content_hash);

-- ----------------------------------------------------------------------------
-- Column comments — the why where it isn't obvious from name + type.
-- ----------------------------------------------------------------------------

COMMENT ON TABLE customer_tip IS
  'Traveller-sourced practical tips (find_tips tool). Second shape of the Inform job; distinct from inform_chunk (Swoop''s own guidance) by its first-person, attributed register. See planning/03-exec-customer-tips-tool.md.';
COMMENT ON COLUMN customer_tip.author_name IS
  'Traveller display name from customertip.name, TRIM-ed and with literal tabs stripped. Shown WITH the tip as attribution.';
COMMENT ON COLUMN customer_tip.topic_tags IS
  '8-topic taxonomy {packing,weather,money,safety,transit,food,accommodation,etiquette}, assigned per-row by the tip-topic Haiku classifier (no aggregation).';
COMMENT ON COLUMN customer_tip.classified_at IS
  'NULL until the tip-topic classifier has written topic_tags + region. The classify idempotency gate (re-runs skip already-classified rows unless content_hash changed).';

COMMIT;
