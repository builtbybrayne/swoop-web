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
}

interface ContentblockRow {
  id: number;
  page_id: number;
  page_canonical_url: string;
  subtype: string;
  title: string | null;
  text: string | null;
}

interface BlogChunkRow {
  id: number;
  blog_canonical_url: string;
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
    const hash = contentHash(c.text, SOURCE_TYPE);
    await opts.client.query(
      `INSERT INTO inform_chunk
         (source_provenance, source_id, question, text, canonical_url, content_hash, tsv)
       VALUES ('faq', $1, $2, $3, NULL, $4, to_tsvector('english', $3))`,
      [String(f.id), f.title, c.text, hash],
    );
    faqRows += 1;
  }

  // ---------- 2. Practical pages ------------------------------------------
  const pages = (
    await opts.client.query<PageRow>(
      `SELECT id, canonical_url, intro_text, summary, pagetype_title
       FROM page WHERE pagetype_title = ANY($1::text[])`,
      [[...PRACTICAL_PAGETYPE_TITLES]],
    )
  ).rows;
  const practicalPageIds: number[] = [];
  for (const p of pages) {
    practicalPageIds.push(p.id);
    if (p.intro_text?.trim()) {
      const text = stripHtml(p.intro_text);
      const hash = contentHash(text, SOURCE_TYPE);
      await opts.client.query(
        `INSERT INTO inform_chunk
           (source_provenance, source_id, question, text, canonical_url, content_hash, tsv)
         VALUES ('swoop_practical', $1, NULL, $2, $3, $4, to_tsvector('english', $2))`,
        [`${p.id}_intro`, text, p.canonical_url, hash],
      );
      practicalPageRows += 1;
    }
    if (p.summary?.trim()) {
      const text = stripHtml(p.summary);
      const hash = contentHash(text, SOURCE_TYPE);
      await opts.client.query(
        `INSERT INTO inform_chunk
           (source_provenance, source_id, question, text, canonical_url, content_hash, tsv)
         VALUES ('swoop_practical', $1, NULL, $2, $3, $4, to_tsvector('english', $2))`,
        [`${p.id}_summary`, text, p.canonical_url, hash],
      );
      practicalPageRows += 1;
    }
  }
  if (practicalPageIds.length > 0) {
    const cbs = (
      await opts.client.query<ContentblockRow>(
        `SELECT cb.id, cb.page_id, cb.subtype, cb.title, cb.text,
                p.canonical_url AS page_canonical_url
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
        const hash = contentHash(c.text, SOURCE_TYPE);
        await opts.client.query(
          `INSERT INTO inform_chunk
             (source_provenance, source_id, question, text, canonical_url, content_hash, tsv)
           VALUES ('swoop_practical', $1, $2, $3, $4, $5, to_tsvector('english', $3))`,
          [`${cb.id}_${c.index}`, cb.title ?? null, c.text, cb.page_canonical_url, hash],
        );
        practicalPageRows += 1;
      }
    }
  }

  // ---------- 3. Inform-classified blog chunks ----------------------------
  const informBlogs = (
    await opts.client.query<BlogChunkRow>(
      `SELECT bc.id, bc.text, bp.canonical_url AS blog_canonical_url
       FROM blog_chunk bc
       JOIN blog_post bp ON bp.id = bc.blog_post_id
       WHERE bp.primary_job = 'inform'
          OR 'inform' = ANY(bp.secondary_jobs)`,
    )
  ).rows;
  for (const bc of informBlogs) {
    const hash = contentHash(bc.text, SOURCE_TYPE);
    await opts.client.query(
      `INSERT INTO inform_chunk
         (source_provenance, source_id, question, text, canonical_url, content_hash, tsv)
       VALUES ('blog_practical', $1, NULL, $2, $3, $4, to_tsvector('english', $2))`,
      [String(bc.id), bc.text, bc.blog_canonical_url, hash],
    );
    blogRows += 1;
  }

  return { rowsInserted: faqRows + practicalPageRows + blogRows, faqRows, practicalPageRows, blogRows };
}
