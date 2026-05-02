# Image annotation prompt — operator guide

This folder holds the runtime prompt for the C.t6 image annotation
pipeline. The pipeline lives at
`product/ingestion/src/images/`.

## What's here

- `prompt.md` — the prompt fed to Claude Vision per image. Loaded at
  runtime by `prompt.ts`. Authored top-down: names the journey moments,
  describes which signals matter, gives 5 worked examples covering the
  range (W-trek hero, penguin colony, glacier kayak, refugio interior,
  gravel-road steppe).
- `README.md` — this file.

## How the pipeline uses it

`product/ingestion/src/images/prompt.ts` reads `prompt.md` once at
startup, plus the image's imgix-prefixed URL (built via the existing
`image.canonical_url` already populated by C.t3). Both go into a single
Claude Vision call with structured-output formatting so the model
returns a JSON object `{description, annotation}`. The output is
validated against `output-schema.ts` (Zod). Anything that doesn't parse
fails closed and is written to the checkpoint as `failed`.

## Iteration workflow

1. Edit `prompt.md` — add a worked example, tune the avoidance list,
   adjust the "what to anchor on" guidance.
2. Run a slice against fresh images: `npm --workspace @swoop/ingestion
   run annotate-images -- --dry-run` to confirm the candidate count is
   what you expect, then `--max-budget=5 --limit=20` to spend ~$0.10
   on a 20-image slice.
3. Read sample rows: `psql $DATABASE_URL -c "SELECT id, description,
   annotation FROM image WHERE annotation IS NOT NULL ORDER BY
   modified_at DESC LIMIT 20;"`. Check both columns. Voice-check the
   description against `cms/prompts/system/10_style-avoid.md` — em-dash
   rhythm, AI-signature verbs, empty affirmations, all to be absent.
4. If it's not landing, edit `prompt.md`, then re-run on a *different*
   slice (say `--limit=20 --offset=20` if we add that flag) so you're
   not voice-checking the same images twice.
5. Once a slice lands cleanly, run unbounded with `--max-budget=N` set
   to your remaining budget. The 6.7K-image full-catalogue run is
   estimated at ~$30 (~£25) on the per-call rates we have today.

## Reading the cost estimator output

`--dry-run` writes a summary to stdout:

```
[annotate] candidates: 6,732 (description IS NULL OR TRIM(description) = '')
[annotate] estimated cost (live API): $33.66 USD
[annotate] estimated cost (Batches API, 50% discount): $16.83 USD
[annotate] re-run with --max-budget=$N to proceed (Batches mode is the default).
```

If the estimator's number is higher than your budget, slice with
`--limit=N` (or future `--tag=region:torres-del-paine` once we add tag
filters) to bound the run.

## Voice-check anchors

- `cms/prompts/system/00_why.md` — the agent voice the description prose
  should align with.
- `cms/prompts/system/10_style-avoid.md` — the avoidance list. Annotation
  prose lives in tool outputs that ultimately get woven by Sonnet — drift
  here drifts the agent.

## What NOT to iterate on this way

- **The output schema** (`description` + `annotation` keys, both required
  strings). That's set by HITL Q1 ratification (2026-05-01) and lives in
  `product/ingestion/src/images/output-schema.ts`. Changing it is a
  schema migration, not a prompt edit.
- **The candidate filter** (`description IS NULL OR TRIM(description) =
  ''`). Idempotency lives there. Don't move it into the prompt.
- **The cost cap mechanism**. Lives in `cost.ts` + the CLI; not here.
