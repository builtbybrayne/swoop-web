# 03 — Blog content ingest pipeline

**Parent**: chunk C (retrieval & data) — feeds the agent's grounding-content surface (search-first, not filter-first; see [inbox.md](../inbox.md) 2026-04-27 entry on retrieval patterns).

**Status**: Implemented. Snapshot pipeline landed in `product/ingestion/` workspace package; first backfill run produces `data/blog/raw/<UTC-stamp>/`. Plan kept canonical for the design rationale and forward-looking sections.

**Triggered by**: 2026-04-27 conversation — Swoop has a 5-year+ WordPress blog we'd forgotten to scope. Decision: pull it for agent grounding.

---

## Goal

Pull Swoop's blog posts from the WordPress REST API, store as immutable dated snapshots locally, and support cheap incremental refresh going forwards.

---

## Source

- Base: `https://swoop-patagonia.com/blog/wp-json/wp/v2/posts`
- Sanity-checked 2026-04-27:
  - **465 posts**, 5 pages of 100
  - Range: **2010-10-05 → 2026-03-27** (15+ years available, not 5 — see scope note below)
  - API open, no auth required
  - CORS exposes pagination headers (`X-WP-Total`, `X-WP-TotalPages`)
  - No visible rate-limit headers; Cloudflare-fronted (`cf-cache-status: DYNAMIC`)

**Scope**: 5-year rolling window, **filtered at fetch**. Older blog content is genuinely stale (defunct hotels, changed routes, dated voice) and out of scope — we don't retrieve it at all.

- Cutoff = `now() - 5 years`, computed at fetch start. Rolling: each new run uses a fresh cutoff, so older posts age out naturally over time.
- Filter applied via WordPress REST `?after=<cutoff-iso>` on every fetch. Strictly publication-date based — a 2018 post that was edited in 2024 is still 2018-era thinking and stays out.
- Posts in the window: **~108 total** (sanity-checked 2026-04-27 against `?after=2021-04-28`). Two pages of 100. Earliest in-window post is from 2021-05-06.
- Snapshot folders are immutable, but represent a moment-in-time slice of the rolling window. A snapshot read months later may contain posts that have since aged out — the downstream embedding/insert stage should re-apply the 5-year rule for defence in depth.

---

## Storage layout

Files land at **`data/blog/`** in the project root, alongside the existing SQL dump location. Already gitignored under the same `data/` rule Al fixed earlier.

```
data/blog/
  raw/
    <YYYY-MM-DDTHHMMSSZ>/        ← UTC-timestamped run folder, immutable
      manifest.json               ← run metadata (see schema below)
      posts.ndjson                ← one post per line, full API response with _embed
      log.txt                     ← per-page fetch log (timings, retries, errors)
```

**Why this shape:**

- **Immutable dated snapshots** — runs never overwrite. Lets us re-process content without re-fetching, see drift over time, roll back if a run goes wrong.
- **NDJSON over JSON array** — streamable, append-friendly, greppable, easy to slice with `jq`/`sed`, no comma-handling at file boundaries.
- **No separate state file** — incremental runs read `data/blog/raw/<latest>/manifest.json` for the resume point. Single source of truth, no drift between state file and dump.

---

## Manifest schema (per run)

```json
{
  "ingested_at": "2026-04-27T16:42:00Z",
  "mode": "backfill" | "incremental" | "explicit-since",
  "endpoint": "https://swoop-patagonia.com/blog/wp-json/wp/v2/posts",
  "params_used": {
    "per_page": 100,
    "orderby": "modified",
    "order": "asc",
    "_embed": true,
    "after": "<5y-ago-ISO-8601>",
    "modified_after": null | "<ISO-8601>"
  },
  "relevance_cutoff": "<5y-ago-ISO-8601>",
  "pages_fetched": 2,
  "post_count": 108,
  "earliest_published": "2010-10-05T12:43:00",
  "latest_published": "2026-03-27T15:17:14",
  "earliest_modified_seen": "2010-10-05T12:43:00",
  "latest_modified_seen": "2026-03-27T15:24:27",
  "duration_ms": 12450,
  "errors": []
}
```

The two fields that matter for incremental:
- `latest_modified_seen` — the resume floor for the next run.
- `errors[]` — if non-empty, the next incremental run falls back to the prior clean manifest's floor (see "Robustness").

---

## What to capture

**Maximal — `_embed=true`, no field filtering.** The dump captures the entire API response per post (title, content, excerpt, author, featured media, terms, links, embedded resources). Disk is cheap, re-fetching is annoying, and we don't yet know what we'll want.

Per Al's steer: *"lean towards a rich dump so we can analyse and plan; we can always constrain more later."*

---

## Ordering

`orderby=modified&order=asc`:

- **Backfill** walks oldest-modification first (deterministic).
- **Incremental** resumes cleanly via `modified_after=<latest_modified_seen>`.
- **Republished posts surface as updates** without dedup logic — they get a fresh modified-timestamp and reappear in the next incremental run, naturally newer than the prior copy.

`orderby=date` would miss republishes; `orderby=id` would miss the resume property entirely.

---

## Pipeline

### Script location

`product/ingestion/src/blog/fetch.ts` — Node TS, single-file. The `@swoop/ingestion` package is a workspace under `product/` (see `product/CLAUDE.md`); the original plan said `product/ingest/blog/fetch.ts` ahead of the workspace decision, the realised home is the equivalent path inside the workspace package's `src/`.

Vitest suite alongside at `product/ingestion/src/blog/__tests__/fetch.test.ts` covers `parseArgs`, `computeRelevanceCutoff`, `buildPostsUrl`, `toFolderStamp`, `fetchPageWithRetry` (success / 5xx-retry / 429 / 4xx / network-error / retries-exhausted), `ManifestSchema`, `readPriorFloor`, and the `run()` orchestrator end-to-end with mocked fetcher (backfill, incremental, partial-failure, malformed-post, dry-run, 5y cutoff non-negotiable across modes).

### Dependencies

- Built-in `fetch` (Node 20+) — no third-party HTTP client for v1.
- `tsx` for execution. Already in repo dev-dependencies.
- No HTML processing in this stage — that's deferred to a post-dump pass.

### CLI shape

```bash
# All commands run from product/. Direct npm scripts on the workspace:

# Incremental — reads modified_after from latest manifest, pulls deltas only
npm --workspace @swoop/ingestion run blog:fetch

# Full backfill — ignores state, walks everything
npm --workspace @swoop/ingestion run blog:fetch:backfill

# Dry-run — fetch headers + first page only, log what would happen
npm --workspace @swoop/ingestion run blog:fetch:dry-run

# Explicit floor — useful for catch-up after manifest corruption (no npm alias; direct invocation)
cd ingestion && npx tsx src/blog/fetch.ts --since=2024-01-01
```

The three named scripts (`blog:fetch`, `blog:fetch:backfill`, `blog:fetch:dry-run`) are wired in `product/ingestion/package.json`. Output paths live under the repo root's gitignored `data/blog/raw/<UTC-stamp>/`, two levels above the workspace; the script resolves the repo root via `.git`/`.gitignore` marker walk.

### Algorithm

1. **Compute relevance cutoff**: `now() - 5 years` as ISO-8601. Becomes the value of `after` on every request, regardless of mode. Strict, non-negotiable — older posts are never fetched.
2. **Determine `modified_after`:**
   - `--backfill`: null (so any post within the 5y window is returned)
   - `--since=X`: X
   - default (incremental): read `data/blog/raw/<latest>/manifest.json#latest_modified_seen`. If no prior run exists, fall through to backfill behaviour with a console warning.
3. **Create run folder** at `data/blog/raw/<utc-iso-stamp>/`.
4. **Fetch page 1** to read `X-WP-TotalPages` and `X-WP-Total` headers.
5. **Loop pages 1..N:**
   - GET `?per_page=100&orderby=modified&order=asc&_embed=true&page=N&after=<cutoff>&modified_after=<X>`
   - Stream each post to `posts.ndjson` (append).
   - Track running min/max of `date` + `modified`.
   - Per-page retry with exponential backoff (1s, 4s, 16s) on 5xx + network errors — 3 attempts, then mark page as errored and continue.
6. **Write `manifest.json`** (including `relevance_cutoff`).
7. **Log totals.**

**Note on `after` + `modified_after` together**: WP REST ANDs them. Backfill (`modified_after=null`) returns all in-window posts. Incremental returns posts in-window AND modified since last run — catches edits to posts published within the window, doesn't pull in pre-window posts that were edited recently (a 2018 post edited last week stays out).

### Robustness

- **5xx / network**: per-page exponential backoff (3 tries).
- **429 rate-limit**: honour `Retry-After` if present; otherwise sleep 30s and retry once.
- **Partial run**: leave the run folder in place; mark `errors[]` in manifest with the page numbers that failed. Subsequent incremental runs detect a non-empty `errors[]` and fall back to the prior clean manifest's `latest_modified_seen`. Operator can re-run `--backfill` to fully refresh if a partial drift is concerning.
- **Schema drift**: if a page response shape diverges (e.g. missing `modified` field), log a warning and skip the malformed entry, recording in `errors[]`.

### Verification on each run

- Post count matches `X-WP-Total` (within ±1 for race conditions during the fetch window).
- Every NDJSON line parses as JSON.
- No duplicate `id` values within the file.
- `latest_modified_seen >= earliest_modified_seen`.

---

## Refresh cadence

- **Now → M4**: manual via `npm run blog:fetch`. Run when we want fresh data.
- **Steady-state (post-M4)**: weekly cron / Cloud Run Job. Volumes are small enough that even daily would be fine; weekly is the sane default for a low-publish-rate blog.

---

## Out of scope (deferred until after first dump lands)

We're explicitly *only* fetching and storing in this task. The following come later, gated on inspecting the actual data:

- HTML cleaning / markdown conversion
- Chunking strategy
- Embedding (model + chunk shape)
- Insertion into derived store (Postgres+pgvector vs DuckDB — see C.18, pending re-decision)
- Image mirroring / CDN-prefix verification
- Comments ingestion — **explicitly never** (PII boundary, separate endpoint we don't call)
- HTML shortcode resolution / iframe extraction
- Auto-tagging / supplemental metadata enrichment

These each become their own Tier 3 exec plan once the data is in hand.

---

## Volumes

- ~108 posts in the 5y window × ~20–50 KB each with `_embed` = ~2–5 MB raw NDJSON.
- Backfill: <10 seconds end-to-end.
- Incremental: typically 0–5 posts; <2 seconds.
- Window shrinks/grows ±2–3 posts each ingest as the rolling cutoff moves.

---

## Verification checklist (when implemented)

- [ ] `data/blog/` is gitignored — nothing stains the worktree.
- [ ] Initial `--backfill` produces a run folder with ~108 posts in `posts.ndjson` (within the 5y window only).
- [ ] No post in the dump has a `date` older than the relevance cutoff.
- [ ] `manifest.json` accurately reflects the run, including `relevance_cutoff`.
- [ ] Re-running `--backfill` creates a fresh dated folder; doesn't overwrite the prior.
- [ ] Incremental run with no new posts: empty `posts.ndjson`, valid manifest with `post_count: 0`.
- [ ] Incremental run after an edit on a known post: returns that post.
- [ ] Network simulation (kill connection mid-run): partial run flagged in `errors[]`; next incremental falls back to prior floor.

---

## Open questions for the post-dump analysis pass

(Not blockers for this plan — these get answered by inspecting the dump once it's local.)

- **Image URL patterns**: imgix-style like the operational site, direct WP media URLs, or both? Determines whether the existing imgix-prefix rule from the SQL ontology applies.
- **Author surface**: how many distinct authors? Bio fields populated and useful?
- **Category / tag taxonomy**: rich enough for filter-narrowing, or noisy?
- **Content quality**: HTML cleanliness, shortcode density, embed prevalence. Affects parsing complexity downstream.
- **Duplicates / placeholder posts** / "category landing" pages masquerading as posts.
- **Length distribution**: typical word count, longest, shortest. Drives chunking strategy.
- **Featured-image presence rate**: do we get a hero image for every post?
- **Evergreen vs dated/news ratio**: shapes how aggressively the agent should bias to recency.
- **Slug patterns**: noted some posts have `<id>-<slug>` (older), some clean (newer). Suggests a slug migration somewhere — worth confirming the canonical URL we'd build for citations.

---

## Suggested follow-on tasks

Once the dump lands, three obvious next steps:

1. **Analysis pass** — read 50 posts at random + summary stats, decide chunking + content shape. Output: a one-page "blog content shape" addendum to `data-ontology.md`.
2. **Cleaning pipeline** (`product/ingest/blog/clean.ts`) — HTML → markdown, strip theme chrome, preserve heading hierarchy + image alt/captions.
3. **Embedding + insert** — depends on derived-store decision (C.18). Cheapest path: chunk on `<h2>`/`<h3>`, embed with Voyage-3, store with parent post link.

Each of these gets its own Tier 3 exec plan after the analysis pass.
