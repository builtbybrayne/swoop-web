/**
 * Output Zod schemas for the four classifier passes.
 *
 * Each classifier's structured output shape lives here. The schema is what
 * Anthropic's tool-use returns; the classifier driver validates each
 * batch result against it (retry-once-then-fail per Plan §Open Q11).
 *
 * Plan: planning/03-exec-c-t3a.md §"Classifier prompts (CMS)" — the four
 * `output-schema.ts` files referenced. Co-locating in one file keeps the
 * Zod definitions discoverable; the prompt loader still reads `prompt.md`
 * per classifier.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// 1. Blog-post job classifier
// -----------------------------------------------------------------------------
//
// Per decision C.25 (the five conversational jobs) — assign one primary +
// up to 2 secondaries from {inspire, mirror, reassure, inform}. Adds
// 'multi' (genuinely cross-cutting; should be split into chunks anyway)
// and 'none' (admin / non-content posts) per plan §"D.1".

export const JobLabel = z.enum(['inspire', 'mirror', 'reassure', 'inform']);

export const BlogPostJobOutputSchema = z.object({
  primary_job: z.enum(['inspire', 'mirror', 'reassure', 'inform', 'multi', 'none']),
  secondary_jobs: z.array(JobLabel).max(2).default([]),
  reasoning: z.string().optional(),
});

export type BlogPostJobOutput = z.infer<typeof BlogPostJobOutputSchema>;

// -----------------------------------------------------------------------------
// 2. Persona-summary classifier
// -----------------------------------------------------------------------------
//
// Aggregated-by-reviewer-name input → 1–3 sentence persona blob.
// Per HITL Q3 (2026-05-01): anonymous rows go through a different path
// (prose embedded but persona_summary = null). This schema covers only
// the named-aggregate case.

export const PersonaSummaryOutputSchema = z.object({
  persona_summary: z.string().min(1),
  reviewer_name: z.string(),
  region_hint: z.string().optional(),
});

export type PersonaSummaryOutput = z.infer<typeof PersonaSummaryOutputSchema>;

// -----------------------------------------------------------------------------
// 3. (retired 2026-05-02) — image annotation classifier
// -----------------------------------------------------------------------------
//
// The standalone Haiku-text-only image annotation classifier was retired
// when C.t3a's image-annotation pass was folded into C.t6's unified Vision
// call (one Claude Vision call → description + annotation + four tag
// arrays). The Zod schema for the unified output now lives at
// `product/ingestion/src/images/output-schema.ts` (alongside its
// run-time consumer); this enrich-side schema entry was removed.
//
// -----------------------------------------------------------------------------
// 4. Blog-tag normalisation classifier
// -----------------------------------------------------------------------------
//
// Free-text WordPress tags → canonical 79-row ntag taxonomy. Returns ids,
// not aliases. Unmapped tags surface in `unmapped_raw_tags` for periodic
// review.

export const BlogTagNormalisationOutputSchema = z.object({
  ntag_ids: z.array(z.number().int().positive()).default([]),
  unmapped_raw_tags: z.array(z.string()).default([]),
});

export type BlogTagNormalisationOutput = z.infer<typeof BlogTagNormalisationOutputSchema>;

/**
 * Map of classifier names to schemas. Used by the prompts loader to wire
 * the right schema per folder name.
 */
export const CLASSIFIER_SCHEMAS = {
  'blog-post-job': BlogPostJobOutputSchema,
  'persona-summary': PersonaSummaryOutputSchema,
  'blog-tag-normalisation': BlogTagNormalisationOutputSchema,
} as const;

export type ClassifierName = keyof typeof CLASSIFIER_SCHEMAS;
