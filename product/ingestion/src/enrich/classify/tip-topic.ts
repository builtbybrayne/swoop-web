/**
 * Tip-topic classifier (find_tips — the 9th MCP tool).
 *
 * Per-row classification (NO aggregation — structurally a sibling of the
 * blog-post-job classifier, NOT persona-summary): each customer_tip row gets
 * zero-or-more topic_tags from the fixed 8-topic taxonomy plus an optional
 * Patagonian sub-region. The classifier writes topic_tags + region +
 * classified_at back to customer_tip.
 *
 * Idempotency gate: `classified_at IS NULL`. Re-running after a prompt-version
 * bump (or to re-classify a slice whose text changed) requires the operator to
 * `UPDATE customer_tip SET classified_at = NULL WHERE …` — explicit, prevents
 * accidental re-batching of the whole table. This mirrors blog-post-job's
 * NULL-gate convention exactly.
 *
 * Per HITL Q4 (2026-05-01): runs via the Anthropic Message Batches API for the
 * 50% discount, same as the other classifier passes.
 *
 * Plan: planning/03-exec-customer-tips-tool.md §"Tip-topic classifier".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import type { BatchClient, BatchRequest } from '../haiku.js';
import { waitForBatch } from '../anthropic-batch-client.js';
import type { LoadedPrompt } from '../prompts.js';
import { TipTopicOutputSchema, type TipTopicOutput } from '../schemas.js';

interface TipRow {
  id: number;
  text: string;
  author_name: string | null;
}

export interface ClassifyTipTopicOptions {
  client: pg.PoolClient;
  batch: BatchClient;
  ledger: CostLedger;
  prompt: LoadedPrompt;
  limit?: number;
  dryRun?: boolean;
}

export interface ClassifyTipTopicResult {
  tipsConsidered: number;
  batched: number;
  succeeded: number;
  errored: number;
  estimatedInputTokens: number;
  /** customId → output mapping for post-batch verification / tests. */
  outputs: Map<string, TipTopicOutput>;
}

const TOOL_NAME = 'classify_tip_topic';
const TOOL_DESCRIPTION =
  'Tag this traveller tip with its topics (from the fixed taxonomy) and an optional Patagonian sub-region.';

async function readTipsToClassify(client: pg.PoolClient, limit?: number): Promise<TipRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  // Gate on classified_at IS NULL — the idempotency key. A re-run after a
  // prompt bump requires `UPDATE customer_tip SET classified_at = NULL` for
  // the slice the operator wants re-classified (mirrors blog-post-job).
  const r = await client.query<TipRow>(
    `SELECT id, text, author_name
     FROM customer_tip
     WHERE classified_at IS NULL
     ORDER BY id
     ${limitClause}`,
  );
  return r.rows;
}

function buildTipUserMessage(tip: TipRow): string {
  return [tip.author_name ? `Traveller: ${tip.author_name}` : null, `Tip:`, tip.text]
    .filter((s) => s !== null)
    .join('\n');
}

export async function classifyTipTopic(
  opts: ClassifyTipTopicOptions,
): Promise<ClassifyTipTopicResult> {
  const tips = await readTipsToClassify(opts.client, opts.limit);

  const requests: BatchRequest[] = tips.map((t) => ({
    customId: `customer_tip:${t.id}`,
    systemPrompt: opts.prompt.systemPrompt,
    userMessage: buildTipUserMessage(t),
    outputToolName: TOOL_NAME,
    outputToolDescription: TOOL_DESCRIPTION,
    outputToolSchema: TipTopicOutputSchema,
    model: opts.prompt.frontmatter.model,
    temperature: opts.prompt.frontmatter.temperature,
    maxTokens: 256,
  }));

  let estimatedInputTokens = 0;
  for (const req of requests) {
    estimatedInputTokens += approxTokenCount(req.systemPrompt) + approxTokenCount(req.userMessage);
  }

  const outputs = new Map<string, TipTopicOutput>();

  if (opts.dryRun || tips.length === 0) {
    if (opts.dryRun) {
      opts.ledger.recordHaiku('haiku:tip_topic', 0, 0, requests.length, opts.batch.isBatched);
    }
    return {
      tipsConsidered: tips.length,
      batched: opts.dryRun ? requests.length : 0,
      succeeded: 0,
      errored: 0,
      estimatedInputTokens,
      outputs,
    };
  }

  if (opts.ledger.shouldAbort()) {
    throw new Error(`[enrich/classify/tip-topic] cost-cap reached before submit; aborting`);
  }

  const submitted = await opts.batch.submit(requests);
  await waitForBatch(opts.batch, submitted.batchId, {
    shouldAbort: () => opts.ledger.shouldAbort(),
  });
  const results = await opts.batch.fetchResults(submitted.batchId);

  let succeeded = 0;
  let errored = 0;
  let actualInputTokens = 0;
  let actualOutputTokens = 0;

  for (const r of results) {
    if (r.status !== 'succeeded' || !r.output) {
      errored += 1;
      continue;
    }
    const parsed = TipTopicOutputSchema.safeParse(r.output);
    if (!parsed.success) {
      errored += 1;
      continue;
    }
    outputs.set(r.customId, parsed.data);
    actualInputTokens += r.inputTokens;
    actualOutputTokens += r.outputTokens;
    const idStr = r.customId.split(':')[1];
    const tipId = idStr ? Number(idStr) : NaN;
    if (Number.isFinite(tipId)) {
      // region: empty string → NULL (the optional field is absent or blank for
      // region-agnostic tips, which is most of them).
      const region = parsed.data.region && parsed.data.region.trim().length > 0
        ? parsed.data.region.trim()
        : null;
      await opts.client.query(
        `UPDATE customer_tip
         SET topic_tags = $1,
             region = $2,
             classified_at = NOW(),
             modified_at = NOW()
         WHERE id = $3`,
        [parsed.data.topic_tags, region, tipId],
      );
      succeeded += 1;
    }
  }

  opts.ledger.recordHaiku(
    'haiku:tip_topic',
    actualInputTokens,
    actualOutputTokens,
    succeeded + errored,
    opts.batch.isBatched,
  );

  return {
    tipsConsidered: tips.length,
    batched: requests.length,
    succeeded,
    errored,
    estimatedInputTokens,
    outputs,
  };
}
