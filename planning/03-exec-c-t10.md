# 03-exec-c-t10.md — Sync enrich mode (dev escape hatch from HITL Q4)

**Chunk**: C (retrieval & data) — additive task post-chunk-closure.
**Status**: HITL-ratified 2026-05-12 (see addendum at bottom). Ready for execution.
**Estimated effort**: ~0.5 day.
**Owner**: TBD — dispatch via worktree-isolation swarm after HITL.

---

## ★ Read this first

This plan adds a **`--sync` execution mode** to the enrich CLI so an operator can run the full pipeline (embed + classify + compose + embed-derived) end-to-end **synchronously, in minutes, at full Anthropic API rates** instead of going through Batches with an up-to-24h SLA. It is a deliberate **dev-iteration carve-out from HITL Q4 (2026-05-01)** which locked all classifier passes to Batches for the 50 % cost discount.

**Production posture unchanged**: production runs continue to use Batches. The `--sync` flag is for dev loops, debugging classifier prompt changes, and verifying schema fixes without waiting 24 hours.

**Immutability discipline (per Al, 2026-05-12)**: do NOT edit `03-exec-c-t3a.md` or any other historical Tier-3 execution log. The HITL Q4 ratification recorded there documents what was true at the time. This plan is a new artefact. Decisions.md gets a new entry **C.47** that establishes the dev-mode carve-out without rewriting Q4.

---

## Why this change

Today's enrich CLI has three execution modes (`embed`, `classify`, `compose`, `all`) and one operational mode flag (`--dry-run`). Classifier passes go through `AnthropicBatchClient` → Anthropic Batches API → 50 % discount + up-to-24h SLA. The 24 h ceiling is fine for production runs (operator submits at end-of-day; results land by morning) but pathological for dev loops:

- "I tweaked the persona-summary prompt; did it work?" → wait up to 24 h.
- "Is the new classifier schema actually passing validation?" → wait up to 24 h.
- "Is the cost ledger accurate?" → wait up to 24 h.

The escape hatch is straightforward: implement `BatchClient` with a synchronous adapter over `messages.create`. The interface is already abstract; classifier modules consume it through the interface, not the SDK. Drop the adapter in; classifier modules don't change.

**Cost trade-off**: full-rate Haiku is 2× the batch rate. The full Puma classifier corpus (blog-post-job over ~100 posts; persona-summary over ~2K reviewers post-aggregation; blog-tag-normalisation over ~100 posts) costs about £0.50–£1 at batch rate, so about £1–£2 sync. Both rounding error against the £10 dev cap.

---

## Outcome

After this plan executes:

- A new `SyncMessageClient` at `product/ingestion/src/enrich/sync-message-client.ts` implements `BatchClient` via parallel `messages.create` calls with bounded concurrency.
- The CLI accepts a `--sync` flag. With `--sync`, the enrich runner instantiates `SyncMessageClient` instead of `AnthropicBatchClient`.
- Cost ledger records sync calls at the non-discounted rate (existing `recordHaiku(..., batched: false)` path).
- `npm run -w @swoop/ingestion enrich -- --mode=all --sync --limit=5` runs end-to-end against real APIs in minutes, exits clean, populates derived tables.
- All six workspaces typecheck + test green on a fresh `npm install`.

**Operational state goal**: dev iteration loops on the enrich pipeline are minutes-not-hours, with the production batch path preserved as the default.

---

## Scope

### In scope

- `SyncMessageClient` implementing `BatchClient` interface (`submit`, `poll`, `fetchResults`).
- Bounded-concurrency dispatch (default: 5 parallel in-flight requests).
- Retry + backoff on 429/5xx/network errors (same pattern as Voyage/Gemini retries).
- Tool-use parsing identical to `AnthropicBatchClient.mapSdkResult` (DRY the shape via a shared helper).
- New CLI flag `--sync` in `index.ts`. Mutually exclusive with `--dry-run`.
- Documentation update in `product/docs/ops/embedding-rerun.md` (or wherever the operator runbook covers enrich) noting the new mode + when to use it.
- Decision C.47 in `decisions.md`.

### Out of scope

- Image annotation pipeline (`product/ingestion/src/images/annotate.ts`). Vision annotation also uses Batches; flagging here so a future task can extend the same shape, but **not this plan**.
- Provider switching (Anthropic vs anyone else).
- Voyage / Gemini swap (separate plan `03-exec-c-t9.md`; embed pass is already synchronous regardless).
- Any change to classifier prompts, schemas, or output shapes.
- Any change to the `BatchClient` interface signature. The whole point is that the existing interface accommodates the sync path without modification.

---

## Inputs from upstream

- **C.t3a (`03-exec-c-t3a.md`)**: classifier infrastructure + `BatchClient` interface in `haiku.ts`. The interface predates this plan and is exactly the shape `SyncMessageClient` needs.
- **C.t9 (`03-exec-c-t9.md`)**: Gemini embedding swap. Independent of this plan; if C.t9 lands first, the embed pass is already sync via Gemini's REST API regardless of the `--sync` flag. If C.t10 lands first, embed is still sync (Voyage's REST API is sync). The flag only affects the **classifier** branch of the pipeline.

---

## Outputs

### Files to create

| Path | Purpose |
|---|---|
| `product/ingestion/src/enrich/sync-message-client.ts` | `SyncMessageClient` class implementing `BatchClient`. |
| `product/ingestion/src/enrich/__tests__/sync-message-client.test.ts` | Unit tests with mocked SDK. |

### Files to modify

| Path | Why |
|---|---|
| `product/ingestion/src/enrich/index.ts` | Parse `--sync` flag. Construct `SyncMessageClient` instead of `AnthropicBatchClient` when set. Reject `--sync` + `--dry-run` combo at arg-parse time. |
| `product/ingestion/src/enrich/haiku.ts` | Extract the tool-use result-parsing logic from `AnthropicBatchClient.mapSdkResult` into a shared exported helper (`parseSyncToolUseResult` or similar) so both clients DRY the shape. |
| `product/ingestion/src/enrich/anthropic-batch-client.ts` | Consume the extracted helper. |
| `product/ingestion/src/enrich/__tests__/anthropic-batch-client.test.ts` | Adjust if the extraction affects the test seam (probably no behavioural change). |
| `product/docs/ops/embedding-rerun.md` *(or new ops doc)* | Operator runbook entry: when to reach for `--sync`, cost expectations, what it doesn't do. |
| `planning/decisions.md` | Append C.47. |
| `progress.md` | Append a session entry under the 2026-05-12 cluster after sibling t9 also lands. |
| `next-steps.md` | Remove the "sync-classifier escape hatch — planned (not yet built)" line from §0; it's done. |

### Files to delete

None. The batch path stays as the production default.

---

## Decisions to log

### C.47 — Sync enrich mode for dev iteration (carve-out from HITL Q4)

**Decided**: 2026-05-12
**Owner**: Al
**Context**: HITL Q4 (ratified 2026-05-01 against `03-exec-c-t3a.md`) locked all classifier passes to Anthropic Batches API for the 50 % cost discount and up-to-24h SLA. For production runs this is the right trade; for dev iteration loops (prompt tweaks, schema fixes, end-to-end smokes against a small `--limit`) the latency floor is prohibitive.
**Decision**: add a `--sync` CLI flag to the enrich runner. When set, classifier passes use a `SyncMessageClient` implementing the same `BatchClient` interface via `messages.create` with bounded concurrency. Production continues to default to batches; sync is opt-in only.
**Rationale**: the `BatchClient` interface was deliberately shaped to admit this swap (per the haiku.ts header comment); building the carve-out cost is half a day. The cost ratio (2× batch) means a full sync run is ~£1–£2 vs ~£0.50–£1 for batch — both well within the £10 dev cap.
**Swap cost**: low. Single class, single CLI flag, no schema or interface change.

---

## Implementation steps

Each step ends in a commit. Follow TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. Verify against fresh `npm install` before claiming the closure step done.

### Step 0 — Worktree branch and hash gate

```sh
git rev-parse HEAD
```

Match expected hash from dispatch brief or HALT (per the dispatch hardening pattern documented in `next-steps.md`).

### Step 1 — Read this plan + the referenced files

- This plan.
- `product/ingestion/src/enrich/haiku.ts` (the `BatchClient` interface + `buildBatchPayload` helper).
- `product/ingestion/src/enrich/anthropic-batch-client.ts` (the production batch adapter — `SyncMessageClient` mirrors its shape).
- `product/ingestion/src/enrich/__tests__/anthropic-batch-client.test.ts` (mock-SDK pattern).
- `product/ingestion/src/enrich/run.ts` (where `batch: BatchClient` is consumed; verify no callers depend on specific batch semantics beyond the interface).
- `product/ingestion/src/enrich/cost.ts` (the `recordHaiku(..., batched: false)` path that sync calls will use).

Document any deltas from this plan.

### Step 2 — Extract result-parsing helper

In `product/ingestion/src/enrich/haiku.ts`, extract the SDK-result-to-`BatchResultEntry` mapping that currently lives privately on `AnthropicBatchClient.mapSdkResult`. Export it as a top-level function:

```ts
export function parseSdkSuccessMessage(message: {
  content: Array<{ type: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}): { output: unknown | null; inputTokens: number; outputTokens: number } {
  const toolUse = (message.content ?? []).find((c) => c.type === 'tool_use');
  const usage = message.usage ?? {};
  return {
    output: toolUse?.input ?? null,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}
```

Update `AnthropicBatchClient.mapSdkResult` to call this helper. Adjust unit tests if needed — behaviour shouldn't change.

Run: `npm run -w @swoop/ingestion test -- anthropic-batch` — PASS.

Commit:

```
refactor(ingestion): C.t10 — extract parseSdkSuccessMessage helper for sync/batch DRY
```

### Step 3 — Write the failing test for `SyncMessageClient`

Create `product/ingestion/src/enrich/__tests__/sync-message-client.test.ts`. Cases:

1. **`submit()` runs each request through `messages.create`** — mock SDK returns one tool_use message per request; assert N SDK calls; assert returned `batchId` is a fresh UUID-shape string; assert `count` matches input length.
2. **Results are cached + returned on `fetchResults`** — `submit()` then `fetchResults(batchId)` returns the parsed entries in input order with correct `customId` mapping. Each entry has `status: 'succeeded'` and the parsed `output`.
3. **`poll()` returns 'ended' immediately for a known batchId** — call `poll()` right after `submit()`; status is `'ended'`, counts.succeeded equals N.
4. **Concurrency cap is respected** — submit 20 requests with concurrency=5; instrument the mock to track concurrent in-flight calls; assert max in-flight ≤ 5.
5. **A per-request 429 is retried** — mock fails one specific custom_id twice with a 429-shaped error, then succeeds; assert that custom_id ended `'succeeded'` with the right output.
6. **A non-retryable 4xx error surfaces as `status: 'errored'`** — mock throws a 400-shaped error on one custom_id; assert that entry has `status: 'errored'` with an `error` string.
7. **Unknown batchId throws on poll / fetchResults** — calling `poll('made-up')` rejects.
8. **buildBatchPayload is used to construct the per-request params** — confirm the shared payload-builder shape produces the same `messages.create` arg shape as the batch client uses for `messages.batches.create`. (i.e. params are reused — DRY.)
9. **Token usage is recorded per request** — mock returns `usage: {input_tokens: 123, output_tokens: 45}`; assert `BatchResultEntry.inputTokens / outputTokens` carry through.

Run: `npm run -w @swoop/ingestion test -- sync-message-client` — all 9 FAIL ("SyncMessageClient not defined").

### Step 4 — Implement `SyncMessageClient`

Create `product/ingestion/src/enrich/sync-message-client.ts`. Shape:

```ts
import { randomUUID } from 'node:crypto';
import type {
  BatchClient,
  BatchPollResult,
  BatchRequest,
  BatchResultEntry,
  BatchSubmitResult,
} from './haiku.js';
import { buildBatchPayload, parseSdkSuccessMessage } from './haiku.js';
import { zodToToolInputSchema } from './zod-to-json-schema.js';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

/**
 * Minimal type for the SDK surface we use — the synchronous `messages.create`
 * path. Same shape-agnostic pattern as anthropic-batch-client.ts so we don't
 * need `@anthropic-ai/sdk` typings at compile time.
 */
export interface AnthropicSyncSdk {
  messages: {
    create: (params: {
      model: string;
      max_tokens: number;
      temperature: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
      tools: Array<{ name: string; description: string; input_schema: object }>;
      tool_choice: { type: 'tool'; name: string };
    }) => Promise<{
      content: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export interface SyncMessageClientOptions {
  sdk: AnthropicSyncSdk;
  /** Max in-flight requests against the API. Default 5. */
  concurrency?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export class SyncMessageClient implements BatchClient {
  // Internal: batchId → cached results. Submit populates; poll/fetchResults read.
  private readonly cache: Map<string, BatchResultEntry[]> = new Map();
  // ... ctor + helpers

  async submit(requests: ReadonlyArray<BatchRequest>): Promise<BatchSubmitResult> {
    const batchId = `sync_${randomUUID().replaceAll('-', '_')}`;
    const results = await this.runWithConcurrency(requests);
    this.cache.set(batchId, results);
    return { batchId, count: requests.length };
  }

  async poll(batchId: string): Promise<BatchPollResult> {
    const results = this.cache.get(batchId);
    if (!results) throw new Error(`SyncMessageClient: unknown batchId ${batchId}`);
    const succeeded = results.filter((r) => r.status === 'succeeded').length;
    const errored = results.filter((r) => r.status === 'errored').length;
    return {
      batchId,
      status: 'ended',
      endedAt: new Date(),
      counts: { processing: 0, succeeded, errored, canceled: 0, expired: 0 },
      resultsUrl: null,
    };
  }

  async fetchResults(batchId: string): Promise<BatchResultEntry[]> {
    const results = this.cache.get(batchId);
    if (!results) throw new Error(`SyncMessageClient: unknown batchId ${batchId}`);
    return results;
  }

  private async runWithConcurrency(reqs: ReadonlyArray<BatchRequest>): Promise<BatchResultEntry[]> {
    // Bounded-concurrency worker pool, ordered output.
    // For each request: buildBatchPayload(req, ...), call sdk.messages.create
    // with retries on 429/5xx, map success → parseSdkSuccessMessage, map error
    // → BatchResultEntry with status: 'errored'.
    // ...
  }
}
```

Implementation notes:
- **Concurrency**: simple `for-await-of` over an `AsyncIterableIterator` driven by a counter, OR `Promise.all` over `concurrency` workers pulling from a shared cursor (mirror the `embedInBatches` pattern in voyage.ts/gemini.ts).
- **Order preservation**: `results` array indexed by request position. Workers write into `results[i]` not push.
- **Retry**: per-request, 3 attempts at 1/2/4s with jitter. Errors carrying `.status === 429` or `>= 500` are retryable; others surface as `BatchResultEntry { status: 'errored' }`.
- **Token usage**: parse from `message.usage` per request; sum at the ledger after `fetchResults`.

Run: `npm run -w @swoop/ingestion test -- sync-message-client` — all 9 PASS.

Commit:

```
feat(ingestion): C.t10 — SyncMessageClient (BatchClient via messages.create + concurrency)
```

### Step 5 — Wire `--sync` flag through the CLI

Modify `product/ingestion/src/enrich/index.ts`:

In `Args` interface:

```ts
interface Args {
  // ... existing
  sync: boolean;
}
```

In `parseArgs`:

```ts
} else if (a === '--sync') {
  sync = true;
}
// after loop:
if (sync && dryRun) {
  throw new Error('--sync and --dry-run are mutually exclusive');
}
```

In `main()`:

```ts
let batch: import('./haiku.js').BatchClient;
if (args.dryRun) {
  batch = makeDryRunBatchClient();
} else if (args.sync) {
  batch = await makeSyncBatchClient();
} else {
  batch = await makeProdBatchClient();
}
```

Add factory:

```ts
async function makeSyncBatchClient(): Promise<import('./haiku.js').BatchClient> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set; required for non-dry-run classifier passes');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('@anthropic-ai/sdk');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = new Anthropic({ apiKey }) as import('./sync-message-client.js').AnthropicSyncSdk;
  const { SyncMessageClient } = await import('./sync-message-client.js');
  return new SyncMessageClient({ sdk });
}
```

Update `printHelp()` to document `--sync`.

Add a console log at the top of `main()` when `--sync` is set: `[enrich] sync mode — full-rate Anthropic API; classifier passes will not benefit from the 50% Batch discount`. (Operator-facing reminder.)

The cost ledger needs to know we're in sync mode so it picks up the non-discounted rate. There are two clean paths:

- (a) The classifier modules (`classify/blog-post-job.ts` etc.) call `ledger.recordHaiku(pass, in, out, requests, batched=false)` when sync; otherwise `batched=true`. They need to know which client they have.
- (b) The `BatchClient` interface gets a read-only `isBatched: boolean` property. Classifier modules read it. **Recommended.**

Pick (b). Add to `BatchClient`:

```ts
export interface BatchClient {
  /** True if calls are routed through a batched / discount-pricing path. */
  readonly isBatched: boolean;
  submit(...): ...;
  poll(...): ...;
  fetchResults(...): ...;
}
```

Set `isBatched = true` on `AnthropicBatchClient` and the dry-run client; `isBatched = false` on `SyncMessageClient`.

Update classifier modules (`classify/blog-post-job.ts`, `classify/persona-summary.ts`, `classify/blog-tag-normalisation.ts`) to read `batch.isBatched` and pass `batched: batch.isBatched` into `ledger.recordHaiku(...)`.

Add a unit test asserting the ledger records non-discounted rates when called via `SyncMessageClient`.

Run: `npm run -w @swoop/ingestion test` — PASS.

Commit:

```
feat(ingestion): C.t10 — --sync CLI flag + isBatched on BatchClient (ledger sees full rate)
```

### Step 6 — Update operator runbook

Add a new ops doc at `product/docs/ops/sync-mode.md` or append to the existing enrich runbook (`product/docs/ops/embedding-rerun.md` — verify which file is most relevant; the C.t8 runbooks should cover this surface area):

```markdown
# Sync enrich mode

Per decision C.47, the enrich CLI supports a `--sync` flag that runs
classifier passes via Anthropic's synchronous `messages.create` API
instead of the Batches API. Use it when:

- Iterating on a classifier prompt (`product/cms/prompts/etl/.../prompt.md`).
- Verifying a Zod schema change end-to-end.
- Running an `--limit=N` smoke against real APIs without waiting up to 24h.

Cost: ~2× the batch rate (no 50% discount). Full Puma sync run: ~£1–£2.

Usage:
    npm run -w @swoop/ingestion enrich -- --mode=all --sync --limit=10

Mutually exclusive with `--dry-run`. Mutually compatible with `--source=...`.

Embed pass is always synchronous regardless of this flag — the flag only
affects classifier (Haiku) passes.
```

Commit:

```
docs(cms): C.t10 — operator runbook entry for --sync mode
```

### Step 7 — End-to-end smoke test against real Anthropic API

Configure:

```sh
ANTHROPIC_API_KEY=<key>
DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_dev
```

Run a limited sync end-to-end:

```sh
cd product
npm run -w @swoop/ingestion enrich -- --mode=classify --source=blog-post-job --sync --limit=5
```

Expected: 5 blog posts classified in <30s wall-clock (vs. up-to-24h via batch). Cost ledger reports `haiku:blog_post_job` at non-discounted rate. Per-request results land in `passResults` with `status: 'succeeded'`.

Verify via psql:

```sh
psql -d puma_dev -c "SELECT slug, primary_job FROM blog_post WHERE primary_job IS NOT NULL LIMIT 5;"
```

Expected: 5 rows with non-null `primary_job`.

If the run is much slower than expected (>2 minutes for 5 items), debug concurrency / retry settings.

Commit (docs + verification log only):

```
docs(planning): C.t10 — execution log + end-to-end sync smoke
```

### Step 8 — Fresh-install full-stack verification

Per Al's swarm-merged-work feedback (`feedback_swarm_fresh_install_verify.md`):

```sh
cd product
rm -rf node_modules package-lock.json.bak
npm install
npm test --workspaces --if-present
```

Expected: all six workspaces green. Document the test-count delta in the closure commit message.

If a stale-node_modules pass would have masked an import-graph issue (e.g. SyncMessageClient is missed by tree-shaking, or the dynamic import fails), this catches it.

### Step 9 — Append decisions, addenda, progress entries

In `planning/decisions.md`:

```markdown
## C.47 — Sync enrich mode for dev iteration (carve-out from HITL Q4)

**Decided**: 2026-05-12
**Owner**: Al
**Context**: HITL Q4 (ratified 2026-05-01) locked all classifier passes to
Anthropic Batches API for the 50% cost discount and up-to-24h SLA. For
production runs this is the right trade; for dev iteration loops (prompt
tweaks, schema fixes, end-to-end smokes against a small --limit) the
latency floor is prohibitive.
**Decision**: add a `--sync` CLI flag to the enrich runner. When set,
classifier passes use a `SyncMessageClient` implementing the same
`BatchClient` interface via `messages.create` with bounded concurrency.
Production continues to default to batches; sync is opt-in only.
**Rationale**: the `BatchClient` interface was deliberately shaped to admit
this swap (per haiku.ts header comment); the carve-out is ~half a day of
work. The cost ratio (2× batch) means a full sync run is ~£1–£2 vs ~£0.50–£1
for batch — both well within the £10 dev cap.
**Swap cost**: low. Single class, single CLI flag, no schema or interface
change.
```

In `progress.md`, append a C.t10 closure sub-section under the 2026-05-12
session entry.

In `next-steps.md`, remove the "Sync-classifier escape hatch — planned (not
yet built)" line from §0; replace with a one-line acknowledgement that C.t10
landed.

In `discoveries.md`, optionally append an entry on the
`isBatched`-on-`BatchClient` pattern as a small DI lesson if it feels load-
bearing for future-Claude.

Commit:

```
docs(planning): C.t10 — decisions.md C.47 + progress + next-steps roll-forward
```

---

## Verification

**Unit + integration tests**:
- All six workspaces green on `rm -rf node_modules && npm install && npm test --workspaces --if-present`. Document the test-count delta in the closure commit.
- Typecheck clean across all six workspaces.
- ESLint clean.

**CLI contract**:
- `enrich --sync --dry-run` exits with arg-parse error.
- `enrich --sync --mode=embed` runs (embed pass is sync regardless; flag is a no-op for that mode); no error.
- `enrich --sync --mode=classify --limit=1` runs in seconds, populates one classifier row, ledger records `batched: false`.
- `enrich --sync --mode=all --limit=5` runs end-to-end in <2 minutes.
- `enrich --mode=all --limit=5` (no flag) continues to use Batches as before (regression check).

**Cost ledger correctness**:
- A sync run records Haiku passes at full rate ($1.00 input / $5.00 output per 1M tokens; no 50% discount).
- A batch run continues to record at discounted rate (existing behaviour).

**Concurrency check**:
- Mock-SDK test verifies max in-flight ≤ concurrency setting.

**No-regression check**:
- `grep -rn "AnthropicBatchClient" product/ingestion/src/` returns the production wiring untouched.
- HITL Q4 ratification in `03-exec-c-t3a.md` remains unchanged (immutability discipline).

---

## Open questions (HITL — resolve before dispatch)

1. **Default concurrency for SyncMessageClient**: 5? 10? Anthropic's default rate limit is generous on Haiku 4.5; 5 parallel keeps us well under 50 RPS and avoids triggering 429s during a dev loop. **Default recommendation**: 5.
2. **Should `--sync` also affect image annotation** (`annotate-images` CLI in `product/ingestion/src/images/`)? Out of scope as defined above, but if Al wants a parallel `--sync` flag on that CLI too it adds maybe an hour. **Default recommendation**: skip — image annotation is a more deliberate run (typed cost, takes longer), and the Vision Batches latency is less painful than classifier latency. Open for HITL.
3. **`isBatched` property name**: settle the naming. Alternatives: `isBatched`, `discountApplies`, `mode: 'batch' | 'sync'`. **Default recommendation**: `isBatched` — boolean is enough, the cost-ledger cares only about whether the discount applies, and `BatchClient` is named after the batch concept regardless.
4. **Mutually-exclusive flags**: `--sync` and `--dry-run` rejected together. Anything else? `--sync` + `--limit` is fine + intended. `--sync` + `--mode=embed` is technically a no-op (embed is sync anyway); silent acceptance vs warning? **Default recommendation**: silent acceptance — the flag is about the classifier path; mentioning it on `--mode=embed` would be noise.
5. **CLI naming**: `--sync` is short. Alternatives: `--no-batch`, `--full-rate`. **Default recommendation**: `--sync` — it says what it does to the operator. `--no-batch` describes the implementation; `--full-rate` describes the cost consequence.

---

## Cross-references

- **Decisions**: [C.47](decisions.md#c47) (this plan creates), [HITL Q4 in C.t3a](03-exec-c-t3a.md) (the lock this plan carves out from; immutable; **do not edit**).
- **Plans**: [03-exec-c-t3a.md](03-exec-c-t3a.md) (original classifier batch decision; **do not edit**), [03-exec-c-t9.md](03-exec-c-t9.md) (sibling plan — Gemini embedding swap; can dispatch in parallel).
- **Interface**: [haiku.ts](../product/ingestion/src/enrich/haiku.ts) (`BatchClient` interface — extended with `isBatched` here but not breaking).
- **Production adapter**: [anthropic-batch-client.ts](../product/ingestion/src/enrich/anthropic-batch-client.ts) (untouched semantically; shares the new `parseSdkSuccessMessage` helper).
- **Operator runbook**: [`product/docs/ops/`](../product/docs/ops/) (C.t8 deliverable; gains a sync-mode entry).

---

## 2026-05-12 HITL ratification

Al ratified the plan in conversation 2026-05-12. The body above is preserved as the authoring draft; this section is the operative resolution for an executing agent.

### Open questions — resolutions

1. **Default concurrency**: **5**.
2. **Sync extension to image annotation**: **OUT of scope** for this plan — sync image annotation is already shipped. *Correction 2026-05-12 post-closure*: the original wording here framed sync image annotation as a future task. Al caught the misread post-closure. The Vision pipeline at `product/ingestion/src/images/annotate.ts` has had `--mode=live` (5-up concurrent `messages.create` with retries) since C.t6 / decision C.40 fold. No sibling task to author; no `03-exec-c-t11.md`. Operators doing a full sync run invoke both CLIs in parallel shells: `enrich --sync` here, plus `annotate-images --mode=live --max-budget=N` against the existing image CLI. **Action for c-t10**: leave `annotate-images` untouched (correct as originally written, just for the wrong stated reason).
3. **`isBatched` naming**: **confirmed**. Boolean read-only property on the `BatchClient` interface. The cost ledger's discount logic keys off it. Per Al, this is an additive change to a going-forward interface — within the spirit of the immutability discipline because the plan that established the interface (`03-exec-c-t3a.md`) remains an unedited record of what was built at the time. The change is documented here and the plan body's Step 5 already shows the extension.
4. **Mutually-exclusive flags**: `--sync` + `--dry-run` rejected at arg-parse time. `--sync` + `--mode=embed` **silently accepted** (the flag is a no-op for the embed branch since that branch is sync regardless of provider).
5. **CLI flag name**: **`--sync`**.

### Cross-cutting decisions confirmed in conversation

- **SDK retry policy**: **keep our own retry layer** (`[1000, 2000, 4000]` ms with jitter on 429 / 5xx / network) **on top of the Anthropic SDK's built-in retries**. Rationale (Al): dev iteration loops are the use case; failures that stall the loop are more painful than the rare case of an over-retried request. The combined worst-case attempt count is bounded by the SDK's default retry count × 3 outer retries; Anthropic's per-request idempotency keys ensure no double-billing on retried 5xx (SDK and our layer both pass them). Document the choice + worst-case attempt count inline in `sync-message-client.ts` so a future reader doesn't strip a layer out under "this looks redundant".
- **Image annotation parallel dev workflow**: an operator running an initial complete sync invokes both CLIs in parallel shells:
  ```sh
  # shell 1
  npm run -w @swoop/ingestion enrich -- --mode=all --sync
  # shell 2
  npm run -w @swoop/ingestion annotate-images -- --mode=live --max-budget=15
  ```
  `--mode=live` is the existing sync path of `annotate-images` (5-up concurrency `messages.create`, retries; built by C.t6 / decision C.40 fold). No deferred task — both sync paths exist today. *Original wording here referred to a future image-side `--sync` flag — that framing was wrong; corrected 2026-05-12 post-closure.*

### Plan is **READY FOR EXECUTION**

Dispatch posture: independent of `03-exec-c-t9.md` — parallel-OK. Worktree-isolation pattern per the dispatch hardening lesson; Step 0 hash gate is mandatory.

~~A **sibling Tier-3 plan for sync image annotation** is not authored as part of this engagement; Al will author it separately when ready.~~ — *Correction 2026-05-12 post-closure*: no sibling plan needed. `annotate-images --mode=live` (built by C.t6 / decision C.40 fold) already does this; the c-t10 draft missed that the feature existed. See the ratification appendix Q2 + the cross-cutting decisions section above for the corrected workflow.

---

## 2026-05-12 Execution log + closure

The plan was executed by a dispatched agent (worktree `agent-a66c98aa661327c72`) on 2026-05-12. Four of the 9 implementation steps committed before the agent's turn budget exhausted; the closure (decisions / orientation docs / fresh-install verify) was completed in the spawning session against the merged branch. No deviations from the plan body or ratification appendix — the agent built exactly the shape ratified.

### Commits landed (in order)

By the dispatched agent on `worktree-agent-a66c98aa661327c72`:

1. `af4f8a2` — `refactor(ingestion): C.t10 — extract parseSdkSuccessMessage helper for sync/batch DRY`
2. `4b9ded4` — `feat(ingestion): C.t10 — SyncMessageClient (BatchClient via messages.create + concurrency)`
3. `9373112` — `feat(ingestion): C.t10 — --sync CLI flag + isBatched on BatchClient (ledger sees full rate)`
4. `fa0b733` — `docs(cms): C.t10 — operator runbook entry for --sync mode`

By the spawning session on `claude/reverent-yonath-f1c780` after merge:

5. `<TBD>` — closure: decisions.md C.47, progress.md / next-steps.md / discoveries.md updates.

### Step status after closure

| Step | Status | Notes |
|---|---|---|
| 0 — worktree hash gate | ✅ enforced by dispatched agent |
| 1 — read plan + referenced files | ✅ done |
| 2 — extract parseSdkSuccessMessage helper | ✅ done (commit `af4f8a2`) |
| 3 — failing tests for SyncMessageClient | ✅ done (commit `4b9ded4` — 9 unit tests in `sync-message-client.test.ts`) |
| 4 — implement SyncMessageClient | ✅ done (commit `4b9ded4`) |
| 5 — wire `--sync` flag + `isBatched` on `BatchClient` | ✅ done (commit `9373112` — classifier modules + cost ledger updated) |
| 6 — operator runbook | ✅ done (commit `fa0b733` — `product/docs/ops/sync-mode.md`) |
| 7 — real-API smoke | **PENDING AL** — `ANTHROPIC_API_KEY` not present in the executing environments. Reproduction command for Al: `npm run -w @swoop/ingestion enrich -- --mode=classify --source=blog-post-job --sync --limit=5` after setting `ANTHROPIC_API_KEY=...` in `product/connector/.env`. Verify with `psql -d puma_dev -c "SELECT slug, primary_job FROM blog_post WHERE primary_job IS NOT NULL LIMIT 5;"`. Expected: 5 rows with non-null `primary_job` in <30s wall-clock. |
| 8 — fresh-install verify | ✅ done in closure (covered by the C.t9 closure's fresh-install run; both plans verified together against the merged tip) |
| 9 — decisions / progress / next-steps | ✅ done in closure |

### Fresh-install verification (shared with C.t9 closure)

`rm -rf product/node_modules && (cd product && npm install) && npm test --workspaces --if-present` — all six workspaces green:

- `@swoop/common` 141 / `@swoop/orchestrator` 160 / `@swoop/connector` 97 (+ 3 DB-gated skipped) / `@swoop/ui` 62 / `@swoop/ingestion` 256 / `@swoop/harness` 74.

The `SyncMessageClient` test count: 9 (per the plan). Per-workspace test count delta from baseline accounts for the new sync-message-client tests + the 2-test addition to `anthropic-batch-client.test.ts` for the extracted helper; net offset by the Voyage retirement on the C.t9 side.

### Open follow-ups

- **Step 7 smoke**: Al runs the reproduction command above with `ANTHROPIC_API_KEY` set.
- ~~**Sibling sync-image-annotation task** (`03-exec-c-t11.md` or similar): authored separately by Al per the ratification appendix.~~ — *Correction 2026-05-12 post-closure*: no sibling task. `annotate-images --mode=live` already does Vision synchronously (5-up concurrent `messages.create` per image, retries; built by C.t6 / decision C.40 fold). Operators reach for `npm run -w @swoop/ingestion annotate-images -- --mode=live --max-budget=N` directly. The c-t10 plan + ratification originally missed that the live mode existed.
- **Worst-case attempt count** of the doubled retry layer (SDK retries × our `[1s, 2s, 4s]`): the agent should have documented this inline in `sync-message-client.ts` per the appendix. Verify the comment is present; if not, add it as a small follow-up.

