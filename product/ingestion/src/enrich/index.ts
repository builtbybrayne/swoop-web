/**
 * CLI entry for the C.t3a enrichment pipeline.
 *
 * Usage (from `product/`):
 *   npm run -w @swoop/ingestion enrich -- --mode=embed --source=tag
 *   npm run -w @swoop/ingestion enrich -- --mode=classify --source=blog-post-job
 *   npm run -w @swoop/ingestion enrich -- --mode=all
 *   npm run -w @swoop/ingestion enrich -- --mode=all --dry-run
 *
 * Args:
 *   --mode=embed|classify|compose|all   (required; 'all' runs the full pipeline)
 *   --source=<name>                     (optional; default 'all' within mode)
 *   --limit=N                           (optional; per-pass row cap, testing)
 *   --dry-run                           (optional; estimate cost, no API calls)
 *   --database-url=<url>                (optional; falls back to DATABASE_URL env)
 *   --budget-gbp=N                      (optional; overrides ENRICH_BUDGET_GBP)
 *
 * Plan: planning/03-exec-c-t3a.md §"Outputs — index.ts" + §"Verification".
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { runEnrich, type RunMode } from './run.js';
import { VoyageClient } from './voyage.js';
import { AnthropicBatchClient, type AnthropicBatchSdk } from './anthropic-batch-client.js';
import {
  DEFAULT_HARD_CAP_GBP_DEV,
  DEFAULT_HARD_CAP_GBP_PROD,
} from './cost.js';

interface Args {
  mode: RunMode;
  source: string | undefined;
  limit: number | undefined;
  dryRun: boolean;
  databaseUrl: string | undefined;
  budgetGbp: number | undefined;
}

function parseArgs(argv: string[]): Args {
  let mode: RunMode | undefined;
  let source: string | undefined;
  let limit: number | undefined;
  let dryRun = false;
  let databaseUrl: string | undefined;
  let budgetGbp: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('--mode=')) {
      mode = a.slice('--mode='.length) as RunMode;
    } else if (a === '--mode') {
      mode = argv[++i] as RunMode;
    } else if (a.startsWith('--source=')) {
      source = a.slice('--source='.length);
    } else if (a === '--source') {
      source = argv[++i];
    } else if (a.startsWith('--limit=')) {
      limit = Number(a.slice('--limit='.length));
    } else if (a === '--limit') {
      limit = Number(argv[++i]);
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a.startsWith('--database-url=')) {
      databaseUrl = a.slice('--database-url='.length);
    } else if (a === '--database-url') {
      databaseUrl = argv[++i];
    } else if (a.startsWith('--budget-gbp=')) {
      budgetGbp = Number(a.slice('--budget-gbp='.length));
    } else if (a === '--budget-gbp') {
      budgetGbp = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!mode) throw new Error('--mode <embed|classify|compose|all> is required');
  if (!['embed', 'classify', 'compose', 'all'].includes(mode)) {
    throw new Error(`Invalid --mode: ${mode}`);
  }

  return { mode, source, limit, dryRun, databaseUrl, budgetGbp };
}

function printHelp(): void {
  console.log(`Usage:
  npm run -w @swoop/ingestion enrich -- --mode <embed|classify|compose|all> [options]

Options:
  --mode <m>            embed | classify | compose | all   (required)
  --source <s>          tag | faqitem | image | blog_chunk | blog-post-job |
                        persona-summary | blog-tag-normalisation
                        (image-annotation retired 2026-05-02 — folded into
                        C.t6's Vision call; use \`annotate-images\` instead)
                        (default: all)
  --limit N             per-pass row cap (testing)
  --dry-run             estimate cost + plan operations; no API calls / writes
  --database-url <url>  override DATABASE_URL env
  --budget-gbp N        override ENRICH_BUDGET_GBP env (default £10 dev / £15 prod)`);
}

function loadEnvFromConnectorIfPresent(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..', '..', 'connector', '.env'),
    path.resolve(here, '..', '..', '..', '..', 'connector', '.env'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      loadDotenv({ path: c, override: true });
      return;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  loadEnvFromConnectorIfPresent();

  const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set; pass --database-url or set in connector/.env');
  }

  // Voyage requires VOYAGE_API_KEY. Skip in dry-run mode.
  const voyageApiKey = process.env.VOYAGE_API_KEY;
  if (!voyageApiKey && !args.dryRun) {
    throw new Error('VOYAGE_API_KEY not set; required for non-dry-run embed pass');
  }

  const voyage = new VoyageClient({ apiKey: voyageApiKey ?? 'dry-run' });

  // Anthropic SDK lookup. If not installed, fall back to a no-op client that
  // throws on actual submit/poll/results so dry-runs still work.
  let batch: import('./haiku.js').BatchClient;
  if (args.dryRun) {
    batch = makeDryRunBatchClient();
  } else {
    batch = await makeProdBatchClient();
  }

  const isProd = process.env.NODE_ENV === 'production';
  const defaultCap = isProd ? DEFAULT_HARD_CAP_GBP_PROD : DEFAULT_HARD_CAP_GBP_DEV;
  const hardCap = args.budgetGbp ?? (Number(process.env.ENRICH_BUDGET_GBP) || defaultCap);

  const result = await runEnrich({
    mode: args.mode,
    source: args.source,
    limit: args.limit,
    dryRun: args.dryRun,
    databaseUrl,
    voyage,
    batch,
    hardCapGbp: hardCap,
    log: (msg) => console.log(msg),
  });

  console.log('---');
  console.log(`mode:           ${result.mode}`);
  console.log(`total spend:    £${result.totalGbp.toFixed(4)}`);
  if (result.derivedRowCounts) {
    console.log('derived row counts:');
    for (const [k, v] of Object.entries(result.derivedRowCounts)) {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log('per-pass spend:');
  for (const [k, v] of Object.entries(result.perPass)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  console.log('per-pass results:');
  for (const [k, v] of Object.entries(result.passResults)) {
    console.log(`  ${k}: ${JSON.stringify(redactOutputs(v))}`);
  }
}

function redactOutputs(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  // Strip the outputs map from passResults so it doesn't blow up the log.
  const o = { ...(obj as Record<string, unknown>) };
  if ('outputs' in o) o['outputs'] = `[Map size=${(o['outputs'] as Map<unknown, unknown>)?.size ?? 0}]`;
  if ('buckets' in o) o['buckets'] = `[Map size=${(o['buckets'] as Map<unknown, unknown>)?.size ?? 0}]`;
  return o;
}

function makeDryRunBatchClient(): import('./haiku.js').BatchClient {
  return {
    submit: async (reqs) => ({ batchId: 'dry-run-batch', count: reqs.length }),
    poll: async () => ({
      batchId: 'dry-run-batch',
      status: 'ended',
      counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
      resultsUrl: null,
    }),
    fetchResults: async () => [],
  };
}

async function makeProdBatchClient(): Promise<import('./haiku.js').BatchClient> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set; required for non-dry-run classifier passes');
  }
  // Dynamic import so the build doesn't hard-fail if the SDK isn't installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Anthropic: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('@anthropic-ai/sdk');
    Anthropic = mod.default ?? mod.Anthropic ?? mod;
  } catch (err) {
    throw new Error(
      `[enrich] @anthropic-ai/sdk not installed in @swoop/ingestion. Install it and retry. (${err instanceof Error ? err.message : err})`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = new Anthropic({ apiKey }) as AnthropicBatchSdk;
  return new AnthropicBatchClient(sdk);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
