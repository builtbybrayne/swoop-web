// -----------------------------------------------------------------------------
// SeenItems — server-side anti-repetition state.
//
// Per planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27):
// orchestrator owns the seen-set per session. The connector is stateless;
// excludes ride into tool calls as normal validated arguments, and the
// orchestrator merges the returned ids/canonical URLs back into session state
// after each call.
//
// Keying conventions per type:
//   inspire_passage : passage.id (uuid string)
//   customer_story  : story.id (uuid string)
//   trust_proof     : proof.id (uuid string)
//   inform_chunk    : chunk.id (uuid string)
//   image           : image.canonical_url (string) — "never show the same
//                     picture twice" (HITL Q5). Two image rows with the same
//                     URL still count as one.
//   blog_post       : blog_post.canonical_url (string) — reserved for future;
//                     same URL-based dedup as images.
//   hotel           : hotel.id (integer, stringified)
//   region_base     : area.id (integer, stringified)
//   customer_tip    : tip.id (integer, stringified) — find_tips. NB the
//                     tool's `excludeIds` input is z.number[]; the
//                     orchestrator numifies on the way out (computeExcludes)
//                     and stringifies on the way in (extractSeenDelta).
//
// `trip` and `tour` are DELIBERATELY ABSENT from the schema. Swoop is selling
// trips and tours; repeating an option ("did you want to revisit the
// Highlights of Patagonia trip?") is the work, not a bug. The structural
// absence is the carve-out — no conditional logic in handlers.
//
// Wire shape is arrays-of-strings for JSON-friendliness; the in-memory hot
// path can promote to Set for O(1) membership. The orchestrator does this
// implicitly inside `mergeSeen` via Set-based dedup.
// -----------------------------------------------------------------------------

import { z } from "zod";

export const SeenItemsSchema = z
  .object({
    inspire_passage: z.array(z.string()).default([]),
    customer_story: z.array(z.string()).default([]),
    trust_proof: z.array(z.string()).default([]),
    inform_chunk: z.array(z.string()).default([]),
    image: z.array(z.string()).default([]),
    blog_post: z.array(z.string()).default([]),
    hotel: z.array(z.string()).default([]),
    region_base: z.array(z.string()).default([]),
    customer_tip: z.array(z.string()).default([]),
  })
  .default({});
export type SeenItems = z.infer<typeof SeenItemsSchema>;

/** Type-key for the dedup-eligible row types. Exported so the orchestrator
 *  and tests can keep the dispatch table type-safe. */
export type SeenItemType = keyof SeenItems;

/** Build a fresh empty seen-set. Used by the orchestrator on first read for
 *  sessions that pre-date the schema field. */
export function defaultEmptySeenItems(): SeenItems {
  return {
    inspire_passage: [],
    customer_story: [],
    trust_proof: [],
    inform_chunk: [],
    image: [],
    blog_post: [],
    hotel: [],
    region_base: [],
    customer_tip: [],
  };
}

/**
 * Union-merge a partial seen-items delta into an existing state. De-dupes
 * via Set so repeated calls with the same id are idempotent.
 *
 * Pure function. No I/O. Caller commits the result via the orchestrator's
 * session store.
 */
export function mergeSeen(
  base: SeenItems,
  delta: Partial<Record<SeenItemType, ReadonlyArray<string>>>,
): SeenItems {
  const out: SeenItems = { ...base };
  for (const key of Object.keys(delta) as SeenItemType[]) {
    const incoming = delta[key];
    if (!incoming || incoming.length === 0) continue;
    const merged = new Set<string>([...(out[key] ?? []), ...incoming]);
    out[key] = [...merged];
  }
  return out;
}
