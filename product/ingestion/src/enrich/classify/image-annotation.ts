/**
 * Image annotation classifier (text-only).
 *
 * Per the 2026-04-29 image text-field finding: ~50% of images carry a
 * description / title / caption text input. This text-only pass extracts
 * subject_tags / mood_tags / region_tags / tags arrays via Haiku Batches.
 *
 * The other ~50% (no text input) are out of scope here — C.t6's vision
 * pass writes their `description`, then a follow-up enrich run picks them
 * up via this pass.
 *
 * Plan: planning/03-exec-c-t3a.md §"D.3 Image annotation classifier".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import type { BatchClient, BatchRequest } from '../haiku.js';
import { waitForBatch } from '../anthropic-batch-client.js';
import type { LoadedPrompt } from '../prompts.js';
import { ImageAnnotationOutputSchema, type ImageAnnotationOutput } from '../schemas.js';

interface ImageRow {
  id: number;
  alt_text: string | null;
  description: string | null;
  /** Note: actual db column might be empty; we filter in SQL. */
}

export interface ClassifyImageAnnotationOptions {
  client: pg.PoolClient;
  batch: BatchClient;
  ledger: CostLedger;
  prompt: LoadedPrompt;
  limit?: number;
  dryRun?: boolean;
}

export interface ClassifyImageAnnotationResult {
  imagesConsidered: number;
  batched: number;
  succeeded: number;
  errored: number;
  estimatedInputTokens: number;
}

const TOOL_NAME = 'annotate_image';
const TOOL_DESCRIPTION =
  'Normalise image text fields into subject / mood / region tags + free-text tags.';

async function readImagesNeedingAnnotation(
  client: pg.PoolClient,
  limit?: number,
): Promise<ImageRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  // Skip rows that already have any of the three tag arrays populated —
  // those have been annotated previously. The first run picks up everything;
  // re-runs after a prompt-version bump require operator to TRUNCATE the
  // tag arrays for the slice they want to re-annotate.
  const r = await client.query<ImageRow>(
    `SELECT id, alt_text, description
     FROM image
     WHERE (
            (description IS NOT NULL AND length(trim(description)) > 0)
         OR (alt_text IS NOT NULL AND length(trim(alt_text)) > 0)
       )
       AND coalesce(array_length(subject_tags, 1), 0) = 0
       AND coalesce(array_length(mood_tags, 1), 0) = 0
       AND coalesce(array_length(region_tags, 1), 0) = 0
     ORDER BY id
     ${limitClause}`,
  );
  return r.rows;
}

function buildUserMessage(row: ImageRow): string {
  return [
    `description: ${(row.description ?? '').trim()}`,
    `alt_text: ${(row.alt_text ?? '').trim()}`,
  ].join('\n');
}

export async function classifyImageAnnotation(
  opts: ClassifyImageAnnotationOptions,
): Promise<ClassifyImageAnnotationResult> {
  const images = await readImagesNeedingAnnotation(opts.client, opts.limit);

  const requests: BatchRequest[] = images.map((img) => ({
    customId: `image:${img.id}`,
    systemPrompt: opts.prompt.systemPrompt,
    userMessage: buildUserMessage(img),
    outputToolName: TOOL_NAME,
    outputToolDescription: TOOL_DESCRIPTION,
    outputToolSchema: ImageAnnotationOutputSchema,
    model: opts.prompt.frontmatter.model,
    temperature: opts.prompt.frontmatter.temperature,
    maxTokens: 256,
  }));

  let estimatedInputTokens = 0;
  for (const req of requests) {
    estimatedInputTokens += approxTokenCount(req.systemPrompt) + approxTokenCount(req.userMessage);
  }

  if (opts.dryRun || images.length === 0) {
    if (opts.dryRun) {
      opts.ledger.recordHaiku('haiku:image_annotation', 0, 0, requests.length, true);
    }
    return {
      imagesConsidered: images.length,
      batched: opts.dryRun ? requests.length : 0,
      succeeded: 0,
      errored: 0,
      estimatedInputTokens,
    };
  }

  if (opts.ledger.shouldAbort()) {
    throw new Error(`[enrich/classify/image-annotation] cost-cap reached before submit; aborting`);
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
    const parsed = ImageAnnotationOutputSchema.safeParse(r.output);
    if (!parsed.success) {
      errored += 1;
      continue;
    }
    actualInputTokens += r.inputTokens;
    actualOutputTokens += r.outputTokens;
    const idStr = r.customId.split(':')[1];
    const imgId = idStr ? Number(idStr) : NaN;
    if (Number.isFinite(imgId)) {
      const out: ImageAnnotationOutput = parsed.data;
      // Only update description if upstream lacks it AND the model produced one.
      // We use COALESCE(description, $5) so a populated upstream description
      // is preserved.
      if (out.description) {
        await opts.client.query(
          `UPDATE image
           SET subject_tags = $1,
               mood_tags = $2,
               region_tags = $3,
               tags = $4,
               description = COALESCE(description, $5),
               modified_at = NOW()
           WHERE id = $6`,
          [out.subject_tags, out.mood_tags, out.region_tags, out.tags, out.description, imgId],
        );
      } else {
        await opts.client.query(
          `UPDATE image
           SET subject_tags = $1,
               mood_tags = $2,
               region_tags = $3,
               tags = $4,
               modified_at = NOW()
           WHERE id = $5`,
          [out.subject_tags, out.mood_tags, out.region_tags, out.tags, imgId],
        );
      }
      succeeded += 1;
    }
  }

  opts.ledger.recordHaiku(
    'haiku:image_annotation',
    actualInputTokens,
    actualOutputTokens,
    succeeded + errored,
    true,
  );

  return {
    imagesConsidered: images.length,
    batched: requests.length,
    succeeded,
    errored,
    estimatedInputTokens,
  };
}
