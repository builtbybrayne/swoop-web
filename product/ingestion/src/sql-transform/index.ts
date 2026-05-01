/**
 * CLI entry point for the SQL-transform pipeline.
 *
 * Usage (from `product/`):
 *   npm run -w @swoop/ingestion etl:sql -- \
 *     --dump data/content-data-swoop-patagonia_prod.sql \
 *     [--customerreview-dump data/customerreview_tables_-_swoop-patagonia_prod.sql] \
 *     [--database-url "$DATABASE_URL"] \
 *     [--dry-run] \
 *     [--only=trip,page]
 *
 * Defaults:
 *   - DATABASE_URL: from `product/connector/.env` via the connector's loadConfig.
 *   - --customerreview-dump: looked up alongside the main dump if file exists.
 *
 * Plan: planning/03-exec-c-t3.md §"CLI shape".
 * HITL ratification 2026-05-01.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { run, type RunResult } from './run.js';

interface Args {
  dump: string;
  customerReviewDump: string | undefined;
  databaseUrl: string;
  dryRun: boolean;
  only: Set<string> | undefined;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let dump: string | undefined;
  let customerReviewDump: string | undefined;
  let databaseUrl: string | undefined;
  let dryRun = false;
  let only: Set<string> | undefined;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dump') dump = argv[++i];
    else if (a.startsWith('--dump=')) dump = a.slice('--dump='.length);
    else if (a === '--customerreview-dump') customerReviewDump = argv[++i];
    else if (a.startsWith('--customerreview-dump=')) customerReviewDump = a.slice('--customerreview-dump='.length);
    else if (a === '--database-url') databaseUrl = argv[++i];
    else if (a.startsWith('--database-url=')) databaseUrl = a.slice('--database-url='.length);
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--yes' || a === '-y') yes = true;
    else if (a.startsWith('--only=')) {
      const v = a.slice('--only='.length);
      only = new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--only') {
      const v = argv[++i] ?? '';
      only = new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!dump) {
    throw new Error('--dump <path> is required.');
  }

  // Load DATABASE_URL from connector/.env if not supplied.
  if (!databaseUrl) {
    const connectorEnv = path.resolve(currentDir(), '..', '..', '..', 'connector', '.env');
    if (existsSync(connectorEnv)) {
      loadDotenv({ path: connectorEnv, override: true });
    }
    databaseUrl = process.env.DATABASE_URL;
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set; pass --database-url or set in connector/.env.');
  }

  // Auto-detect customerreview dump if not supplied.
  if (!customerReviewDump) {
    const candidate = path.resolve(
      path.dirname(dump),
      'customerreview_tables_-_swoop-patagonia_prod.sql',
    );
    if (existsSync(candidate)) customerReviewDump = candidate;
  }

  return { dump, customerReviewDump, databaseUrl, dryRun, only, yes };
}

function printHelp(): void {
  console.log(`Usage:
  npm run -w @swoop/ingestion etl:sql -- --dump <path> [options]

Options:
  --dump <path>                   MariaDB SQL dump path. Required.
  --customerreview-dump <path>    Supplementary customerreview dump.
                                  Auto-detected next to --dump if present.
  --database-url <url>            DATABASE_URL override; otherwise loads from
                                  product/connector/.env.
  --dry-run                       Parse + log counts without writing.
  --only <list>                   Comma-separated target table allowlist
                                  (e.g. --only=trip,page,image).
  --yes / -y                      Skip the prod-host safety prompt.
  --help / -h                     Print this help.
`);
}

/**
 * Belt-and-braces guard against accidentally writing to a Cloud SQL prod
 * instance. Heuristic only — not a substitute for proper IAM scoping.
 */
function refuseProdLikeUrl(url: string, yes: boolean): void {
  const lower = url.toLowerCase();
  if (lower.includes('prod') && !yes) {
    throw new Error(
      `DATABASE_URL contains "prod" — refusing to run without --yes (heuristic safety check).`,
    );
  }
}

function currentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export async function main(argv: string[]): Promise<RunResult> {
  const args = parseArgs(argv);
  refuseProdLikeUrl(args.databaseUrl, args.yes);

  const u = new URL(args.databaseUrl);
  console.log(
    `[etl:sql] target Postgres: host=${u.hostname} db=${u.pathname.slice(1)} dry-run=${args.dryRun}`,
  );

  const pool = new pg.Pool({
    connectionString: args.databaseUrl,
    max: 4,
    application_name: 'swoop-ingestion-etl-sql',
    options: '-c statement_timeout=300000', // 5 min — ETL needs more than the service-default 10s.
  });

  let result: RunResult;
  try {
    const client = await pool.connect();
    try {
      result = await run({
        client,
        dumpPath: args.dump,
        customerReviewDumpPath: args.customerReviewDump,
        only: args.only,
        dryRun: args.dryRun,
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
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[etl:sql] FATAL: ${err instanceof Error ? err.message : err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
}
