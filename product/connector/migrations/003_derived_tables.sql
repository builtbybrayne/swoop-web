-- 003_derived_tables.sql
-- ----------------------------------------------------------------------------
-- The five job-shaped derived tables — the surfaces tools read from.
--
-- Per planning/03-exec-c-t2.md §"Schema design — Postgres" + decision C.30
-- (customer_story persona shape).
--
-- Every derived row carries:
--   - id (UUID, generated)
--   - source_provenance (where the row originated — page/blog/contentblock/...)
--   - source_id (id in the source table)
--   - text (chunk content, agent-ready)
--   - canonical_url (deep-link target)
--   - ntag_ids (int[] — for filtering)
--   - embedding (vector(1536), populated by C.t3a)
--   - tsv (tsvector for hybrid retrieval; populated by C.t3a)
--   - content_hash (idempotent re-embedding lookups)
-- plus job-specific fields.
--
-- The five tables map 1:1 to the five conversational jobs (decision C.25):
--   inspire_passage → Inspire (find_inspiring)
--   customer_story  → Mirror   (find_someone_who) — conditional per C.26
--   trust_proof     → Reassure (find_proof)
--   inform_chunk    → Inform   (lookup)
--   trip_card       → Propose options (find_options)
--
-- Mirror retrieval is persona-shaped (C.30), so customer_story has
-- persona_summary + persona_embedding instead of a content embedding.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- inspire_passage — Inspire job
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspire_passage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provenance TEXT NOT NULL CHECK (
    source_provenance IN (
      'page_intro', 'page_summary', 'page_contentblock',
      'blog_chunk', 'chunk'
    )
  ),
  source_id         TEXT NOT NULL,            -- TEXT to accommodate UUID blog chunk ids alongside int domain ids
  text              TEXT NOT NULL,
  canonical_url     TEXT NOT NULL,
  ntag_ids          INTEGER[] DEFAULT '{}',
  region            TEXT,                     -- denormalised from ntag.area overlap
  mood              TEXT,                     -- optional, derived where extractable
  image_id          INTEGER REFERENCES image(id),
  embedding         vector(1536),
  tsv               tsvector,
  content_hash      TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  modified_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- customer_story — Mirror job (conditional on C.26)
--
-- Per decision C.30: persona_summary TEXT + persona_embedding vector. No
-- structured persona columns, no JSONB blob. Haiku writes a 1–3 sentence
-- description per row at ETL; cosine similarity on persona_embedding is how
-- the Mirror tool finds matching customers.
--
-- No content embedding column on this table — persona-shaped retrieval is
-- the only matching mechanism. Add one if a future use case wants topic-
-- shaped retrieval over stories ("show me stories about the W trail"); not
-- before.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_story (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provenance  TEXT NOT NULL CHECK (
    source_provenance IN ('customerreview', 'customertip', 'blog_first_person')
  ),
  source_id          TEXT NOT NULL,
  text               TEXT NOT NULL,
  canonical_url      TEXT,
  region             TEXT,
  persona_summary    TEXT NOT NULL,
  persona_embedding  vector(1536),
  image_id           INTEGER REFERENCES image(id),
  tsv                tsvector,
  content_hash       TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  modified_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- trust_proof — Reassure job
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trust_proof (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provenance TEXT NOT NULL CHECK (
    source_provenance IN (
      'swoop_page', 'partner_page', 'blog_b_corp',
      'pressreview', 'external_certification'
    )
  ),
  source_id         TEXT NOT NULL,
  topic             TEXT NOT NULL CHECK (
    topic IN (
      'sustainability', 'b-corp', 'expertise', 'conservation',
      'safety', 'guides', 'satisfaction', 'other'
    )
  ),
  claim             TEXT NOT NULL,
  evidence          TEXT NOT NULL,
  canonical_url     TEXT,
  embedding         vector(1536),
  tsv               tsvector,
  content_hash      TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  modified_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- inform_chunk — Inform job
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inform_chunk (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provenance TEXT NOT NULL CHECK (
    source_provenance IN (
      'faq', 'swoop_practical', 'guidebook_practical',
      'month_page', 'blog_practical', 'trip_prose'
    )
  ),
  source_id         TEXT NOT NULL,
  question          TEXT,                     -- non-null for FAQ-style sources
  text              TEXT NOT NULL,
  canonical_url     TEXT,
  topic_tags        TEXT[] DEFAULT '{}',
  embedding         vector(1536),
  tsv               tsvector,
  content_hash      TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  modified_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- trip_card — Propose options job
--
-- id is INTEGER, mirroring trip.id (one card per trip). Internals minimal
-- pending trips ingestion firming up; surface (headline / vibe_line / region /
-- price / image / canonical_url) is committed.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trip_card (
  id                  INTEGER PRIMARY KEY REFERENCES trip(id),
  slug                TEXT,
  headline            TEXT NOT NULL,
  vibe_line           TEXT,
  region              TEXT,
  duration_days       INTEGER,
  from_price          DECIMAL(10, 2),
  currency_code       TEXT,
  image_id            INTEGER REFERENCES image(id),
  accommodation_style TEXT,
  activity_tags       TEXT[] DEFAULT '{}',
  canonical_url       TEXT NOT NULL,
  embedding           vector(1536),
  tsv                 tsvector,
  content_hash        TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  modified_at         TIMESTAMPTZ DEFAULT NOW()
);
