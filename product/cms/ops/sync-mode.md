# Sync enrich mode — dev iteration escape hatch

Operator runbook entry for the `--sync` flag on the `enrich` CLI. Open this when you're iterating on a classifier prompt, schema, or end-to-end flow and don't want to wait up to 24 hours for Anthropic Batches.

---

## Why this exists

Per decision **C.47** (the carve-out from HITL Q4, ratified 2026-05-12), the enrich CLI supports a `--sync` flag that routes classifier passes through Anthropic's synchronous `messages.create` API instead of the Batches API. Production runs continue to default to Batches and the 50% cost discount; this mode is for the dev inner loop.

The latency floor on the batch path is up to 24 hours per submitted batch (typically much faster, but the SLA is the SLA). Three concrete situations where waiting that long is pathological:

- *"I tweaked the persona-summary prompt; did it work?"* — sync, 30 seconds, iterate.
- *"Is the new classifier schema actually passing validation against real prose?"* — sync, run a small `--limit` smoke, see the result.
- *"Is the cost ledger accurate against full-rate spend?"* — sync, get the actual ledger entries reflecting full rate.

---

## When to use it

Use `--sync` when:

- Iterating on a classifier prompt (`product/cms/prompts/etl/<classifier>/prompt.md`).
- Verifying a Zod schema change end-to-end.
- Running an `--limit=N` smoke against the real APIs without waiting up to 24 h.
- Smoke-testing a `--mode=all` end-to-end after a non-trivial change to `run.ts`, the ledger, or a compose step.

**Do NOT use it for**:

- Production-scale runs of the full corpus. Use the default batch path — it costs half as much and the wall-clock is acceptable for a daily / weekly cadence.
- Anything you'd be embarrassed to charge twice for. (Sync runs cost 2× the batch rate. Full Puma corpus sync is ~£1–£2.)

---

## Usage

From `product/`:

```bash
npm run -w @swoop/ingestion enrich -- --mode=all --sync --limit=10
```

A "sync mode" banner prints at the top of the run as an operator-facing reminder:

```
[enrich] sync mode — full-rate Anthropic API; classifier passes will not benefit from the 50% Batch discount
```

The cost ledger records every Haiku pass at the full (non-discounted) rate during a sync run — see `recordHaiku(..., batched=false)` in `cost.ts`. The `--budget-gbp` cap still applies; if you blow through it the run aborts at the next batch boundary just like the production path.

### Flag interactions

| Combination | Behaviour |
|---|---|
| `--sync` + `--dry-run` | **Rejected at arg-parse time.** Dry-run estimates production posture; sync is the opposite. |
| `--sync` + `--mode=embed` | Silently accepted but a no-op. Embed (Voyage) is sync regardless of provider. |
| `--sync` + `--mode=classify` | Classifier passes route through `SyncMessageClient`. |
| `--sync` + `--mode=all` | Classifier passes sync; embed and compose are sync regardless. |
| `--sync` + `--source=<s>` | Compatible. Common combo for prompt iteration. |
| `--sync` + `--limit=N` | Compatible. Common combo for `--limit=5` end-to-end smokes. |

### Concurrency

`SyncMessageClient` runs 5 in-flight requests in parallel by default. Anthropic's Haiku 4.5 rate limit is generous; 5 keeps us well under any plausible 429 threshold while finishing a 100-item classifier pass in seconds rather than minutes.

If you see 429s, the client retries each request up to 3 times at 1s / 2s / 4s with jitter. Beyond that the entry surfaces as `status: 'errored'` in the per-pass result — the whole submit doesn't fail. Inspect the `errored` count in the ledger summary at the end of the run.

---

## Cost expectations

| Pass | Batch rate | Sync rate | Sync-cost full corpus |
|---|---|---|---|
| Haiku classifier (input) | $0.50 / 1M tokens | $1.00 / 1M tokens | ~£0.50 |
| Haiku classifier (output) | $2.50 / 1M tokens | $5.00 / 1M tokens | ~£0.50 |
| Voyage embeddings | $0.02 / 1M tokens | (same — Voyage is always sync) | ~£0.05 |

A full Puma sync run (blog-post-job + persona-summary + blog-tag-normalisation) lands at ~£1–£2. Well inside the dev cap of £10 (`ENRICH_BUDGET_GBP`). If you're worried, run with `--dry-run` first to see the projected (batched) cost, then double it as a rough sync ceiling.

---

## What it doesn't do

- **Image annotation**: the `annotate-images` CLI in `product/ingestion/src/images/` does **not** support `--sync` in this iteration. A sibling task (provisionally `03-exec-c-t11.md`) will land that flag separately. Until then, an operator doing a complete initial sync invokes both CLIs in parallel shells — the image side continues to use Vision Batches with the up-to-24 h SLA:

  ```bash
  # shell 1 — classifier sync
  npm run -w @swoop/ingestion enrich -- --mode=all --sync

  # shell 2 — image annotation (still batched; no --sync yet)
  npm run -w @swoop/ingestion annotate-images
  ```

- **Provider switching**: `--sync` doesn't change provider. Same Anthropic SDK, same Haiku 4.5 model, same prompts and schemas. Only the API surface (`messages.create` vs `messages.batches.create`) differs.

- **Re-classification semantics**: the same content-hash-based dedupe applies. If a row's `content_hash` matches what's already on disk, the row is skipped regardless of `--sync`. To force re-classification, `UPDATE blog_post SET primary_job = NULL` (or the equivalent for the table you're targeting) for the slice you want re-classified.

---

## Cross-references

- Decision: `planning/decisions.md` — **C.47** (sync enrich mode for dev iteration).
- Plan: `planning/03-exec-c-t10.md`.
- Carve-out from: HITL Q4 in `planning/03-exec-c-t3a.md` (immutable; do not edit).
- Implementation: `product/ingestion/src/enrich/sync-message-client.ts`.
- Companion runbook: `embedding-rerun.md` (default batch path).
