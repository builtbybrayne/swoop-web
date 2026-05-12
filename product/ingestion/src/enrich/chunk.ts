/**
 * Chunking strategies per source type.
 *
 * Pure functions, no I/O. Plan: planning/03-exec-c-t3a.md §"Sub-pass design"
 * — chunking-rule decision recorded as C.35.
 *
 * Rules (decision C.35):
 *
 *   - page.intro_text:      one chunk if non-empty
 *   - page.summary:         one chunk if non-empty
 *   - contentblock prose:   one chunk per row; sliding-window split if
 *                           text exceeds ~800 tokens, on subheading boundaries
 *   - blog post:            split on <h2>/<h3>; sliding-window fallback at
 *                           ~800 tokens with 100-token overlap
 *   - faqitem:              one row = one chunk (Q + ' ' + A)
 *   - chunk:                one row = one chunk (the source row IS the chunk)
 *   - customerreview:       aggregate by reviewer name first; the aggregated
 *                           prose IS the chunk
 *
 * Token approximation: 1 token ≈ 4 characters of English prose. We avoid a
 * tokenizer dep here (Voyage doesn't ship one and tiktoken would be a hefty
 * pull); the approximation is fine because chunk targeting is soft — Voyage
 * accepts up to 32K tokens per input, our 800-token target is generous.
 */

const APPROX_CHARS_PER_TOKEN = 4;

/** Soft target chunk size for sliding-window splits, in characters. */
export const TARGET_CHUNK_CHARS = 800 * APPROX_CHARS_PER_TOKEN;

/** Sliding-window overlap between adjacent chunks, in characters. */
export const CHUNK_OVERLAP_CHARS = 100 * APPROX_CHARS_PER_TOKEN;

/**
 * Gemini's per-input token cap (gemini-embedding-001 = 2048 input tokens).
 *
 * Our 800-token chunk target sits comfortably below this — chunkBlogHtml,
 * chunkContentblockText, and chunkFaqItem all produce outputs well inside
 * the cap. But persona aggregation by reviewer name (composePersonaInputProse)
 * can concatenate many short reviews into a blob that occasionally exceeds
 * 2048 tokens for prolific reviewers. Apply the cap defensively at the
 * persona-aggregation boundary; soft-truncate to the char-equivalent.
 *
 * Per c-t9 Step 8.
 */
export const GEMINI_INPUT_TOKEN_CAP = 2048;
export const GEMINI_INPUT_CHAR_CAP = GEMINI_INPUT_TOKEN_CAP * APPROX_CHARS_PER_TOKEN;

/**
 * Truncate text to fit within Gemini's 2048-token input limit.
 *
 * Soft truncation at character boundary (no word-aware slicing) — the cap
 * is a defensive boundary, not a quality knob. Persona-summary content
 * past this point is rare and incremental; the lost suffix is acceptable.
 */
export function capToGeminiInput(text: string): string {
  if (text.length <= GEMINI_INPUT_CHAR_CAP) return text;
  return text.slice(0, GEMINI_INPUT_CHAR_CAP);
}

/** A chunked output. Index is the position within the source row. */
export interface SourceChunk {
  /** 0-indexed position within the source row. */
  index: number;
  /** Chunk text, plain (HTML stripped, whitespace normalised). */
  text: string;
}

/** Strip HTML tags + collapse whitespace. */
export function stripHtml(html: string): string {
  return html
    // Drop scripts and styles entirely (with their contents).
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    // Convert structural breaks to whitespace so they survive collapsing.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    // Drop remaining tags.
    .replace(/<[^>]+>/g, ' ')
    // Decode the most common HTML entities. Full decoder isn't worth the dep.
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Collapse whitespace.
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split blog HTML into chunks.
 *
 * Strategy: scan for `<h2>` / `<h3>` boundaries, split there, strip HTML per
 * chunk. If a single section exceeds TARGET_CHUNK_CHARS, sliding-window split
 * with CHUNK_OVERLAP_CHARS overlap.
 */
export function chunkBlogHtml(html: string): SourceChunk[] {
  if (!html || !html.trim()) return [];

  // Split on h2/h3 opening tags. The split keeps everything before the first
  // header as one piece (the "intro" before any heading).
  const sections = html
    .split(/(?=<h[23][\s>])/i)
    .map((s) => stripHtml(s))
    .filter((s) => s.length > 0);

  // If no headers, treat as one big section.
  const effectiveSections = sections.length > 0 ? sections : [stripHtml(html)];

  const chunks: SourceChunk[] = [];
  let nextIndex = 0;
  for (const section of effectiveSections) {
    if (section.length <= TARGET_CHUNK_CHARS) {
      chunks.push({ index: nextIndex++, text: section });
      continue;
    }
    // Sliding window for oversized sections.
    let start = 0;
    while (start < section.length) {
      const end = Math.min(start + TARGET_CHUNK_CHARS, section.length);
      const piece = section.slice(start, end).trim();
      if (piece.length > 0) {
        chunks.push({ index: nextIndex++, text: piece });
      }
      if (end === section.length) break;
      start = end - CHUNK_OVERLAP_CHARS;
    }
  }
  return chunks;
}

/**
 * Split contentblock prose into chunks.
 *
 * One chunk per row when the row is small; sliding-window split when the
 * `text` field is oversized. We don't try to detect subheadings inside a
 * single contentblock — those are usually their own contentblock rows.
 */
export function chunkContentblockText(text: string): SourceChunk[] {
  const stripped = text ? stripHtml(text) : '';
  if (!stripped) return [];
  if (stripped.length <= TARGET_CHUNK_CHARS) {
    return [{ index: 0, text: stripped }];
  }
  const chunks: SourceChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < stripped.length) {
    const end = Math.min(start + TARGET_CHUNK_CHARS, stripped.length);
    const piece = stripped.slice(start, end).trim();
    if (piece.length > 0) {
      chunks.push({ index: index++, text: piece });
    }
    if (end === stripped.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

/**
 * FAQ chunk: question + answer concatenated. One chunk per faqitem row.
 */
export function chunkFaqItem(title: string, content: string): SourceChunk {
  return {
    index: 0,
    text: `${title.trim()}\n\n${stripHtml(content).trim()}`,
  };
}

/**
 * Aggregate customer reviews by reviewer name.
 *
 * Rule per the 2026-04-30 customerreview discovery: the corpus is ~80%
 * short snippets; per-row personas are thin. Aggregating by reviewer
 * (name only — HITL Q2 resolved 2026-05-01) before classifying produces
 * coherent persona blobs.
 *
 * Returns a Map keyed by name → array of source rows. Anonymous rows
 * (null/empty name) live in their own bucket under the special key
 * `__anonymous__` and are NOT aggregated for persona generation per
 * HITL Q3 — caller emits them as individual rows with persona_summary=null.
 */
export interface ReviewerBucket {
  name: string;
  isAnonymous: boolean;
  /** Source customerreview rows (preserve order — caller may want chronological). */
  rows: Array<{
    id: number;
    content: string;
    location: string | null;
    date: string | null;
    title: string | null;
    image_id: number | null;
  }>;
}

export const ANONYMOUS_BUCKET_KEY = '__anonymous__';

export function aggregateReviewsByName(
  reviews: ReadonlyArray<{
    id: number;
    content: string;
    name: string | null;
    location: string | null;
    date: Date | string | null;
    title: string | null;
    image_id: number | null;
  }>,
): Map<string, ReviewerBucket> {
  const buckets = new Map<string, ReviewerBucket>();
  for (const r of reviews) {
    const trimmedName = (r.name ?? '').trim();
    const key = trimmedName === '' ? ANONYMOUS_BUCKET_KEY : trimmedName;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        name: trimmedName === '' ? ANONYMOUS_BUCKET_KEY : trimmedName,
        isAnonymous: trimmedName === '',
        rows: [],
      };
      buckets.set(key, bucket);
    }
    bucket.rows.push({
      id: r.id,
      content: r.content,
      location: r.location ?? null,
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      title: r.title ?? null,
      image_id: r.image_id ?? null,
    });
  }
  return buckets;
}

/**
 * Compose the prose passed to the persona-summary classifier from an
 * aggregated reviewer bucket.
 *
 * Joins individual review texts with a separator so the classifier sees
 * them as discrete contributions while still being able to extract a
 * coherent persona.
 */
export function composePersonaInputProse(bucket: ReviewerBucket): string {
  const joined = bucket.rows
    .map((r) => stripHtml(r.content).trim())
    .filter((t) => t.length > 0)
    .join('\n\n---\n\n');
  // Defensive cap — Gemini's 2048-token input ceiling. Prolific reviewers
  // can blow through this; the suffix loss is acceptable for persona signal.
  return capToGeminiInput(joined);
}
