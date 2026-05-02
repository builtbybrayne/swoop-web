/**
 * Write-back logic for the C.t6 image annotation pipeline.
 *
 * Per HITL Q2 (2026-05-01):
 *
 *   - `image.annotation` ALWAYS writes when the run produced a non-empty
 *      annotation. This is the new column added by migration 007.
 *
 *   - `image.description` writes ONLY when the existing column is NULL
 *      or whitespace-only. The annotation pipeline never overwrites a
 *      curated upstream description. The candidate-selection filter
 *      already excludes populated rows, so this is belt-and-braces:
 *      between candidate fetch + write-back, an upstream re-import
 *      could in theory have populated the column. The write-back's
 *      WHERE clause re-checks; the row gets the description only if
 *      it's still empty.
 *
 *   - `modified_at` updates so the operator can spot freshly-annotated
 *      rows in `psql` (`ORDER BY modified_at DESC LIMIT 20`).
 *
 * The function returns whether the description was written, separately
 * from whether the annotation was written, so the runner can log the
 * outcome accurately.
 */

import type pg from 'pg';

export interface WriteBackResult {
  descriptionWritten: boolean;
  annotationWritten: boolean;
}

/**
 * Apply a single annotation outcome to an `image` row.
 *
 * Writes are atomic — a single SQL statement updates both columns plus
 * `modified_at`. The `description` write is gated by the COALESCE check;
 * the `annotation` write happens unconditionally (other than the
 * non-empty-string gate the caller has already enforced).
 */
export async function writeAnnotation(
  client: pg.PoolClient,
  args: {
    imageId: number;
    description: string;
    annotation: string;
  },
): Promise<WriteBackResult> {
  const description = args.description.trim();
  const annotation = args.annotation.trim();

  // Branch on what the caller has — keeps the SQL legible at the cost of
  // two query shapes. (Single SQL with conditional updates would work
  // too; this is more readable and the perf cost is negligible at
  // single-row UPDATE rates.)

  if (description.length > 0 && annotation.length > 0) {
    // Both: write annotation always; write description only when empty.
    const sql = `
      UPDATE image
         SET description = COALESCE(NULLIF(TRIM(description), ''), $2),
             annotation = $3,
             modified_at = NOW()
       WHERE id = $1
       RETURNING (
         description IS DISTINCT FROM $2
           AND COALESCE(NULLIF(TRIM(description), ''), '') = $2
       ) AS desc_written,
       (annotation = $3) AS ann_written
    `;
    const res = await client.query<{ desc_written: boolean; ann_written: boolean }>(
      sql,
      [args.imageId, description, annotation],
    );
    const row = res.rows[0];
    return {
      descriptionWritten: row?.desc_written ?? false,
      annotationWritten: row?.ann_written ?? false,
    };
  }

  if (annotation.length > 0) {
    // Annotation only.
    const sql = `
      UPDATE image
         SET annotation = $2,
             modified_at = NOW()
       WHERE id = $1
       RETURNING (annotation = $2) AS ann_written
    `;
    const res = await client.query<{ ann_written: boolean }>(sql, [args.imageId, annotation]);
    return {
      descriptionWritten: false,
      annotationWritten: res.rows[0]?.ann_written ?? false,
    };
  }

  if (description.length > 0) {
    // Description only — unusual but possible if the prompt produces
    // one and not the other. Still gated on upstream emptiness.
    const sql = `
      UPDATE image
         SET description = COALESCE(NULLIF(TRIM(description), ''), $2),
             modified_at = NOW()
       WHERE id = $1
       RETURNING (
         COALESCE(NULLIF(TRIM(description), ''), '') = $2
       ) AS desc_written
    `;
    const res = await client.query<{ desc_written: boolean }>(sql, [args.imageId, description]);
    return {
      descriptionWritten: res.rows[0]?.desc_written ?? false,
      annotationWritten: false,
    };
  }

  return { descriptionWritten: false, annotationWritten: false };
}
