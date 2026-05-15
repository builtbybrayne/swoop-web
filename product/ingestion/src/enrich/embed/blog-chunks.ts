/**
 * Blog post chunking + embedding.
 *
 * Two responsibilities (run as one pass for efficiency):
 *
 *  1. Chunk every `blog_post.content` (HTML) into `blog_chunk` rows on
 *     `<h2>`/`<h3>` boundaries with sliding-window fallback at ~800 tokens.
 *  2. Embed each chunk via Voyage and write into `blog_chunk.embedding`.
 *
 * Idempotency: each chunk row carries `(blog_post_id, chunk_index, content_hash)`
 * via UNIQUE(blog_post_id, chunk_index) + content_hash check. Re-runs against
 * unchanged source skip writes entirely. When `blog_post.content` changes,
 * the new chunk-set replaces the old (DELETE then INSERT for that post id).
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-pass design — embed/blog-chunks.ts" +
 * §"Sub-pass design — Per-source-row embedding".
 */

import type pg from 'pg';
import type { CostLedger } from '../cost.js';
import { approxTokenCount } from '../cost.js';
import { embedInBatches, GEMINI_MODEL_ID, GeminiClient } from '../gemini.js';
import { toPgVectorLiteral } from '../pool.js';
import { chunkBlogHtml, type SourceChunk } from '../chunk.js';
import { contentHash } from '../hash.js';

const SOURCE_TYPE = 'blog_chunk';

interface BlogPostRow {
  id: number;
  content: string | null;
}

interface PendingChunk {
  blog_post_id: number;
  chunk_index: number;
  text: string;
  content_hash: string;
}

export interface EmbedBlogChunksOptions {
  client: pg.PoolClient;
  embeddingClient: GeminiClient;
  ledger: CostLedger;
  limit?: number;
  dryRun?: boolean;
}

export interface EmbedBlogChunksResult {
  postsConsidered: number;
  postsRechunked: number;
  postsSkippedNoChange: number;
  chunksWritten: number;
  estimatedTokens: number;
}

async function readBlogPosts(client: pg.PoolClient, limit?: number): Promise<BlogPostRow[]> {
  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : '';
  const r = await client.query<BlogPostRow>(
    `SELECT id, content FROM blog_post ORDER BY id ${limitClause}`,
  );
  return r.rows;
}

async function readExistingChunkHashes(
  client: pg.PoolClient,
  postId: number,
): Promise<Map<number, string>> {
  const r = await client.query<{ chunk_index: number; content_hash: string }>(
    `SELECT chunk_index, content_hash FROM blog_chunk WHERE blog_post_id = $1`,
    [postId],
  );
  const map = new Map<number, string>();
  for (const row of r.rows) map.set(row.chunk_index, row.content_hash);
  return map;
}

export async function embedBlogChunks(
  opts: EmbedBlogChunksOptions,
): Promise<EmbedBlogChunksResult> {
  const posts = await readBlogPosts(opts.client, opts.limit);
  const pending: PendingChunk[] = [];
  let postsRechunked = 0;
  let postsSkippedNoChange = 0;

  for (const post of posts) {
    const html = post.content ?? '';
    const chunks: SourceChunk[] = chunkBlogHtml(html);
    const newHashesByIndex = new Map<number, string>();
    for (const c of chunks) {
      newHashesByIndex.set(c.index, contentHash(c.text, SOURCE_TYPE));
    }
    const existing = await readExistingChunkHashes(opts.client, post.id);
    const sameSet =
      existing.size === newHashesByIndex.size &&
      [...newHashesByIndex.entries()].every(([idx, h]) => existing.get(idx) === h);

    if (sameSet) {
      postsSkippedNoChange += 1;
      continue;
    }
    postsRechunked += 1;

    if (!opts.dryRun) {
      // Replace the chunk-set: DELETE existing then we'll INSERT below after
      // we've embedded.
      await opts.client.query(`DELETE FROM blog_chunk WHERE blog_post_id = $1`, [post.id]);
    }

    for (const c of chunks) {
      pending.push({
        blog_post_id: post.id,
        chunk_index: c.index,
        text: c.text,
        content_hash: newHashesByIndex.get(c.index)!,
      });
    }
  }

  let estimatedTokens = 0;
  for (const c of pending) estimatedTokens += approxTokenCount(c.text);

  if (opts.dryRun) {
    return {
      postsConsidered: posts.length,
      postsRechunked,
      postsSkippedNoChange,
      chunksWritten: 0,
      estimatedTokens,
    };
  }

  if (pending.length === 0) {
    return {
      postsConsidered: posts.length,
      postsRechunked,
      postsSkippedNoChange,
      chunksWritten: 0,
      estimatedTokens: 0,
    };
  }

  // Cache lookup: any pending chunk whose content_hash already exists in
  // embedding_cache can skip the Gemini call entirely (per
  // planning/03-exec-crosscut-embedding-cache.md §2.4). We hold the literal
  // form so we can pass it straight into the INSERT below.
  const literalsByHash = new Map<string, string>();
  const cacheLookup = await opts.client.query<{ content_hash: string; embedding: string }>(
    `SELECT content_hash, embedding::text AS embedding FROM embedding_cache
     WHERE content_hash = ANY($1::text[]) AND model_version = $2`,
    [pending.map((c) => c.content_hash), GEMINI_MODEL_ID],
  );
  for (const row of cacheLookup.rows) {
    literalsByHash.set(row.content_hash, row.embedding);
  }

  const cacheMisses = pending.filter((c) => !literalsByHash.has(c.content_hash));

  if (cacheMisses.length > 0) {
    const out = await embedInBatches(opts.embeddingClient, cacheMisses, (c) => c.text, {
      // batchSize + concurrency intentionally unset — defer to env-var-overridable
      // defaults so operators can dial down for rate-limit windows.
      shouldAbort: () => opts.ledger.shouldAbort(),
      onBatchComplete: (t) => opts.ledger.recordEmbedding('gemini:blog_chunk', t, 1),
    });

    // Write-through to cache for freshly-embedded chunks + collect literals
    // for the INSERT pass below.
    for (const { item, embedding } of out) {
      const literal = toPgVectorLiteral(embedding);
      literalsByHash.set(item.content_hash, literal);
      await opts.client.query(
        `INSERT INTO embedding_cache (content_hash, model_version, embedding)
         VALUES ($1, $2, $3::halfvec(3072))
         ON CONFLICT (content_hash, model_version) DO NOTHING`,
        [item.content_hash, GEMINI_MODEL_ID, literal],
      );
    }
  }

  let chunksWritten = 0;
  for (const c of pending) {
    const literal = literalsByHash.get(c.content_hash);
    if (!literal) continue; // defensive — shouldn't happen given the lookup above
    await opts.client.query(
      `INSERT INTO blog_chunk (blog_post_id, chunk_index, text, embedding, content_hash)
       VALUES ($1, $2, $3, $4::halfvec(3072), $5)`,
      [c.blog_post_id, c.chunk_index, c.text, literal, c.content_hash],
    );
    chunksWritten += 1;
  }

  return {
    postsConsidered: posts.length,
    postsRechunked,
    postsSkippedNoChange,
    chunksWritten,
    estimatedTokens,
  };
}
