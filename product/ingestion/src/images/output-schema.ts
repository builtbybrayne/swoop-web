/**
 * Zod schema for the structured-output of the C.t6 image annotation
 * pipeline.
 *
 * Per HITL Q1 + Q6 (2026-05-01): a single Claude Vision call returns an
 * object with both a journey-shaped `description` and a generic
 * descriptive `annotation`. The pipeline validates against this schema
 * before any write-back. Parse failures are recorded as `failed` in the
 * checkpoint with a `parse_error` reason; nothing gets written.
 *
 * Empty strings (both fields blank) are a legitimate non-fatal skip
 * signal — the prompt instructs the model to return `{description: "",
 * annotation: ""}` for unreachable / corrupt / non-Patagonia images.
 * The pipeline treats that as a `skipped` outcome (not `done`, not
 * `failed`) and does not write to the row. See run.ts for the
 * branching.
 */

import { z } from 'zod';

/**
 * The structured-output shape per HITL Q1.
 *
 * - `description`: 1–2 sentence journey-shaped paragraph. Plain prose.
 * - `annotation`:  1–2 sentence generic descriptive text for tsvector.
 *
 * Both fields are strings (possibly empty — see the empty-string
 * skip-signal branch above). We do NOT enforce `.min(1)` here because
 * that would conflate "model returned empty by design" with "schema
 * violation". The run-time logic distinguishes the two.
 */
export const ImageAnnotationOutputSchema = z
  .object({
    description: z.string(),
    annotation: z.string(),
  })
  .strict();

export type ImageAnnotationOutput = z.infer<typeof ImageAnnotationOutputSchema>;

/**
 * True when the model's structured output is the explicit "skip this
 * image" signal — both fields blank after trim. Any other shape is a
 * usable annotation.
 */
export function isSkipSignal(output: ImageAnnotationOutput): boolean {
  return output.description.trim() === '' && output.annotation.trim() === '';
}
