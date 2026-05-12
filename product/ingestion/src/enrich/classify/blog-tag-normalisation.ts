/**
 * Blog-tag normalisation classifier.
 *
 * Maps free-text WordPress tags to canonical ntag IDs (the 79-row taxonomy
 * the agent's tools filter against). One Haiku call per blog post; the
 * full taxonomy is sent in the user message.
 *
 * Per HITL Q4: runs via Anthropic Message Batches API.
 *
 * Plan: planning/03-exec-c-t3a.md §"D.4 Blog-tag normalisation".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import type { BatchClient, BatchRequest } from '../haiku.js';
import { waitForBatch } from '../anthropic-batch-client.js';
import type { LoadedPrompt } from '../prompts.js';
import {
  BlogTagNormalisationOutputSchema,
  type BlogTagNormalisationOutput,
} from '../schemas.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

interface NtagRow {
  id: number;
  alias: string | null;
  type: string;
  title: string;
}

interface BlogPostRow {
  id: number;
  tags: string[];
}

export interface ClassifyBlogTagNormalisationOptions {
  client: pg.PoolClient;
  batch: BatchClient;
  ledger: CostLedger;
  prompt: LoadedPrompt;
  /** Where to log unmapped raw tags for periodic review. */
  unmappedLogPath?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface ClassifyBlogTagNormalisationResult {
  postsConsidered: number;
  batched: number;
  succeeded: number;
  errored: number;
  unmappedRawTags: string[];
  estimatedInputTokens: number;
}

const TOOL_NAME = 'normalise_blog_tags';
const TOOL_DESCRIPTION =
  'Map free-text WordPress tags to canonical ntag IDs (or surface as unmapped).';

async function readNtagSnapshot(client: pg.PoolClient): Promise<NtagRow[]> {
  const r = await client.query<NtagRow>(
    `SELECT id, alias, type, title FROM tag WHERE is_active = TRUE ORDER BY id`,
  );
  return r.rows;
}

async function readBlogPostsToNormalise(
  client: pg.PoolClient,
  limit?: number,
): Promise<BlogPostRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  // Run on every post that has raw tags but no mapped ntag_ids yet.
  const r = await client.query<BlogPostRow>(
    `SELECT id, tags
     FROM blog_post
     WHERE coalesce(array_length(tags, 1), 0) > 0
       AND coalesce(array_length(ntag_ids, 1), 0) = 0
     ORDER BY id
     ${limitClause}`,
  );
  return r.rows;
}

function buildTaxonomySnapshotMessage(ntags: NtagRow[]): string {
  const lines = ntags.map(
    (t) => `${t.id} | ${t.alias ?? ''} | ${t.type} | ${t.title}`,
  );
  return `Taxonomy (id | alias | type | title):\n${lines.join('\n')}`;
}

export async function classifyBlogTagNormalisation(
  opts: ClassifyBlogTagNormalisationOptions,
): Promise<ClassifyBlogTagNormalisationResult> {
  const ntags = await readNtagSnapshot(opts.client);
  const taxonomyText = buildTaxonomySnapshotMessage(ntags);

  const posts = await readBlogPostsToNormalise(opts.client, opts.limit);

  const requests: BatchRequest[] = posts.map((p) => ({
    customId: `blog_tags:${p.id}`,
    systemPrompt: opts.prompt.systemPrompt,
    userMessage: `${taxonomyText}\n\nBlog post id ${p.id} raw tags: ${p.tags.join(', ')}`,
    outputToolName: TOOL_NAME,
    outputToolDescription: TOOL_DESCRIPTION,
    outputToolSchema: BlogTagNormalisationOutputSchema,
    model: opts.prompt.frontmatter.model,
    temperature: opts.prompt.frontmatter.temperature,
    maxTokens: 256,
  }));

  let estimatedInputTokens = 0;
  for (const req of requests) {
    estimatedInputTokens += approxTokenCount(req.systemPrompt) + approxTokenCount(req.userMessage);
  }

  const unmappedAccum = new Set<string>();

  if (opts.dryRun || posts.length === 0) {
    if (opts.dryRun) {
      opts.ledger.recordHaiku(
        'haiku:blog_tag_normalisation',
        0,
        0,
        requests.length,
        opts.batch.isBatched,
      );
    }
    return {
      postsConsidered: posts.length,
      batched: opts.dryRun ? requests.length : 0,
      succeeded: 0,
      errored: 0,
      unmappedRawTags: [],
      estimatedInputTokens,
    };
  }

  if (opts.ledger.shouldAbort()) {
    throw new Error(`[enrich/classify/blog-tag-normalisation] cost-cap reached before submit; aborting`);
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
    const parsed = BlogTagNormalisationOutputSchema.safeParse(r.output);
    if (!parsed.success) {
      errored += 1;
      continue;
    }
    actualInputTokens += r.inputTokens;
    actualOutputTokens += r.outputTokens;
    for (const u of parsed.data.unmapped_raw_tags) unmappedAccum.add(u);

    const idStr = r.customId.split(':')[1];
    const postId = idStr ? Number(idStr) : NaN;
    if (Number.isFinite(postId)) {
      // Filter mapped ids to only those that exist in the taxonomy snapshot,
      // belt-and-braces against model hallucination.
      const validIds = new Set(ntags.map((n) => n.id));
      const mappedIds: BlogTagNormalisationOutput['ntag_ids'] = parsed.data.ntag_ids.filter((id) =>
        validIds.has(id),
      );
      await opts.client.query(
        `UPDATE blog_post SET ntag_ids = $1, modified_at = NOW() WHERE id = $2`,
        [mappedIds, postId],
      );
      succeeded += 1;
    }
  }

  opts.ledger.recordHaiku(
    'haiku:blog_tag_normalisation',
    actualInputTokens,
    actualOutputTokens,
    succeeded + errored,
    opts.batch.isBatched,
  );

  // Persist unmapped tags for periodic review.
  if (opts.unmappedLogPath && unmappedAccum.size > 0) {
    mkdirSync(path.dirname(opts.unmappedLogPath), { recursive: true });
    writeFileSync(
      opts.unmappedLogPath,
      JSON.stringify(
        {
          recorded_at: new Date().toISOString(),
          unmapped: [...unmappedAccum].sort(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  return {
    postsConsidered: posts.length,
    batched: requests.length,
    succeeded,
    errored,
    unmappedRawTags: [...unmappedAccum],
    estimatedInputTokens,
  };
}
