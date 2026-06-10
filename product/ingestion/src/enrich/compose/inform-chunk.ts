/**
 * Compose `inform_chunk` rows for the Inform job (`lookup` tool).
 *
 * Routing:
 *   - Every faqitem (one chunk per row).
 *   - Pages with practical pagetypes (Before-you-travel, Practical-guide,
 *     Month, FAQ-host).
 *   - Blog chunks where blog_post.primary_job='inform' OR 'inform' is in
 *     secondary_jobs.
 *
 * Plan: planning/03-exec-c-t3a.md §"E. Compose derived tables — inform_chunk".
 */

import type pg from 'pg';
import { contentHash } from '../hash.js';
import { chunkFaqItem, stripHtml, chunkContentblockText } from '../chunk.js';
import { GEMINI_MODEL_ID } from '../gemini.js';

const SOURCE_TYPE = 'inform_chunk';

const PRACTICAL_PAGETYPE_TITLES = new Set([
  'Before-you-travel',
  'Before You Travel',
  'Practical-guide',
  'Practical',
  'Month',
  'FAQ-host',
]);

interface FaqRow {
  id: number;
  title: string;
  content: string;
}

interface PageRow {
  id: number;
  canonical_url: string;
  intro_text: string | null;
  summary: string | null;
  pagetype_title: string | null;
  title: string | null;
}

interface ContentblockRow {
  id: number;
  page_id: number;
  page_canonical_url: string;
  page_title: string | null;
  subtype: string;
  title: string | null;
  text: string | null;
}

interface BlogChunkRow {
  id: number;
  blog_canonical_url: string;
  blog_title: string | null;
  blog_published_at: Date | null;
  text: string;
}

export interface ComposeInformChunkOptions {
  client: pg.PoolClient;
  truncate?: boolean;
  dryRun?: boolean;
}

export interface ComposeInformChunkResult {
  rowsInserted: number;
  faqRows: number;
  practicalPageRows: number;
  blogRows: number;
}

export async function composeInformChunk(
  opts: ComposeInformChunkOptions,
): Promise<ComposeInformChunkResult> {
  if (opts.dryRun) return { rowsInserted: 0, faqRows: 0, practicalPageRows: 0, blogRows: 0 };
  if (opts.truncate !== false) {
    await opts.client.query(`TRUNCATE inform_chunk`);
  }

  let faqRows = 0;
  let practicalPageRows = 0;
  let blogRows = 0;

  // ---------- 1. FAQ items ------------------------------------------------
  const faqs = (await opts.client.query<FaqRow>(`SELECT id, title, content FROM faqitem`)).rows;
  for (const f of faqs) {
    const c = chunkFaqItem(f.title, f.content ?? '');
    if (c.text.trim().length === 0) continue;
    await insertInformChunkRow(opts.client, {
      provenance: 'faq',
      sourceId: String(f.id),
      question: f.title,
      text: c.text,
      canonicalUrl: null,
      // FAQ items have no user-facing page title or editorial date.
      sourceTitle: null,
      sourcePublishedAt: null,
    });
    faqRows += 1;
  }

  // ---------- 2. Practical pages ------------------------------------------
  const pages = (
    await opts.client.query<PageRow>(
      `SELECT id, canonical_url, intro_text, summary, pagetype_title, title
       FROM page WHERE pagetype_title = ANY($1::text[])`,
      [[...PRACTICAL_PAGETYPE_TITLES]],
    )
  ).rows;
  const practicalPageIds: number[] = [];
  for (const p of pages) {
    practicalPageIds.push(p.id);
    if (p.intro_text?.trim()) {
      await insertInformChunkRow(opts.client, {
        provenance: 'swoop_practical',
        sourceId: `${p.id}_intro`,
        question: null,
        text: stripHtml(p.intro_text),
        canonicalUrl: p.canonical_url,
        // Step 0 (2026-06-10): page.created_at is an ETL timestamp, not a
        // real editorial date — date ships NULL for page-derived rows.
        sourceTitle: p.title ?? null,
        sourcePublishedAt: null,
      });
      practicalPageRows += 1;
    }
    if (p.summary?.trim()) {
      await insertInformChunkRow(opts.client, {
        provenance: 'swoop_practical',
        sourceId: `${p.id}_summary`,
        question: null,
        text: stripHtml(p.summary),
        canonicalUrl: p.canonical_url,
        sourceTitle: p.title ?? null,
        sourcePublishedAt: null,
      });
      practicalPageRows += 1;
    }
  }
  if (practicalPageIds.length > 0) {
    const cbs = (
      await opts.client.query<ContentblockRow>(
        `SELECT cb.id, cb.page_id, cb.subtype, cb.title, cb.text,
                p.canonical_url AS page_canonical_url,
                p.title         AS page_title
         FROM contentblock cb
         JOIN page p ON p.id = cb.page_id
         WHERE cb.page_id = ANY($1::int[])
           AND cb.text IS NOT NULL AND length(trim(cb.text)) > 0`,
        [practicalPageIds],
      )
    ).rows;
    for (const cb of cbs) {
      const chunks = chunkContentblockText(cb.text!);
      for (const c of chunks) {
        await insertInformChunkRow(opts.client, {
          provenance: 'swoop_practical',
          sourceId: `${cb.id}_${c.index}`,
          question: cb.title ?? null,
          text: c.text,
          canonicalUrl: cb.page_canonical_url,
          sourceTitle: cb.page_title ?? null,
          sourcePublishedAt: null,
        });
        practicalPageRows += 1;
      }
    }
  }

  // ---------- 3. Inform-classified blog chunks ----------------------------
  const informBlogs = (
    await opts.client.query<BlogChunkRow>(
      `SELECT bc.id, bc.text, bp.canonical_url AS blog_canonical_url,
              bp.title        AS blog_title,
              bp.published_at AS blog_published_at
       FROM blog_chunk bc
       JOIN blog_post bp ON bp.id = bc.blog_post_id
       WHERE bp.primary_job = 'inform'
          OR 'inform' = ANY(bp.secondary_jobs)`,
    )
  ).rows;
  for (const bc of informBlogs) {
    await insertInformChunkRow(opts.client, {
      provenance: 'blog_practical',
      sourceId: String(bc.id),
      question: null,
      text: bc.text,
      canonicalUrl: bc.blog_canonical_url,
      sourceTitle: bc.blog_title ?? null,
      sourcePublishedAt: bc.blog_published_at ?? null,
    });
    blogRows += 1;
  }

  return { rowsInserted: faqRows + practicalPageRows + blogRows, faqRows, practicalPageRows, blogRows };
}

interface InsertArgs {
  provenance: 'faq' | 'swoop_practical' | 'blog_practical' | 'guidebook_practical' | 'month_page' | 'trip_prose';
  sourceId: string;
  question: string | null;
  text: string;
  canonicalUrl: string | null;
  /** Human-readable title of the source. NULL for FAQ sources (no page title). */
  sourceTitle: string | null;
  /**
   * Publication date. Non-null only for blog_practical provenance
   * (blog_post.published_at). Page rows ship NULL — page.created_at is an
   * ETL timestamp (Step 0 verdict 2026-06-10).
   */
  sourcePublishedAt: Date | null;
}

/**
 * Insert one inform_chunk row with embedding-cache lookup. Cache hit hydrates
 * the embedding column inline (no Gemini call); cache miss leaves it NULL for
 * the embed pass. Per planning/03-exec-crosscut-embedding-cache.md §2.2.
 */
async function insertInformChunkRow(client: pg.PoolClient, row: InsertArgs): Promise<void> {
  const hash = contentHash(row.text, SOURCE_TYPE);
  // IMPORTANT: source_title / source_published_at are metadata — they are
  // intentionally NOT part of the content_hash input (migration 017 comment).
  const cached = await client.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding FROM embedding_cache
     WHERE content_hash = $1 AND model_version = $2`,
    [hash, GEMINI_MODEL_ID],
  );
  const cachedEmbedding = cached.rows[0]?.embedding ?? null;
  await client.query(
    `INSERT INTO inform_chunk
       (source_provenance, source_id, question, text, canonical_url, content_hash,
        embedding, tsv, source_title, source_published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::halfvec(3072), to_tsvector('english', $4), $8, $9)`,
    [
      row.provenance, row.sourceId, row.question, row.text, row.canonicalUrl,
      hash, cachedEmbedding, row.sourceTitle, row.sourcePublishedAt,
    ],
  );
}
