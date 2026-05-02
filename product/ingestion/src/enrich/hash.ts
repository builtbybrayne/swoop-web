/**
 * Content-hash helpers — the idempotency contract.
 *
 * Every embedded / classified row carries a `content_hash` column. Re-runs
 * skip rows whose stored hash matches the recomputed hash. The hash composes:
 *
 *   sha256(text || '|' || source_type || '|' || version)
 *
 * `version` lets us force a re-run after a chunking-rule or prompt change
 * without touching the source rows. Bump it sparingly — every bump
 * re-embeds / re-classifies the entire affected slice.
 *
 * `source_type` segregates hashes across tables so two different tables that
 * happen to share the same prose don't collide their content_hashes.
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-pass design — Per-source-row
 * embedding — content_hash composition rule per source type".
 */

import { createHash } from 'node:crypto';

/**
 * Embedding-pass hash version. Bump when the embedding-input rule changes
 * (add/remove a concatenated field, change tokenisation, etc.). Forces a
 * full re-embed across all rows whose stored version differs.
 */
export const EMBED_HASH_VERSION = 1;

/**
 * Classifier-pass hash version. Bump when classifier prompts change in a
 * way that should propagate (i.e. the prompt frontmatter `version` field).
 * Lives separately because embed and classify versions evolve independently.
 */
export const CLASSIFY_HASH_VERSION = 1;

/**
 * Compute a stable SHA-256 over `text + source_type + version`.
 * Caller composes `text` from whatever fields make up the hash input
 * (page id + chunk index + body, customerreview prose aggregate, etc.).
 */
export function contentHash(
  text: string,
  sourceType: string,
  version: number = EMBED_HASH_VERSION,
): string {
  return createHash('sha256')
    .update(`${text}|${sourceType}|${version}`)
    .digest('hex');
}

/**
 * Convenience helper: hash a tag taxonomy snapshot.
 *
 * Used by the blog-tag-normalisation classifier so that a new ntag row in
 * the live taxonomy invalidates every blog post's stored normalisation hash.
 * The snapshot is sorted by id for stability across runs.
 */
export function ntagSnapshotHash(
  rows: ReadonlyArray<{ id: number; alias: string | null; type: string }>,
): string {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const serialised = sorted.map((r) => `${r.id}:${r.alias ?? ''}:${r.type}`).join('\n');
  return createHash('sha256').update(serialised).digest('hex');
}
