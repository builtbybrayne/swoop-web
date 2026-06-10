/**
 * Provenance projection helpers — source title + publication date.
 *
 * Per crosscut plan 03-exec-crosscut-magical-poincare-retrieval-provenance.md
 * (Luke feedback L2 + D1, 2026-06-10): derived rows carry `source_title` /
 * `source_published_at` (migration 017); the agent-visible `*Public` schemas
 * expose `sourceTitle` / `publishedAt` as OPTIONAL fields, omitted when null
 * to save tokens.
 *
 * `publishedAt` goes on the wire as an ISO date (YYYY-MM-DD) — enough for the
 * agent's date-awareness ("this figure is from a 2011 post") without
 * timestamp noise.
 */

export interface ProvenanceRow {
  source_title?: string | null;
  source_published_at?: Date | string | null;
}

export interface ProvenanceFields {
  sourceTitle?: string;
  publishedAt?: string;
}

/** Format a date as YYYY-MM-DD; returns undefined for null/invalid input. */
export function publishedAtIso(d: Date | string | null | undefined): string | undefined {
  if (d == null) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

/**
 * Spread-friendly projection: returns `{ sourceTitle?, publishedAt? }` with
 * each key present only when the underlying column is populated. Use as
 * `...provenanceFields(r)` inside a `Schema.parse({...})` literal.
 */
export function provenanceFields(row: ProvenanceRow): ProvenanceFields {
  const out: ProvenanceFields = {};
  const title = row.source_title?.trim();
  if (title) out.sourceTitle = title;
  const iso = publishedAtIso(row.source_published_at);
  if (iso) out.publishedAt = iso;
  return out;
}
