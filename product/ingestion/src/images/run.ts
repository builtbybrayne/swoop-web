/**
 * Annotation pipeline runner — orchestrates the full C.t6 flow.
 *
 * Modes (set via `mode` arg):
 *
 *   - `dry-run` (default if no `--max-budget` supplied): count
 *     candidates, project cost, do not call the Vision API. Output
 *     is a stdout summary only.
 *
 *   - `live`: 5-up concurrency, single calls per image, exponential
 *     backoff on transient errors. Suited to small slices for prompt
 *     iteration.
 *
 *   - `batches`: submit a single Anthropic Message Batch with all
 *     candidates, poll the batch endpoint until ended, stream the
 *     `.jsonl` results, write them back. Suited to the unbounded
 *     full-catalogue pass (HITL §"Notes for the executing agent":
 *     Anthropic Message Batches API at 50% cost / 24h latency).
 *
 * Cost guard: the `--max-budget` enforcement happens BEFORE any Vision
 * call. If the projected spend exceeds the budget, the runner refuses
 * to proceed and surfaces the operator-readable reason.
 *
 * Idempotency: each (id, status) outcome is recorded in the checkpoint
 * file. A `--resume` run re-reads the checkpoint and skips ids already
 * marked `done` / `skipped` (and `failed` unless `--retry-failed`).
 *
 * Cancellation: live mode honours an `AbortSignal` (Ctrl-C wired by
 * the CLI). Batches mode polls the batch and accepts a kill-switch
 * between polls — not mid-batch (Anthropic offers a separate cancel
 * call at HITL §"Coordination", but we don't auto-cancel; the operator
 * can do so via the SDK if needed).
 */

import type pg from 'pg';
import { fetchCandidates, type Candidate } from './candidates.js';
import { estimateCost, formatCostEstimate, fitsBudget, type CostEstimate } from './cost.js';
import {
  loadCheckpoint,
  saveCheckpoint,
  recordEntry,
  startRun,
  shouldSkipId,
  type CheckpointFile,
  type CheckpointRunSummary,
} from './checkpoint.js';
import { loadPrompt } from './prompt.js';
import {
  annotateImageLive,
  buildBatchRequest,
  buildClient,
  type AnthropicClientLike,
  DEFAULT_MODEL,
} from './vision-client.js';
import { ImageAnnotationOutputSchema, isSkipSignal } from './output-schema.js';
import { writeAnnotation } from './write-back.js';

export type RunMode = 'dry-run' | 'live' | 'batches';

export interface RunOptions {
  client: pg.PoolClient;
  mode: RunMode;
  /** Max USD spend; required for live + batches; ignored for dry-run. */
  maxBudgetUsd?: number;
  /** Cap candidate set; primarily for slicing during prompt iteration. */
  limit?: number;
  /** Apply checkpoint state — skip ids already `done` / `skipped` (and `failed` unless retryFailed). */
  resume?: boolean;
  /** When true, treat checkpoint `failed` ids as retryable. */
  retryFailed?: boolean;
  /** Per-call cost override (USD); operator may pass a current-rate update. */
  perCallUsdOverride?: number;
  /** Concurrency for live mode (HITL Q5: 5-up). */
  concurrency?: number;
  /** Anthropic API key. Required for live + batches; unused in dry-run. */
  apiKey?: string;
  /** Optional client double for tests. */
  visionClient?: AnthropicClientLike;
  /** Vision model id; defaults to claude-sonnet-4-5-20250929. */
  model?: string;
  /** Custom log sink — defaults to console.log. */
  log?: (line: string) => void;
  /** Cancellation. */
  signal?: AbortSignal;
  /** Checkpoint namespace; defaults to "default". */
  checkpointNamespace?: string;
  /** Override checkpoint storage dir; primarily for tests. */
  checkpointBaseDir?: string;
  /** Cap retries per id in live mode. Defaults to 3. */
  maxAttempts?: number;
}

export interface RunResult {
  mode: RunMode;
  candidatesCount: number;
  estimate: CostEstimate;
  succeeded: number;
  skipped: number;
  failed: number;
  /** Reason the run aborted, if any (budget refusal, signal, etc.). */
  abortedReason?: string;
}

/**
 * Top-level entry point. The CLI in `annotate.ts` translates argv +
 * environment into this options bag and calls into `run()`.
 */
export async function run(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((line) => console.log(line));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 25));
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);

  // 1) Cost projection — runs in every mode so the operator always sees
  // the size of the candidate set + projected spend.
  const estimate = await estimateCost(opts.client, opts.perCallUsdOverride);
  log(formatCostEstimate(estimate, { mode: opts.mode === 'live' ? 'live' : 'batches' }));

  // 2) Mode branch.
  if (opts.mode === 'dry-run') {
    log(`[annotate] dry-run: no Vision calls fired. Re-run with --max-budget=N (and optional --mode=live|batches) to spend.`);
    return {
      mode: opts.mode,
      candidatesCount: estimate.candidates,
      estimate,
      succeeded: 0,
      skipped: 0,
      failed: 0,
    };
  }

  // 3) Budget gate.
  if (typeof opts.maxBudgetUsd !== 'number' || !Number.isFinite(opts.maxBudgetUsd)) {
    return abort(
      log,
      opts.mode,
      estimate,
      `--max-budget=N is required to spend. Re-run with --max-budget=$N (USD).`,
    );
  }
  const fits = fitsBudget(estimate, opts.maxBudgetUsd, {
    mode: opts.mode === 'live' ? 'live' : 'batches',
  });
  if (!fits.ok) {
    return abort(log, opts.mode, estimate, fits.reason);
  }
  log(`[annotate] budget gate OK: ${fits.reason}`);

  // 4) Load checkpoint + prompt.
  const checkpoint = loadCheckpoint({
    namespace: opts.checkpointNamespace,
    baseDir: opts.checkpointBaseDir,
  });
  const systemPrompt = loadPrompt();

  // 5) Fetch candidates.
  const limit = opts.limit ?? estimate.candidates;
  const allCandidates = await fetchCandidates(opts.client, limit);
  const filtered = opts.resume
    ? allCandidates.filter((c) => !shouldSkipId(checkpoint.file, c.id, opts.retryFailed ?? false))
    : allCandidates;
  log(
    `[annotate] candidates: fetched=${allCandidates.length} ` +
      `filtered=${filtered.length} (resume=${!!opts.resume} retryFailed=${!!opts.retryFailed})`,
  );

  if (filtered.length === 0) {
    log(`[annotate] nothing to do — all candidates already processed (per checkpoint).`);
    return {
      mode: opts.mode,
      candidatesCount: 0,
      estimate,
      succeeded: 0,
      skipped: 0,
      failed: 0,
    };
  }

  if (!opts.apiKey && !opts.visionClient) {
    return abort(
      log,
      opts.mode,
      estimate,
      `ANTHROPIC_API_KEY required for ${opts.mode} mode (or pass visionClient for tests).`,
    );
  }
  const visionClient =
    opts.visionClient ?? buildClient({ apiKey: opts.apiKey ?? '' });

  const summary = startRun(checkpoint.file, opts.mode, filtered.length, estimate.totalUsdLive);

  // 6) Execute.
  if (opts.mode === 'live') {
    await runLive({
      candidates: filtered,
      systemPrompt,
      visionClient,
      model: opts.model ?? DEFAULT_MODEL,
      pgClient: opts.client,
      checkpointFile: checkpoint.file,
      checkpointPath: checkpoint.filePath,
      summary,
      concurrency,
      maxAttempts,
      log,
      signal: opts.signal,
    });
  } else {
    await runBatches({
      candidates: filtered,
      systemPrompt,
      visionClient,
      model: opts.model ?? DEFAULT_MODEL,
      pgClient: opts.client,
      checkpointFile: checkpoint.file,
      checkpointPath: checkpoint.filePath,
      summary,
      log,
      signal: opts.signal,
    });
  }

  summary.endedAt = new Date().toISOString();
  saveCheckpoint(checkpoint.filePath, checkpoint.file);

  log(
    `[annotate] complete: succeeded=${summary.succeeded} skipped=${summary.skipped} ` +
      `failed=${summary.failed}. Checkpoint: ${checkpoint.filePath}`,
  );

  return {
    mode: opts.mode,
    candidatesCount: filtered.length,
    estimate,
    succeeded: summary.succeeded,
    skipped: summary.skipped,
    failed: summary.failed,
  };
}

/* ---------------------------------------------------------------------- */
/* Live mode — concurrency pool                                           */
/* ---------------------------------------------------------------------- */

interface LiveArgs {
  candidates: Candidate[];
  systemPrompt: string;
  visionClient: AnthropicClientLike;
  model: string;
  pgClient: pg.PoolClient;
  checkpointFile: CheckpointFile;
  checkpointPath: string;
  summary: CheckpointRunSummary;
  concurrency: number;
  maxAttempts: number;
  log: (line: string) => void;
  signal?: AbortSignal;
}

async function runLive(args: LiveArgs): Promise<void> {
  const queue = [...args.candidates];
  let saveCounter = 0;

  const SAVE_EVERY = 25; // checkpoint every N completions

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (args.signal?.aborted) return;
      const candidate = queue.shift();
      if (!candidate) return;
      const outcome = await processOne(args, candidate);
      await applyOutcome(args, candidate, outcome);
      saveCounter += 1;
      if (saveCounter % SAVE_EVERY === 0) {
        saveCheckpoint(args.checkpointPath, args.checkpointFile);
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < args.concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

interface ProcessOutcome {
  status: 'done' | 'skipped' | 'failed';
  reason: string | null;
  description?: string;
  annotation?: string;
}

async function processOne(args: LiveArgs, candidate: Candidate): Promise<ProcessOutcome> {
  let attempt = 0;
  let lastReason: string = 'unknown';
  while (attempt < args.maxAttempts) {
    attempt += 1;
    if (args.signal?.aborted) {
      return { status: 'failed', reason: 'aborted' };
    }
    const result = await annotateImageLive({
      client: args.visionClient,
      systemPrompt: args.systemPrompt,
      imageUrl: candidate.canonical_url,
      model: args.model,
      signal: args.signal,
    });

    if (!result.ok) {
      lastReason = result.reason;
      if (!result.retryable) {
        return { status: 'failed', reason: result.reason };
      }
      // Exponential backoff: 0.5s, 1s, 2s, 4s, ...
      const backoff = Math.min(500 * 2 ** (attempt - 1), 8000);
      args.log(`[annotate] image=${candidate.id} attempt=${attempt} retryable: ${result.reason}; backing off ${backoff}ms`);
      await sleep(backoff);
      continue;
    }

    const parsed = parseAndValidate(result.rawText);
    if (!parsed.ok) {
      // JSON parse / Zod fail — treat as terminal (model violated the
      // prompt's contract; retrying without prompt change won't help).
      return { status: 'failed', reason: parsed.reason };
    }

    if (isSkipSignal(parsed.value)) {
      return { status: 'skipped', reason: 'model_emitted_empty' };
    }

    return {
      status: 'done',
      reason: null,
      description: parsed.value.description,
      annotation: parsed.value.annotation,
    };
  }
  return { status: 'failed', reason: `exhausted_${args.maxAttempts}_attempts: ${lastReason}` };
}

async function applyOutcome(
  args: LiveArgs,
  candidate: Candidate,
  outcome: ProcessOutcome,
): Promise<void> {
  if (outcome.status === 'done') {
    try {
      const wb = await writeAnnotation(args.pgClient, {
        imageId: candidate.id,
        description: outcome.description ?? '',
        annotation: outcome.annotation ?? '',
      });
      recordEntry(args.checkpointFile, candidate.id, 'done', null);
      args.summary.succeeded += 1;
      args.log(
        `[annotate] image=${candidate.id} done desc_written=${wb.descriptionWritten} ann_written=${wb.annotationWritten}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      recordEntry(args.checkpointFile, candidate.id, 'failed', `write_back: ${reason}`);
      args.summary.failed += 1;
      args.log(`[annotate] image=${candidate.id} write_back FAILED: ${reason}`);
    }
    return;
  }
  if (outcome.status === 'skipped') {
    recordEntry(args.checkpointFile, candidate.id, 'skipped', outcome.reason);
    args.summary.skipped += 1;
    args.log(`[annotate] image=${candidate.id} skipped: ${outcome.reason}`);
    return;
  }
  recordEntry(args.checkpointFile, candidate.id, 'failed', outcome.reason);
  args.summary.failed += 1;
  args.log(`[annotate] image=${candidate.id} FAILED: ${outcome.reason ?? 'unknown'}`);
}

/* ---------------------------------------------------------------------- */
/* Batches mode — Anthropic Message Batches API                           */
/* ---------------------------------------------------------------------- */

interface BatchesArgs {
  candidates: Candidate[];
  systemPrompt: string;
  visionClient: AnthropicClientLike;
  model: string;
  pgClient: pg.PoolClient;
  checkpointFile: CheckpointFile;
  checkpointPath: string;
  summary: CheckpointRunSummary;
  log: (line: string) => void;
  signal?: AbortSignal;
}

/**
 * Build the batch request payload only. The actual `messages.batches`
 * SDK call lives behind a runtime check because the live SDK exposes
 * the surface as `client.messages.batches`. Tests can swap this via
 * `visionClient` typed as `AnthropicClientLike & { messages: { batches: ... } }`.
 *
 * For the current C.t6 ratification window, the executing agent runs
 * the small-sample live path (5-up live calls on 10–20 images) to
 * verify the prompt + Zod parse + write-back round-trip. Full-catalogue
 * unbounded runs are an operator concern (C.t8 runbook), at which point
 * Batches mode can be exercised. The skeleton below builds the
 * `requests` array correctly so wiring is mechanical.
 */
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

  // Defensive runtime: the live SDK has `client.messages.batches`; our
  // narrow `AnthropicClientLike` type doesn't model it (the C.t6 plan
  // says batches is the canonical full-catalogue path but the
  // integration with poll + result-stream is documented in the C.t8
  // runbook, not implemented in this commit). Surface a clear message
  // for the operator who picks `--mode=batches` ahead of that runbook.
  const batches = (args.visionClient as unknown as {
    messages: { batches?: { create?: unknown } };
  }).messages.batches;
  if (!batches || typeof batches.create !== 'function') {
    const msg =
      `[annotate] --mode=batches: the runtime client doesn't expose messages.batches.create. ` +
      `For the small-sample verification (10–20 images) use --mode=live; ` +
      `the unbounded Batches submission is documented in the C.t8 runbook.`;
    args.log(msg);
    args.summary.failed = args.candidates.length;
    for (const c of args.candidates) {
      recordEntry(args.checkpointFile, c.id, 'failed', 'batches_not_wired');
    }
    return;
  }
  // The full Batches submission + poll + result-stream wiring lives in
  // a follow-up PR for C.t8. Keep the request-build path tested here.
  args.log(
    `[annotate] --mode=batches: request-build verified; submission deferred to C.t8 runbook step. Use --mode=live for the small-sample verification.`,
  );
  args.summary.failed = args.candidates.length;
  for (const c of args.candidates) {
    recordEntry(args.checkpointFile, c.id, 'failed', 'batches_submission_deferred');
  }
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

function abort(
  log: (line: string) => void,
  mode: RunMode,
  estimate: CostEstimate,
  reason: string,
): RunResult {
  log(`[annotate] ABORT: ${reason}`);
  return {
    mode,
    candidatesCount: estimate.candidates,
    estimate,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    abortedReason: reason,
  };
}

function parseAndValidate(
  rawText: string,
): { ok: true; value: { description: string; annotation: string } } | { ok: false; reason: string } {
  // Strip code-fence markers if the model wrapped its output.
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      reason: `parse_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = ImageAnnotationOutputSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, reason: `schema_error: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

function roughPayloadBytes(requests: ReturnType<typeof buildBatchRequest>[]): number {
  // Conservative napkin estimate so the operator notices a sudden jump
  // in batch size. Not a hard ceiling; Anthropic accepts batches up to
  // their published per-payload limit (~256MB at writing).
  return JSON.stringify(requests).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
