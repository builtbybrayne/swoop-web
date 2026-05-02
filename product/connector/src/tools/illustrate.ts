/**
 * `illustrate` handler — visual companion to any of the content tools.
 *
 * The journey moment: prose is doing too much; an image carries more. Returns
 * curated images matching keywords (and optional region slug). Per HITL Q1
 * ratification: ships against whatever C.t6 annotation coverage exists at
 * execution time. Where annotation is absent, those rows simply don't match
 * keyword embeddings and won't surface — no defensive fallback.
 *
 * Coverage gaps are an observability concern (logged via the F-a `tool.invoked`
 * event's outputCount), not a schema concern.
 */

import {
  IllustrateInputSchema,
  IllustrateOutputSchema,
  type IllustrateInput,
  type IllustrateOutput,
} from '@swoop/common';

import { findImagesByKeywords } from '../data/find-images-by-keywords.js';
import type { ToolHandlerDeps } from './deps.js';

const DEFAULT_COUNT = 4;

export async function illustrateBody(
  input: IllustrateInput,
  deps: ToolHandlerDeps,
): Promise<IllustrateOutput> {
  const limit = input.count ?? DEFAULT_COUNT;
  // Embed the joined keywords as a single search vector — Voyage handles
  // natural-language phrasing better than concatenated tokens, but this is
  // close enough for the keyword shape `illustrate` carries.
  const embedding = await deps.embedQuery(input.keywords.join(' '));
  const images = await deps.withClient((client) =>
    findImagesByKeywords(client, embedding, input.keywords, {
      regionSlug: input.regionSlug,
      limit,
    }),
  );
  return IllustrateOutputSchema.parse({ images });
}

export const illustrateSpec = {
  name: 'illustrate' as const,
  inputSchema: IllustrateInputSchema,
  outputSchema: IllustrateOutputSchema,
};
