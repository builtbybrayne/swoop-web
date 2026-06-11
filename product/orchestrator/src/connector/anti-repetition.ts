/**
 * Anti-repetition orchestration helpers — server-side seen-set management.
 *
 * Per planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
 *
 * Architectural posture (Q1/Q2/Q3 resolutions):
 *   - The orchestrator owns the seen-set in `SessionState.seenItems`.
 *   - The connector stays stateless. Excludes ride into tool calls as
 *     regular validated arguments (the existing `excludeIds` /
 *     `excludeCanonicalUrls` parameter shape, generalised across every
 *     dedup-eligible primitive).
 *   - After each successful tool call, the orchestrator parses the
 *     returned ids / canonical URLs from the structured result and merges
 *     them into session state via `mergeSeen`.
 *
 * Carve-out (Q4 in the plan):
 *   - `trip_card` and `tour_card` rows are NEVER added to the seen-set
 *     (Swoop is selling trips and tours; repeats are the point).
 *   - The carve-out is structural — `SeenItemsSchema` has no `trip` or
 *     `tour` keys, so even if a future caller passed them they'd be ignored.
 *
 * Embedded images (Q6):
 *   - When a returned row (inspire_passage, customer_story) carries an
 *     embedded `image.canonicalUrl`, the image URL is marked shown too.
 *
 * Pool exhausted (Q9):
 *   - Returns empty array. The agent handles the empty case in prose.
 *
 * This module is pure (no I/O). It exports two functions:
 *   - `computeExcludes`: read seen-set, produce per-tool exclude args to
 *     merge into the tool input.
 *   - `extractSeenDelta`: parse structured tool output and build a delta to
 *     merge into seen-set.
 */

import type {
  FindOptionsInput,
  ProposalType,
  SeenItems,
} from '@swoop/common';

/**
 * Per-tool exclude payload — the subset of the tool input that the
 * orchestrator auto-injects from session state. Each tool merges these
 * shallowly with the agent-supplied input; arrays union (the agent's
 * field, if any, is preserved + extended).
 */
export type ToolExcludePayload =
  | FindInspiringExcludes
  | FindSomeoneWhoExcludes
  | FindProofExcludes
  | LookupExcludes
  | FindTipsExcludes
  | IllustrateExcludes
  | FindOptionsExcludes
  | undefined;

export interface FindInspiringExcludes {
  excludeIds?: string[];
  excludeImageCanonicalUrls?: string[];
}
export interface FindSomeoneWhoExcludes {
  excludeIds?: string[];
  excludeImageCanonicalUrls?: string[];
}
export interface FindProofExcludes {
  excludeIds?: string[];
}
export interface LookupExcludes {
  excludeIds?: string[];
}
/**
 * `find_tips` excludeIds are INTEGER tip ids (`FindTipsInputSchema`), unlike
 * the uuid-string ids elsewhere. The seen-set stores them stringified (the
 * `SeenItems` wire shape is arrays-of-strings); `computeExcludes` numifies on
 * the way out and `extractSeenDelta` stringifies on the way in. The generic
 * array-union in `mergeExcludesIntoInput` is value-type-agnostic, so numbers
 * survive it unchanged.
 */
export interface FindTipsExcludes {
  excludeIds?: number[];
}
export interface IllustrateExcludes {
  excludeCanonicalUrls?: string[];
}
/**
 * `find_options` uses the existing per-type `exclude: Array<{type, id}>`
 * lever (C.focused-shamir-5). We extend that list with synthesized entries
 * from `seenItems.hotel` / `seenItems.region_base` — trip and tour are
 * NEVER added (carve-out).
 */
export interface FindOptionsExcludes {
  exclude: Array<{ type: ProposalType; id: string }>;
}

/**
 * Build the per-tool exclude payload from the current session's seenItems.
 * Returns undefined for utility tools (handoff / handoff_submit) that
 * don't surface trackable content.
 *
 * For find_options: returns the additional per-type `exclude` entries
 * (hotel + region_base) the orchestrator wants to union with any
 * agent-supplied excludes. The find_options handler's `excludeIdsForType`
 * helper already filters by type, so a unified `exclude` array is the
 * cleanest contract.
 */
export function computeExcludes(
  toolName: string,
  seenItems: SeenItems,
): ToolExcludePayload {
  switch (toolName) {
    case 'find_inspiring':
      return {
        excludeIds: dedupe(seenItems.inspire_passage),
        excludeImageCanonicalUrls: dedupe(seenItems.image),
      };
    case 'find_someone_who':
      return {
        excludeIds: dedupe(seenItems.customer_story),
        excludeImageCanonicalUrls: dedupe(seenItems.image),
      };
    case 'find_proof':
      return { excludeIds: dedupe(seenItems.trust_proof) };
    case 'lookup':
      return { excludeIds: dedupe(seenItems.inform_chunk) };
    case 'find_tips': {
      // dedupe() is undefined-when-empty by design (lean envelopes — no empty
      // arrays on the wire); numify the stringified seen-set only when there
      // is something to exclude.
      const seen = dedupe(seenItems.customer_tip ?? []);
      return {
        excludeIds: seen?.map(Number).filter((n) => Number.isInteger(n)),
      };
    }
    case 'illustrate':
      return { excludeCanonicalUrls: dedupe(seenItems.image) };
    case 'find_options': {
      // Synthesize per-type {type, id} entries for the existing
      // excludeIdsForType plumbing in connector/src/tools/find_options.ts.
      // Trip + tour deliberately omitted — saleable-surface carve-out.
      const excludes: Array<{ type: ProposalType; id: string }> = [];
      for (const id of seenItems.hotel) {
        excludes.push({ type: 'hotel', id });
      }
      for (const id of seenItems.region_base) {
        excludes.push({ type: 'region_base', id });
      }
      return { exclude: excludes };
    }
    case 'show_options':
      // show_options doesn't accept exclude params — it receives explicit ids
      // from the agent. No auto-injection needed.
      return undefined;
    default:
      // handoff / handoff_submit / anything new — no auto-injection.
      return undefined;
  }
}

/**
 * Merge orchestrator-supplied excludes into the validated tool input.
 *
 * For find_options: append synthesized {type, id} entries to whatever the
 * agent supplied (union semantics — agent excludes can ADD but never
 * subtract). De-dupe the merged array on the (type, id) tuple.
 *
 * For other tools: union the arrays, de-dupe.
 */
export function mergeExcludesIntoInput(
  toolName: string,
  agentInput: Record<string, unknown>,
  autoExcludes: ToolExcludePayload,
): Record<string, unknown> {
  if (!autoExcludes) return agentInput;
  const out: Record<string, unknown> = { ...agentInput };

  if (toolName === 'find_options') {
    const auto = autoExcludes as FindOptionsExcludes;
    const agentSupplied = (agentInput.exclude as
      | Array<{ type: ProposalType; id: string }>
      | undefined) ?? [];
    const seen = new Set<string>();
    const merged: Array<{ type: ProposalType; id: string }> = [];
    for (const entry of [...agentSupplied, ...auto.exclude]) {
      const key = `${entry.type}:${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
    if (merged.length > 0) out.exclude = merged;
    return out;
  }

  // For id-array fields and url-array fields: union with agent-supplied.
  const arrayFields: ReadonlyArray<string> = [
    'excludeIds',
    'excludeImageCanonicalUrls',
    'excludeCanonicalUrls',
  ];
  for (const field of arrayFields) {
    if (!(field in (autoExcludes as Record<string, unknown>))) continue;
    const autoArr =
      ((autoExcludes as Record<string, unknown>)[field] as string[] | undefined) ??
      [];
    const agentArr =
      (agentInput[field] as string[] | undefined) ?? [];
    const merged = Array.from(new Set([...agentArr, ...autoArr]));
    if (merged.length > 0) out[field] = merged;
  }
  return out;
}

/**
 * Per-tool delta: which seen-set keys to merge into session state, and
 * what string ids/URLs the tool just returned.
 *
 * `extractSeenDelta` reads the validated tool result (whose shape is
 * already known) and builds the delta map.
 */
export type SeenDelta = Partial<Record<keyof SeenItems, string[]>>;

/**
 * Walk a validated tool result and pull out the per-type ids/URLs the
 * orchestrator should merge into session state.
 *
 * `result` is the parsed `*OutputSchema` value from the connector. Each
 * tool's shape is hard-coded here — small switch, no reflection.
 *
 * Trip + tour cards in find_options output are deliberately ignored
 * (carve-out — Swoop is selling those; repeats are fine).
 */
export function extractSeenDelta(
  toolName: string,
  result: unknown,
): SeenDelta {
  if (!result || typeof result !== 'object') return {};
  const r = result as Record<string, unknown>;
  const delta: SeenDelta = {};

  switch (toolName) {
    case 'find_inspiring': {
      const passages = (r.passages ?? []) as Array<{
        id: string;
        image?: { canonicalUrl?: string } | null;
      }>;
      if (passages.length === 0) return delta;
      delta.inspire_passage = passages.map((p) => p.id);
      const imageUrls = passages
        .map((p) => p.image?.canonicalUrl)
        .filter((u): u is string => typeof u === 'string');
      if (imageUrls.length > 0) delta.image = imageUrls;
      return delta;
    }
    case 'find_someone_who': {
      const stories = (r.stories ?? []) as Array<{
        id: string;
        image?: { canonicalUrl?: string } | null;
      }>;
      if (stories.length === 0) return delta;
      delta.customer_story = stories.map((s) => s.id);
      const imageUrls = stories
        .map((s) => s.image?.canonicalUrl)
        .filter((u): u is string => typeof u === 'string');
      if (imageUrls.length > 0) delta.image = imageUrls;
      return delta;
    }
    case 'find_proof': {
      const proofs = (r.proofs ?? []) as Array<{ id: string }>;
      if (proofs.length > 0) {
        delta.trust_proof = proofs.map((p) => p.id);
      }
      return delta;
    }
    case 'lookup': {
      const chunks = (r.chunks ?? []) as Array<{ id: string }>;
      if (chunks.length > 0) {
        delta.inform_chunk = chunks.map((c) => c.id);
      }
      return delta;
    }
    case 'find_tips': {
      // Tip ids are integers (`CustomerTipPublicSchema.id`); the seen-set
      // stores strings, so stringify on the way in (hotel/region_base
      // precedent).
      const tips = (r.tips ?? []) as Array<{ id: number }>;
      if (tips.length > 0) {
        delta.customer_tip = tips.map((t) => String(t.id));
      }
      return delta;
    }
    case 'illustrate': {
      // Image rows have `url` (the canonical URL), not `canonicalUrl`,
      // per `IllustrateOutputSchema` / `ImageRowSchema`.
      const images = (r.images ?? []) as Array<{ url: string }>;
      if (images.length > 0) {
        delta.image = images
          .map((i) => i.url)
          .filter((u): u is string => typeof u === 'string');
      }
      return delta;
    }
    case 'find_options': {
      // C.goofy-goldstine-13 (2026-06-11): marking moved to show_options.
      // find_options is now the agent-private browse tool — it returns compact
      // BrowseOption rows (no images, no hotel/region_base marking here).
      // exclude-on-entry still fires via computeExcludes above.
      return delta;
    }
    case 'show_options': {
      // Per HITL Q4 + C.goofy-goldstine-13: show_options is the visitor-facing
      // curation step. Hotels + region_bases shown here enter the seen-set.
      // Trip + tour cards: carve-out preserved (Swoop is selling them; repeats fine).
      // Embedded image canonical URLs are also marked — the image was on screen.
      const cards = (r.cards ?? []) as Array<{
        type: string;
        id: string;
        image?: { canonicalUrl?: string } | null;
      }>;
      const hotelIds: string[] = [];
      const regionBaseIds: string[] = [];
      const imageUrls: string[] = [];
      for (const card of cards) {
        if (card.type === 'hotel') hotelIds.push(card.id);
        else if (card.type === 'region_base') regionBaseIds.push(card.id);
        // trip / tour: deliberately skipped (carve-out).
        // Embedded image canonical URL — applies to ALL card types, including
        // trip/tour. The image was on screen; future illustrate calls
        // shouldn't repeat it. Per HITL Q5+Q6.
        if (card.image?.canonicalUrl) {
          imageUrls.push(card.image.canonicalUrl);
        }
      }
      if (hotelIds.length > 0) delta.hotel = hotelIds;
      if (regionBaseIds.length > 0) delta.region_base = regionBaseIds;
      if (imageUrls.length > 0) delta.image = imageUrls;
      return delta;
    }
    default:
      // handoff / handoff_submit / anything new — no seen-set update.
      return delta;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Defensive de-dupe in case the upstream session-state writer ever drifts
 * (the merge helper already de-dupes, but cheap insurance at the read
 * boundary). Returns undefined when input is empty so we don't pass empty
 * arrays through the wire — keeps tool envelopes lean.
 */
function dedupe(arr: ReadonlyArray<string>): string[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  const set = new Set(arr);
  return [...set];
}

/** Test-only export — surface internals so unit tests don't have to
 *  re-implement the dedupe contract. */
export const __testing = { dedupe };
