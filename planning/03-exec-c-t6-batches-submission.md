## 03 — Execution: C.t6 batches submission wiring (BATCH-C.t6)

**Task code**: `BATCH-C.t6` (custom prefix — `batches submission wiring` — chosen to avoid numeric-id collision with parallel Tier-3 plan authors per 2026-05-13 dispatch session).

**Task**: implement the deferred Anthropic Message Batches API submission path for the C.t6 image annotation pipeline. Today's `runBatches` in [product/ingestion/src/images/run.ts:435–476](../product/ingestion/src/images/run.ts) builds the request payload, ratifies it against the schema, then bails out with every candidate marked `batches_submission_deferred` in the checkpoint. v3 of this plan wires the actual `messages.batches.create` → `poll` → `fetchResults` → `writeAnnotation` chain.

**Chunk**: C (retrieval & data) — follow-on to C.t6 image annotation pipeline. Decision context: [planning/decisions.md — C.52 (annotate-images --mode=batches deferred scope-cut)](decisions.md).

**Implements**: decision C.52 (the deliberate C.t6 scope-cut surfaced 2026-05-13 after operator confusion); user instruction 2026-05-13 ("C.t6 ... can go ahead").

**Depends on**:
- C.t6 closed (live mode + Vision client + write-back + cost ledger + checkpoint all working — confirmed by the live runs Al has done).
- C.t10 closed ([planning/03-exec-c-t10.md — sync enrich mode (`--sync` flag)](03-exec-c-t10.md)) — the pattern to copy is `AnthropicBatchClient` at [product/ingestion/src/enrich/anthropic-batch-client.ts](../product/ingestion/src/enrich/anthropic-batch-client.ts).

**Produces**:
- `product/ingestion/src/images/vision-batch-client.ts` — **new** — Vision-specific batches client implementing a narrow interface analogous to the Haiku `BatchClient` from `enrich/haiku.ts`, but specialised for the image-annotation result shape (parses message text → JSON, not tool_use blocks).
- `product/ingestion/src/images/__tests__/vision-batch-client.test.ts` — **new** — unit tests against a mocked SDK shape.
- `product/ingestion/src/images/run.ts` — **edit** — `runBatches` swaps the bail-out for: build → submit → poll-with-kill-switch → fetchResults → per-result write-back + checkpoint.
- `product/ingestion/src/images/__tests__/run.test.ts` — **edit (if exists; new otherwise)** — extend batches-mode tests with the full submit/poll/result wiring.
- `product/docs/ops/image-annotation-rerun.md` — **edit** — flip the operator caveat from "use --mode=live; --mode=batches is unwired" to "--mode=batches now submits + polls + writes back; --mode=live remains supported for small slices".
- `gotchas.md` — **edit** — flip the "annotate-images --mode=batches builds the payload then bails" entry from current-state to historical / closed.
- `planning/decisions.md` — append entries `C.batch-1` through `C.batch-N` (numbered with the `batch-` prefix to avoid collision).
- `progress.md`, `next-steps.md` — orientation updates.

**Pairs with**: nothing in-flight. This is an isolated chunk-C follow-up.

**Blocks**: nothing. The image-annotation pipeline keeps working in `--mode=live`; this just adds the cheaper bulk path.

**Out of scope**:
- Vision client retry tuning. Live mode's exponential backoff is independent.
- Multi-batch sharding. The current 6.9K-image corpus fits one batch comfortably (Anthropic's per-batch limit at writing is 10K requests / 256MB). Sharding would only matter if Antarctica + Arctic expansion lands.
- Operator commentary on real-time progress per request. Polling reports counts; per-request progress isn't worth the round-trip.
- Cost-cap kill-switch refinement beyond what `waitForBatch` already provides.
- Tour content backfill (separate Swoop ask).
- E.t1 wire-tightening (parallel work in this session).

**Estimate**: ~1–2 hrs TDD. The Haiku batch client (`AnthropicBatchClient`) is 145 lines + 16 lines of `waitForBatch`. The Vision variant is similar minus the tool-call parsing (Vision returns plain text → JSON, not `tool_use` blocks).

---

## ★ Read this first — what's different vs the Haiku batches client

The Haiku batches client (`AnthropicBatchClient` in `product/ingestion/src/enrich/anthropic-batch-client.ts`) routes classifier work — each batch request asks Sonnet/Haiku to call exactly one tool whose `input_schema` is a Zod schema. Results come back as `tool_use` block inputs.

The Vision pipeline doesn't use tool calls. The system prompt asks for a JSON object in plain text; the response carries a `text` block whose content is JSON (sometimes wrapped in code fences). The runner already has `parseAndValidate` in [run.ts:500–534](../product/ingestion/src/images/run.ts) that strips fences + `ImageAnnotationOutputSchema.safeParse`s.

So the new client's `fetchResults` differs from `AnthropicBatchClient.mapSdkResult` in **one place**: instead of `parseSdkSuccessMessage` (which finds the `tool_use` block + reads its `input`), we extract the assistant text and hand the raw text back. The runner then runs `parseAndValidate` on it (the same function the live path uses).

This is the right factoring: **one parsing path for both live + batch**. If a future prompt change moves to tool_use blocks, we update both call sites in lockstep.

---

## 1. Outcome

When this task is done:

- `product/ingestion/src/images/vision-batch-client.ts` exists, exports `VisionBatchClient` + `buildVisionBatchSdk` + `waitForVisionBatch`.
- `runBatches` in `run.ts` end-to-end: builds requests → calls `client.submit` → calls `waitForVisionBatch` to poll → calls `client.fetchResults` → streams results back → per-result either runs `parseAndValidate` + `writeAnnotation` + records `done` in checkpoint, or records `failed`/`expired`/`canceled` with the right reason.
- Operator can run `npm run -w @swoop/ingestion annotate-images -- --mode=batches --max-budget=20` and the run actually POSTs a batch to Anthropic and persists results. **Per Al's 2026-05-13 instruction: NO need to RUN it — just leave the script working for later. The unit tests cover the wiring; live invocation is operator-discretion.**
- `image-annotation-rerun.md` runbook entry reflects the new behaviour.
- `gotchas.md` "annotate-images --mode=batches builds the payload then bails" entry is rewritten as a historical note ("closed by BATCH-C.t6 on 2026-05-13"), preserving the diagnostic content for git-blame readers.
- Decisions `C.batch-1..N` logged in `decisions.md`.

Not outcomes:
- A real batch run firing against Al's Anthropic account.
- A `npm run -w @swoop/ingestion annotate-images -- --mode=batches` live invocation.
- Cost-cap behaviour beyond what `waitForVisionBatch` already inherits from the Haiku pattern.

---

## 2. Target functionalities

### 2.1 `VisionBatchClient` (new file)

`product/ingestion/src/images/vision-batch-client.ts`. Mirrors `AnthropicBatchClient` in `product/ingestion/src/enrich/anthropic-batch-client.ts`. Differences:

**Interface** — local to this file, not pulled from `BatchClient` in `haiku.ts` because the request shape is different (Vision pipeline already has `buildBatchRequest` returning `BatchCreateParams.Request`; the Haiku client uses its own `BatchRequest` shape with `outputToolSchema`).

```ts
export interface VisionBatchSubmitResult {
  batchId: string;
  count: number;
}

export interface VisionBatchPollResult {
  batchId: string;
  status: 'in_progress' | 'canceling' | 'ended';
  endedAt?: Date | null;
  counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  resultsUrl?: string | null;
}

export interface VisionBatchResultEntry {
  customId: string;
  status: 'succeeded' | 'errored' | 'canceled' | 'expired';
  /** Raw assistant text for succeeded results; null for non-succeeded.
   *  Caller runs the existing `parseAndValidate` on this text to validate
   *  + extract the annotation fields. */
  rawText: string | null;
  error?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface VisionBatchClient {
  submit(requests: ReadonlyArray<BatchCreateParams.Request>): Promise<VisionBatchSubmitResult>;
  poll(batchId: string): Promise<VisionBatchPollResult>;
  fetchResults(batchId: string): Promise<VisionBatchResultEntry[]>;
}
```

**`AnthropicVisionBatchClient` class** — implements the interface against the SDK's `messages.batches` surface:

```ts
import type { BatchCreateParams } from '@anthropic-ai/sdk/resources/messages/batches.js';

// Same narrow SDK type the Haiku client uses; copied verbatim so this file
// doesn't depend on @anthropic-ai/sdk at typecheck time.
export interface AnthropicBatchSdk { /* same as enrich/anthropic-batch-client.ts */ }

export class AnthropicVisionBatchClient implements VisionBatchClient {
  constructor(private readonly sdk: AnthropicBatchSdk) {}

  async submit(requests: ReadonlyArray<BatchCreateParams.Request>) {
    const created = await this.sdk.messages.batches.create({
      requests: requests as unknown as object[],
    });
    return { batchId: created.id, count: requests.length };
  }

  async poll(batchId: string) { /* mirrors AnthropicBatchClient.poll */ }

  async fetchResults(batchId: string) {
    const stream = await this.sdk.messages.batches.results(batchId);
    const out: VisionBatchResultEntry[] = [];
    for await (const r of stream) {
      out.push(this.mapSdkResult(r));
    }
    return out;
  }

  private mapSdkResult(r: BatchSdkResult): VisionBatchResultEntry {
    if (r.result.type === 'succeeded') {
      const text = extractAssistantText(r.result.message.content);
      const usage = r.result.message.usage ?? {};
      return {
        customId: r.custom_id,
        status: 'succeeded',
        rawText: text,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
      };
    }
    // Non-succeeded path identical to enrich/anthropic-batch-client.ts.
  }
}
```

**`extractAssistantText`** — copy the helper from `vision-client.ts` (or import + re-export it) so the parsing logic is shared.

**`waitForVisionBatch`** — Vision-specific wrapper around the polling loop. Same shape as `waitForBatch` in `enrich/anthropic-batch-client.ts`. Could in principle be parameterised + shared, but the cost of duplicating ~15 lines is lower than the cost of introducing a shared module just for this — and keeps Vision-batch and Haiku-batch isolatable when tuning poll intervals independently.

### 2.2 `runBatches` rewrite

Existing function bails after building. New shape:

```ts
async function runBatches(args: BatchesArgs): Promise<void> {
  const requests = args.candidates.map((c) =>
    buildBatchRequest({
      imageId: c.id,
      systemPrompt: args.systemPrompt,
      imageUrl: c.canonical_url,
      model: args.model,
    }),
  );
  args.log(`[annotate] batch built: ${requests.length} requests; payload bytes ~${roughPayloadBytes(requests)}`);

  // Acquire the batches sub-client from the runtime SDK or test-injected stub.
  const batchClient = resolveBatchClient(args.visionClient);
  if (!batchClient) {
    args.log(`[annotate] --mode=batches: client does not expose messages.batches; falling back to scope-cut bail. Use --mode=live or upgrade the SDK.`);
    args.summary.failed = args.candidates.length;
    for (const c of args.candidates) {
      recordEntry(args.checkpointFile, c.id, 'failed', 'batches_sdk_missing');
    }
    return;
  }

  // Submit + wait + fetch.
  const submit = await batchClient.submit(requests);
  args.log(`[annotate] batch submitted: id=${submit.batchId} count=${submit.count}`);

  const polled = await waitForVisionBatch(batchClient, submit.batchId, {
    log: args.log,
    shouldAbort: () => args.signal?.aborted ?? false,
  });
  args.log(
    `[annotate] batch ended: status=${polled.status} succeeded=${polled.counts.succeeded} errored=${polled.counts.errored} expired=${polled.counts.expired} canceled=${polled.counts.canceled}`,
  );

  const results = await batchClient.fetchResults(submit.batchId);
  args.log(`[annotate] batch results: ${results.length} entries`);

  // Per-result write-back. Same parseAndValidate / writeAnnotation pair as live.
  for (const r of results) {
    const candidateId = parseInt(r.customId.replace(/^image-/, ''), 10);
    if (!Number.isFinite(candidateId)) {
      args.log(`[annotate] batch result has malformed custom_id=${r.customId}; skipping`);
      continue;
    }
    if (r.status !== 'succeeded' || r.rawText === null) {
      recordEntry(args.checkpointFile, candidateId, 'failed', `batch_${r.status}: ${r.error ?? 'no text'}`);
      args.summary.failed += 1;
      continue;
    }
    const parsed = parseAndValidate(r.rawText);
    if (!parsed.ok) {
      recordEntry(args.checkpointFile, candidateId, 'failed', parsed.reason);
      args.summary.failed += 1;
      continue;
    }
    if (isSkipSignal(parsed.value)) {
      recordEntry(args.checkpointFile, candidateId, 'skipped', 'model_emitted_empty');
      args.summary.skipped += 1;
      continue;
    }
    try {
      await writeAnnotation(args.pgClient, {
        imageId: candidateId,
        description: parsed.value.description,
        annotation: parsed.value.annotation,
        subjectTags: parsed.value.subject_tags,
        moodTags: parsed.value.mood_tags,
        regionTags: parsed.value.region_tags,
        tags: parsed.value.tags,
      });
      recordEntry(args.checkpointFile, candidateId, 'done', null);
      args.summary.succeeded += 1;
    } catch (err) {
      recordEntry(args.checkpointFile, candidateId, 'failed', `write_back: ${messageOf(err)}`);
      args.summary.failed += 1;
    }
  }
}
```

**`resolveBatchClient(visionClient)`**: small adapter helper that inspects whether the live SDK client has `messages.batches.create` and either wraps it in an `AnthropicVisionBatchClient` or returns null. Allows test injection via the same `visionClient` parameter — tests pass a stub with `messages.batches.{create,retrieve,results}` and `resolveBatchClient` wraps it.

`parseAndValidate` and `isSkipSignal` are already exported / defined in the runner; no movement needed.

### 2.3 Tests

**`product/ingestion/src/images/__tests__/vision-batch-client.test.ts`** — new. Mock `AnthropicBatchSdk` (the narrow SDK type). 6 cases:

1. `submit` calls `sdk.messages.batches.create` with the request array; returns `{batchId, count}`.
2. `poll` calls `sdk.messages.batches.retrieve` and maps status / counts / endedAt.
3. `poll` maps `'canceling'` and `'in_progress'` statuses correctly; any other string → `'ended'`.
4. `fetchResults` iterates the async iterable + maps `succeeded` results to extracted `rawText`.
5. `fetchResults` maps `errored` results to `status: 'errored' + error: string`.
6. `fetchResults` maps `canceled` / `expired` results to their respective statuses.

**`product/ingestion/src/images/__tests__/run.test.ts`** — extend (or create if missing). Stub the `visionClient` as `AnthropicClientLike & {messages: {batches: {create, retrieve, results}}}` so `resolveBatchClient` finds the surface. Mock the SDK to return:

1. `submit` returns a fake `batchId` and `processing_status: 'in_progress'`.
2. `retrieve` (first poll) returns `'in_progress'`; (second poll) returns `'ended'`.
3. `results` async-iterator yields one `succeeded` JSON-shaped text + one `errored`.
4. Verify: succeeded image gets `writeAnnotation` called + checkpoint `done`; errored image gets checkpoint `failed` with reason. `summary.succeeded === 1`, `summary.failed === 1`.

Extra test: when `visionClient.messages.batches.create` is missing (no SDK), the bail-out path still works (back-compat).

**Existing C.t6 unit tests** in the workspace continue to pass unchanged. Live-mode tests, checkpoint tests, cost tests — none of those touch.

### 2.4 Operator runbook update

[product/docs/ops/image-annotation-rerun.md](../product/docs/ops/image-annotation-rerun.md) — flip the section that warns about `--mode=batches` not being wired. New language: "`--mode=batches` submits via Anthropic's Batches API (50% discount, up to 24h SLA). Use for full-corpus runs; `--mode=live` remains the supported path for small slices during prompt iteration."

Keep the cost figures honest: full ~6.9K-image batch at the discounted rate is ~$17 / £14; live rate is ~$34 / £27.

### 2.5 Gotcha entry update

`gotchas.md` — the "`annotate-images --mode=batches` builds the payload then bails" entry. Rewrite as a closed-historical note pointing at this plan + the new behaviour. Preserve the diagnostic content (the symptom + error string) so anyone hitting an old log can still find the entry.

### 2.6 Decisions to log

Append to `planning/decisions.md`:

- **C.batch-1** — Vision batches submission is wired in-line with the Haiku batches pattern; the request payload shape (`BatchCreateParams.Request` from the SDK) is the same on both code paths. Image-annotation parsing reuses the existing `parseAndValidate` + `isSkipSignal` from the runner, not a separate batch-side parser. One parsing path for both modes.
- **C.batch-2** — `VisionBatchClient` interface is local to `product/ingestion/src/images/`, not pulled from `BatchClient` in `enrich/haiku.ts`. The Haiku version is tool_use-shaped; the Vision version is text-shaped. Sharing would force a generic over the result type that costs more clarity than it buys. Two clients, same SDK surface.
- **C.batch-3** — `waitForVisionBatch` is a local copy of `enrich/anthropic-batch-client.ts:waitForBatch` rather than a shared helper. ~15 lines of duplication; allows independent tuning of poll intervals + log prefixes for the Vision pass without touching the Haiku path.
- **C.batch-4** — When the live SDK client doesn't expose `messages.batches.create` (older SDK, test stub without that surface), the runner falls back to the scope-cut bail rather than throwing. Defensive — protects operators running against older SDKs from confusing crashes.

---

## 3. Architectural principles applied here

- **Pattern, not re-invention**: copy the AnthropicBatchClient shape. ~140 lines of mechanical translation, not architectural design.
- **One parsing path**: live and batch both feed `parseAndValidate` on the assistant text. Maintenance and behaviour drift between the two paths is minimised.
- **Test seam stays narrow**: mock the SDK shape, not the world. Tests don't need a real `Anthropic` client.
- **Defensive against operator confusion**: if the SDK shape isn't present, bail the same way the current code does — don't crash.

---

## 4. Implementation order

TDD throughout.

1. Write `vision-batch-client.test.ts` with the 6 cases above (failing).
2. Implement `vision-batch-client.ts` until tests pass.
3. Extend `run.test.ts` with the 4 cases above (failing on the existing scope-cut bail).
4. Refactor `runBatches` in `run.ts` until tests pass.
5. Typecheck the ingestion workspace; fix drift.
6. Fresh-install verification (full suite green).
7. Operator runbook + gotcha + decisions + orientation docs.
8. Commit in 4 atomic chunks: (a) plan, (b) vision-batch-client + tests, (c) runBatches rewrite + tests, (d) docs + decisions.

---

## 5. Verification

```bash
cd /Users/al/Studio/projects/swoop_web/.claude/worktrees/jolly-pasteur-77252a
pwd  # must end in .claude/worktrees/jolly-pasteur-77252a

cd product
rm -rf node_modules */node_modules
npm install
npm test --workspace @swoop/ingestion --if-present  # +~10 tests, all green
npm test --workspaces --if-present                   # full suite green
```

Sweep:

```bash
grep -rn "batches_submission_deferred\|batches_not_wired" product/ingestion/src
# Expected: zero matches (the old scope-cut reasons have been replaced
# with the wired path; failed results now carry the real Anthropic reason).
```

**No live invocation required** per Al's 2026-05-13 instruction. The unit tests cover the wiring; the operator runbook reflects the new behaviour.

---

## 6. HITL questions

**None expected.** The pattern (`AnthropicBatchClient` for Haiku) is the canonical shape; this plan replicates it for Vision.

Items that may surface during execution:
- If the SDK's `messages.batches.results` returns a different async-iterable shape than the Haiku client expects, the result mapping needs adjusting. Unlikely (same SDK, same API), but document inline if encountered.
- If `BatchCreateParams.Request` has changed shape since C.t6 was authored (SDK upgrade), the existing `buildBatchRequest` may need a cast adjustment. Same defence — document inline.

---

## 7. References

- `product/ingestion/src/enrich/anthropic-batch-client.ts` — the canonical pattern.
- `product/ingestion/src/enrich/haiku.ts` — interface design + waitForBatch helper.
- `product/ingestion/src/images/run.ts:435–476` — the scope-cut `runBatches` being replaced.
- `product/ingestion/src/images/vision-client.ts` — `buildBatchRequest`, `extractAssistantText`.
- `product/docs/ops/image-annotation-rerun.md` — operator runbook to update.
- `gotchas.md` — entry to update.
- `planning/decisions.md` — C.52 (the deferred decision) + new C.batch-N entries.

---

## Execution log

(To be filled in as the work progresses.)

### 2026-05-13 — Plan authored

Tier-3 plan written by primary session in worktree `jolly-pasteur-77252a` after the BF-FO-v3 merge to main (`c5a475b`). Ratified inline against:
- `product/ingestion/src/enrich/anthropic-batch-client.ts` (the pattern to copy).
- `product/ingestion/src/enrich/haiku.ts` (the interface design).
- `product/ingestion/src/images/run.ts` (the scope-cut `runBatches`).
- `product/ingestion/src/images/vision-client.ts` (existing batches request-build).

### 2026-05-13 — Implementation landed (same session)

TDD throughout. Three change clusters:

1. **`vision-batch-client.ts` + tests**: new module mirroring `enrich/anthropic-batch-client.ts`. `AnthropicVisionBatchClient` implements submit/poll/fetchResults. `waitForVisionBatch` polls until `'ended'` with abort + timeout. `adaptVisionSdkForBatches` shape-checks the runtime client + wraps it. 12 unit tests (submit, poll status mapping, fetchResults across all 4 result types, waitForVisionBatch progress + abort).
2. **`runBatches` refactor in `run.ts`**: replaces the scope-cut bail with end-to-end submit → wait → fetch → per-result write-back. Defensive fallback when `adaptVisionSdkForBatches` returns null (older SDKs or test stubs without `messages.batches`). `RunOptions` gains a `batchClient?: VisionBatchClient` field for test injection. +5 integration tests in `run.test.ts` (happy path, mixed succeeded/errored, schema-violating rawText, skip-signal, SDK-missing fallback).
3. **Docs + decisions**: operator runbook ([product/docs/ops/image-annotation-rerun.md](../product/docs/ops/image-annotation-rerun.md)) flipped from "deferred" to "preferred for full re-runs". `gotchas.md` "annotate-images --mode=batches" entry rewritten as closed-historical. Decisions C.batch-1..4 appended to `planning/decisions.md`.

**Test totals after this landing**: `@swoop/ingestion` 266 → 283 (+17). Total across all workspaces 931 → 948 (BATCH-C.t6 alone; VERDICT-E.t1 added +10 separately).

**Deviations from the plan**:
1. **`VisionBatchClient` interface uses `BatchCreateParams.Request` directly** rather than re-declaring its own request type. The plan §2.1 sketched a self-contained interface, but the SDK's type is exactly what `vision-client.ts:buildBatchRequest` already returns — re-typing would duplicate. The cost-of-coupling here is zero since we're already importing the SDK type elsewhere.
2. **`adaptVisionSdkForBatches` returns nullable** rather than throwing. Defensive against older SDKs + test stubs. The runner's caller-facing log is operator-readable: *"the runtime client doesn't expose messages.batches.{create,retrieve,results}. Upgrade the SDK or use --mode=live."*
3. **No live invocation** per Al's instruction. Unit tests cover the wiring; live runs already done via `--mode=live` so re-running is wasteful duplication.

**Items surfaced for downstream**: none. The path is mechanical from here. When Antarctica + Arctic expansion lands and the corpus grows past 10K images, sharding the batch becomes a future concern (Anthropic's per-batch limit at writing).

**Hand-off**:
- `progress.md` updated with the 2026-05-13 entry.
- `next-steps.md` Chunk C item flipped: `--mode=batches` ✅ landed (was ⏳ deferred).
- `decisions.md` carries C.batch-1..4.
- `gotchas.md` entry rewritten as closed.
