/**
 * Persona-summary classifier — the load-bearing one.
 *
 * Per the 2026-04-30 customerreview discovery: the corpus is ~80% short
 * snippets that produce thin per-row personas; aggregate by reviewer name
 * first, then classify, to get coherent personas.
 *
 * HITL Q2 (2026-05-01): aggregation key = `name` only.
 * HITL Q3 (2026-05-01): anonymous rows (name null/empty) are KEPT in the
 * corpus but NOT aggregated into a persona. Each lands in customer_story
 * as an individual with persona_summary=null. Caller (compose/customer-story.ts)
 * handles that branch.
 *
 * This file's responsibility is ONLY the aggregate-and-classify path for
 * NAMED reviewers.
 *
 * Plan: planning/03-exec-c-t3a.md §"D.2 Persona-summary classifier" +
 * §"Aggregate-by-reviewer" load-bearing finding.
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import type { BatchClient, BatchRequest } from '../haiku.js';
import { waitForBatch } from '../anthropic-batch-client.js';
import type { LoadedPrompt } from '../prompts.js';
import {
  aggregateReviewsByName,
  ANONYMOUS_BUCKET_KEY,
  composePersonaInputProse,
  type ReviewerBucket,
} from '../chunk.js';
import { contentHash } from '../hash.js';
import { PersonaSummaryOutputSchema, type PersonaSummaryOutput } from '../schemas.js';

interface ReviewRow {
  id: number;
  content: string;
  name: string | null;
  location: string | null;
  date: Date | null;
  title: string | null;
  image_id: number | null;
}

export interface ClassifyPersonaSummaryOptions {
  client: pg.PoolClient;
  batch: BatchClient;
  ledger: CostLedger;
  prompt: LoadedPrompt;
  limit?: number;
  dryRun?: boolean;
}

export interface ClassifyPersonaSummaryResult {
  reviewsConsidered: number;
  bucketsFormed: number;
  namedBuckets: number;
  anonymousRows: number;
  batched: number;
  succeeded: number;
  errored: number;
  estimatedInputTokens: number;
  /** customId → output for downstream compose/customer-story.ts. */
  outputs: Map<string, PersonaSummaryOutput>;
  /** key (reviewer name) → bucket — exposes the aggregation result for
   *  composition. Anonymous bucket is included but caller skips persona generation for it. */
  buckets: Map<string, ReviewerBucket>;
}

const TOOL_NAME = 'summarise_persona';
const TOOL_DESCRIPTION =
  'Write a 1–3 sentence persona summary for this reviewer based on their reviews.';

async function readPublishedReviews(client: pg.PoolClient, limit?: number): Promise<ReviewRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  const r = await client.query<ReviewRow>(
    `SELECT id, content, name, location, date, title, image_id
     FROM customerreview
     WHERE is_published = TRUE
     ORDER BY id
     ${limitClause}`,
  );
  return r.rows;
}

function bucketCustomId(bucket: ReviewerBucket): string {
  // Hash the name to keep custom_id within Anthropic's allowed character set.
  // Anthropic's batch custom_id limits: alphanumeric + underscore + dash.
  const safe = bucket.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return `persona:${safe}`;
}

function buildBucketUserMessage(bucket: ReviewerBucket, prose: string): string {
  return [
    `Reviewer name: ${bucket.name}`,
    `Number of reviews: ${bucket.rows.length}`,
    `Combined review prose (most recent first):`,
    '',
    prose,
  ].join('\n');
}

export async function classifyPersonaSummary(
  opts: ClassifyPersonaSummaryOptions,
): Promise<ClassifyPersonaSummaryResult> {
  const reviews = await readPublishedReviews(opts.client, opts.limit);
  const buckets = aggregateReviewsByName(reviews);
  let anonymousRows = 0;
  let namedBuckets = 0;
  for (const [k, b] of buckets) {
    if (k === ANONYMOUS_BUCKET_KEY) anonymousRows = b.rows.length;
    else namedBuckets += 1;
  }

  // Build batch requests for the named buckets only.
  const namedBucketEntries = [...buckets.entries()].filter(([k]) => k !== ANONYMOUS_BUCKET_KEY);
  const requests: BatchRequest[] = [];
  for (const [, bucket] of namedBucketEntries) {
    const prose = composePersonaInputProse(bucket);
    if (prose.length === 0) continue;
    requests.push({
      customId: bucketCustomId(bucket),
      systemPrompt: opts.prompt.systemPrompt,
      userMessage: buildBucketUserMessage(bucket, prose),
      outputToolName: TOOL_NAME,
      outputToolDescription: TOOL_DESCRIPTION,
      outputToolSchema: PersonaSummaryOutputSchema,
      model: opts.prompt.frontmatter.model,
      temperature: opts.prompt.frontmatter.temperature,
      maxTokens: 256,
    });
  }

  let estimatedInputTokens = 0;
  for (const req of requests) {
    estimatedInputTokens += approxTokenCount(req.systemPrompt) + approxTokenCount(req.userMessage);
  }

  const outputs = new Map<string, PersonaSummaryOutput>();

  if (opts.dryRun || requests.length === 0) {
    if (opts.dryRun) {
      opts.ledger.recordHaiku(
        'haiku:persona_summary',
        0,
        0,
        requests.length,
        opts.batch.isBatched,
      );
    }
    return {
      reviewsConsidered: reviews.length,
      bucketsFormed: buckets.size,
      namedBuckets,
      anonymousRows,
      batched: opts.dryRun ? requests.length : 0,
      succeeded: 0,
      errored: 0,
      estimatedInputTokens,
      outputs,
      buckets,
    };
  }

  if (opts.ledger.shouldAbort()) {
    throw new Error(`[enrich/classify/persona-summary] cost-cap reached before submit; aborting`);
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
    const parsed = PersonaSummaryOutputSchema.safeParse(r.output);
    if (!parsed.success) {
      errored += 1;
      continue;
    }
    outputs.set(r.customId, parsed.data);
    actualInputTokens += r.inputTokens;
    actualOutputTokens += r.outputTokens;
    succeeded += 1;
  }

  opts.ledger.recordHaiku(
    'haiku:persona_summary',
    actualInputTokens,
    actualOutputTokens,
    succeeded + errored,
    opts.batch.isBatched,
  );

  return {
    reviewsConsidered: reviews.length,
    bucketsFormed: buckets.size,
    namedBuckets,
    anonymousRows,
    batched: requests.length,
    succeeded,
    errored,
    estimatedInputTokens,
    outputs,
    buckets,
  };
}

/**
 * Compute the content_hash for a customer_story row backed by a named
 * reviewer aggregate. The hash captures the reviewer name + aggregated
 * prose, so any change in either re-classifies on next run.
 */
export function namedPersonaContentHash(bucket: ReviewerBucket): string {
  const prose = composePersonaInputProse(bucket);
  return contentHash(`${bucket.name}\n${prose}`, 'persona_named');
}
