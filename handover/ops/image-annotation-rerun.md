# Image annotation re-run — Claude Vision pipeline

Operator-facing runbook for the Vision pipeline that produces image descriptions, annotations, and tag arrays. Open this when new images arrive in the source dump or when the annotation prompt changes.

---

## Why this exists

Puma's `find_someone_who` and `illustrate` paths lean on image text — descriptions and tag arrays — to retrieve and render the right image at the right conversational moment. Source data only carries `image.title` (99.7% populated), `image.description` (47.5% populated), and `image.caption` (35.2%) — the rest of the corpus needs Vision-derived text.

The pipeline runs a single Claude Vision call per image and gets back six structured outputs (per decision **C.40** — fold of C.t3a image-annotation into C.t6's Vision call):

- `description` — natural-language alt-text-quality description.
- `annotation` — richer narrative annotation usable as retrieval context.
- `subject_tags` — array of subject categories (mountain, glacier, vessel, …).
- `mood_tags` — array of mood/atmosphere tags (peaceful, dramatic, intimate, …).
- `region_tags` — array of geographic anchors (torres-del-paine, fitz-roy, …).
- `tags` — array of free-form tags surfacing anything else useful.

Cost target: ~£30–£150 one-time, at ~$0.005 per image, over the ~6,700 images that need annotation. ~6,300 images already have an upstream `image.description` and skip Vision entirely.

The pipeline is **dry-run by default** — it won't fire Vision calls unless you explicitly pass `--max-budget=N`.

---

## What you'll do every time

1. Run a `--dry-run` to confirm scope + cost.
2. Run live with an explicit `--max-budget`.
3. Spot-check the resulting rows.

Time-box: ~5 min interactive; ~30 min wall-clock for a full live run on the local fixtures (Vision is slower than text-only Haiku batches).

---

## Cadence + ownership

- **When**: at handover (one-time backfill); on-demand when Swoop sends fresh image batches; after a prompt-version bump (frontmatter `version` invalidates `content_hash` and re-annotates affected rows).
- **Who**: the **ETL operator**.
- **How long**: 5 min interactive; 30 min – several hours wall-clock depending on batch size.

---

## Step 1 — Dry-run

```bash
npm run annotate-images --workspace @swoop/ingestion
```

That's the dry-run path. With no `--max-budget`, the CLI prints what it *would* spend and exits without firing Vision calls.

You'll see output along the lines of:
- Total candidate images (rows missing `description` or `annotation`).
- Estimated cost in USD.
- Number of skipped rows (images with upstream `image.description` already populated, or matching the current prompt-version checkpoint).

Sanity-check before going live:
- Candidate count matches your expectation (a fresh ETL with no prompt bump should have ~6,700 candidates the first time, near zero on re-runs).
- Estimated cost is below your intended budget.

---

## Step 2 — Run live

```bash
npm run annotate-images --workspace @swoop/ingestion -- --max-budget=50
```

The `--max-budget=N` is in **USD** (not GBP — distinct from the embedding pass's `ENRICH_BUDGET_GBP`). Pick a cap that covers your estimated spend with margin.

Other flags:
- `--mode=live` (default when `--max-budget` is supplied) — fires Vision calls one-at-a-time with 5-up concurrency.
- `--mode=batches` — Anthropic Batches API path. ✅ Wired by BATCH-C.t6 (2026-05-13, decisions C.batch-1..4). 50% cost discount + up to 24h SLA. Use for full-corpus re-runs; `--mode=live` remains the supported path for small slices during prompt iteration. Cost: ~$17 / £14 for a full ~6.9K-image batch vs ~$34 / £27 at live rate.
- `--mode=dry-run` — explicit dry-run, equivalent to omitting `--max-budget`.
- `--model=<id>` — override the Vision model (default: the constant in `product/orchestrator/src/config/schema.ts`).
- `--retry-failed` — re-process items that failed in a prior run.
- `--database-url <url>` — override `DATABASE_URL`.

You'll know it worked when:
- Per-image progress streams (image_id, cost, success/failure).
- A "wrote N rows" line at the end.
- Final spend reported under your `--max-budget`.

The run is **resumable**. The checkpoint stores per-image state (`done` / `skipped` / `failed`); re-running picks up from where it stopped. By default, `failed` items aren't retried — pass `--retry-failed` to retry them.

---

## Cost cap behaviour

The `--max-budget` enforcement happens **before** any Vision call fires. If a planned call would push the running total over the cap, the runner stops at that boundary. Partial progress is checkpointed; the database has the writes for everything completed up to the stop point.

If you hit the cap mid-corpus and want to continue:

```bash
npm run annotate-images --workspace @swoop/ingestion -- --max-budget=100
```

The checkpoint replays from where it stopped; only the unannotated rows incur new spend.

There's no separate soft warning for image annotation (unlike embedding-rerun's £5 soft warning). The cost-per-image is small and predictable; the cap is the kill-switch.

---

## Step 3 — Spot-check

```bash
psql "$DATABASE_URL" -c "
  SELECT
    COUNT(*) AS total,
    COUNT(description) AS has_description,
    COUNT(annotation) AS has_annotation,
    COUNT(*) FILTER (WHERE array_length(subject_tags, 1) > 0) AS has_subject_tags,
    COUNT(*) FILTER (WHERE array_length(region_tags, 1) > 0) AS has_region_tags
  FROM image;
"
```

You'll know it worked when:
- `has_description` is the sum of upstream-populated rows + Vision-annotated rows (close to the full image count).
- `has_annotation` covers the Vision-annotated subset.
- Tag arrays are populated on Vision-annotated rows.

A qualitative sanity check: pick three random Vision-annotated images and read their `description` + `annotation`. They should sound like the operator-voice rules in the prompt, not generic image-captioning prose. Tag arrays should match what's actually in the image.

---

## Prompt-version rollback

Annotation prompts live at `product/cms/prompts/etl/image-annotation/` with a frontmatter `version` field. Bumping the version invalidates every row's checkpoint hash for that prompt, forcing re-annotation. Use this for material prompt changes; don't bump for typo fixes.

If you ship a bad prompt revision and want to revert without burning through budget on a re-run-of-a-re-run, see `prompt-version-rollback.md`.

---

## When things go wrong

### Symptom: `--max-budget=N is required to spend`

You ran without `--max-budget` and got the dry-run output. That's the safety default. Add `--max-budget=N` to actually spend.

### Symptom: cost-cap hit, run stopped

Expected. Raise the cap or accept the partial run and pick up next time.

### Symptom: many rows fail with `400 invalid image url`

The pipeline resolves image URLs via `@swoop/common/image` (per decisions **C.41** + **C.42**). If a row's underlying `file.path` is malformed or the Imgix tenant rejects it, the call fails. Check the failed image's source row in the `image` + `file` join (`image.image_id → file.id`); the issue is upstream data, not the pipeline.

Use `--retry-failed` only after the upstream issue is fixed.

### Symptom: `ANTHROPIC_API_KEY is required`

Same fix as embedding-rerun. Check `.env`; ensure `dotenv({ override: true })` is honoured.

### Symptom: rate-limit (429)

Vision is rate-limited per account. The runner backs off and retries; if persistent, drop concurrency by setting the relevant env var (see `product/ingestion/src/images/run.ts`) or split the corpus and run smaller batches.

### Symptom: wall-clock far longer than expected

Vision is inherently slower than Haiku. The local fixtures (~6,700 candidate images) take ~30 min; production-scale corpora scale roughly linearly. If a run is stuck (no progress for >2 minutes), check the connector logs for upstream issues.

### Symptom: agent's `illustrate` tool returns wrong/missing images

Annotation works at the data layer; retrieval correctness is a derived-table-composition concern. If annotations look right but retrieval returns wrong results, escalate to `troubleshooting.md` "Tool calls returning empty results" and check the derived `inspire_passage`, `customer_story` etc. tables that consume the annotation columns.

---

## Open items for Al

1. **Batches mode** ✅ wired 2026-05-13 by BATCH-C.t6 (decisions C.batch-1..4). **Prefer `--mode=batches` for full re-runs**: 50% discount + up to 24h SLA. For small prompt-iteration slices, stay on `--mode=live`. Full ~6.9K corpus: ~$17 / £14 batches vs ~$34 / £27 live.
2. **Production corpus size**. Today's estimate (~6,700 candidates at ~$0.005 each) is from local fixtures. Production prod-scale corpora may shift the cost envelope; first prod run will calibrate.
3. **Vision model selection**. The default model lives in `config/schema.ts`; if Anthropic ships a more cost-effective Vision model, pin it via `--model` and consider promoting the new default after a quality compare.

---

## Where the rules came from

- Decision **C.40** — fold C.t3a image-annotation into the C.t6 Vision call (one call, six outputs).
- Decisions **C.41** + **C.42** — imgix render parameters + tenant constants.
- `03-exec-c-t6.md` — the Tier 3 plan that produced the Vision pipeline.
- `discoveries.md` 2026-04-29 — image filenames live on `file`, not `image` (two-table model).
