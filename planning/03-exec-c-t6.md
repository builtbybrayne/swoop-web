# 03 — Execution: C.t6 Image annotation pipeline (Claude Vision)

**Status**: **DRAFT — for HITL review. Not yet executable.**
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t6** task ("Image annotation pipeline"). Operationalises decision C.10 (image annotation pipeline) and §2.7 (image annotation pipeline as a parallel workstream from day one). Cost shape revised by the 2026-04-29 discovery that `image.description` is already 47.5% populated upstream — the pipeline runs only over the ~6.3K images without a usable upstream description, not the full 13.3K catalogue.
**Depends on**: C.t2 closed (entity model — `image` table has `description` / `alt_text` / `tags` / `embedding` columns); C.t3 (SQL-dump → Postgres ETL — `image` table populated with filenames + upstream `description` where present); C.t5 (image URL utility — pipeline calls `imgixUrl` for any per-call rendering during inspection runs). C.t6 can start once C.t3 has loaded the `image` table; doesn't strictly need C.t3a embedding pass to have run.
**Blocks**: nothing on the critical path. C.t4's `illustrate` tool ships against whatever annotations exist — partial coverage is acceptable for M1 demos; full coverage is required before production traffic.
**Produces**:
- `product/ingestion/src/images/` — new sub-tree for the annotation job (parallel to existing `product/ingestion/src/blog/`):
  - `annotate.ts` — main entry point. Reads candidates from Postgres `image` table, calls Claude Vision per candidate, writes back annotations.
  - `prompt.ts` — the annotation prompt(s); one per call shape (single-image, batch).
  - `cost.ts` — pre-flight estimator (counts candidates, multiplies against per-call cost, dry-runs without spend).
  - `checkpoint.ts` — resumable-run state (which images are done, which failed, which retry).
  - `__tests__/annotate.test.ts` + `prompt.test.ts` — unit-level coverage; vision API itself is mocked.
- `product/cms/prompts/etl/image-annotation/prompt.md` — the runtime annotation prompt (per G.11; CMS owns prose).
- `product/cms/prompts/etl/image-annotation/README.md` — what's in this folder, how to iterate.
- A small CLI surface (`npm --workspace @swoop/ingestion run annotate-images -- [--dry-run | --max-budget=N | --tag=X | --resume]`) — runbook target for C.t8.
- Decision-log entries (`planning/decisions.md`) — likely C.37 (annotation prompt shape: journey-shaped, not literal description), C.38 (write-back column choice: `image.description` vs derived `image_annotation`), C.39 (cost-cap mechanism), and C.40 (mapping to job-shaped derived rows: are annotations a primary signal for `inspire_passage.illustration_image_id`?).
**Estimate**: ~1 day setup + unattended runtime. Cost estimate (Phase 0): ~£30–£150 one-time at ~$0.005/image × ~6.3K images = ~$30 (~£25); leaving headroom for prompt iteration runs.

---

## ★ Read this first — calibration before code

> **Before you author the prompt, the schema, or the runner, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"★ Read this first — the WHY of chunk C" end-to-end.** This task is a workstream in chunk C; the same calibration applies.

The compressed reminder for C.t6 specifically:

- **The annotations exist to serve the Inspire job (and secondarily the Illustrate utility).** When the agent says *"the W trek climbs into a granite amphitheatre that you can hear humming with wind from a kilometre off"*, the visual that pairs with that prose is what tips Awareness → Interest. An annotated image with a journey-shaped description (mood, scale, conditions, what the camera is looking at) feeds directly into `find_inspiring`'s output and `illustrate`'s mood-matching. A literal-description annotation (*"image of a mountain"*) does not.
- **The bottom-up trap here**: *"Run Claude Vision over every image, write whatever it returns to `image.description`, done."* Wrong direction. The annotation prompt is a content-shaped artefact. It encodes which signals are journey-relevant for Patagonia: scale, mood, time-of-day, weather, named landmarks, presence/absence of people, activity, season cue. **The prompt is what makes annotations useful. The pipeline plumbing is the cheap part.**
- **The other bottom-up trap**: treating this as a "generate alt text" job. Alt text is one *output* of annotation, not its purpose. The same pass produces a description, mood tags, region tags, activity tags, subject tags — all of which feed retrieval (`find_inspiring` filters by mood; `illustrate` matches by region; `lookup` may want a "show me what this looks like" affordance). Designing the prompt around alt-text alone leaves four other signals on the floor.
- **The annotations are derived data** (theme 5, decision C.12). They're regenerable from images + prompt + model; the pipeline writes them back to columns; a prompt revision triggers a re-run. Idempotency, dry-runs, partial-rerun-by-tag are all first-class.

Anti-pattern signals to push back on, hard:

- *"The vision model knows what's in the image; let it write what it sees."* — That's literal-description thinking. The prompt has to *direct* the model toward journey-relevant signals, not let it default to *"a wide shot of mountains"*.
- *"We have 13K images; let's annotate them all."* — 6.3K of those 13K already have a usable upstream `image.description` (per the 2026-04-29 discovery). Annotating images that already have descriptions wastes spend and risks regressing the upstream curated-by-a-human label. The pipeline only annotates where `image.description IS NULL OR image.description = ''`.
- *"More tags is better."* — More tags is noisier. The retrieval surface can't distinguish a 12-tag image from a 4-tag image; it just gets longer arrays. Prompt should ask for the load-bearing signals, not maximise length.

---

## Purpose

C.t6 makes ~6.3K Patagonia images *retrievable by mood, region, subject, and activity* — not just by filename or surrounding-page-context. This unlocks `illustrate`'s ability to return a *granite-amphitheatre-at-golden-hour* image when the agent's prose is about the W trek, instead of a generically-tagged file from the same page.

The pipeline runs as a one-shot job (re-runnable on demand) over candidate images. For each image it produces:

- A short journey-shaped description (1–2 sentences; the prose intent is "what's the visitor seeing and feeling here?", not "list the contents of this image").
- A short alt text (~10–15 words; accessibility-shaped, more literal than the description, but still attentive to what's primary).
- Subject tags (mountain / glacier / lake / forest / fjord / ice / wildlife / lodge / boat / hiker / camp / road).
- Mood tags (serene / dramatic / golden-hour / overcast / stormy / vast / intimate / vibrant / muted).
- Region tags (Torres del Paine / El Chaltén / Perito Moreno / Cape Horn / Antarctic Peninsula / Patagonian Lakes / [other named] / unspecified).
- Activity tags (hiking / kayaking / horseriding / photography / lodge-stay / cruising / glacier-walk / wildlife-watching).

The annotations land in columns on the `image` derived table (per C.t2's schema), queryable inline by retrieval primitives (no JOIN tax).

---

## Out of scope

- **No re-annotation of upstream-described images** at first run. The 6.3K-image scope filter is `WHERE description IS NULL OR description = ''`. A future re-run could re-annotate everything for consistency once the prompt is mature; not a C.t6 concern.
- **No image embeddings**. The `image.embedding` column is populated by C.t3a (the embedding pass), not by C.t6. Annotations are *inputs* to embedding (the embedded text is `description + tags`).
- **No upstream image fetching**. Files are already on imgix; this pipeline just calls Claude Vision against the imgix URL.
- **No file format conversion**. Imgix handles render variants; annotations work off whatever variant the prompt specifies (probably a 1024×wide hero crop).
- **No annotation of new images post-launch**. Steady-state cadence is C.t8's runbook concern: "when Swoop's source dump adds new images, re-run with `--resume`".
- **No automated mapping to journey moments**. Whether the annotation pipeline directly populates `inspire_passage.illustration_image_id` is open question 4 below; default stance is "no — the chunking pass picks images via vector similarity over `image.embedding` post-C.t3a, not via direct ETL link".

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — §"★ Read this first", §2.7 (image annotation pipeline), §2.6 (image rendering and URL construction).
- [`decisions.md`](decisions.md) — C.10 (image annotation pipeline), C.12 (derived-datasource), C.15 (URL + image construction), C.16 (page-as-hub).
- [`discoveries.md`](../discoveries.md) — 2026-04-29 entries on the two-table image model (`image` ↔ `file`), `image.description` 47.5% population, imgix transformation pattern.
- `product/connector/migrations/002_domain_tables.sql` — the `image` table column shapes (description / alt_text / tags / embedding / mood_tags / region_tags / subject_tags).
- `product/ts-common/src/derived.ts` — `DerivedImageSchema` for the joined-image record returned by tools.
- `product/cms/prompts/system/00_why.md` — the agent's voice anchor; annotation prose shouldn't fight it.
- `product/cms/prompts/system/10_style-avoid.md` — the anti-tells list; annotation prose stays out of em-dash rhythm and AI-signature verbs.
- `chatgpt_poc/product/scripts/build-image-catalogue.ts` — PoC's reference shape for image processing (treat as wireframe; the actual implementation is greenfield against Postgres + Claude Vision, not local file I/O).

---

## Outputs (files to write/modify, with paths)

### Ingestion workspace

`product/ingestion/src/images/` — new directory:

| File | Purpose |
|---|---|
| `annotate.ts` | CLI entry point. Reads candidates, calls Vision, writes back. Handles `--dry-run`, `--max-budget`, `--tag`, `--resume` flags. |
| `prompt.ts` | Loads `cms/prompts/etl/image-annotation/prompt.md`, composes the per-image vision request payload (image URL + system prompt + structured-output schema). |
| `vision-client.ts` | Thin wrapper over Anthropic SDK's vision call. Exponential-backoff retry on 429/5xx. |
| `cost.ts` | Pre-flight estimator. Counts candidates, multiplies by per-call cost constant, returns a budget summary. Dry-run path lives here too. |
| `checkpoint.ts` | Resumable-run state. Writes `data/image-annotations/checkpoint.json` (ignored by git) tracking image-id → status (`pending` / `done` / `failed`). |
| `output-schema.ts` | Zod schema for the structured annotation output the prompt asks the model to return. |
| `__tests__/annotate.test.ts` | Unit-level coverage of the runner. Vision API mocked; checkpoint round-trips. |
| `__tests__/prompt.test.ts` | Snapshot-tests the rendered prompt; catches accidental edits to the prompt file. |
| `__tests__/cost.test.ts` | Verifies the dry-run path doesn't call the model. |
| `package.json` script | `"annotate-images": "tsx src/images/annotate.ts"` (or whichever runner — verify against `@swoop/ingestion`'s existing convention from the blog ingest task). |

### CMS

`product/cms/prompts/etl/image-annotation/`:

| File | Purpose |
|---|---|
| `prompt.md` | The runtime annotation prompt. Authored top-down: names the journey moments, describes which signals matter, gives 3–5 worked examples (annotation A: this image is W-trek granite at golden hour, here's how I'd describe it; annotation B: this image is a Magellanic penguin colony, here's how; etc.). 1–2 KB; ships on day one with placeholder examples that get refined as Al reviews real output. |
| `README.md` | Operator note: how to iterate the prompt, how to trigger a partial-rerun for prompt-comparison testing, how to read the cost estimator output. |

### Decision log

`planning/decisions.md` — likely four entries:

- **C.37** — Annotation prompt shape. Journey-shaped (mood + scale + named landmarks + presence-of-people + time-of-day + activity-cue), not literal-description. Records the worked-examples-in-prompt approach and the rationale (literal descriptions don't differentiate Patagonia images for retrieval; journey-shaped descriptions do).
- **C.38** — Write-back column choice. Recommendation: write to `image.description` directly when no upstream description exists; write `alt_text`, `tags`, `mood_tags`, `region_tags`, `subject_tags` always (those columns are net-new from C.t2 — not contested by upstream). If we need to distinguish "human-written upstream" from "AI-generated", add a `description_source` enum column at C.t2-addendum time. Records the call.
- **C.39** — Cost-cap mechanism. Recommendation: `--dry-run` reports candidates + estimated cost + writes a per-run plan file; `--max-budget=N` halts the run if the projected spend exceeds N (USD). No magic auto-stop on partial completion; the operator confirms before re-running unbounded. Records the call + the chosen N for first-run.
- **C.40** — Mapping annotations to job-shaped derived rows. Recommendation: **annotations don't directly populate** `inspire_passage.illustration_image_id` etc. C.t3a's embedding pass embeds `description + tags` into `image.embedding`; the chunking pass picks an image per chunk via vector similarity over `inspire_passage.text` ⟷ `image.embedding`. Records the call, scope-fences C.t6 to "annotations only", and points at C.t3a for the linkage.

---

## Architectural principles applied here

- **Annotations are derived data**. The pipeline is regenerable from images + prompt + model. Re-running is cheap if cheap (`--resume`); a prompt revision triggers a partial-rerun (use `--tag=region:torres-del-paine` to test on a slice). The output never becomes "the source of truth"; the source is the image + the prompt + the model.
- **One LLM call per image, batched only if API supports it**. Anthropic's vision endpoint is currently per-call. Batching is not load-bearing; concurrency is (run 5–10 calls in parallel via a small `Promise.all` worker pool with rate-limit awareness).
- **Pre-flight cost gate is non-optional**. Operator can never trigger an unbounded run. `--dry-run` is the default if no `--max-budget` is supplied, with a clear message: *"projected spend $X over Y candidates; re-run with --max-budget=$Z to proceed".*
- **Idempotency via the candidate filter**. Running twice doesn't re-annotate done images. `WHERE description IS NULL OR description = ''` (plus optional checkpoint filter) gives natural idempotency.
- **The prompt lives in CMS, not in code** (G.11). Iteration is content work; the operator (probably Al at first, then Swoop's ops team post-handover per C.t8) can edit `prompt.md` and re-run.
- **Voice consistency**. Annotation `description` text feeds tool outputs and ultimately ends up in agent prose. Style-avoid list applies. The prompt explicitly forbids the AI tells (em-dash rhythm, *"delve"* / *"unpack"*, *"a serene scene of..."*).

---

## Components, file paths

| Component | Path | Existing or new |
|---|---|---|
| Runner | `product/ingestion/src/images/annotate.ts` | New |
| Vision client | `product/ingestion/src/images/vision-client.ts` | New |
| Prompt loader | `product/ingestion/src/images/prompt.ts` | New |
| Cost estimator | `product/ingestion/src/images/cost.ts` | New |
| Checkpoint state | `product/ingestion/src/images/checkpoint.ts` | New |
| Output schema | `product/ingestion/src/images/output-schema.ts` | New |
| Tests | `product/ingestion/src/images/__tests__/*.test.ts` | New |
| Prompt content | `product/cms/prompts/etl/image-annotation/prompt.md` | New |
| Prompt README | `product/cms/prompts/etl/image-annotation/README.md` | New |
| Checkpoint storage | `product/ingestion/data/image-annotations/checkpoint.json` | New, gitignored |
| Schema (read-only here) | `product/connector/migrations/002_domain_tables.sql` | Existing |
| Helper utilities | `@swoop/common` `imgixUrl`, `canonicalUrl` | C.t5 — must be in place first |

The pipeline runs as a Cloud Run Job in production; locally it runs via `npm --workspace @swoop/ingestion run annotate-images -- ...`. The `@swoop/connector` package is touched only via the shared Postgres connection pool — and even that is reusable from `@swoop/connector` (see C.t1) or freshly opened by the ingestion script (lower coupling, recommended for one-shot jobs).

---

## Verification

Task is done when:

1. `cd product && npm run typecheck` is green across the workspace.
2. `cd product && npm run lint` is green.
3. `cd product && npm test --workspace @swoop/ingestion` passes — the annotate runner round-trips a fixture image through a mocked Vision client and produces a schema-valid annotation; `--dry-run` does not invoke the mock; checkpoint resume picks up at the recorded last-id.
4. `npm --workspace @swoop/ingestion run annotate-images -- --dry-run` against a populated `image` table reports a candidate count + projected cost + does not invoke Claude Vision.
5. A first real run with a small `--tag` slice (e.g. `--tag=region:torres-del-paine` or `--limit=20`) produces 20 annotations against real Vision, written back to `image.description` / `image.alt_text` / `image.subject_tags` / `image.mood_tags` / `image.region_tags` / `image.tags`. Sample annotations land Al's voice-check (rough first-pass acceptable; iteration on the prompt is expected before full run).
6. A second `--tag` slice with `--resume` skips the already-annotated images and only annotates new ones.
7. `product/cms/prompts/etl/image-annotation/prompt.md` exists, is loaded at runtime, and a snapshot-test in `prompt.test.ts` catches drift.
8. `planning/decisions.md` has C.37–C.40 entries (or whatever is closed at execution time).
9. Execution log appended to this Tier 3 plan.

For the **full-catalogue run** (a separate operational step, not a code-task verification): cost projection ≤ £150, run completes without rate-limit errors, no annotations missing for active retrieval-relevant images.

---

## Open questions for execution time

Numbered for tracking. Items 1 + 2 are content-shaped (Al's calls); 3 + 4 are operational.

1. **Annotation prompt: what's a journey-shaped description?** This is the load-bearing call. Candidates:
   - **Anchor on the visitor's gaze**: *"What's the visitor seeing? What's the feeling? What's the scale? What's the time of day? Are there people in this, and what are they doing?"* — directs the model to journey-relevant signals.
   - **Anchor on retrieval queries**: *"Imagine the agent saying X about Patagonia and reaching for an image. What X would this image illustrate?"* — directs the model to retrieval-shaped output.
   - **Mix of both, with worked examples**: 3–5 example annotations in the prompt covering the range (W-trek hero, penguin colony, lodge interior, glacier, road-with-vehicle). Recommended.

   Anti-pattern guard: explicit DON'T list in the prompt — *"don't write 'an image of', 'a beautiful', 'a serene'; don't list contents; don't use em-dashes for rhythm; don't describe what's NOT in the image"*.

   Recommendation: third candidate. Author the prompt with placeholder examples, run a 20-image slice, Al reviews, refine, run again, then full.

2. **Where do annotations land?** Candidates:
   - **Direct write-back to `image.description`** when null. Net-new columns (`alt_text`, `mood_tags`, `region_tags`, `subject_tags`, `tags`) always written. Recommended (per C.38).
   - **Derived `image_annotation` table**, never touch `image.description`. Cleaner provenance, but adds a JOIN tax to every retrieval primitive that wants the description. Not recommended at our scale.
   - **`image.description` plus a `description_source` enum** (`upstream` / `ai_generated`). Recommended **only if** Swoop ops will care about distinguishing later. C.t2 didn't add this column; would be a small migration if added now. Decide at C.37/C.38 closure.

3. **Cost cap mechanism**. Candidates:
   - **`--dry-run` default; `--max-budget=N` required to spend**. Recommended.
   - **Soft cap with a `--confirm` interactive prompt**. Adds CI friction; not needed.
   - **No cap; let it run**. Risk of accidental £150 burn from a typo'd `--all`. Not recommended.

   Recommendation: first option. C.39 records the chosen N for first-run (probably $25 — enough for ~5K calls — leaving headroom).

4. **Map to journey moments: does this populate `inspire_passage.illustration_image_id`?** Candidates:
   - **No — C.t3a's embedding pass picks images via vector similarity** (`inspire_passage.text` ⟷ `image.embedding`). Recommended (per C.40). Decouples annotation work from chunking work; annotations stay reusable across all five derived tables.
   - **Yes — C.t6 directly assigns** the best-matching image per derived row at annotation time. Tighter coupling; annotation pipeline now needs to know about derived-row content; revisit if vector-similarity matching produces poor pairings.

   Recommendation: first option. Decouple. Revisit only if Phase 0 vector-similarity image pairing is meaningfully worse than expected.

5. **Concurrency / rate-limit**. Anthropic's per-API-key limits set the ceiling. Recommended starting point: 5 concurrent calls; back off to 1 on first 429; re-ramp slowly. Refine at execution time based on actual rate-limit headers.

6. **Output structure: free text or structured?** Claude Vision can return JSON if the prompt asks for it. Strongly recommended: ask for JSON matching `output-schema.ts`. Robust against prose drift, validates cleanly, easy to write back per-column.

---

## Risks

- **Prompt produces literal-description annotations on first pass**, leaving retrieval no better than filename. Mitigation: 20-image slice + Al voice-check before full run. Iterate the prompt; re-run the slice; only run unbounded once first 20 land cleanly.
- **Annotations regress upstream `image.description` quality**. The 6.3K candidates filter excludes already-described images, but if the filter has a bug (e.g. treats whitespace-only descriptions as populated), AI output overwrites curated text. Mitigation: filter is `WHERE description IS NULL OR TRIM(description) = ''`; explicit log line per write reporting "would overwrite" if filter doesn't match.
- **Cost overrun**. Mitigation: dry-run default, max-budget required, per-tag/per-limit slicing as a habit. C.39 records the cap.
- **Vision model rejects an image** (CSAM-style false positive on a legitimate Patagonia hiker, or rate-limit cluster). Mitigation: `failed` state in checkpoint with the error reason; resume skips them; operator reviews failures separately.
- **Imgix URL composition wrong** — pipeline calls Vision against a 404 URL. Mitigation: re-use C.t5's `imgixUrl` helper; one upstream test that the URL is reachable in the dry-run summary.
- **Prompt iteration churn writes intermediate annotations to prod**. Mitigation: per-prompt-version checkpoint namespace (e.g. `data/image-annotations/v2/checkpoint.json`); production write only after operator confirms a version is final. Detail can be sketched at execution time.
- **Annotations encode a brand-voice misalignment** that bleeds into agent output. Mitigation: prompt explicitly references `cms/prompts/system/10_style-avoid.md`; sample-review by Al on first-run output before unbounded runs.

---

## Coordination

- **C.t5** — image URL utility must be in place before C.t6 starts. The pipeline calls `imgixUrl` per candidate.
- **C.t3** — `image` table populated with filenames + upstream `description` is a precondition. C.t6's candidate filter assumes `image.description` reflects upstream truth.
- **C.t3a** — embedding pass runs after C.t6 (or concurrently, per-image). The `image.embedding` column is computed from `description + tags`; if annotation lands first, embeddings are higher-quality. If annotation lands second, embeddings need re-running for the newly-annotated rows.
- **C.t4** — `illustrate` tool consumes the annotation columns directly. No tight coupling; whatever's there is what gets returned. Partial-coverage `illustrate` is acceptable for M1 demos.
- **C.t8** — runbook section on "running the annotation pipeline" pulls from this brief.

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*
