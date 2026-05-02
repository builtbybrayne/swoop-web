/**
 * CLI entry point for the C.t6 image annotation pipeline.
 *
 * Plan: planning/03-exec-c-t6.md.
 * HITL ratification 2026-05-01.
 *
 * Usage (from `product/`):
 *
 *   npm --workspace @swoop/ingestion run annotate-images -- \
 *     [--mode=dry-run|live|batches]   # default: dry-run
 *     [--max-budget=N]                # USD; required for live + batches
 *     [--limit=N]                     # cap candidate set
 *     [--resume]                      # respect checkpoint
 *     [--retry-failed]                # re-process checkpoint failures
 *     [--per-call-usd=0.005]          # override per-call cost in estimator
 *     [--concurrency=5]               # live-mode pool size (HITL Q5: 5-up)
 *     [--namespace=v2]                # checkpoint folder
 *     [--model=claude-sonnet-4-5-20250929]
 *     [--database-url ...]            # default: connector/.env DATABASE_URL
 *
 * Defaults match the HITL ratification: dry-run (no spend) is the
 * default; --max-budget is required to spend; 5-up concurrency for live.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { run, type RunMode, type RunResult } from './run.js';
import { DEFAULT_PER_CALL_USD } from './cost.js';

interface CliArgs {
  mode: RunMode;
  maxBudgetUsd: number | undefined;
  limit: number | undefined;
  resume: boolean;
  retryFailed: boolean;
  perCallUsd: number | undefined;
  concurrency: number | undefined;
  namespace: string | undefined;
  model: string | undefined;
  databaseUrl: string;
  apiKey: string | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  let mode: RunMode = 'dry-run';
  let maxBudgetUsd: number | undefined;
  let limit: number | undefined;
  let resume = false;
  let retryFailed = false;
  let perCallUsd: number | undefined;
  let concurrency: number | undefined;
  let namespace: string | undefined;
  let model: string | undefined;
  let databaseUrl: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--mode') {
      mode = parseMode(argv[++i]);
    } else if (a.startsWith('--mode=')) {
      mode = parseMode(a.slice('--mode='.length));
    } else if (a === '--max-budget') {
      maxBudgetUsd = parseFloatStrict(argv[++i], '--max-budget');
    } else if (a.startsWith('--max-budget=')) {
      maxBudgetUsd = parseFloatStrict(a.slice('--max-budget='.length), '--max-budget');
    } else if (a === '--limit') {
      limit = parseIntStrict(argv[++i], '--limit');
    } else if (a.startsWith('--limit=')) {
      limit = parseIntStrict(a.slice('--limit='.length), '--limit');
    } else if (a === '--resume') {
      resume = true;
    } else if (a === '--retry-failed') {
      retryFailed = true;
    } else if (a === '--dry-run') {
      mode = 'dry-run';
    } else if (a === '--per-call-usd') {
      perCallUsd = parseFloatStrict(argv[++i], '--per-call-usd');
    } else if (a.startsWith('--per-call-usd=')) {
      perCallUsd = parseFloatStrict(a.slice('--per-call-usd='.length), '--per-call-usd');
    } else if (a === '--concurrency') {
      concurrency = parseIntStrict(argv[++i], '--concurrency');
    } else if (a.startsWith('--concurrency=')) {
      concurrency = parseIntStrict(a.slice('--concurrency='.length), '--concurrency');
    } else if (a === '--namespace') {
      namespace = argv[++i];
    } else if (a.startsWith('--namespace=')) {
      namespace = a.slice('--namespace='.length);
    } else if (a === '--model') {
      model = argv[++i];
    } else if (a.startsWith('--model=')) {
      model = a.slice('--model='.length);
    } else if (a === '--database-url') {
      databaseUrl = argv[++i];
    } else if (a.startsWith('--database-url=')) {
      databaseUrl = a.slice('--database-url='.length);
    } else {
      throw new Error(`Unknown argument: ${a}. Use --help to see options.`);
    }
  }

  // Load DATABASE_URL + ANTHROPIC_API_KEY from connector/.env if present.
  const connectorEnv = path.resolve(currentDir(), '..', '..', '..', 'connector', '.env');
  if (existsSync(connectorEnv)) {
    loadDotenv({ path: connectorEnv, override: true });
  }
  // Also load product/orchestrator/.env for ANTHROPIC_API_KEY which lives there in dev.
  const orchEnv = path.resolve(currentDir(), '..', '..', '..', 'orchestrator', '.env');
  if (existsSync(orchEnv)) {
    loadDotenv({ path: orchEnv, override: false });
  }

  databaseUrl = databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL not set; pass --database-url or set in product/connector/.env.',
    );
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;

  return {
    mode,
    maxBudgetUsd,
    limit,
    resume,
    retryFailed,
    perCallUsd,
    concurrency,
    namespace,
    model,
    databaseUrl,
    apiKey,
  };
}

function parseMode(raw: string | undefined): RunMode {
  if (raw === 'dry-run' || raw === undefined) return 'dry-run';
  if (raw === 'live') return 'live';
  if (raw === 'batches') return 'batches';
  throw new Error(`--mode must be one of: dry-run | live | batches (got: ${raw}).`);
}

function parseIntStrict(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value.`);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer (got: ${raw}).`);
  }
  return n;
}

function parseFloatStrict(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value.`);
  const cleaned = raw.replace(/^\$/, '');
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive number (got: ${raw}).`);
  }
  return n;
}

function printHelp(): void {
  console.log(`Usage:
  npm --workspace @swoop/ingestion run annotate-images -- [options]

Options:
  --mode <mode>             dry-run | live | batches (default: dry-run)
  --max-budget <USD>        Max projected spend; required for live + batches
  --limit <N>               Cap the candidate set (slice for prompt iteration)
  --resume                  Apply checkpoint state — skip ids already done
  --retry-failed            With --resume, re-process checkpoint failures
  --per-call-usd <USD>      Override per-call cost in estimator (default: ${DEFAULT_PER_CALL_USD})
  --concurrency <N>         Live-mode worker pool size (default: 5; HITL Q5)
  --namespace <name>        Checkpoint folder under data/image-annotations
  --model <model>           Anthropic model id (default: sonnet 4.5)
  --database-url <url>      DATABASE_URL override (otherwise loaded from connector/.env)
  --help, -h                Print this help

Environment variables consumed:
  DATABASE_URL              Same surface as @swoop/connector
  ANTHROPIC_API_KEY         Required for --mode=live or --mode=batches

Examples:
  # Cost estimate only — no Vision calls fired:
  npm --workspace @swoop/ingestion run annotate-images

  # 20-image live slice for prompt iteration:
  npm --workspace @swoop/ingestion run annotate-images -- \\
      --mode=live --limit=20 --max-budget=2

  # Full Batches submission against the ~6.7K candidates:
  npm --workspace @swoop/ingestion run annotate-images -- \\
      --mode=batches --max-budget=25
`);
}

function currentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export async function main(argv: string[]): Promise<RunResult> {
  const args = parseArgs(argv);
  const u = new URL(args.databaseUrl);
  console.log(
    `[annotate] target Postgres: host=${u.hostname} db=${u.pathname.slice(1)} mode=${args.mode}`,
  );

  const pool = new pg.Pool({
    connectionString: args.databaseUrl,
    max: 4,
    application_name: 'swoop-ingestion-annotate-images',
    options: '-c statement_timeout=300000', // 5 min — write-back loop, not a migration.
  });

  const abortController = new AbortController();
  const onSig = (sig: string) => {
    console.log(`[annotate] received ${sig}; aborting...`);
    abortController.abort();
  };
  process.on('SIGINT', () => onSig('SIGINT'));
  process.on('SIGTERM', () => onSig('SIGTERM'));

  let result: RunResult;
  try {
    const client = await pool.connect();
    try {
      result = await run({
        client,
        mode: args.mode,
        maxBudgetUsd: args.maxBudgetUsd,
        limit: args.limit,
        resume: args.resume,
        retryFailed: args.retryFailed,
        perCallUsdOverride: args.perCallUsd,
        concurrency: args.concurrency,
        apiKey: args.apiKey,
        model: args.model,
        signal: abortController.signal,
        checkpointNamespace: args.namespace,
      });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  return result;
}

// Auto-run when invoked as a script.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main(process.argv.slice(2))
    .then((result) => {
      if (result.abortedReason) {
        process.exitCode = 2;
      } else if (result.failed > 0) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(`[annotate] FATAL: ${err instanceof Error ? err.message : err}`);
      if (err instanceof Error && err.stack) console.error(err.stack);
      process.exit(1);
    });
}
