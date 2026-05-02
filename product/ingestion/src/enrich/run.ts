/**
 * Top-level enrich runner — orchestrates the embed + classify + compose passes.
 *
 * Plan: planning/03-exec-c-t3a.md §"Sub-step ordering" + §"Verification".
 *
 * Modes:
 *   - 'embed': Voyage embedding passes only.
 *   - 'classify': Haiku Batches API classifier passes only.
 *   - 'compose': SQL composition into derived tables only.
 *   - 'all': embed → classify → compose → embed-derived-rows (composition
 *     produces text-only rows; second embed pass populates the embeddings).
 *
 * Cost cap: ENRICH_BUDGET_GBP env var (defaults: dev £10 / prod £15 per HITL Q1).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import {
  CostLedger,
  DEFAULT_HARD_CAP_GBP_DEV,
  DEFAULT_HARD_CAP_GBP_PROD,
  DEFAULT_SOFT_WARNING_GBP,
} from './cost.js';
import { withEnrichClient, closeEnrichPool, type EnrichPoolConfig } from './pool.js';
import { embedTags } from './embed/tags.js';
import { embedFaqItems } from './embed/faqitems.js';
import { embedImages } from './embed/images.js';
import { embedBlogChunks } from './embed/blog-chunks.js';
import { embedDerivedTable } from './embed/derived-rows.js';
import { VoyageClient } from './voyage.js';
import type { BatchClient } from './haiku.js';
import { loadClassifierPrompt, resolveEtlPromptsRoot } from './prompts.js';
import { CLASSIFIER_SCHEMAS } from './schemas.js';
import { classifyBlogPostJob } from './classify/blog-post-job.js';
import { classifyPersonaSummary } from './classify/persona-summary.js';
import { classifyBlogTagNormalisation } from './classify/blog-tag-normalisation.js';
// Image-annotation classifier retired 2026-05-02: folded into C.t6's
// unified Vision call (one Claude Vision call → description + annotation
// + 4 tag arrays). See product/ingestion/src/images/.
import { composeInspirePassage } from './compose/inspire-passage.js';
import { composeCustomerStory } from './compose/customer-story.js';
import { composeTrustProof } from './compose/trust-proof.js';
import { composeInformChunk } from './compose/inform-chunk.js';
import { composeTripCard } from './compose/trip-card.js';

export type RunMode = 'embed' | 'classify' | 'compose' | 'all';

export interface EnrichRunOptions {
  mode: RunMode;
  /** Sub-source filter (e.g. 'tag', 'faqitem', 'blog_chunk'). 'all' if undefined. */
  source?: string;
  databaseUrl: string;
  voyage: VoyageClient;
  /** Haiku Batches API client. */
  batch: BatchClient;
  /** Hard cap; defaults to env or dev default. */
  hardCapGbp?: number;
  softWarningGbp?: number;
  /** Limit per pass — useful for testing. */
  limit?: number;
  /** Don't issue API calls; print plan + cost estimate only. */
  dryRun?: boolean;
  /** Override prompts root (tests). */
  promptsRoot?: string;
  /** Where the unmapped blog tags log lives. */
  unmappedLogPath?: string;
  /** Logger override. */
  log?: (msg: string) => void;
}

export interface EnrichRunResult {
  mode: RunMode;
  totalGbp: number;
  perPass: Record<string, unknown>;
  /** Counts per derived table after composition (only set in 'compose' / 'all'). */
  derivedRowCounts?: Record<string, number>;
  /** Sub-pass-level results, keyed by pass name. */
  passResults: Record<string, unknown>;
}

function poolConfigFrom(databaseUrl: string): EnrichPoolConfig {
  return { databaseUrl, statementTimeoutMs: 120_000, poolMax: 4 };
}

export async function runEnrich(opts: EnrichRunOptions): Promise<EnrichRunResult> {
  const log = opts.log ?? ((s) => console.log(s));
  const ledger = new CostLedger({
    hardCapGbp: opts.hardCapGbp ?? (Number(process.env.ENRICH_BUDGET_GBP) || DEFAULT_HARD_CAP_GBP_DEV),
    softWarningGbp: opts.softWarningGbp ?? DEFAULT_SOFT_WARNING_GBP,
  });
  const poolCfg = poolConfigFrom(opts.databaseUrl);
  const passResults: Record<string, unknown> = {};
  let derivedRowCounts: Record<string, number> | undefined;

  const startedAt = Date.now();
  log(
    `[enrich] mode=${opts.mode} source=${opts.source ?? 'all'} hardCap=£${ledger.hardCapGbp.toFixed(2)} softWarning=£${ledger.softWarningGbp.toFixed(2)} dryRun=${opts.dryRun ? 'true' : 'false'}`,
  );

  try {
    await withEnrichClient(poolCfg, async (client) => {
      // Resolve prompts root once.
      const promptsRoot =
        opts.promptsRoot ??
        resolveEtlPromptsRoot(
          path.dirname(fileURLToPath(import.meta.url)),
        );

      // ---------- EMBED ---------------------------------------------------
      if (opts.mode === 'embed' || opts.mode === 'all') {
        if (!opts.source || opts.source === 'tag' || opts.source === 'all') {
          log(`[enrich/embed/tag] starting`);
          passResults['embed:tag'] = await embedTags({
            client,
            voyage: opts.voyage,
            ledger,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
        if (!opts.source || opts.source === 'faqitem' || opts.source === 'all') {
          log(`[enrich/embed/faqitem] starting`);
          passResults['embed:faqitem'] = await embedFaqItems({
            client,
            voyage: opts.voyage,
            ledger,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
        if (!opts.source || opts.source === 'blog_chunk' || opts.source === 'all') {
          log(`[enrich/embed/blog_chunk] starting`);
          passResults['embed:blog_chunk'] = await embedBlogChunks({
            client,
            voyage: opts.voyage,
            ledger,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
        if (!opts.source || opts.source === 'image' || opts.source === 'all') {
          log(`[enrich/embed/image] starting`);
          passResults['embed:image'] = await embedImages({
            client,
            voyage: opts.voyage,
            ledger,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
      }

      // ---------- CLASSIFY ------------------------------------------------
      if (opts.mode === 'classify' || opts.mode === 'all') {
        if (!opts.source || opts.source === 'blog-post-job' || opts.source === 'all') {
          log(`[enrich/classify/blog-post-job] starting`);
          const prompt = await loadClassifierPrompt('blog-post-job', {
            rootDir: promptsRoot,
            schema: CLASSIFIER_SCHEMAS['blog-post-job'],
          });
          passResults['classify:blog-post-job'] = await classifyBlogPostJob({
            client,
            batch: opts.batch,
            ledger,
            prompt,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
        if (!opts.source || opts.source === 'persona-summary' || opts.source === 'all') {
          log(`[enrich/classify/persona-summary] starting`);
          const prompt = await loadClassifierPrompt('persona-summary', {
            rootDir: promptsRoot,
            schema: CLASSIFIER_SCHEMAS['persona-summary'],
          });
          passResults['classify:persona-summary'] = await classifyPersonaSummary({
            client,
            batch: opts.batch,
            ledger,
            prompt,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
        // image-annotation classifier retired 2026-05-02 — folded into
        // C.t6's unified Vision call. The four image tag arrays are
        // populated by `product/ingestion/src/images/annotate.ts`, not
        // here. The `--source=image-annotation` argument is no longer
        // recognised; operators producing image tags should run the C.t6
        // CLI: `npm run -w @swoop/ingestion annotate-images -- ...`.
        if (!opts.source || opts.source === 'blog-tag-normalisation' || opts.source === 'all') {
          log(`[enrich/classify/blog-tag-normalisation] starting`);
          const prompt = await loadClassifierPrompt('blog-tag-normalisation', {
            rootDir: promptsRoot,
            schema: CLASSIFIER_SCHEMAS['blog-tag-normalisation'],
          });
          passResults['classify:blog-tag-normalisation'] = await classifyBlogTagNormalisation({
            client,
            batch: opts.batch,
            ledger,
            prompt,
            unmappedLogPath: opts.unmappedLogPath,
            limit: opts.limit,
            dryRun: opts.dryRun,
          });
        }
      }

      // ---------- COMPOSE -------------------------------------------------
      if (opts.mode === 'compose' || opts.mode === 'all') {
        log(`[enrich/compose] composing derived tables`);
        passResults['compose:inspire_passage'] = await composeInspirePassage({
          client,
          dryRun: opts.dryRun,
        });
        // For customer_story, we need persona outputs from the persona-summary classifier.
        const personaResult = passResults['classify:persona-summary'] as
          | { outputs: Map<string, import('./schemas.js').PersonaSummaryOutput> }
          | undefined;
        passResults['compose:customer_story'] = await composeCustomerStory({
          client,
          personaOutputs: personaResult?.outputs ?? new Map(),
          dryRun: opts.dryRun,
        });
        passResults['compose:trust_proof'] = await composeTrustProof({
          client,
          dryRun: opts.dryRun,
        });
        passResults['compose:inform_chunk'] = await composeInformChunk({
          client,
          dryRun: opts.dryRun,
        });
        passResults['compose:trip_card'] = await composeTripCard({
          client,
          dryRun: opts.dryRun,
        });

        if (!opts.dryRun) {
          // Embed derived tables now that they have text.
          log(`[enrich/embed-derived] embedding derived rows`);
          passResults['embed:inspire_passage'] = await embedDerivedTable({
            client, voyage: opts.voyage, ledger,
            table: 'inspire_passage', textColumn: 'text', embedColumn: 'embedding',
            ledgerKey: 'voyage:inspire_passage', populateTsv: false, idColumn: 'uuid',
          });
          passResults['embed:customer_story'] = await embedDerivedTable({
            client, voyage: opts.voyage, ledger,
            table: 'customer_story', textColumn: 'persona_summary', embedColumn: 'persona_embedding',
            ledgerKey: 'voyage:customer_story', populateTsv: false, idColumn: 'uuid',
          });
          passResults['embed:trust_proof'] = await embedDerivedTable({
            client, voyage: opts.voyage, ledger,
            table: 'trust_proof', textColumn: 'evidence', embedColumn: 'embedding',
            ledgerKey: 'voyage:trust_proof', populateTsv: false, idColumn: 'uuid',
          });
          passResults['embed:inform_chunk'] = await embedDerivedTable({
            client, voyage: opts.voyage, ledger,
            table: 'inform_chunk', textColumn: 'text', embedColumn: 'embedding',
            ledgerKey: 'voyage:inform_chunk', populateTsv: false, idColumn: 'uuid',
          });
          passResults['embed:trip_card'] = await embedDerivedTable({
            client, voyage: opts.voyage, ledger,
            table: 'trip_card', textColumn: 'headline', embedColumn: 'embedding',
            ledgerKey: 'voyage:trip_card', populateTsv: false, idColumn: 'integer',
          });
        }

        // Read post-compose row counts.
        const counts = await readDerivedRowCounts(client);
        derivedRowCounts = counts;
        log(`[enrich/compose] row counts: ${JSON.stringify(counts)}`);
      }
    });
  } finally {
    await closeEnrichPool();
  }

  const summary = ledger.summary();
  const elapsedMs = Date.now() - startedAt;
  log(
    `[enrich] done in ${elapsedMs}ms; total spend £${summary.totalGbp.toFixed(4)}`,
  );

  return {
    mode: opts.mode,
    totalGbp: summary.totalGbp,
    perPass: summary.perPass,
    derivedRowCounts,
    passResults,
  };
}

async function readDerivedRowCounts(client: pg.PoolClient): Promise<Record<string, number>> {
  const tables = ['inspire_passage', 'customer_story', 'trust_proof', 'inform_chunk', 'trip_card'];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${t}`);
    out[t] = Number(r.rows[0]?.n ?? '0');
  }
  return out;
}
