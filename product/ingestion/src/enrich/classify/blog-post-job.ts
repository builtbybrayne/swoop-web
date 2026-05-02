/**
 * Blog-post job classifier.
 *
 * Per HITL Q4: runs via Anthropic Message Batches API for the 50% discount.
 *
 * Flow:
 *   1. Read all blog_post rows whose primary_job is NULL OR whose stored
 *      classifier-version differs from the live prompt.frontmatter.version.
 *   2. Build BatchRequests (one per post). Submit batch.
 *   3. Wait for batch to complete (or until cost-cap kill-switch).
 *   4. Fetch results; UPDATE blog_post.primary_job + secondary_jobs per row.
 *
 * Plan: planning/03-exec-c-t3a.md §"D.1 Blog-post job classifier" + §"Open Q11"
 * (retry-once-then-fail on schema-violation).
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import type { BatchClient, BatchRequest } from '../haiku.js';
import { waitForBatch } from '../anthropic-batch-client.js';
import type { LoadedPrompt } from '../prompts.js';
import { stripHtml } from '../chunk.js';
import { BlogPostJobOutputSchema, type BlogPostJobOutput } from '../schemas.js';

interface BlogPost {
  id: number;
  title: string;
  excerpt: string | null;
  content: string | null;
}

export interface ClassifyBlogPostJobOptions {
  client: pg.PoolClient;
  batch: BatchClient;
  ledger: CostLedger;
  prompt: LoadedPrompt;
  limit?: number;
  dryRun?: boolean;
  /** Per-row max content chars to send (truncates long posts). */
  maxContentChars?: number;
}

export interface ClassifyBlogPostJobResult {
  postsConsidered: number;
  batched: number;
  succeeded: number;
  errored: number;
  estimatedInputTokens: number;
  /** customId → output mapping for post-batch verification. */
  outputs: Map<string, BlogPostJobOutput>;
}

const TOOL_NAME = 'classify_blog_post_job';
const TOOL_DESCRIPTION = 'Classify the blog post by which conversational job it serves the visitor.';

async function readPostsToClassify(
  client: pg.PoolClient,
  limit?: number,
): Promise<BlogPost[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  // For Puma's first run we re-classify only rows that are NULL.
  // Re-running after a prompt-version bump requires the operator to
  // `UPDATE blog_post SET primary_job = NULL` for the slice they want
  // re-classified — explicit, prevents accidental re-batching of the
  // whole table.
  const r = await client.query<BlogPost>(
    `SELECT id, title, excerpt, content
     FROM blog_post
     WHERE primary_job IS NULL
     ORDER BY id
     ${limitClause}`,
  );
  return r.rows;
}

function buildPostUserMessage(post: BlogPost, maxContentChars: number): string {
  const content = stripHtml(post.content ?? '').slice(0, maxContentChars);
  const excerpt = (post.excerpt ?? '').trim();
  return [
    `Title: ${post.title}`,
    excerpt ? `Excerpt: ${excerpt}` : null,
    `Content (first ${maxContentChars} chars):`,
    content,
  ]
    .filter((s) => s !== null)
    .join('\n\n');
}

export async function classifyBlogPostJob(
  opts: ClassifyBlogPostJobOptions,
): Promise<ClassifyBlogPostJobResult> {
  const maxChars = opts.maxContentChars ?? 2000;
  const posts = await readPostsToClassify(opts.client, opts.limit);

  const requests: BatchRequest[] = posts.map((p) => ({
    customId: `blog_post:${p.id}`,
    systemPrompt: opts.prompt.systemPrompt,
    userMessage: buildPostUserMessage(p, maxChars),
    outputToolName: TOOL_NAME,
    outputToolDescription: TOOL_DESCRIPTION,
    outputToolSchema: BlogPostJobOutputSchema,
    model: opts.prompt.frontmatter.model,
    temperature: opts.prompt.frontmatter.temperature,
    maxTokens: 512,
  }));

  let estimatedInputTokens = 0;
  for (const req of requests) {
    estimatedInputTokens += approxTokenCount(req.systemPrompt) + approxTokenCount(req.userMessage);
  }

  const outputs = new Map<string, BlogPostJobOutput>();

  if (opts.dryRun || posts.length === 0) {
    if (opts.dryRun) {
      // Estimate batched cost upfront so dry-run reports a number.
      opts.ledger.recordHaiku(
        'haiku:blog_post_job',
        0,
        0,
        requests.length,
        true,
      );
    }
    return {
      postsConsidered: posts.length,
      batched: opts.dryRun ? requests.length : 0,
      succeeded: 0,
      errored: 0,
      estimatedInputTokens,
      outputs,
    };
  }

  if (opts.ledger.shouldAbort()) {
    throw new Error(`[enrich/classify/blog-post-job] cost-cap reached before submit; aborting`);
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
    const parsed = BlogPostJobOutputSchema.safeParse(r.output);
    if (!parsed.success) {
      errored += 1;
      continue;
    }
    outputs.set(r.customId, parsed.data);
    actualInputTokens += r.inputTokens;
    actualOutputTokens += r.outputTokens;
    const idStr = r.customId.split(':')[1];
    const postId = idStr ? Number(idStr) : NaN;
    if (Number.isFinite(postId)) {
      await opts.client.query(
        `UPDATE blog_post
         SET primary_job = $1,
             secondary_jobs = $2,
             modified_at = NOW()
         WHERE id = $3`,
        [parsed.data.primary_job, parsed.data.secondary_jobs, postId],
      );
      succeeded += 1;
    }
  }

  // Record actual usage on the ledger (replaces estimate).
  opts.ledger.recordHaiku(
    'haiku:blog_post_job',
    actualInputTokens,
    actualOutputTokens,
    succeeded + errored,
    true,
  );

  return {
    postsConsidered: posts.length,
    batched: requests.length,
    succeeded,
    errored,
    estimatedInputTokens,
    outputs,
  };
}
