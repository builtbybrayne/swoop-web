# 03 — Execution: Crosscut — Embedding cache (survival of truncates + content-hash idempotency)

> **Status**: DRAFT — author 2026-05-15, focused-shamir-52524c worktree. Decision IDs proposed `C.embedding-cache-{1..}` (wave-named, TBD-on-merge). Authored as a response to the C.focused-shamir-2 compose run on 2026-05-15 surfacing that `compose` TRUNCATEs every derived table on every run and the embed pass gates on `embedding IS NULL` (not `content_hash` as the runbook documents) — net effect: every compose re-embeds the entire derived store. This plan closes that gap with a content-hash-keyed embedding cache that lives outside the truncate blast radius.

---

## ★ Read this first — the problem this closes

The documented behaviour (per [cms/ops/embedding-rerun.md:17](../product/cms/ops/embedding-rerun.md)): *"idempotent on `content_hash`: if the source content hasn't changed, the existing embedding stays."*

The actual behaviour:
1. `compose*` functions in [enrich/compose/](../product/ingestion/src/enrich/compose) default to `TRUNCATE` + `INSERT FROM SELECT`. Every compose run blows away all derived rows.
2. `embedDerivedTable` ([enrich/embed/derived-rows.ts:64](../product/ingestion/src/enrich/embed/derived-rows.ts#L64)) gates on `WHERE embedding IS NULL`. Not `content_hash`. After TRUNCATE every row has `embedding IS NULL` → everything re-embeds.

The 2026-05-15 incident: a compose run for C.focused-shamir-2 wiped 649 embeddings off `trip_card` (cost-free re-embed claim was wrong), and burnt fresh tokens on 2,581 rows that had unchanged content. The user's constraint: **"100% cannot be trashing embeddings any time we change the data."**

Why a separate FK'd table per derived table isn't enough: TRUNCATE on the parent cascades (or restricts), so the embedding storage must be **outside any truncatable table**, keyed by the natural key of an embedding — its **content_hash** — so the cache is decoupled from any specific derived row.

This plan:
- Stores embeddings in `embedding_cache (content_hash, model_version, embedding)`, separate from every derived table.
- Compose-time INSERT does a cache lookup; cache hit → embedding restored without a Gemini call.
- Embed pass writes through to the cache so future TRUNCATEs are recoverable.
- The migration itself backfills the cache from currently-embedded rows so existing work isn't lost.

---

## 1. Outcome

After this lands:
- Re-running `compose` of any (or every) derived table costs **zero Gemini tokens** if the content hasn't changed since it was first embedded — the cache hit happens at compose-time INSERT.
- A direct `TRUNCATE` on any derived table loses the row but not the embedding artefact; re-composing recovers it from cache.
- A genuine content change (different `content_hash`) is the *only* trigger for a fresh embedding — exactly matching what the runbook always documented.
- All currently-embedded rows (the 2,581 that survived the 2026-05-15 compose) are preserved through the migration's backfill step; tour-v2 can then resume safely.

## 1.5 What this does **not** change

Clarifying because the cache architecture invites a wrong mental model. The cache is the **spare key**, not the **front door**:

- **Embedding columns stay on derived tables.** `inspire_passage.embedding`, `customer_story.persona_embedding`, `trip_card.embedding`, `tour_card.embedding`, etc. — all preserved. The HNSW indexes on them — all preserved.
- **Similarity-search code paths are unchanged.** `find_inspiring` still does `SELECT … FROM inspire_passage ORDER BY embedding <=> $query LIMIT N`. `find_someone_who` still queries `customer_story.persona_embedding`. The `_card` readers consumed by `find_options` are unchanged. No JOIN through the cache at query time.
- **Pointers back to source records stay intact.** `source_id`, `canonical_url`, `text`, image refs — all the columns retrieval consumers depend on stay where they are, on the same row as the embedding. The cache doesn't replace that linkage; it just guarantees the embedding column can be re-filled cheaply.

The cache's only job: write-through on every fresh embedding so a future TRUNCATE/re-compose can repopulate the column without spending tokens. Retrieval semantics, schema visible to consumers, query performance — none of it changes.

---

## 2. Target functionalities

### 2.1 `embedding_cache` table — migration 012

New file: `product/connector/migrations/012_embedding_cache.sql`.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash   TEXT NOT NULL,
  model_version  TEXT NOT NULL DEFAULT 'gemini-embedding-001',
  embedding      halfvec(3072) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (content_hash, model_version)
);

-- No HNSW index here — the cache is for lookup-by-content-hash, not for
-- similarity search. The derived tables keep their HNSW indexes for that.

-- Backfill from currently-embedded derived rows. Idempotent (ON CONFLICT DO
-- NOTHING). model_version is assumed to be the current production embedder
-- per decision C.46 / C.brave-pare-1 (gemini-embedding-001 / halfvec(3072));
-- if any rows were embedded under a different model the cache will need a
-- manual catch-up — record that as a known constraint and a follow-up if it
-- ever bites.
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

-- blog_chunk also has content_hash and embedding columns — include it.
-- tag / faqitem / image are DEFERRED from this tranche because they don't
-- have content_hash columns yet (audited 2026-05-15). Adding content_hash
-- to those tables is its own small piece of design work (deciding what
-- "content" means for an image — annotation output? alt_text? — is
-- non-trivial), and source-table embeddings are lower-risk than derived
-- (they aren't TRUNCATEd by any compose function, only re-written by
-- column-preserving ETL upserts). Tracked as a follow-up in §9.
INSERT INTO embedding_cache (content_hash, model_version, embedding)
SELECT content_hash, 'gemini-embedding-001', embedding
FROM blog_chunk WHERE embedding IS NOT NULL AND content_hash IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
```

**Note on column existence**: the backfill assumes each table has both an `embedding` (or `persona_embedding`) column AND a `content_hash` column. Verify at execution — if any table is missing `content_hash`, that table's pass through the cache is degraded (no cache hits possible) and needs that column added before this migration can fully serve it. Mitigation: extend the migration to no-op those tables and flag a follow-up.

### 2.2 Compose function changes — cache lookup on INSERT

All 6 compose functions ([enrich/compose/inspire-passage.ts](../product/ingestion/src/enrich/compose/inspire-passage.ts), `customer-story`, `trust-proof`, `inform-chunk`, `trip-card`, `tour-card`) get the same minimal change: when inserting a row, look up its `content_hash` in the cache. Cache hit → write the cached embedding into the new derived row's embedding column inline; cache miss → leave embedding NULL (the embed pass picks it up).

**Shape** (pseudocode; per-function adaptation):

```typescript
// Existing path:
const hash = contentHash(embedInput, SOURCE_TYPE);
await client.query(
  `INSERT INTO trip_card (..., content_hash, embedding, tsv) VALUES (...)`
);

// New path:
const hash = contentHash(embedInput, SOURCE_TYPE);
const cached = await client.query<{ embedding: string }>(
  `SELECT embedding::text AS embedding FROM embedding_cache
   WHERE content_hash = $1 AND model_version = $2`,
  [hash, GEMINI_MODEL_VERSION],
);
const cachedEmbedding = cached.rows[0]?.embedding ?? null;
await client.query(
  `INSERT INTO trip_card (..., content_hash, embedding, tsv)
   VALUES (..., $hash, $cachedEmbedding::halfvec(3072), ...)`
);
// On cache hit we also touch last_used_at so the LRU-like prune (future)
// has a signal:
if (cachedEmbedding !== null) {
  await client.query(
    `UPDATE embedding_cache SET last_used_at = NOW()
     WHERE content_hash = $1 AND model_version = $2`,
    [hash, GEMINI_MODEL_VERSION],
  );
}
```

**Performance consideration**: per-row SELECT adds latency. At our scale (max ~2,500 derived rows per compose run) this is trivial — sub-second. If it becomes a hotspot, switch to **batch lookup**: compute all hashes first, single `SELECT … WHERE content_hash = ANY($1)` into a map, then loop with in-memory lookup. The contract stays the same.

**Constant**: `GEMINI_MODEL_VERSION` lives in `enrich/gemini.ts` (alongside `GEMINI_MODEL`); both compose and embed read from it. Bumping the model is a one-line change there.

### 2.3 Embed-pass changes — write-through to cache

[enrich/embed/derived-rows.ts](../product/ingestion/src/enrich/embed/derived-rows.ts): when an embedding is computed for a row, write to **both** the derived table AND `embedding_cache` in the same step.

```typescript
for (const { item, embedding } of out) {
  // 1. Cache write — ON CONFLICT DO NOTHING (idempotent; same hash never
  //    duplicates). NOTE: we look up content_hash for the row here; the
  //    embed-pass SELECT already pulls it.
  await opts.client.query(
    `INSERT INTO embedding_cache (content_hash, model_version, embedding)
     VALUES ($1, $2, $3::halfvec(3072))
     ON CONFLICT (content_hash, model_version) DO NOTHING`,
    [item.content_hash, GEMINI_MODEL_VERSION, toPgVectorLiteral(embedding)],
  );

  // 2. Derived-table write (unchanged from today).
  await opts.client.query(
    `UPDATE ${opts.table} SET ${opts.embedColumn} = $1::halfvec(3072), ...
     WHERE id = $2${idCast}`,
    [...]
  );
}
```

The SELECT at the top of `embedDerivedTable` needs to also pull `content_hash`:
```sql
SELECT id::text AS id, ${textColumn} AS text, content_hash
FROM ${table}
WHERE ${embedColumn} IS NULL ...
```

`DerivedRow` interface gains `content_hash: string`.

### 2.4 Source-table embedders — blog_chunk only this tranche

Only [embed/blog-chunks.ts](../product/ingestion/src/enrich/embed/blog-chunks.ts) gets the write-through treatment here, because `blog_chunk` already has a `content_hash` column. The other three source embedders ([embed/tags.ts](../product/ingestion/src/enrich/embed/tags.ts), `faqitems.ts`, `images.ts`) are deferred — their tables lack `content_hash` (audited 2026-05-15), adding it requires a per-table design call on what "content" means, and the survival risk is lower (no compose function TRUNCATEs them; column-preserving ETL upserts protect their embeddings already). Tracked as a follow-up in §9.

Same write-through pattern for blog_chunk: when embedding completes, INSERT INTO `embedding_cache` (ON CONFLICT DO NOTHING) and UPDATE `blog_chunk.embedding` (today's behaviour).

### 2.5 Gemini client — model_version constant

[enrich/gemini.ts](../product/ingestion/src/enrich/gemini.ts) likely already has a `GEMINI_MODEL = 'gemini-embedding-001'` const. Add `GEMINI_MODEL_VERSION` (probably the same string) and export it. Compose and embed import from there; one source of truth.

### 2.6 Tests

Per the project's testing philosophy (`product/CLAUDE.md`: unit-test only narrow pure utilities; integration belongs in the H harness), the bulk of verification is integration. Specifically:

- **Migration test** ([connector/src/migrate.ts](../product/connector/src/migrate.ts) suite): assert that running 012 leaves `embedding_cache` non-empty with the expected row count (sum of currently-embedded rows across all source + derived tables).
- **Compose round-trip test**: TRUNCATE one derived table, re-run its compose function, assert embeddings come back populated **without** any Gemini call. (Can be done by injecting a `GeminiClient` mock that fails if called.)
- **content_hash change → fresh embedding test**: modify a source field, re-compose, assert that row's embedding is now NULL on the derived table (and that the embed pass would re-embed it). Cache for the *old* content_hash still exists.

These integration tests live in `enrich/__tests__/` (currently empty for compose paths — this is the right time to seed it).

### 2.7 Decisions to log

Two proposed entries in [decisions.md](decisions.md):

- **C.embedding-cache-1** — Embeddings live in a separate `embedding_cache` table keyed by `(content_hash, model_version)`, decoupled from the truncatable derived/source tables. Compose-time INSERT does cache lookup; embed-pass writes through. Supersedes the implicit "embedding column on derived table is the source of truth" pattern. Reversible: keeping the embedding columns on derived tables means existing readers (find_inspiring, find_someone_who, find_options _card readers) are unchanged — the cache is purely a survival/idempotency layer.
- **C.embedding-cache-2** — `model_version` is part of the cache primary key. Bumping the embedder (e.g. Gemini-embedding-001 → -002) creates a new cache entry rather than overwriting; allows graceful rollouts and rollback (mirrors the immutable-history principle of C.31 forward-only migrations).

### 2.8 Doc updates (in the same PR)

- **`cms/ops/embedding-rerun.md`** — correct the "idempotent on `content_hash`" sentence; it's *now* true. Add a "How the cache works" subsection. Note the recovery affordance: direct TRUNCATEs survive.
- **`gotchas.md`** — replace the "Gemini embeddings 429 under our default concurrency" gotcha's tactical fix advice with a pointer to the cache: most re-runs cost zero tokens now.
- **`discoveries.md`** — short entry on the divergence-then-resolution: documented vs implemented behaviour reconciled.

---

## 3. Architectural principles applied here

- **Embeddings are functions of content + model, not of the row that happens to hold them.** Storing them keyed by `(content_hash, model_version)` is the architecturally honest shape. Per-row columns become a denormalised *projection* of the cache.
- **Outside the truncate blast radius.** No FK from the cache back to derived rows. The cache survives anything that happens to those tables — TRUNCATE, DROP, DELETE — because it doesn't depend on them.
- **One cache for all sources.** Same content from different sources (rare but possible — e.g. the same prose chunk appearing in `inform_chunk` and `inspire_passage`) hits the same cache entry. No duplication.
- **Idempotency by construction, not by convention.** The runbook's previous claim was convention-based and silently wrong; the new shape makes it structural.
- **Model version is first-class.** Future Gemini-embedding-002 or a swap to a different family becomes a clean event — bump the constant, new entries get the new model_version, old entries persist as auditable history.

---

## 4. Implementation order

1. **Migration 012** authored + applied to `puma_dev`. Verify cache populated with the 2,581 surviving rows (inspire_passage 665 + customer_story 953 + trust_proof 39 + inform_chunk 924 — assuming all four have content_hash; verify).
2. **Add `GEMINI_MODEL_VERSION` constant** to `enrich/gemini.ts`. Re-export from `enrich/index.ts` if needed.
3. **Update `embedDerivedTable`** ([enrich/embed/derived-rows.ts](../product/ingestion/src/enrich/embed/derived-rows.ts)) to write-through to cache on every embed. SELECT now pulls `content_hash`; DerivedRow interface gains the field.
4. **Update the 4 source embedders** (tags / faqitems / images / blog-chunks) with the same write-through pattern.
5. **Update each of the 6 compose functions** with the cache lookup on INSERT. Mechanical; mirror across all 6.
6. **Integration tests** per §2.6.
7. **Typecheck + lint + tests** green across `@swoop/ingestion` and `@swoop/connector`.
8. **End-to-end smoke**: run `enrich --mode=compose` against `puma_dev`. Expected: trip_card + tour_card get freshly embedded (the only cache misses); the other 4 derived tables hit cache and stay populated with zero Gemini calls.
9. **Doc sweep** per §2.8.
10. **Commit + merge.**

---

## 5. Verification

### Fresh-install gate (per `feedback_swarm_fresh_install_verify.md`)

```sh
cd product && rm -rf node_modules package-lock.json && npm install \
  && npm run typecheck && npm run lint && npm test
```

### Sweep checks (against puma_dev)

```sh
PSQL="postgresql://al:pick-a-password@localhost:5432/puma_dev"

# Cache populated, sized as expected
psql "$PSQL" -c "SELECT count(*) AS cached, count(DISTINCT model_version) AS models FROM embedding_cache;"
# expect: cached ≥ 2,581 (post-backfill) + tag/faqitem/image/blog_chunk row counts;
# models = 1 (just gemini-embedding-001)

# Every embedded derived row has a matching cache entry
psql "$PSQL" -c "
  SELECT 'trip_card' AS t,
         (SELECT count(*) FROM trip_card WHERE embedding IS NOT NULL) AS embedded_rows,
         (SELECT count(*) FROM trip_card tc JOIN embedding_cache c ON c.content_hash = tc.content_hash
          WHERE tc.embedding IS NOT NULL) AS in_cache
  UNION ALL SELECT 'inspire_passage',
         (SELECT count(*) FROM inspire_passage WHERE embedding IS NOT NULL),
         (SELECT count(*) FROM inspire_passage p JOIN embedding_cache c ON c.content_hash = p.content_hash
          WHERE p.embedding IS NOT NULL);
"
# expect: embedded_rows = in_cache on every line (cache is a strict superset of derived embeddings)

# Truncate-and-recover round-trip (after compose changes ship):
psql "$PSQL" -c "TRUNCATE inspire_passage;"
# Run compose:
set -a; source product/connector/.env; set +a
npm run -w @swoop/ingestion enrich -- --mode=compose
# Re-check:
psql "$PSQL" -c "SELECT count(*) AS embedded FROM inspire_passage WHERE embedding IS NOT NULL;"
# expect: 665 — all recovered from cache, zero Gemini calls
```

The third check is the actual proof that the constraint is met.

### Smoke test the user-facing tools

After end-to-end smoke (§4 step 8), boot connector+orchestrator+UI and run a `find_inspiring` query that depends on `inspire_passage.embedding` semantic search. Result quality should be identical to pre-incident — embeddings preserved bit-for-bit (cache write-through stores the exact vector).

---

## 6. HITL questions

Three calls to ratify before execution:

**Q1 — Cache scope: derived tables only, or also source tables?** **RESOLVED by audit 2026-05-15**: scope to the 7 tables that already have a `content_hash` column — the 6 derived tables (inspire_passage, customer_story, trust_proof, inform_chunk, trip_card, tour_card) + `blog_chunk`. The other three source tables (`tag`, `faqitem`, `image`) lack `content_hash` and are deferred to a follow-up; adding the column to `image` in particular needs a design call on what "content" means for an image (annotation output? alt_text? a hash over both?). Risk of source-table embedding loss is lower than derived (no compose function TRUNCATEs them; ETL upsert preserves embedding columns by construction) — the deferral is responsible scoping, not a gap.

**Q2 — `model_version` value: how granular?**
- Recommendation: **the model identifier string** (`'gemini-embedding-001'`). Treat any change as a new model.
- Alternative: separate `model_family` + `model_revision` columns; future Gemini-embedding-001-v2 would be the same family but different revision and could share retrieval. Adds complexity for ~zero current benefit; defer.

**Q3 — Cache pruning policy?**
- Recommendation: **none today.** `last_used_at` is recorded so future cleanup can be data-driven, but at our scale (10K-ish entries lifetime, ~50KB each → ~500MB max, never reclaimed) it's not yet worth a sweep. Revisit at M5 if cache hits an operational ceiling.

---

## 7. Coordination with siblings

- **Tour-v2 (C.focused-shamir-{2..5})** — paused at migration 011 + composeTourCard written. Once embedding-cache lands and a recovery compose run completes, tour-v2 resumes from §2.3 of `03-exec-crosscut-find-options-v2-backfill.md` (`queryTourCardsByFilter`). trip_card and tour_card both end up cached on the first post-fix compose; no further re-embed work.
- **C.t9 / C.46 (Gemini embedder swap)** — the cache's `model_version` column is the structural register that earlier swap would have wanted. If a future model swap happens, this plan's pattern means it's a one-line change to the constant + a one-shot cache backfill for the new model.
- **C.t3a (initial enrich pipeline)** — superseded in the embedding-survival layer. Original compose/embed split stays; this plan adds the cache layer between them.

---

## 8. Effort estimate

**~2.5–3 hours** for a single executor:
- Migration 012 (write + apply + verify backfill): 30m
- `GEMINI_MODEL_VERSION` constant + `embedDerivedTable` write-through: 30m
- `blog_chunk` embedder write-through (only source-table embedder touched this tranche): 15m
- Compose functions (6 files) cache-lookup-on-INSERT: 60m
- End-to-end smoke + doc sweep: 30m

Integration tests in §2.6 are nice-to-have but the e2e smoke (§5 "truncate-and-recover round-trip") is the actual proof against the constraint.

The risk is in step 5 (compose functions) — the same change mechanically applied 6 times. Easy to miss a function or get the SELECT shape slightly different. The integration tests in §2.6 catch this.

---

## 9. Open items at execution

These don't block the plan but resolve inline:

1. **Follow-up — `tag` / `faqitem` / `image` cache coverage.** Audit 2026-05-15 confirmed these three lack `content_hash`. Out of scope here; a future plan adds `content_hash` to each (with a per-table call on what gets hashed — title for tag, title+content for faqitem, annotation output for image) plus a backfill pass plus inclusion in the cache write-through.
2. **Cache pruning** stays unwired but `last_used_at` is recorded so a future sweep can target unused entries (model upgrades, source rows deleted permanently).
3. **Failed-embed retry semantics**: if `INSERT INTO embedding_cache` succeeds but the `UPDATE derived_table` fails, the cache has an entry the derived table lacks. Acceptable (next compose lookup recovers it). Worth a comment in the embed-pass code.
