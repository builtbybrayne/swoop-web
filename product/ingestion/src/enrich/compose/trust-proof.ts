/**
 * Compose `trust_proof` rows from Swoop / Partner pages + Reassure-classified
 * blog chunks.
 *
 * Routing:
 *   - Pages where pagetype_title in {Sustainability, B-Corp, About-Swoop,
 *     Partner, Conservation}.
 *   - Their `intro_text` and `summary` (one chunk each).
 *   - Prose contentblocks attached to those pages.
 *   - Blog chunks where blog_post.primary_job='reassure' OR 'reassure' is
 *     in secondary_jobs.
 *
 * `topic` column: rule-based mapping from page slug + ntag — see Plan
 * §"Open Q4". Falls back to 'other' when no rule matches.
 *
 * Plan: planning/03-exec-c-t3a.md §"E. Compose derived tables — trust_proof"
 * + §"Open question #4 — rule-based topic mapping".
 */

import type pg from 'pg';
import { contentHash } from '../hash.js';
import { stripHtml, chunkContentblockText } from '../chunk.js';

const SOURCE_TYPE = 'trust_proof';

const TRUST_PAGETYPE_TITLES = new Set([
  'Sustainability',
  'B-Corp',
  'About-Swoop',
  'About',
  'Partner',
  'Conservation',
]);

type TrustTopic =
  | 'sustainability'
  | 'b-corp'
  | 'expertise'
  | 'conservation'
  | 'safety'
  | 'guides'
  | 'satisfaction'
  | 'other';

const TOPIC_RULES: Array<{ keyword: RegExp; topic: TrustTopic }> = [
  { keyword: /b[-\s]?corp/i, topic: 'b-corp' },
  { keyword: /sustainab/i, topic: 'sustainability' },
  { keyword: /conservation|wildlife|protect/i, topic: 'conservation' },
  { keyword: /safety|safe[-\s]?travel|emergency/i, topic: 'safety' },
  { keyword: /guide|specialist|expert/i, topic: 'expertise' },
  { keyword: /testimonial|review|star/i, topic: 'satisfaction' },
];

function topicFor(text: string, pagetypeTitle: string | null): TrustTopic {
  // Pagetype-driven first.
  if (pagetypeTitle === 'Sustainability') return 'sustainability';
  if (pagetypeTitle === 'B-Corp') return 'b-corp';
  if (pagetypeTitle === 'Conservation') return 'conservation';
  // Then text rules.
  for (const rule of TOPIC_RULES) {
    if (rule.keyword.test(text)) return rule.topic;
  }
  return 'other';
}

interface PageRow {
  id: number;
  canonical_url: string;
  intro_text: string | null;
  summary: string | null;
  pagetype_title: string | null;
  title: string;
}

interface ContentblockRow {
  id: number;
  page_id: number;
  page_canonical_url: string;
  page_title: string;
  pagetype_title: string | null;
  subtype: string;
  title: string | null;
  text: string | null;
}

interface BlogChunkRow {
  id: number;
  blog_post_id: number;
  blog_canonical_url: string;
  blog_title: string;
  text: string;
}

export interface ComposeTrustProofOptions {
  client: pg.PoolClient;
  truncate?: boolean;
  dryRun?: boolean;
}

export interface ComposeTrustProofResult {
  rowsInserted: number;
  pageRows: number;
  blogRows: number;
}

export async function composeTrustProof(
  opts: ComposeTrustProofOptions,
): Promise<ComposeTrustProofResult> {
  if (opts.dryRun) {
    return { rowsInserted: 0, pageRows: 0, blogRows: 0 };
  }
  if (opts.truncate !== false) {
    await opts.client.query(`TRUNCATE trust_proof`);
  }

  let pageRows = 0;
  let blogRows = 0;

  // ---------- 1. Trust-pagetype pages -------------------------------------
  const pages = (
    await opts.client.query<PageRow>(
      `SELECT id, canonical_url, intro_text, summary, pagetype_title, title
       FROM page
       WHERE pagetype_title = ANY($1::text[])`,
      [[...TRUST_PAGETYPE_TITLES]],
    )
  ).rows;

  for (const p of pages) {
    if (p.intro_text?.trim()) {
      const text = stripHtml(p.intro_text);
      await insertTrustRow(opts.client, {
        provenance: p.pagetype_title === 'Partner' ? 'partner_page' : 'swoop_page',
        sourceId: `${p.id}_intro`,
        topic: topicFor(`${p.title} ${text}`, p.pagetype_title),
        claim: p.title,
        evidence: text,
        canonicalUrl: p.canonical_url,
      });
      pageRows += 1;
    }
    if (p.summary?.trim()) {
      const text = stripHtml(p.summary);
      await insertTrustRow(opts.client, {
        provenance: p.pagetype_title === 'Partner' ? 'partner_page' : 'swoop_page',
        sourceId: `${p.id}_summary`,
        topic: topicFor(`${p.title} ${text}`, p.pagetype_title),
        claim: p.title,
        evidence: text,
        canonicalUrl: p.canonical_url,
      });
      pageRows += 1;
    }
  }

  // ---------- 2. Contentblocks of trust pages -----------------------------
  const trustPageIds = pages.map((p) => p.id);
  if (trustPageIds.length > 0) {
    const cbs = (
      await opts.client.query<ContentblockRow>(
        `SELECT cb.id, cb.page_id, cb.subtype, cb.title, cb.text,
                p.canonical_url AS page_canonical_url,
                p.title AS page_title,
                p.pagetype_title
         FROM contentblock cb
         JOIN page p ON p.id = cb.page_id
         WHERE cb.page_id = ANY($1::int[])
           AND cb.text IS NOT NULL
           AND length(trim(cb.text)) > 0
         ORDER BY cb.page_id, cb.position NULLS LAST, cb.id`,
        [trustPageIds],
      )
    ).rows;
    for (const cb of cbs) {
      const chunks = chunkContentblockText(cb.text!);
      for (const c of chunks) {
        await insertTrustRow(opts.client, {
          provenance: cb.pagetype_title === 'Partner' ? 'partner_page' : 'swoop_page',
          sourceId: `${cb.id}_${c.index}`,
          topic: topicFor(`${cb.title ?? cb.page_title} ${c.text}`, cb.pagetype_title),
          claim: cb.title ?? cb.page_title,
          evidence: c.text,
          canonicalUrl: cb.page_canonical_url,
        });
        pageRows += 1;
      }
    }
  }

  // ---------- 3. Reassure blog chunks -------------------------------------
  const reassureChunks = (
    await opts.client.query<BlogChunkRow>(
      `SELECT bc.id, bc.blog_post_id, bc.text,
              bp.canonical_url AS blog_canonical_url,
              bp.title AS blog_title
       FROM blog_chunk bc
       JOIN blog_post bp ON bp.id = bc.blog_post_id
       WHERE bp.primary_job = 'reassure'
          OR 'reassure' = ANY(bp.secondary_jobs)`,
    )
  ).rows;
  for (const bc of reassureChunks) {
    await insertTrustRow(opts.client, {
      provenance: 'blog_b_corp',
      sourceId: String(bc.id),
      topic: topicFor(bc.text, null),
      claim: bc.blog_title,
      evidence: bc.text,
      canonicalUrl: bc.blog_canonical_url,
    });
    blogRows += 1;
  }

  return { rowsInserted: pageRows + blogRows, pageRows, blogRows };
}

interface InsertArgs {
  provenance: 'swoop_page' | 'partner_page' | 'blog_b_corp' | 'pressreview' | 'external_certification';
  sourceId: string;
  topic: TrustTopic;
  claim: string;
  evidence: string;
  canonicalUrl: string | null;
}

async function insertTrustRow(client: pg.PoolClient, row: InsertArgs): Promise<void> {
  const hash = contentHash(`${row.claim}\n${row.evidence}`, SOURCE_TYPE);
  await client.query(
    `INSERT INTO trust_proof
       (source_provenance, source_id, topic, claim, evidence, canonical_url, content_hash, tsv)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $4 || ' ' || $5))`,
    [row.provenance, row.sourceId, row.topic, row.claim, row.evidence, row.canonicalUrl, hash],
  );
}
