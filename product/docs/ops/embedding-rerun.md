# Embedding re-run — Voyage-3 + Haiku enrichment pass

Operator-facing runbook for re-running the embedding pass and the Haiku ETL classifiers. Open this when content has changed, when a classifier prompt has been edited, or after a fresh ETL run.

---

## Why this exists

The retrieval surface doesn't query the domain tables directly — it queries the **derived job-shaped tables** (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`). Each row in those tables carries:

- A natural-language summary (composed from the source rows by Haiku, where applicable).
- A Voyage-3 embedding of that summary or the source prose, used by the connector's vector search.
- Tag arrays, classifier verdicts, and other Haiku-derived fields.

The enrichment pass is what populates those columns. Without it, the agent's retrieval surface returns empty results.

The pass is idempotent on `content_hash`: if the source content hasn't changed, the existing embedding / classifier output stays. So re-running after an ETL re-run only re-embeds and re-classifies the rows that actually changed.

### How the cache enforces this (post-2026-05-15)

Embeddings are stored in **two places**: on the derived row (for retrieval — `inspire_passage.embedding`, `customer_story.persona_embedding`, etc.) AND in a separate **`embedding_cache`** table keyed by `(content_hash, model_version)`. The cache lives outside any derived table's TRUNCATE blast radius. Compose-time INSERT looks up by content_hash — cache hit → embedding hydrated inline, no Gemini call; cache miss → embedding NULL, embed pass picks it up and writes through to the cache.

Practical effect: after one compose run, re-running compose against unchanged content costs **zero Gemini tokens**. A direct `TRUNCATE inspire_passage` followed by re-compose recovers all 665 embeddings from cache with no API calls. Plan: [planning/03-exec-crosscut-embedding-cache.md](../../../planning/03-exec-crosscut-embedding-cache.md). Decisions: C.embedding-cache-1, C.embedding-cache-2.

Coverage today: 6 derived tables + `blog_chunk`. `tag`, `faqitem`, `image` are not yet cached (they lack `content_hash` columns); a follow-up adds those. Until then, those four sources still re-embed on every run — but they don't get TRUNCATEd by any compose function, so the cost surfaces only on intentional re-embed.

---

## What you'll do every time

1. Confirm ETL ran successfully (`etl-rerun.md`).
2. Run a `--dry-run` to preview cost.
3. Run the full enrichment pass.
4. Spot-check the derived tables.

Time-box: ~5 min of operator attention. The pass itself takes up to **24 hours** end-to-end via Anthropic's Batches API — most of that is wall-clock waiting for batches to clear, not interactive work.

---

## Cadence + ownership

- **When**: after every ETL re-run (`etl-rerun.md`); when a classifier or composition prompt changes (frontmatter `version` bump invalidates `content_hash` for that prompt's rows); when the Voyage-3 model version changes (rare).
- **Who**: the **ETL operator**. Same role as `etl-rerun.md`.
- **How long**: ~5 min interactive; up to 24 hours wall-clock. Plan the trigger early in the day so batches clear before you next need the data.

---

## Step 1 — Dry-run to preview cost

```bash
npm run enrich:dry-run --workspace @swoop/ingestion
```

The dry-run estimates batch sizes, token counts, and projected GBP cost without firing any API calls or DB writes. Read the output. Sanity-check:

- The number of items per source roughly matches your expectation (e.g. `customerreview` ~2,160 if all rows changed; far fewer if you ETL-re-ran with mostly-stable content).
- The total estimated cost is below your budget cap (`ENRICH_BUDGET_GBP`).

You'll know it worked when:
- A "would spend ~£X" line prints.
- No errors, no API calls fired.

If the cost is higher than you expected, the most likely cause is a prompt-version bump (a frontmatter `version: N → N+1` change invalidates every row's `content_hash` and re-classifies the whole corpus). Check git for recent prompt changes under `product/cms/prompts/etl/<classifier>/`.

---

## Step 2 — Run the full pass

```bash
npm run enrich --workspace @swoop/ingestion -- --mode=all
```

This runs three sub-modes in sequence:
- `--mode=embed` — Voyage-3 embeddings on every changed row's prose.
- `--mode=classify` — Haiku batch classifiers (blog-post-job, blog-tag-normalisation, persona-summary).
- `--mode=compose` — derived job-shaped tables populated from the domain layer + classifier output.

You can run them individually:

```bash
npm run enrich --workspace @swoop/ingestion -- --mode=embed
npm run enrich --workspace @swoop/ingestion -- --mode=classify
npm run enrich --workspace @swoop/ingestion -- --mode=compose
```

Or scope by source:

```bash
npm run enrich --workspace @swoop/ingestion -- --mode=embed --source=tag
npm run enrich --workspace @swoop/ingestion -- --mode=classify --source=blog-post-job
```

The `--source=image-annotation` argument is **retired** (per decision **C.40** — image annotation folded into the C.t6 Vision call). Use `image-annotation-rerun.md` for image work.

You'll know it worked when:
- The progress log streams batch-submission acknowledgements from Anthropic.
- After each batch clears, a "wrote N rows to <table>" line appears.
- The final line reports total spend in GBP and the budget remaining.

The pass is **resumable**. If it gets interrupted, re-running picks up from the checkpoint — `content_hash` skip means rows already processed don't pay again.

---

## Cost cap

Hard cap via env var:
- `ENRICH_BUDGET_GBP=10` (dev default — set in `connector/.env`).
- `ENRICH_BUDGET_GBP=15` (prod target).

Soft warning fires at £5 spent. The runner stops at the next batch boundary if the cap is reached — partial progress is checkpointed, you can resume after raising the cap or after spending elsewhere drains the budget.

Override per-run:

```bash
npm run enrich --workspace @swoop/ingestion -- --mode=all --budget-gbp=20
```

If you hit the cap mid-run, the next message will say something like *"budget cap reached at £10.04 / £10; stopping at batch boundary"*. Resume after raising the cap by re-running the same command — the checkpoint picks up where it left off.

---

## Step 3 — Spot-check derived tables

```bash
psql "$DATABASE_URL" -c "
  SELECT 'inspire_passage' AS t, COUNT(*) FROM inspire_passage WHERE embedding IS NOT NULL
  UNION ALL SELECT 'customer_story', COUNT(*) FROM customer_story WHERE persona_embedding IS NOT NULL
  UNION ALL SELECT 'trust_proof', COUNT(*) FROM trust_proof WHERE embedding IS NOT NULL
  UNION ALL SELECT 'inform_chunk', COUNT(*) FROM inform_chunk WHERE embedding IS NOT NULL
  UNION ALL SELECT 'trip_card', COUNT(*) FROM trip_card;
"
```

You'll know it worked when:
- All five tables have row counts.
- The embedding columns are populated (`COUNT(*) WHERE embedding IS NOT NULL` is non-zero on every embedded table).

A quick agent-side smoke test: boot the connector + orchestrator + UI, ask the agent something general (*"I'd love to see Patagonia"*), and verify the inspire_passage results render in the chat surface.

---

## Anonymous customer reviews

`customerreview` rows where `name` is NULL or empty (anonymous reviewers) are kept in the corpus but not aggregated for persona generation. Their `customer_story.persona_summary` is null; they don't surface via `find_someone_who` (the Mirror tool keys on `persona_embedding`, which is generated only on populated personas).

This is by design — `find_someone_who`'s value is *"someone who's been there, by name"*; an anonymous *"customer who liked the trip"* persona doesn't serve the Mirror job. Decision recorded under HITL Q3 (2026-05-01).

If a new requirement emerges to surface anonymous reviews differently (e.g. as aggregate testimony, not per-persona), that's a content-derivation change — re-shape the customer-story composition step in `product/ingestion/src/enrich/compose/`.

---

## Prompt versioning

Each ETL classifier lives under `product/cms/prompts/etl/<classifier>/` with a frontmatter `version` field. Bumping the version invalidates every row's `content_hash` (because the hash factors in the prompt content), forcing re-classification on the next run. Use this when:

- The prompt's instructions change materially (output schema shift, new tag categories, refined voice).
- You're rolling forward from a bad prompt revision (see `prompt-version-rollback.md`).

Don't bump the version for trivial typo fixes — every bump costs a full re-classification of the affected corpus.

---

## When things go wrong

### Symptom: `DATABASE_URL not set; pass --database-url or set in connector/.env`

The runner reads `DATABASE_URL` from `connector/.env` by default. If you're running from a different shell or the env file isn't loaded, pass `--database-url` explicitly:

```bash
npm run enrich --workspace @swoop/ingestion -- --mode=all --database-url="postgresql://al:pick-a-password@localhost:5432/puma_dev"
```

### Symptom: `ANTHROPIC_API_KEY is required`

Same root cause as the orchestrator — Claude Code's shell injects an empty `ANTHROPIC_API_KEY`. The runner uses `dotenv({ override: true })` already; if you're hitting this, your `.env` is missing the key. Add it.

### Symptom: Voyage API returns 429

Rate-limit. The runner backs off and retries automatically. If it's persistent, check Voyage's status page; in pathological cases, run with `--mode=embed --source=<small-source>` to scope the affected work.

### Symptom: Batch returns partial results

Some rows succeeded, some failed. The runner records per-row failures in the checkpoint and continues. After the run completes, re-run the same command — the checkpoint replays just the failed rows.

### Symptom: budget cap hit, run stopped mid-corpus

Expected behaviour. Either raise the cap (`--budget-gbp=N` or `ENRICH_BUDGET_GBP` env) and resume, or accept the partial run and pick up next time the budget renews.

### Symptom: persona_summary column is null on some rows

Either the customer-review row was anonymous (see "Anonymous customer reviews" above) or `customer_story` composition hasn't run yet (`--mode=compose`).

### Symptom: agent retrieval returns empty results despite the run completing

Check the embedding columns are populated (step 3 query). If they are but retrieval still returns empty, the issue isn't enrichment — escalate to `troubleshooting.md` "Tool calls returning empty results".

---

## Open items for Al

1. **Production batch-API budget calibration**. The £10 / £15 caps are dev / prod targets, calibrated against the local fixtures. Production-scale corpora may push past £15 on a fresh run — revisit the prod cap after the first full prod run.
2. **Prompt-version bump cost discipline**. Today every version bump triggers a full re-classification. If a future use case needs *"re-classify only the diff"*, that's a content-hash refinement (factor only the changed prompt sections into the hash) — Tier 3 task.
3. **Voyage-3 model version pinning**. The model is `voyage-3-large` today. If Voyage rolls out a new minor version with breaking embedding-shape changes, every embedding gets invalidated. Watch for Voyage release notes.

---

## Where the rules came from

- Decision **C.40** — image annotation folded into the C.t6 Vision call (so embedding-rerun no longer carries an `image-annotation` source).
- HITL Q3 (2026-05-01) — anonymous customerreview rows kept in corpus, persona_summary null.
- `03-exec-c-t3a.md` — the Tier 3 plan that produced the embedding + classifier pipeline.
- Anthropic Message Batches API — https://docs.anthropic.com/en/docs/build-with-claude/batch-processing
