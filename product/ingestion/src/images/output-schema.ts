/**
 * Zod schema for the structured-output of the C.t6 image annotation
 * pipeline.
 *
 * Per HITL Q1 + Q6 (2026-05-01) and the 2026-05-02 fold of C.t3a's
 * image-annotation classifier into this Vision call: a single Claude
 * Vision call returns SIX outputs — two prose fields plus four tag
 * arrays. The pipeline validates against this schema before any write-
 * back. Parse failures are recorded as `failed` in the checkpoint with a
 * `parse_error` reason; nothing gets written.
 *
 * Empty `description` AND `annotation` (both prose fields blank) is the
 * legitimate non-fatal skip signal — the prompt instructs the model to
 * return all-empty for unreachable / corrupt / non-Patagonia images.
 * The pipeline treats that as a `skipped` outcome (not `done`, not
 * `failed`) and does not write to the row. The four tag arrays are
 * always permitted to be empty without triggering skip.
 */

import { z } from 'zod';

/**
 * The structured-output shape per HITL Q1 + 2026-05-02 fold.
 *
 * - `description`: 1–2 sentence journey-shaped paragraph. Plain prose.
 * - `annotation`:  1–2 sentence generic descriptive text for tsvector.
 * - `subject_tags`: short array of subject nouns (granite, ice, …).
 * - `mood_tags`:    short array of mood words (vast, intimate, …).
 * - `region_tags`:  short array of place slugs (torres-del-paine, …).
 * - `tags`:         short free-form catch-all array.
 *
 * Both prose fields are strings (possibly empty — see the empty-string
 * skip-signal branch above). The four tag arrays default to `[]` so a
 * model that omits them entirely still parses. We do NOT enforce
 * `.min(1)` on prose because that would conflate "model returned empty
 * by design" with "schema violation". The run-time logic distinguishes
 * the two via `isSkipSignal`.
 */
export const ImageAnnotationOutputSchema = z
  .object({
    description: z.string(),
    annotation: z.string(),
    subject_tags: z.array(z.string()).default([]),
    mood_tags: z.array(z.string()).default([]),
    region_tags: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  })
  .strict();

export type ImageAnnotationOutput = z.infer<typeof ImageAnnotationOutputSchema>;

/**
 * True when the model's structured output is the explicit "skip this
 * image" signal — both prose fields blank after trim. The four tag
 * arrays are not consulted: a non-skip output may legitimately leave a
 * bucket empty.
 */
export function isSkipSignal(output: ImageAnnotationOutput): boolean {
  return output.description.trim() === '' && output.annotation.trim() === '';
}
