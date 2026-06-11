# Prompt-version rollback — reverting a bad prompt revision

Brief operator runbook for reverting an ETL prompt change that produced bad outputs without re-running the whole pipeline.

---

## Why this exists

Each ETL classifier and the image-annotation pipeline live under `product/cms/prompts/etl/<prompt-name>/` with a frontmatter `version` field. Bumping the version invalidates every row's `content_hash` for that prompt, forcing re-classification on the next run.

If you ship a bad prompt revision (`version: 2 → 3` produced worse outputs than `version: 2`), the rollback discipline prevents two failure modes:

- Burning through budget re-running the corpus on every revision.
- Losing the cleaner prior-version outputs to a faulty new revision.

The mechanism is per-prompt-version checkpoint namespacing: each prompt version's output gets stored against that version's content hash, so old outputs don't get overwritten until a new run actually completes for them.

---

## What you'll do

1. Identify the bad prompt-version bump.
2. Revert the prompt file (frontmatter `version` and prompt body) to the prior known-good revision.
3. Re-run the pipeline; the checkpoint is content-hash-keyed, so rows reverted to the prior version skip if they have a stored output for that version, or re-run if they don't.

Time-box: a few minutes for the revert + re-run trigger; same wall-clock as a normal pipeline run for the re-classification.

---

## Step 1 — Identify the bad version

Look at git for the most recent change to the affected prompt:

```bash
git log --oneline -10 product/cms/prompts/etl/<prompt-name>/
```

The bad bump is the most recent commit that changed the frontmatter `version`. Note the prior `version` value (e.g. `2`) and the prior file content.

---

## Step 2 — Revert the prompt file

```bash
git checkout <prior-good-commit> -- product/cms/prompts/etl/<prompt-name>/
```

Or hand-edit the file: set `version` back to the prior value, restore the prompt body to the prior text. Commit the revert with a clear message:

```
fix(cms): revert <prompt-name> to version N — version N+1 produced bad outputs
```

You'll know the revert is right when:
- `git diff` against the prior good commit is empty for that prompt.
- The frontmatter `version` matches what was in production before the bad bump.

---

## Step 3 — Re-run the pipeline

For embedding-rerun classifiers:

```bash
npm run enrich --workspace @swoop/ingestion -- --mode=classify --source=<prompt-name>
```

For image annotation:

```bash
npm run annotate-images --workspace @swoop/ingestion -- --max-budget=N
```

The runner reads the prompt's current `version` and computes the content hash. Rows whose checkpoint already has output for that hash skip without spending. Rows that only have output for the bad version (because they were re-run between the bad bump and the revert) re-classify.

If the corpus had been fully re-classified under the bad version, the revert path is the same as a normal re-run — every row re-classifies under the prior version's prompt. The cost is one full pass.

If the corpus was only partly re-classified under the bad version, only that subset re-classifies; the rest skip via checkpoint hit.

---

## When NOT to use this

- **Trivial typo fixes**. Don't bump prompt versions for typos in comments or whitespace; just edit the file. The version bump is for *material output changes*.
- **Prompt experiments not yet shipped**. If you're iterating in a branch and haven't merged, just keep editing — no bumps, no rollbacks needed.
- **Bad data, not bad prompt**. If the prompt is fine but a row's output is wrong, the issue is content-side (the source row didn't carry what the prompt assumed). Don't roll back the prompt; flag the row.

---

## Open items for Al

1. **Per-version output retention**. Today the checkpoint stores the latest output per row per version-hash. If we ever want to A/B compare across prompt versions, the checkpoint shape would need to retain prior-version outputs alongside. Tier 3 task if needed.
2. **Automated quality regression check**. A run that bumps a prompt version and produces noticeably different outputs (sentiment shift, tag-array length distribution) could surface a soft warning at run time. Out of scope for M1.

---

## Where the rules came from

- HITL Q6 (2026-05-01) — yes, brief; per-prompt-version checkpoint namespace.
- Decision **C.40** — image annotation prompt versioning lives under `product/cms/prompts/etl/image-annotation/` (the C.t6 prompt fold).
- `embedding-rerun.md` "Prompt versioning" — the cost discipline for version bumps.
