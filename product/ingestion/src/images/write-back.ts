/**
 * Write-back logic for the C.t6 image annotation pipeline.
 *
 * Per HITL Q2 (2026-05-01) and the 2026-05-02 fold of C.t3a's image-
 * annotation classifier:
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
 *   - `subject_tags` / `mood_tags` / `region_tags` / `tags` ALWAYS
 *      write the model's output. These columns existed in migration 002
 *      with `DEFAULT '{}'`; the GIN indexes (003 + 008) cover them. The
 *      Vision call now produces these arrays in the same single call
 *      that produces description + annotation (HITL fold 2026-05-02 —
 *      one call, six outputs, no separate Haiku classifier pass).
 *
 *   - `modified_at` updates so the operator can spot freshly-annotated
 *      rows in `psql` (`ORDER BY modified_at DESC LIMIT 20`).
 *
 * Pre-fold (single-shape SQL with branches by which prose was present)
 * we had three SQL strings; with four always-written tag arrays added
 * we collapse to a single SQL — the description COALESCE handles the
 * "only when upstream empty" case inline. The branches kept the SQL
 * legible at the cost of three query shapes; one query shape with
 * COALESCE is simpler and the perf cost is negligible at single-row
 * UPDATE rates.
 */

import type pg from 'pg';

export interface WriteBackResult {
  descriptionWritten: boolean;
  annotationWritten: boolean;
  tagsWritten: boolean;
}

/**
 * Apply a single annotation outcome to an `image` row.
 *
 * Writes happen via a single SQL UPDATE that touches all six output
 * columns plus `modified_at`. The `description` write is gated by the
 * COALESCE-NULLIF check; the `annotation` + tag-array writes happen
 * unconditionally other than the non-empty-string gate the caller
 * enforces on the prose fields.
 *
 * If the caller passes empty/whitespace-only prose AND empty tag
 * arrays, no SQL fires (true skip).
 */
export async function writeAnnotation(
  client: pg.PoolClient,
  args: {
    imageId: number;
    description: string;
    annotation: string;
    subjectTags?: string[];
    moodTags?: string[];
    regionTags?: string[];
    tags?: string[];
  },
): Promise<WriteBackResult> {
  const description = args.description.trim();
  const annotation = args.annotation.trim();
  const subjectTags = args.subjectTags ?? [];
  const moodTags = args.moodTags ?? [];
  const regionTags = args.regionTags ?? [];
  const tags = args.tags ?? [];

  const hasProse = description.length > 0 || annotation.length > 0;
  const hasTags =
    subjectTags.length > 0 ||
    moodTags.length > 0 ||
    regionTags.length > 0 ||
    tags.length > 0;

  if (!hasProse && !hasTags) {
    return {
      descriptionWritten: false,
      annotationWritten: false,
      tagsWritten: false,
    };
  }

  // We always emit the same SQL shape regardless of which prose fields
  // are present. The COALESCE on description preserves an upstream
  // value; passing an empty-string for $2 still preserves it (because
  // NULLIF('', '') = NULL). For annotation, an empty string is
  // perfectly legal — it just writes the empty string back, which is a
  // documented operator-readable signal that this run produced no
  // annotation. In practice the runner already gates on isSkipSignal,
  // so empty-empty doesn't reach this code.

  const sql = `
    UPDATE image
       SET description  = COALESCE(NULLIF(TRIM(description), ''), NULLIF($2, '')),
           annotation   = NULLIF($3, ''),
           subject_tags = $4::text[],
           mood_tags    = $5::text[],
           region_tags  = $6::text[],
           tags         = $7::text[],
           modified_at  = NOW()
     WHERE id = $1
     RETURNING (
       COALESCE(NULLIF(TRIM(description), ''), '') = $2 AND $2 <> ''
     ) AS desc_written,
     ($3 <> '') AS ann_written,
     (
       COALESCE(array_length($4::text[], 1), 0) +
       COALESCE(array_length($5::text[], 1), 0) +
       COALESCE(array_length($6::text[], 1), 0) +
       COALESCE(array_length($7::text[], 1), 0) > 0
     ) AS tags_written
  `;
  const res = await client.query<{
    desc_written: boolean;
    ann_written: boolean;
    tags_written: boolean;
  }>(sql, [args.imageId, description, annotation, subjectTags, moodTags, regionTags, tags]);
  const row = res.rows[0];
  return {
    descriptionWritten: row?.desc_written ?? false,
    annotationWritten: row?.ann_written ?? false,
    tagsWritten: row?.tags_written ?? false,
  };
}
