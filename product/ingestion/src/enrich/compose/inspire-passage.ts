/**
 * Compose `inspire_passage` rows from page chunks + blog chunks + chunk
 * (the 46 reusable CMS prose blocks).
 *
 * Routing rules (decision C.35 / C.t2 §"Schema design"):
 *   - page rows whose pagetype maps to Inspire (Region, National Park, City,
 *     Activity, Region-Activity, Experience, Country, Landmark, Guidebook
 *     editorial subset).
 *   - their `intro_text` and `summary` (one chunk each if non-empty).
 *   - prose-bearing contentblocks attached to those pages.
 *   - blog_chunk rows whose blog_post.primary_job='inspire' OR 'inspire' is
 *     in secondary_jobs.
 *   - the 46 chunk rows (reusable CMS prose blocks).
 *
 * Idempotency: TRUNCATE then INSERT FROM SELECT (forward-only). The derived
 * store is throwaway per theme 5; rebuilding from scratch is cheap and the
 * embedding pass on the freshly-inserted rows is guarded by content_hash so
 * unchanged rows don't re-embed.
 *
 * Plan: planning/03-exec-c-t3a.md §"E. Compose derived tables".
 */

import type pg from 'pg';
import { contentHash } from '../hash.js';
import { stripHtml, chunkContentblockText } from '../chunk.js';
import { GEMINI_MODEL_ID } from '../gemini.js';

/**
 * Pagetype titles whose pages contribute to Inspire. Subset per the
 * C.t2 / Tier 2 chunk-C §2.5 mapping. Conservative — pagetypes that are
 * primarily practical (Before-you-travel, FAQ-host) live in inform_chunk.
 */
const INSPIRE_PAGETYPE_TITLES = new Set([
  'Region',
  'National Park',
  'City',
  'Activity',
  'Region-Activity',
  'Experience',
  'Country',
  'Landmark',
  'Guidebook',
]);

const PROSE_CONTENTBLOCK_SUBTYPES = new Set([
  'text',
  'tour',
  'trip',
  'partnercomment',
  'pressreview',
  'when_to_travel',
  'reviewcarousel',
  'carousel',
]);

const SOURCE_TYPE = 'inspire_passage';

export interface ComposeInspirePassageOptions {
  client: pg.PoolClient;
  /** If true, TRUNCATE inspire_passage before composing. Defaults to true. */
  truncate?: boolean;
  dryRun?: boolean;
}

export interface ComposeInspirePassageResult {
  rowsInserted: number;
  pageIntroChunks: number;
  pageSummaryChunks: number;
  pageContentblockChunks: number;
  blogChunks: number;
  cmsChunks: number;
}

interface PageRow {
  id: number;
  canonical_url: string;
  intro_text: string | null;
  summary: string | null;
  ntag_ids: number[];
  image_id: number | null;
  pagetype_title: string | null;
}

interface ContentblockRow {
  id: number;
  page_id: number;
  page_canonical_url: string;
  page_ntag_ids: number[];
  page_image_id: number | null;
  subtype: string;
  title: string | null;
  text: string | null;
  image_id: number | null;
}

interface BlogChunkRow {
  id: number;
  blog_post_id: number;
  blog_canonical_url: string;
  blog_ntag_ids: number[];
  text: string;
  content_hash: string;
}

interface CmsChunkRow {
  id: number;
  text: string;
  title: string | null;
}

export async function composeInspirePassage(
  opts: ComposeInspirePassageOptions,
): Promise<ComposeInspirePassageResult> {
  if (opts.dryRun) {
    return {
      rowsInserted: 0,
      pageIntroChunks: 0,
      pageSummaryChunks: 0,
      pageContentblockChunks: 0,
      blogChunks: 0,
      cmsChunks: 0,
    };
  }

  if (opts.truncate !== false) {
    await opts.client.query(`TRUNCATE inspire_passage`);
  }

  let pageIntroChunks = 0;
  let pageSummaryChunks = 0;
  let pageContentblockChunks = 0;
  let blogChunks = 0;
  let cmsChunks = 0;

  // ---------- 1. Pages of Inspire-friendly pagetypes ----------------------
  const pages = (
    await opts.client.query<PageRow>(
      `SELECT id, canonical_url, intro_text, summary, ntag_ids, image_id, pagetype_title
       FROM page
       WHERE pagetype_title = ANY($1::text[])`,
      [[...INSPIRE_PAGETYPE_TITLES]],
    )
  ).rows;

  for (const p of pages) {
    if (p.intro_text && p.intro_text.trim()) {
      const text = stripHtml(p.intro_text);
      await insertInspireRow(opts.client, {
        provenance: 'page_intro',
        sourceId: String(p.id),
        text,
        canonicalUrl: p.canonical_url,
        ntagIds: p.ntag_ids ?? [],
        imageId: p.image_id ?? null,
      });
      pageIntroChunks += 1;
    }
    if (p.summary && p.summary.trim()) {
      const text = stripHtml(p.summary);
      await insertInspireRow(opts.client, {
        provenance: 'page_summary',
        sourceId: String(p.id),
        text,
        canonicalUrl: p.canonical_url,
        ntagIds: p.ntag_ids ?? [],
        imageId: p.image_id ?? null,
      });
      pageSummaryChunks += 1;
    }
  }

  // ---------- 2. Contentblocks attached to those pages --------------------
  const inspirePageIds = pages.map((p) => p.id);
  if (inspirePageIds.length > 0) {
    const cbs = (
      await opts.client.query<ContentblockRow>(
        `SELECT cb.id, cb.page_id, cb.subtype, cb.title, cb.text, cb.image_id,
                p.canonical_url AS page_canonical_url,
                p.ntag_ids     AS page_ntag_ids,
                p.image_id     AS page_image_id
         FROM contentblock cb
         JOIN page p ON p.id = cb.page_id
         WHERE cb.page_id = ANY($1::int[])
           AND cb.text IS NOT NULL
           AND length(trim(cb.text)) > 0
           AND cb.subtype = ANY($2::text[])
         ORDER BY cb.page_id, cb.position NULLS LAST, cb.id`,
        [inspirePageIds, [...PROSE_CONTENTBLOCK_SUBTYPES]],
      )
    ).rows;

    for (const cb of cbs) {
      const chunks = chunkContentblockText(cb.text!);
      for (const c of chunks) {
        await insertInspireRow(opts.client, {
          provenance: 'page_contentblock',
          sourceId: `${cb.id}_${c.index}`,
          text: c.text,
          canonicalUrl: cb.page_canonical_url,
          ntagIds: cb.page_ntag_ids ?? [],
          imageId: cb.image_id ?? cb.page_image_id ?? null,
        });
        pageContentblockChunks += 1;
      }
    }
  }

  // ---------- 3. Blog chunks classified as Inspire ------------------------
  const inspireBlogChunks = (
    await opts.client.query<BlogChunkRow>(
      `SELECT bc.id, bc.blog_post_id, bc.text, bc.content_hash,
              bp.canonical_url AS blog_canonical_url,
              bp.ntag_ids     AS blog_ntag_ids
       FROM blog_chunk bc
       JOIN blog_post bp ON bp.id = bc.blog_post_id
       WHERE bp.primary_job = 'inspire'
          OR 'inspire' = ANY(bp.secondary_jobs)`,
    )
  ).rows;

  for (const bc of inspireBlogChunks) {
    await insertInspireRow(opts.client, {
      provenance: 'blog_chunk',
      sourceId: String(bc.id),
      text: bc.text,
      canonicalUrl: bc.blog_canonical_url,
      ntagIds: bc.blog_ntag_ids ?? [],
      imageId: null,
    });
    blogChunks += 1;
  }

  // ---------- 4. Reusable CMS chunks --------------------------------------
  const cms = (
    await opts.client.query<CmsChunkRow>(`SELECT id, text, title FROM chunk`)
  ).rows;

  for (const c of cms) {
    if (!c.text || !c.text.trim()) continue;
    await insertInspireRow(opts.client, {
      provenance: 'chunk',
      sourceId: String(c.id),
      text: stripHtml(c.text),
      // CMS chunks have no canonical_url of their own — empty string fails
      // the URL constraint in the public schema; we use a synthetic root.
      canonicalUrl: 'https://www.swoop-patagonia.com/',
      ntagIds: [],
      imageId: null,
    });
    cmsChunks += 1;
  }

  const rowsInserted =
    pageIntroChunks + pageSummaryChunks + pageContentblockChunks + blogChunks + cmsChunks;
  return { rowsInserted, pageIntroChunks, pageSummaryChunks, pageContentblockChunks, blogChunks, cmsChunks };
}

interface InsertInspireRowArgs {
  provenance: 'page_intro' | 'page_summary' | 'page_contentblock' | 'blog_chunk' | 'chunk';
  sourceId: string;
  text: string;
  canonicalUrl: string;
  ntagIds: number[];
  imageId: number | null;
}

async function insertInspireRow(client: pg.PoolClient, row: InsertInspireRowArgs): Promise<void> {
  const hash = contentHash(row.text, SOURCE_TYPE);
  // Cache lookup: same content_hash + model → reuse the cached embedding,
  // no Gemini call. Per planning/03-exec-crosscut-embedding-cache.md §2.2.
  const cached = await client.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding FROM embedding_cache
     WHERE content_hash = $1 AND model_version = $2`,
    [hash, GEMINI_MODEL_ID],
  );
  const cachedEmbedding = cached.rows[0]?.embedding ?? null;
  await client.query(
    `INSERT INTO inspire_passage
       (source_provenance, source_id, text, canonical_url, ntag_ids, image_id, content_hash, embedding, tsv)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::halfvec(3072), to_tsvector('english', $3))`,
    [row.provenance, row.sourceId, row.text, row.canonicalUrl, row.ntagIds, row.imageId, hash, cachedEmbedding],
  );
}
