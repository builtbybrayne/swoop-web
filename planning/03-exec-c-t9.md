# 03-exec-c-t9.md — Voyage-3 → Gemini embeddings swap

**Chunk**: C (retrieval & data) — additive task post-chunk-closure.
**Status**: HITL-ratified 2026-05-12 (see addendum at bottom). Ready for execution.
**Estimated effort**: ~0.5 day.
**Owner**: TBD — dispatch via worktree-isolation swarm after HITL.

---

## ★ Read this first

This plan **supersedes C.18** (`voyage-3` / 1024d lock) with a new decision **C.46**: `gemini-embedding-001` at 3072 dimensions. It does NOT revisit the chunk-C top-down-from-sales discipline (theme 11), the eight-tool surface (C.25), the no-composer pattern (C.24), or any tool I/O schema. The five-jobs / eight-tools / five-derived-tables architecture stays exactly as it is.

**Immutability discipline (per Al, 2026-05-12)**: do NOT edit `03-exec-c-t3a.md`, `03-exec-c-t1.md`, or any other historical Tier-3 execution log. Those record what was actually built at the time. This plan is a *new* artefact that documents the swap; cross-references back-link from `02-impl-retrieval-and-data.md` (Tier 2; the high-level doc can carry a forward-pointing addendum) and from a supersession note appended to C.18 in `decisions.md`. The existing migrations `002_domain_tables.sql` and `003_derived_tables.sql` stay untouched — they document the original 1024d state. Migration **009** supersedes the embedding-column definitions only.

**What "do NOT touch" looks like in practice**:
- `product/ingestion/src/enrich/voyage.ts` and its test → **delete** (code; not a plan record).
- `planning/03-exec-c-t3a.md` → **do not modify** (Tier-3 execution log).
- `planning/decisions.md` C.18 entry → **append supersession marker, do not rewrite body**.
- Migrations 002 + 003 → **do not edit**. Migration 009 carries the column re-creation.

---

## Why this change

Two reasons:

1. **Vendor consolidation.** The project already pays for Anthropic (orchestrator + classifiers + Vision) and will pay for Google (Gemini API for embeddings is one of many candidate uses of a Google API key). Removing Voyage as a third vendor removes one API key, one billing relationship, one rate-limit budget, one set of operational dashboards to watch.
2. **Quality bump at zero scale-cost.** At our corpus size (~25K vectors total) Gemini-embedding-001 at 3072d costs essentially nothing in storage or index memory beyond the smaller alternatives, and is mathematically ≥ any truncated dim. Voyage-3 at 1024d was a reasonable pre-Gemini choice; with Gemini-001's MRL training at 3072d shipped and stable since June 2025, the upgrade is free in everything except a one-time re-embedding pass.

**Cost ratio**: Gemini's embedding rate ($0.15/1M input tokens) is ~7.5× Voyage-3's ($0.02/1M). For the Puma corpus this multiplies a once-off £0.50–£1 spend into a once-off £4–£8 spend. Well inside the £10 dev cap.

---

## Outcome

After this plan executes:

- A new `@swoop/ingestion` client at `product/ingestion/src/enrich/gemini.ts` calls Gemini's `embedContent` endpoint via the `@google/genai` SDK.
- `product/ingestion/src/enrich/voyage.ts` + its test are deleted.
- Migration `009_embeddings_dim_3072.sql` drops every `vector(1024)` embedding column and recreates it as `vector(3072)`, plus rebuilds the HNSW indexes that referenced them.
- Decision **C.46** appended to `planning/decisions.md`; C.18 marked SUPERSEDED.
- A fresh `npm run -w @swoop/ingestion enrich -- --mode=embed` populates all four domain-table embedding columns at the new dimension.
- A fresh `npm run -w @swoop/ingestion enrich -- --mode=compose` (or `--mode=all`) populates the derived tables and their embeddings at the new dimension.
- All workspaces typecheck + test green on a fresh `npm install`.

**Operational state goal**: end-to-end Puma stack runs against Gemini-3072d embeddings end-to-end; no Voyage references remain in code; the cost ledger reports Gemini spend, not Voyage spend.

---

## Scope

### In scope

- New Gemini client + tests.
- New migration 009 + index recreation.
- Cost ledger pricing constants updated.
- Config / env var rename (`VOYAGE_API_KEY` → `GEMINI_API_KEY`).
- Per-source embed helpers (`embed/tags.ts`, `embed/faqitems.ts`, `embed/images.ts`, `embed/blog-chunks.ts`, `embed/derived-rows.ts`) take the new client through the same call sites.
- `runEnrich` option name `voyage` → `embeddingClient` (or similar).
- CLI wiring in `index.ts`.
- Addendum to `02-impl-retrieval-and-data.md` (Tier 2) pointing here.
- Supersession marker on C.18 in `decisions.md`.

### Out of scope

- Any change to the eight intent-named tools, their handlers, or their I/O Zod schemas.
- Any change to derived-table shape beyond the embedding column type.
- The connector's runtime read path. The connector reads from `vector(N)` columns generically; pgvector accepts the new dimension transparently. **Verify** in the verification step but no code change anticipated.
- Image annotation pipeline (`product/ingestion/src/images/`). Vision-based; does not embed.
- Sync execution mode — addressed separately in `03-exec-c-t10.md`.
- Provider switching at runtime. We're not introducing an `EmbeddingClient` interface or `--embedding-provider` flag (YAGNI). Single provider; if a future swap is needed, the next plan re-runs the same shape.

---

## Inputs from upstream

- **C.t1 (`03-exec-c-t1.md`)**: connector skeleton, Postgres pool, migration runner. Migration 009 runs via the same runner.
- **C.t3 (`03-exec-c-t3.md`)**: domain tables populated. The embed pass reads from these.
- **C.t3a (`03-exec-c-t3a.md`)**: classifier + composer infrastructure. Touched here only by changing the embedding-client argument type in `embedDerivedTable` calls.

---

## Outputs

### Files to create

| Path | Purpose |
|---|---|
| `product/ingestion/src/enrich/gemini.ts` | New `GeminiClient` class. Mirrors Voyage's external shape (`embed(req)` → `{ embeddings, totalTokens }`) so the call sites in `embed/*.ts` change only the import + constructor. |
| `product/ingestion/src/enrich/__tests__/gemini.test.ts` | Unit tests. Mocked fetcher / SDK. Cover happy path, batch-size handling, retry on 429/5xx, dimension validation (every embedding 3072d), task-type defaulting. |
| `product/connector/migrations/009_embeddings_dim_3072.sql` | DDL: drop + recreate each embedding column at the new dim; recreate HNSW indexes. |
| `planning/03-exec-c-t10.md` | Sibling plan — sync enrich mode. Authored in parallel (separate doc per task). |

### Files to modify

| Path | Why |
|---|---|
| `product/ingestion/package.json` | Add `@google/genai` dependency. Remove `voyageai` if listed (it isn't currently — Voyage is via direct `fetch`). Update `enrich:embed` script name if changed; current name stays. |
| `product/ingestion/src/enrich/index.ts` | Replace `VoyageClient` import + construction. Replace `VOYAGE_API_KEY` env-var read with `GEMINI_API_KEY`. Pass new client to `runEnrich`. Update help text. |
| `product/ingestion/src/enrich/run.ts` | Option name `voyage` → `embeddingClient`. Replace `VoyageClient` type with `GeminiClient` (no abstract interface — single provider). |
| `product/ingestion/src/enrich/embed/tags.ts` | Replace `voyage: VoyageClient` parameter with `embeddingClient: GeminiClient`. Same for all other embed/*.ts files. |
| `product/ingestion/src/enrich/embed/faqitems.ts` | (same) |
| `product/ingestion/src/enrich/embed/images.ts` | (same) |
| `product/ingestion/src/enrich/embed/blog-chunks.ts` | (same) |
| `product/ingestion/src/enrich/embed/derived-rows.ts` | (same) |
| `product/ingestion/src/enrich/cost.ts` | Pricing constants: replace `VOYAGE_INPUT_PER_MILLION_USD = 0.02` with `GEMINI_EMBEDDING_INPUT_PER_MILLION_USD = 0.15`. Rename `LedgerPassKey` entries from `voyage:*` to `gemini:*`. Method `recordVoyage` → `recordEmbedding`. |
| `product/ingestion/src/enrich/__tests__/cost.test.ts` | Test names + assertions follow the rename. |
| `planning/decisions.md` | Append C.46 entry. Append supersession marker to C.18. |
| `planning/02-impl-retrieval-and-data.md` | Append a forward-pointing addendum (`## 2026-05-12 Gemini embeddings swap`) linking here. Don't rewrite the body. |
| `progress.md` | Append a session entry under the 2026-05-12 cluster (after sibling t10 also lands). |
| `discoveries.md` | Append entry: dimension change semantics (`DROP COLUMN + ADD COLUMN` was the only path; `ALTER COLUMN TYPE` doesn't work for pgvector dimension changes). |
| `gotchas.md` | Append entry: Gemini's 2048-token input limit (vs Voyage-3's 32K); chunk targeting at 800 is safely under, but the chunking module gains a defensive truncate to be belt-and-braces. |

### Files to delete

| Path | Why |
|---|---|
| `product/ingestion/src/enrich/voyage.ts` | Single-provider stance; no dead code. |
| `product/ingestion/src/enrich/__tests__/voyage.test.ts` | Same. |

The historical record that Voyage was the original provider lives in `03-exec-c-t3a.md` (Tier 3 execution log; immutable) and in decisions.md C.18 (now marked SUPERSEDED). The code doesn't need to carry it.

---

## Decisions to log

### C.46 — Embeddings: Gemini-embedding-001 at 3072 dimensions (supersedes C.18)

**Decided**: 2026-05-12
**Owner**: Al
**Rationale**:
- Vendor consolidation onto Google (one fewer API key, one fewer billing relationship).
- At our scale (~25K vectors), 3072d storage + index memory is trivially within Postgres' working set.
- 3072d is MRL-optimal for Gemini-001; ≥ any truncated dim.
- API cost is dimension-independent ($0.15 / 1M input tokens regardless).
- Gemini's 2048-token input limit is comfortably above our 800-token chunk target.
**Cost impact**: ~7.5× per-token cost vs Voyage-3 ($0.15 vs $0.02). Absolute spend for a full Puma re-embed pass: ~£4–£8 once-off, well inside the £10 dev cap.
**Swap cost** (if reverted): one new migration nullifying then dropping `vector(3072)` columns and recreating at the alternative provider's dim; full re-embed run; ~half a day's work. No production data lock-in at our scale.

### C.18 — `voyage-3` / 1024d ~~lock~~ — **SUPERSEDED by C.46 (2026-05-12)**

Append a one-line supersession marker to the existing C.18 entry. Do not rewrite the body — it documents what was true between 2026-04-22 and 2026-05-12 and the rationale at the time.

---

## Implementation steps

Each step ends in a commit. Follow TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. Verify against fresh `npm install` (per Al's swarm-merged-work memory) before claiming any step done.

### Step 0 — Worktree branch and hash gate

**Acting in a worktree dispatched via `isolation: "worktree"`.** First action of the executing agent:

```sh
git rev-parse HEAD
# Must match the hash communicated in the dispatch brief.
```

If mismatch: `git reset --hard <expected-hash>` if the commit exists locally; HALT otherwise.

### Step 1 — Read this plan in full, plus referenced files

Don't skim. Files to read in full before touching anything:
- This plan.
- `product/ingestion/src/enrich/voyage.ts` (the shape we're replacing).
- `product/ingestion/src/enrich/embed/tags.ts` (canonical call-site).
- `product/connector/migrations/002_domain_tables.sql` lines 79–95 (tag.embedding), 96–116 (image.embedding), 187–203 (faqitem.embedding), 358–367 (blog_chunk.embedding).
- `product/connector/migrations/003_derived_tables.sql` (all five derived tables' embedding columns).
- The HNSW index definitions — likely in a migration 004. Grep: `grep -rn "hnsw\|ivfflat" product/connector/migrations/`.

Document any deltas from this plan as you encounter them.

### Step 2 — Install `@google/genai`

```sh
cd product
npm install --workspace @swoop/ingestion @google/genai
```

Verify it lands in `product/ingestion/package.json` dependencies and `product/package-lock.json`. Commit:

```
feat(ingestion): C.t9 — add @google/genai dependency
```

### Step 3 — Write the failing test for `GeminiClient.embed()`

Create `product/ingestion/src/enrich/__tests__/gemini.test.ts`. Cases (Vitest):

1. **Returns embeddings in input order** — mock fetcher returns 3 embedding vectors keyed by index; assert order preserved.
2. **Each embedding is 3072d** — mock returns a 3072-element array; client passes through. Mock returns a 1024-element array; client throws `GeminiError` with "dimension mismatch".
3. **Empty input returns empty result** — `embed({inputs: []})` returns `{embeddings: [], totalTokens: 0}` without calling the fetcher.
4. **Task type defaults to `RETRIEVAL_DOCUMENT`** — mock captures the request body; assert `task_type` field.
5. **Override task type** — `embed({inputs: [...], inputType: 'query'})` sends `RETRIEVAL_QUERY`.
6. **Output dimensionality is 3072 by default** — assert `output_dimensionality: 3072` in request body.
7. **429 triggers retry with backoff** — mock returns 429 twice then 200; assert 3 attempts; assert sleep called with `[1000, 2000]` (jitter not asserted).
8. **5xx triggers retry; non-retryable 4xx does not** — mock returns 503 then 200 (success); mock returns 400 — throws immediately.
9. **Network error triggers retry** — fetcher throws (no Response); retried like 5xx.
10. **Missing API key throws on construction** — `new GeminiClient({apiKey: ''})` throws.
11. **Batched helper preserves order under concurrency** — copy the shape of the existing `embedInBatches` Voyage test.

Run: `npm run -w @swoop/ingestion test -- gemini`
Expected: all FAIL with "GeminiClient is not defined".

### Step 4 — Implement `GeminiClient`

Create `product/ingestion/src/enrich/gemini.ts`. Shape (signatures only — fill in the body to mirror `voyage.ts`'s structure, batching + retry):

```ts
import { messageOf } from '@swoop/common';

export const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
export const GEMINI_DIMENSIONS = 3072;
export const GEMINI_MODEL_ID = 'gemini-embedding-001';
export const DEFAULT_BATCH_SIZE = 100;
export const DEFAULT_CONCURRENCY = 4;

export type GeminiInputType = 'document' | 'query';

export interface GeminiEmbedRequest {
  inputs: ReadonlyArray<string>;
  inputType?: GeminiInputType;
}

export interface GeminiEmbedResult {
  embeddings: number[][];
  totalTokens: number;
}

export class GeminiError extends Error {
  constructor(message: string, readonly status: number | undefined, readonly attempt: number) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GeminiClientOptions {
  apiKey: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export class GeminiClient {
  constructor(options: GeminiClientOptions) { /* validate apiKey, store deps */ }
  async embed(req: GeminiEmbedRequest): Promise<GeminiEmbedResult> { /* see below */ }
}

export async function embedInBatches<T>(
  client: GeminiClient,
  items: ReadonlyArray<T>,
  toText: (item: T) => string,
  options?: {
    batchSize?: number;
    concurrency?: number;
    onBatchComplete?: (batchInputTokens: number, batchSize: number) => void;
    shouldAbort?: () => boolean;
  },
): Promise<Array<{ item: T; embedding: number[] }>> { /* same shape as voyage's */ }
```

Request shape Gemini expects (REST):

```http
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents
x-goog-api-key: $GEMINI_API_KEY
content-type: application/json

{
  "requests": [
    {
      "model": "models/gemini-embedding-001",
      "content": { "parts": [{ "text": "..." }] },
      "task_type": "RETRIEVAL_DOCUMENT",
      "output_dimensionality": 3072
    },
    ...
  ]
}
```

Note: **use `batchEmbedContents` not `embedContent`** for multi-input batching. Verify endpoint shape against current docs (run via `mcp__plugin_context7_context7__query-docs` if unsure). Response shape: `{ "embeddings": [{ "values": [...] }, ...] }`. The API does NOT return per-call usage; the cost ledger uses `approxTokenCount(text)` from `cost.ts` as the input-token estimate (see Step 8).

Retry policy: copy Voyage's pattern verbatim — `[1000, 2000, 4000]` ms with jitter, retry on 429/5xx/network, fail-fast on 4xx ≠ 429.

Auth: `x-goog-api-key: <apiKey>` header. **Not** OAuth, not service account JSON. Google AI Studio API key route (Vertex AI is blocked on GCP IAM per Thomas; we're not using that path).

Run: `npm run -w @swoop/ingestion test -- gemini` — all 11 tests PASS.

Commit:

```
feat(ingestion): C.t9 — GeminiClient with retry + batching (gemini-embedding-001/3072d)
```

### Step 5 — Write migration 009

Create `product/connector/migrations/009_embeddings_dim_3072.sql`:

```sql
-- 009_embeddings_dim_3072.sql
-- ----------------------------------------------------------------------------
-- Migrate embedding columns from vector(1024) (Voyage-3) to vector(3072)
-- (gemini-embedding-001).
--
-- Decision C.46 (2026-05-12) supersedes C.18.
--
-- pgvector does NOT support `ALTER COLUMN ... TYPE vector(N)` when dimensions
-- differ (the type's parameter is part of the type identity). The idiomatic
-- forward-only path per C.31 is DROP COLUMN + ADD COLUMN. Any existing 1024d
-- data is discarded; a re-run of the C.t3a enrich pipeline at the new
-- dimension repopulates.
--
-- Indexes that referenced the dropped columns are recreated at the new dim
-- in the same transaction.
--
-- Forward-only — no DOWN migration (decision C.31).
-- ----------------------------------------------------------------------------

BEGIN;

-- Domain tables (mirroring migration 002 declarations) -----------------------

-- tag.embedding
DROP INDEX IF EXISTS idx_tag_embedding_hnsw;
ALTER TABLE tag DROP COLUMN embedding;
ALTER TABLE tag ADD COLUMN embedding vector(3072);

-- image.embedding
DROP INDEX IF EXISTS idx_image_embedding_hnsw;
ALTER TABLE image DROP COLUMN embedding;
ALTER TABLE image ADD COLUMN embedding vector(3072);

-- faqitem.embedding
DROP INDEX IF EXISTS idx_faqitem_embedding_hnsw;
ALTER TABLE faqitem DROP COLUMN embedding;
ALTER TABLE faqitem ADD COLUMN embedding vector(3072);

-- blog_chunk.embedding
DROP INDEX IF EXISTS idx_blog_chunk_embedding_hnsw;
ALTER TABLE blog_chunk DROP COLUMN embedding;
ALTER TABLE blog_chunk ADD COLUMN embedding vector(3072);

-- Derived tables (mirroring migration 003 declarations) ----------------------

-- inspire_passage.embedding
DROP INDEX IF EXISTS idx_inspire_passage_embedding_hnsw;
ALTER TABLE inspire_passage DROP COLUMN embedding;
ALTER TABLE inspire_passage ADD COLUMN embedding vector(3072);

-- customer_story.persona_embedding
DROP INDEX IF EXISTS idx_customer_story_persona_embedding_hnsw;
ALTER TABLE customer_story DROP COLUMN persona_embedding;
ALTER TABLE customer_story ADD COLUMN persona_embedding vector(3072);

-- trust_proof.embedding
DROP INDEX IF EXISTS idx_trust_proof_embedding_hnsw;
ALTER TABLE trust_proof DROP COLUMN embedding;
ALTER TABLE trust_proof ADD COLUMN embedding vector(3072);

-- inform_chunk.embedding
DROP INDEX IF EXISTS idx_inform_chunk_embedding_hnsw;
ALTER TABLE inform_chunk DROP COLUMN embedding;
ALTER TABLE inform_chunk ADD COLUMN embedding vector(3072);

-- trip_card.embedding
DROP INDEX IF EXISTS idx_trip_card_embedding_hnsw;
ALTER TABLE trip_card DROP COLUMN embedding;
ALTER TABLE trip_card ADD COLUMN embedding vector(3072);

-- Index recreation -----------------------------------------------------------
--
-- HNSW at default parameters (m=16, ef_construction=64). Cosine ops match
-- existing index choices (verify against migration 004 — adjust opclass if
-- the originals used vector_l2_ops or vector_ip_ops).

CREATE INDEX IF NOT EXISTS idx_tag_embedding_hnsw                    ON tag                USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_image_embedding_hnsw                  ON image              USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_faqitem_embedding_hnsw                ON faqitem            USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_blog_chunk_embedding_hnsw             ON blog_chunk         USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_inspire_passage_embedding_hnsw        ON inspire_passage    USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_customer_story_persona_embedding_hnsw ON customer_story    USING hnsw (persona_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_trust_proof_embedding_hnsw            ON trust_proof        USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_inform_chunk_embedding_hnsw           ON inform_chunk       USING hnsw (embedding         vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_trip_card_embedding_hnsw              ON trip_card          USING hnsw (embedding         vector_cosine_ops);

COMMIT;
```

**Important**: before committing, verify the index names + opclasses by grepping `product/connector/migrations/004*` (or whichever migration carries the original index definitions). If the original migration named them differently (`*_idx`, `_pgvector`, etc.) **match those names** so the `DROP INDEX` actually drops them. If the original opclass was `vector_l2_ops`, change here.

Apply to a scratch DB first:

```sh
cd product/connector
DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_dev_scratch npm run migrate:up
```

Confirm via `psql -d puma_dev_scratch -c "\d tag"` that `embedding` is now `vector(3072)`.

Commit:

```
feat(connector): C.t9 — migration 009 — embedding columns vector(1024) → vector(3072)
```

### Step 6 — Update cost ledger pricing + types

Modify `product/ingestion/src/enrich/cost.ts`:

- Rename `VOYAGE_INPUT_PER_MILLION_USD` → `GEMINI_EMBEDDING_INPUT_PER_MILLION_USD = 0.15`.
- Rename `LedgerPassKey` entries: `voyage:tag` → `gemini:tag`, etc.
- Rename method `recordVoyage` → `recordEmbedding`. Inside, multiply by `GEMINI_EMBEDDING_INPUT_PER_MILLION_USD` not `VOYAGE_INPUT_PER_MILLION_USD`.
- Update the docstring header to reflect the new pricing line.

Modify `product/ingestion/src/enrich/__tests__/cost.test.ts`:
- Test names + assertions follow the rename.
- Numeric assertions: input cost multiplier changes from 0.02 to 0.15.

Run: `npm run -w @swoop/ingestion test -- cost`
Expected: PASS.

Commit:

```
refactor(ingestion): C.t9 — cost ledger renames voyage:* → gemini:*, updates pricing
```

### Step 7 — Replace `VoyageClient` references with `GeminiClient` across embed call sites

For each of:
- `product/ingestion/src/enrich/embed/tags.ts`
- `product/ingestion/src/enrich/embed/faqitems.ts`
- `product/ingestion/src/enrich/embed/images.ts`
- `product/ingestion/src/enrich/embed/blog-chunks.ts`
- `product/ingestion/src/enrich/embed/derived-rows.ts`

Change:
- Import `VoyageClient` → `GeminiClient` (and `embedInBatches` from `../gemini.js`).
- Parameter `voyage: VoyageClient` → `embeddingClient: GeminiClient`.
- Call sites: `voyage.embed(...)` → `embeddingClient.embed(...)`.
- Cost-ledger calls: `ledger.recordVoyage(...)` → `ledger.recordEmbedding(...)`.
- Ledger pass keys: `'voyage:tag'` → `'gemini:tag'` etc.

For each file: run its sibling test first to confirm it fails on the import + type changes, then update the test to match, run again, PASS.

Once all five files are updated, run the full ingestion test suite:

```sh
npm run -w @swoop/ingestion test
```

Expected: PASS (one workspace, all green).

Modify `product/ingestion/src/enrich/run.ts`:
- `EnrichRunOptions.voyage: VoyageClient` → `embeddingClient: GeminiClient`.
- Forward through to the embed/* helpers under the new arg name.
- Ledger keys in the `embedDerivedTable` calls inside the `compose` branch: `'voyage:inspire_passage'` → `'gemini:inspire_passage'`, etc.

Modify `product/ingestion/src/enrich/index.ts`:
- Import `GeminiClient` from `./gemini.js`.
- Read `GEMINI_API_KEY` from env (replace `VOYAGE_API_KEY` env-var read).
- Construct `new GeminiClient({ apiKey: geminiApiKey ?? 'dry-run' })`.
- Pass as `embeddingClient: gemini` to `runEnrich`.
- Update help text + the error message ("`VOYAGE_API_KEY` not set" → "`GEMINI_API_KEY` not set").

Run: `npm run -w @swoop/ingestion test` — PASS. Run: `npm run -w @swoop/ingestion build` (or `typecheck` if no build) — clean.

Commit:

```
refactor(ingestion): C.t9 — swap VoyageClient → GeminiClient across embed pipeline
```

### Step 8 — Defensive chunk-size cap

Modify `product/ingestion/src/enrich/chunk.ts`:

Gemini's input limit is 2048 tokens (≈8192 chars). Our chunk target is 800 tokens, so this is belt-and-braces, but persona aggregation by reviewer name can compose many short reviews into a long prose blob that occasionally exceeds 2048 tokens.

Add:

```ts
/** Gemini's per-input token cap. Stays comfortably above our target chunk size,
 * but is a hard fail at the API boundary, so we defensively truncate before send. */
export const GEMINI_INPUT_TOKEN_CAP = 2048;
export const GEMINI_INPUT_CHAR_CAP = GEMINI_INPUT_TOKEN_CAP * APPROX_CHARS_PER_TOKEN;

export function capToGeminiInput(text: string): string {
  if (text.length <= GEMINI_INPUT_CHAR_CAP) return text;
  return text.slice(0, GEMINI_INPUT_CHAR_CAP);
}
```

Apply at the boundary in `composePersonaInputProse` (output post-aggregation) — wrap the return in `capToGeminiInput(...)`. Optionally also in `chunkContentblockText` / `chunkBlogHtml` if a chunk happens to exceed the cap; per the existing 800-target this is unreachable in normal operation but a defensive cap costs nothing.

Add a unit test asserting `capToGeminiInput` truncates a 10K-char string to ~8192 chars.

Run: `npm run -w @swoop/ingestion test -- chunk` — PASS.

Commit:

```
feat(ingestion): C.t9 — defensive chunk-input cap at 2048 tokens for Gemini
```

### Step 9 — Delete `voyage.ts` + its test

```sh
git rm product/ingestion/src/enrich/voyage.ts
git rm product/ingestion/src/enrich/__tests__/voyage.test.ts
```

Run full workspace tests:

```sh
cd product
rm -rf node_modules package-lock.json.bak
npm install
npm test --workspaces --if-present
```

(Per Al's swarm-merged-work feedback: fresh `npm install`, not a tests-against-stale-modules pass. The `rm -rf node_modules + npm install` cycle is required to catch the kind of "passes against stale build artefacts" failure he's seen before.)

Expected: all six workspaces green. `@swoop/ingestion` test count drops by the Voyage-test count (≈ 11–15 tests) and gains the Gemini test count (11 above) — net delta documented in the commit message.

Commit:

```
chore(ingestion): C.t9 — retire voyage.ts + voyage.test.ts (Gemini swap landed)
```

### Step 10 — End-to-end smoke test against real Gemini API

Configure `product/ingestion/.env` (or set in shell):

```sh
GEMINI_API_KEY=<key from Al>
DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_dev
```

Apply migration 009 to the real `puma_dev`:

```sh
cd product/connector
npm run migrate:up
```

Run the embed pass:

```sh
cd product
npm run -w @swoop/ingestion enrich -- --mode=embed --source=tag --limit=10
```

Expected: 10 rows of `tag.embedding` populated with 3072-element vectors. Total spend reported under £0.01. Cost ledger shows `gemini:tag` not `voyage:tag`.

Verify via psql:

```sh
psql -d puma_dev -c "SELECT id, vector_dims(embedding) FROM tag WHERE embedding IS NOT NULL LIMIT 5;"
```

Expected: `vector_dims = 3072` for every row.

If a 1024-d row somehow survives, the migration didn't fully apply — investigate before commit.

Commit (docs + verification log only, no code change):

```
docs(planning): C.t9 — execution log + end-to-end smoke + dimension verification
```

### Step 11 — Append decisions, addenda, progress entries

In `planning/decisions.md`:

```markdown
## C.46 — Embeddings: Gemini-embedding-001 at 3072 dimensions (supersedes C.18)

**Decided**: 2026-05-12
**Owner**: Al
**Rationale**: Vendor consolidation onto Google (one fewer API key + billing
relationship); at our scale (~25K vectors), 3072d storage + index memory is
trivially within Postgres' working set; 3072d is MRL-optimal for
gemini-embedding-001 (mathematically ≥ any truncated dim); API cost is
dimension-independent ($0.15 / 1M input tokens regardless of output dim).
**Cost impact**: ~7.5× per-token cost vs Voyage-3 ($0.15 vs $0.02). Full
Puma re-embed: ~£4–£8 once-off, inside the £10 dev cap.
**Swap cost**: medium — drop + recreate every embedding column at the
alternative dim; full re-embed run; no production data at risk pre-launch.
```

Append a one-line marker to the existing C.18 entry, in line with the
project convention seen on C.22:

```markdown
## C.18 — ~~Embeddings: voyage-3 / 1024 dimensions~~ — **SUPERSEDED by C.46 (2026-05-12)**
```

(Strikethrough the title only; leave the body intact.)

In `planning/02-impl-retrieval-and-data.md`, append at the bottom:

```markdown
---

## 2026-05-12 — Gemini embeddings swap

Decision C.46 supersedes C.18 ([decisions.md](decisions.md#c46)). The
embedding-column dimension across all four domain tables + five derived
tables is now 3072 (was 1024). The retrieval architecture is unchanged —
this is a surface-level swap of provider + dimension, not a tool surface or
data shape change. New plan: [03-exec-c-t9.md](03-exec-c-t9.md).
```

In `progress.md`, under the 2026-05-12 session entry, add the C.t9 closure
sub-section. In `discoveries.md` and `gotchas.md`, append the dimension-
change + 2048-token-cap entries noted above.

Commit:

```
docs(planning): C.t9 — decisions.md C.46 + supersession marker on C.18 + addendum to Tier-2
```

---

## Verification

**Migration**:
- `npm run -w @swoop/connector migrate:up` against a fresh DB applies 009 cleanly with no errors.
- `psql -d <db> -c "\d tag"` shows `embedding vector(3072)`.
- Same check for `image`, `faqitem`, `blog_chunk`, `inspire_passage`, `customer_story.persona_embedding`, `trust_proof`, `inform_chunk`, `trip_card`.
- `\di` shows the 9 HNSW indexes present at the new dimension.

**Unit + integration tests**:
- All six workspaces green on `rm -rf node_modules && npm install && npm test --workspaces --if-present`. Total test count: existing total minus retired Voyage tests plus new Gemini tests; document the delta in the closure commit message.
- Typecheck clean across all six workspaces.
- ESLint clean.

**Real-API smoke**:
- `npm run -w @swoop/ingestion enrich -- --mode=embed --source=tag --limit=10` populates 10 `tag.embedding` rows with 3072-element vectors.
- Cost ledger emits `gemini:tag` pass keys.
- Run cost: under £0.01.

**No-regression check**:
- `grep -rn "voyage\|VOYAGE" product/ --include='*.ts' --include='*.sql' --include='*.json'` returns zero hits (excluding the historical decisions.md C.18 entry and the addenda referencing the supersession).
- `grep -rn "vector(1024)" product/connector/migrations/` returns only the historical 002 + 003 references; no new occurrences in 009+.

**Pre-merge sanity**:
- `git log --oneline main..HEAD` shows a clean ordered sequence: deps add → GeminiClient + tests → migration 009 → cost ledger → embed call-site swap → chunk cap → Voyage retire → smoke verification → docs.
- Each commit is independently revertable (commit-atomicity discipline per Al's preference).

---

## Open questions (HITL — resolve before dispatch)

1. **Auth route — confirm**: Google AI Studio API key (`generativelanguage.googleapis.com` + `x-goog-api-key` header) vs Vertex AI service-account JSON (`aiplatform.googleapis.com`)? Vertex requires GCP IAM (blocked on Thomas per [questions.md](questions.md)). **Default recommendation**: Studio API key.
2. **Index opclass — confirm**: are the existing HNSW indexes at `vector_cosine_ops` or `vector_l2_ops`? Verify against migration 004 (or wherever the indexes were originally created); migration 009 must use the same opclass to preserve query semantics. **Default recommendation**: `vector_cosine_ops` (matches the connector's similarity-search call patterns).
3. **Batch size for `batchEmbedContents`**: Gemini's batch endpoint accepts up to 100 requests per call (confirm with docs at dispatch time). **Default**: 100.
4. **Concurrency**: max in-flight batch requests against the Gemini endpoint. Voyage was 4 in parallel. Gemini's rate limits are documented per-tier; assume 4 unless we hit 429s. **Default**: 4.
5. **Token usage reporting**: the Gemini embedding response does NOT include token usage. The cost ledger uses `approxTokenCount` (1 token ≈ 4 chars) as the estimate. Accept the inaccuracy, or wire in `gemini-tokenizer` / similar lib for exactness? **Default**: accept the approximation (1–2 % drift; ledger is for cap-not-billing).
6. **Migration name** — is `009_embeddings_dim_3072.sql` the right slot? Verify no migration 009 already exists (`ls product/connector/migrations/`) and pick the next sequential number. **Default**: 009.
7. **Re-embed timing**: should the embed pass fire automatically as the last step of the migration, or as a separate operator action per the runbook? **Default**: separate operator action — migrations stay DDL-only per C.31; the embed pass is a cost-incurring API run that deserves a deliberate `enrich --mode=embed` invocation, not a hidden side-effect of `migrate:up`.
8. **Customertip outstanding**: `customertip` source tables remain undelivered from Swoop (per `questions.md`). Embed pass over `customer_story` will still run cleanly with the current 2,160 customerreviews; when customertip lands, `--mode=all` re-runs idempotently and picks up new rows. No coordination required here.

---

## Cross-references

- **Decisions**: [C.46](decisions.md#c46) (this plan creates), [C.18](decisions.md#c18) (this plan supersedes), [C.31](decisions.md#c31) (forward-only migration discipline — honoured).
- **Plans**: [03-exec-c-t3a.md](03-exec-c-t3a.md) (original Voyage execution log; immutable; **do not edit**), [03-exec-c-t10.md](03-exec-c-t10.md) (sibling plan — sync enrich mode; can dispatch in parallel).
- **Tier 2**: [02-impl-retrieval-and-data.md](02-impl-retrieval-and-data.md) (gets a 2026-05-12 addendum pointing here).
- **Migrations**: [002_domain_tables.sql](../product/connector/migrations/002_domain_tables.sql) (original 1024d declarations — **do not edit**), [003_derived_tables.sql](../product/connector/migrations/003_derived_tables.sql) (same), 009 (this plan creates).

---

## 2026-05-12 HITL ratification

Al ratified the plan in conversation 2026-05-12. The body above is preserved as the authoring draft; this section is the operative resolution for an executing agent.

### Open questions — resolutions

1. **Auth route**: **Google AI Studio API key** (project-scoped within Al's GCP dev project). Endpoint stays `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents`. Env var: `GEMINI_API_KEY`. Auth header: `x-goog-api-key`. Vertex AI (`aiplatform.googleapis.com` + service-account JSON) is the eventual M4-era path once Thomas unblocks the production GCP IAM; not needed now.
2. **Index opclass**: resolve empirically at Step 5 by grepping `product/connector/migrations/004*` (or wherever the original HNSW indexes were declared). Migration 009 must use the **same opclass** as the originals so query semantics carry over. If the originals used `vector_cosine_ops`, 009 uses `vector_cosine_ops`. Don't switch opclass under cover of this migration; that's a separate decision.
3. **Batch size**: **100**.
4. **Concurrency**: **4**.
5. **Token usage**: **`approxTokenCount` (1 token ≈ 4 chars)**. Gemini's embedding response carries no token counts; the ledger is a cap-not-billing instrument and 1–2 % drift is acceptable. If a future invoice reconciliation needs exact tokens, swap in a real tokenizer at that point — not now.
6. **Migration name**: **`009_embeddings_dim_3072.sql`** (next sequential; `ls product/connector/migrations/` confirms no 009 exists yet).
7. **Embed-as-migration-side-effect**: **No** — migrations stay DDL-only per C.31. The re-embed pass is a deliberate operator action (`npm run -w @swoop/ingestion enrich -- --mode=embed`) invoked after migration 009 has applied.
8. **Customertip outstanding**: awareness note only — embed pass over `customer_story` runs cleanly against the existing 2,160 customerreviews. When customertip lands separately from Swoop, `--mode=all` is idempotent and picks the new rows up. No coordination required here.

### Cross-cutting decisions confirmed in conversation

- **Cost-ledger method name**: rename Voyage's `recordVoyage` to **`recordEmbedding`** (provider-neutral), not `recordGemini`. Rationale: future-proof for further provider swaps without breaking the call sites or test names a second time. Pass-key prefixes (`voyage:tag` → `gemini:tag` etc.) stay provider-specific because they're audit-trail data, not call sites — operators inspecting historical ledger output should know which provider produced which spend.
- **`vector(1024)` → `vector(3072)` is a column drop + re-add**, not an in-place ALTER TYPE, because pgvector does not admit dimension changes through `ALTER COLUMN TYPE`. Migration 009 does `DROP COLUMN embedding; ADD COLUMN embedding vector(3072);` per column, then recreates the matching HNSW indexes. The C.31 forward-only discipline is preserved (no rollback path; the previous dimension is recoverable only by re-running an earlier embed pass against re-added 1024d columns — out of scope).

### Plan is **READY FOR EXECUTION**

Dispatch posture: independent of `03-exec-c-t10.md` — parallel-OK. Worktree-isolation pattern per the dispatch hardening lesson; Step 0 hash gate is mandatory.

---

## 2026-05-12 Execution deviations + closure log

The plan was executed by a dispatched agent (worktree `agent-a83ba1fb9d1c28045`) on 2026-05-12. Five of the 11 implementation steps committed before the agent's turn budget exhausted; the remaining steps + the chunk cap + the migrate test fix + the doc work were completed in the spawning session against the merged branch. This addendum records both the deviation from the plan body and the closure mechanics, in keeping with the project's immutability discipline (plan bodies above are preserved as the authoring draft; deviations land here, not as rewrites of the body).

### Deviation — `halfvec(3072)` instead of `vector(3072)` (load-bearing)

The plan body and the 2026-05-12 HITL ratification appendix specified migration 009 using `vector(3072)`. The executing agent discovered empirically against `puma_dev_scratch` that **pgvector's HNSW index has a hard 2000-dimension cap on the `vector` type** — `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` fails at creation when the column is `vector(3072)`.

The agent chose **`halfvec(3072)`** instead — pgvector 0.7+, IEEE 754 binary16 (16-bit floats). The `halfvec` type lifts the HNSW dimension cap to 4000 and halves the index memory footprint vs `vector` at the same dim, with negligible recall loss at 3072d. This is the pgvector-idiomatic answer for high-dim retrieval. Opclass changes from `vector_cosine_ops` to `halfvec_cosine_ops`; cosine semantics carry across unchanged.

The deviation is correct and the right call. Decision **C.46** records the final shape (halfvec) directly; readers should treat C.46's halfvec wording as canonical and this addendum as the explanation of why the plan body says `vector` while the shipped artefact uses `halfvec`. The agent documented the choice inline in the migration header — `product/connector/migrations/009_embeddings_dim_3072.sql` lines 4–14.

### Commits landed (in order)

By the dispatched agent on `worktree-agent-a83ba1fb9d1c28045`:

1. `3c7dc62` — `feat(ingestion): C.t9 — add @google/genai dependency`
2. `3624346` — `feat(ingestion): C.t9 — GeminiClient with retry + batching (gemini-embedding-001/3072d)`
3. `8268700` — `feat(connector): C.t9 — migration 009 — embedding columns vector(1024) → halfvec(3072)`
4. `36847e5` — `refactor(ingestion): C.t9 — cost ledger renames voyage:* → gemini:*, updates pricing`
5. `7841b46` — `refactor(ingestion): C.t9 — swap VoyageClient → GeminiClient across embed pipeline`

By the spawning session on `claude/reverent-yonath-f1c780` after merge:

6. `<TBD>` — closure: chunk cap (Step 8), voyage.ts retirement (Step 9), migrate.test.ts bump, docs (Step 11 — decisions.md, Tier-2 addendum, progress/discoveries/gotchas/next-steps).

### Step status after closure

| Step | Status | Notes |
|---|---|---|
| 0 — worktree hash gate | ✅ enforced by dispatched agent |
| 1 — read plan + referenced files | ✅ done |
| 2 — install @google/genai | ✅ done (commit `3c7dc62`) |
| 3 — failing tests for GeminiClient | ✅ done (commit `3624346`) |
| 4 — implement GeminiClient | ✅ done (commit `3624346`) |
| 5 — migration 009 | ✅ done with halfvec deviation (commit `8268700`); also fixed `migrate.test.ts` to expect 009 in closure commit |
| 6 — cost ledger pricing + rename | ✅ done (commit `36847e5`) |
| 7 — embed call-site swap | ✅ done (commit `7841b46`) |
| 8 — defensive chunk cap | ✅ done in closure (`capToGeminiInput` in `chunk.ts` + 5 unit tests in `chunk.test.ts` + applied at `composePersonaInputProse`) |
| 9 — retire `voyage.ts` + test | ✅ done in closure |
| 10 — real-API smoke | **PENDING AL** — `GEMINI_API_KEY` not present in any of the executing environments. Reproduction command for Al: `npm run -w @swoop/ingestion enrich -- --mode=embed --source=tag --limit=10` after setting `GEMINI_API_KEY=...` in `product/connector/.env`. Verify with `psql -d puma_dev -c "SELECT id, vector_dims(embedding::vector) FROM tag WHERE embedding IS NOT NULL LIMIT 5;"` (note: `halfvec` cast to `vector` for the dim function; result should be `3072`). |
| 11 — decisions / addenda / orientation | ✅ done in closure |

### Fresh-install verification (per Al's swarm-merged-work memory)

`rm -rf product/node_modules && (cd product && npm install) && npm test --workspaces --if-present` — all six workspaces green:

- `@swoop/common` 141 / `@swoop/orchestrator` 160 / `@swoop/connector` 97 (+ 3 DB-gated skipped) / `@swoop/ui` 62 / `@swoop/ingestion` 256 / `@swoop/harness` 74.

The `@swoop/orchestrator` test `POST /chat ... R4-server > returns 400 when the message field exceeds CHAT_MESSAGE_MAX` showed up once as a flake on a parallel-workspace run, but passed on focused re-run and on the second full run. Documented for awareness — not a regression introduced by C.t9.

### Open follow-ups

- **Step 10 smoke**: Al runs the reproduction command above after setting up GCP per the in-conversation 2026-05-12 setup notes (Generative Language API enabled on the dev project + AI Studio API key + `GEMINI_API_KEY` in `connector/.env`).
- **Pricing constants verification**: `GEMINI_EMBEDDING_INPUT_PER_MILLION_USD = 0.15` was the ratification value; verify against published Gemini pricing if anything looks off on the first real billing cycle.
- **HNSW dimension cap note** propagates to `discoveries.md` so the next dim-changing plan won't get caught by the same surprise.

