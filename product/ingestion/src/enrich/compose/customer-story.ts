/**
 * Compose `customer_story` rows from customerreview (aggregated by reviewer)
 * + anonymous customerreview (per-row) + first-person blog rows.
 *
 * Per HITL Q2 + Q3 (2026-05-01):
 *   - Named reviewers: aggregate by `name`, generate one persona via Haiku,
 *     emit ONE customer_story row per named reviewer with persona_summary
 *     populated.
 *   - Anonymous reviewers (name null/empty): emit ONE customer_story row
 *     per source review with persona_summary = synthetic
 *     "anonymous traveller — [region]" (or just "anonymous traveller" if no
 *     region available). Prose still gets embedded by the embed pass.
 *   - First-person blog rows (blog_post.primary_job = 'mirror'): emit ONE
 *     customer_story row per blog_post (whole post is the story);
 *     persona_summary is the post's excerpt (or first 200 chars of stripped
 *     content if excerpt is empty).
 *
 * Idempotency: TRUNCATE then INSERT FROM SELECT. Safe to re-run.
 *
 * Plan: planning/03-exec-c-t3a.md §"E. Compose derived tables — customer_story" +
 * 2026-05-01 HITL ratification §3 (anonymous handling).
 */

import type pg from 'pg';
import type { PersonaSummaryOutput } from '../schemas.js';
import {
  aggregateReviewsByName,
  ANONYMOUS_BUCKET_KEY,
  composePersonaInputProse,
  stripHtml,
} from '../chunk.js';
import { contentHash } from '../hash.js';

const SOURCE_TYPE = 'customer_story';

interface ReviewRow {
  id: number;
  content: string;
  name: string | null;
  location: string | null;
  date: Date | null;
  title: string | null;
  image_id: number | null;
}

interface BlogPostRow {
  id: number;
  title: string;
  excerpt: string | null;
  content: string | null;
  canonical_url: string;
  featured_image_url: string | null;
}

export interface ComposeCustomerStoryOptions {
  client: pg.PoolClient;
  /** customId → PersonaSummaryOutput from the persona-summary classifier. */
  personaOutputs: Map<string, PersonaSummaryOutput>;
  truncate?: boolean;
  dryRun?: boolean;
}

export interface ComposeCustomerStoryResult {
  rowsInserted: number;
  namedPersonas: number;
  anonymousReviews: number;
  firstPersonBlogs: number;
}

export async function composeCustomerStory(
  opts: ComposeCustomerStoryOptions,
): Promise<ComposeCustomerStoryResult> {
  if (opts.dryRun) {
    return {
      rowsInserted: 0,
      namedPersonas: 0,
      anonymousReviews: 0,
      firstPersonBlogs: 0,
    };
  }

  if (opts.truncate !== false) {
    await opts.client.query(`TRUNCATE customer_story`);
  }

  // ---------- 1. Named-reviewer aggregates -------------------------------
  const reviews = (
    await opts.client.query<ReviewRow>(
      `SELECT id, content, name, location, date, title, image_id
       FROM customerreview
       WHERE is_published = TRUE
       ORDER BY id`,
    )
  ).rows;

  const buckets = aggregateReviewsByName(reviews);
  let namedPersonas = 0;
  let anonymousReviews = 0;

  for (const [key, bucket] of buckets) {
    if (key === ANONYMOUS_BUCKET_KEY) {
      // Anonymous path — emit one row per source review.
      for (const row of bucket.rows) {
        const text = stripHtml(row.content).trim();
        if (text.length === 0) continue;
        const region = row.location?.trim() ?? null;
        const personaSummary = region
          ? `Anonymous traveller — ${region}`
          : 'Anonymous traveller';
        await insertCustomerStoryRow(opts.client, {
          provenance: 'customerreview',
          sourceId: String(row.id),
          text,
          canonicalUrl: null,
          region,
          personaSummary,
          imageId: row.image_id ?? null,
        });
        anonymousReviews += 1;
      }
      continue;
    }

    // Named bucket — look up the classifier output.
    const safe = bucket.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const lookupKey = `persona:${safe}`;
    const output = opts.personaOutputs.get(lookupKey);
    if (!output) {
      // Classifier didn't run on this bucket (limit / cap / error). Fall
      // back to anonymous-style synthetic persona — better to keep the
      // prose retrievable than drop the whole reviewer.
      const text = composePersonaInputProse(bucket);
      if (text.length === 0) continue;
      const region = guessRegionFromBucket(bucket);
      await insertCustomerStoryRow(opts.client, {
        provenance: 'customerreview',
        sourceId: String(bucket.rows[0]!.id),
        text,
        canonicalUrl: null,
        region,
        personaSummary:
          region != null ? `Traveller from ${region}` : `Traveller`,
        imageId: bucket.rows[0]!.image_id ?? null,
      });
      namedPersonas += 1;
      continue;
    }

    // Use the classifier's output.
    const text = composePersonaInputProse(bucket);
    if (text.length === 0) continue;
    const region = output.region_hint ?? guessRegionFromBucket(bucket);
    await insertCustomerStoryRow(opts.client, {
      provenance: 'customerreview',
      sourceId: String(bucket.rows[0]!.id),
      text,
      canonicalUrl: null,
      region,
      personaSummary: output.persona_summary,
      imageId: bucket.rows[0]!.image_id ?? null,
    });
    namedPersonas += 1;
  }

  // ---------- 2. First-person blog rows -----------------------------------
  const mirrorBlogs = (
    await opts.client.query<BlogPostRow>(
      `SELECT id, title, excerpt, content, canonical_url, featured_image_url
       FROM blog_post
       WHERE primary_job = 'mirror'`,
    )
  ).rows;

  let firstPersonBlogs = 0;
  for (const bp of mirrorBlogs) {
    const text = stripHtml(bp.content ?? '').trim();
    if (text.length === 0) continue;
    const persona =
      bp.excerpt && bp.excerpt.trim()
        ? bp.excerpt.trim().slice(0, 600)
        : `Blog story: ${bp.title}`.slice(0, 600);
    await insertCustomerStoryRow(opts.client, {
      provenance: 'blog_first_person',
      sourceId: String(bp.id),
      text,
      canonicalUrl: bp.canonical_url,
      region: null,
      personaSummary: persona,
      imageId: null,
    });
    firstPersonBlogs += 1;
  }

  return {
    rowsInserted: namedPersonas + anonymousReviews + firstPersonBlogs,
    namedPersonas,
    anonymousReviews,
    firstPersonBlogs,
  };
}

interface InsertArgs {
  provenance: 'customerreview' | 'customertip' | 'blog_first_person';
  sourceId: string;
  text: string;
  canonicalUrl: string | null;
  region: string | null;
  personaSummary: string;
  imageId: number | null;
}

async function insertCustomerStoryRow(client: pg.PoolClient, row: InsertArgs): Promise<void> {
  const hash = contentHash(`${row.personaSummary}\n${row.text}`, SOURCE_TYPE);
  await client.query(
    `INSERT INTO customer_story
       (source_provenance, source_id, text, canonical_url, region, persona_summary, image_id, content_hash, tsv)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_tsvector('english', $3))`,
    [row.provenance, row.sourceId, row.text, row.canonicalUrl, row.region, row.personaSummary, row.imageId, hash],
  );
}

/**
 * Best-effort guess of a region from a bucket's review locations.
 * Returns the most-common location across the bucket, or null if no
 * location is set on any review.
 */
function guessRegionFromBucket(bucket: { rows: ReadonlyArray<{ location: string | null }> }): string | null {
  const counts = new Map<string, number>();
  for (const r of bucket.rows) {
    const loc = r.location?.trim();
    if (!loc) continue;
    counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
