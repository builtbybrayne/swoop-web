/**
 * WordPress blog ingest pipeline — Tier 3 spec at
 * `planning/03-exec-blog-ingest.md`.
 *
 * Fetches Swoop's WordPress posts from the public REST API and writes
 * an immutable, dated snapshot folder under `data/blog/raw/<UTC-stamp>/`
 * containing a manifest, NDJSON of full responses, and a per-page log.
 *
 * Single-file by design — small enough to keep the whole pipeline in
 * one place. Internal helpers are exported (named, not as default) so
 * the test suite at `__tests__/fetch.test.ts` can exercise them
 * without hitting the network.
 *
 * Usage (from `product/`):
 *   npm --workspace @swoop/ingestion run blog:fetch                  # incremental
 *   npm --workspace @swoop/ingestion run blog:fetch:backfill         # ignore prior state
 *   npm --workspace @swoop/ingestion run blog:fetch:dry-run          # log, no writes
 *   npx tsx src/blog/fetch.ts --since=2024-01-01                     # explicit floor
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BLOG_ENDPOINT =
  'https://swoop-patagonia.com/blog/wp-json/wp/v2/posts';

export const PER_PAGE = 100;
/** 5-year rolling window — see Tier 3 §"Source / Scope". */
export const RELEVANCE_WINDOW_YEARS = 5;
/** 3 attempts on 5xx + network errors at 1s / 4s / 16s — Tier 3 §Robustness. */
export const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;
/** Single retry on a 429 with no `Retry-After`. */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;

/**
 * Resolve `data/blog/` at the repo root. The repo root is two levels up from
 * `product/ingestion/` (i.e. `../../`). When compiled via tsc the output sits
 * in `dist/blog/`, so we walk back four levels in that case — but we run via
 * tsx, which keeps source layout. Fall back to walking up until we hit the
 * repo root marker (the `.git` directory) so this stays robust either way.
 */
export function resolveDataRoot(startDir: string = currentDir()): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (
      safeStat(path.join(dir, '.git')) ||
      safeStat(path.join(dir, '.gitignore'))
    ) {
      return path.join(dir, 'data', 'blog');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to a path next to the workspace.
  return path.join(startDir, '..', '..', 'data', 'blog');
}

function currentDir(): string {
  // import.meta.url available because we ship as ESM ("type": "module").
  return path.dirname(fileURLToPath(import.meta.url));
}

function safeStat(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Schema for the manifest file we write per run. */
export const ManifestSchema = z.object({
  ingested_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  mode: z.enum(['backfill', 'incremental', 'explicit-since']),
  endpoint: z.string().url(),
  params_used: z.object({
    per_page: z.number().int().positive(),
    orderby: z.literal('modified'),
    order: z.literal('asc'),
    _embed: z.literal(true),
    after: z.string(),
    modified_after: z.string().nullable(),
  }),
  relevance_cutoff: z.string(),
  pages_fetched: z.number().int().nonnegative(),
  post_count: z.number().int().nonnegative(),
  earliest_published: z.string().nullable(),
  latest_published: z.string().nullable(),
  earliest_modified_seen: z.string().nullable(),
  latest_modified_seen: z.string().nullable(),
  duration_ms: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      page: z.number().int().positive().optional(),
      kind: z.enum(['fetch_failed', 'malformed_post', 'rate_limited']),
      detail: z.string(),
    }),
  ),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestError = Manifest['errors'][number];

/**
 * Minimal post shape we depend on for ordering / accounting. We keep the
 * full API response in NDJSON — this schema only enforces the fields we
 * read here.
 */
export const PostShapeSchema = z
  .object({
    id: z.number(),
    date: z.string(),
    modified: z.string(),
  })
  .passthrough();

export type PostShape = z.infer<typeof PostShapeSchema>;

// ---------------------------------------------------------------------------
// HTTP fetcher (injectable for tests)
// ---------------------------------------------------------------------------

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type HttpFetcher = (url: string) => Promise<HttpResponse>;

/** Default fetcher uses Node 20+ built-in `fetch`. */
export const realHttpFetcher: HttpFetcher = async (url) => {
  const res = await fetch(url);
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  // WP returns JSON for /wp-json/... in all observed cases.
  let body: unknown;
  const text = await res.text();
  if (text.length === 0) {
    body = null;
  } else {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, headers, body };
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Compute `now() - 5 years` as ISO-8601 (UTC, second precision). */
export function computeRelevanceCutoff(now: Date = new Date()): string {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RELEVANCE_WINDOW_YEARS);
  return toIsoSeconds(cutoff);
}

/** ISO-8601 with second precision and a `Z` suffix. */
export function toIsoSeconds(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

/** UTC timestamp suitable for a folder name: `YYYY-MM-DDTHHMMSSZ`. */
export function toFolderStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Build the WP REST URL for a given page + filter set. */
export function buildPostsUrl(opts: {
  endpoint?: string;
  page: number;
  perPage?: number;
  after: string;
  modifiedAfter: string | null;
}): string {
  const url = new URL(opts.endpoint ?? BLOG_ENDPOINT);
  url.searchParams.set('per_page', String(opts.perPage ?? PER_PAGE));
  url.searchParams.set('orderby', 'modified');
  url.searchParams.set('order', 'asc');
  url.searchParams.set('_embed', 'true');
  url.searchParams.set('page', String(opts.page));
  url.searchParams.set('after', opts.after);
  if (opts.modifiedAfter) {
    url.searchParams.set('modified_after', opts.modifiedAfter);
  }
  return url.toString();
}

export type Mode = 'backfill' | 'incremental' | 'explicit-since';

export interface CliArgs {
  mode: Mode;
  /** ISO-8601 string when `mode === 'explicit-since'`. */
  since: string | null;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = 'incremental';
  let since: string | null = null;
  let dryRun = false;

  for (const raw of argv) {
    if (raw === '--backfill') mode = 'backfill';
    else if (raw === '--dry-run') dryRun = true;
    else if (raw.startsWith('--since=')) {
      mode = 'explicit-since';
      since = raw.slice('--since='.length);
    } else if (raw.startsWith('--')) {
      throw new Error(`Unknown flag: ${raw}`);
    }
  }

  if (mode === 'explicit-since' && !since) {
    throw new Error('--since requires a value, e.g. --since=2024-01-01');
  }

  return { mode, since, dryRun };
}

/** Find the latest existing run folder, or `null` if none. */
export function findLatestRunFolder(rawRoot: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(rawRoot);
  } catch {
    return null;
  }
  const stamped = entries.filter((e) => /^\d{8}T\d{6}Z$/.test(e)).sort();
  return stamped.length > 0 ? path.join(rawRoot, stamped.at(-1)!) : null;
}

/**
 * Read a previous manifest's `latest_modified_seen`. Returns `null` if
 * no prior run exists, or the manifest file is unreadable / invalid, or
 * the prior run logged any errors (defence-in-depth — a partial run
 * should not be used as the resume floor).
 */
export function readPriorFloor(rawRoot: string): string | null {
  const latest = findLatestRunFolder(rawRoot);
  if (!latest) return null;
  const manifestPath = path.join(latest, 'manifest.json');
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.errors.length > 0) return null;
  return result.data.latest_modified_seen;
}

// ---------------------------------------------------------------------------
// Logger — appends to log.txt and mirrors to stdout
// ---------------------------------------------------------------------------

export interface Logger {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

export function makeFileLogger(logPath: string | null): Logger {
  function write(level: string, line: string): void {
    const stamped = `[${new Date().toISOString()}] [${level}] ${line}`;
    // Always mirror to stdout/stderr.
    if (level === 'ERROR') {
      console.error(stamped);
    } else {
      console.log(stamped);
    }
    if (logPath) {
      try {
        appendFileSync(logPath, `${stamped}\n`);
      } catch {
        // Logging failure is non-fatal — we still have stdout.
      }
    }
  }
  return {
    info: (l) => write('INFO', l),
    warn: (l) => write('WARN', l),
    error: (l) => write('ERROR', l),
  };
}

// ---------------------------------------------------------------------------
// Fetch-with-retry
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds. Injectable as a parameter for tests. */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchPageResult {
  /** HTTP status of the response that succeeded (200) or last attempt. */
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /** Number of retry attempts beyond the initial one (0..2 on success). */
  attempts: number;
}

/**
 * Fetch a single URL with the retry policy from Tier 3 §Robustness.
 *
 * - 5xx + network errors: 3 attempts at 1s / 4s / 16s. After the third
 *   failure we throw — the caller records the page in `errors[]`.
 * - 429: honour `Retry-After` header (seconds) if present, else sleep
 *   `DEFAULT_RATE_LIMIT_BACKOFF_MS`. One retry, then throw.
 * - 4xx (other): no retry — surface immediately.
 */
export async function fetchPageWithRetry(
  url: string,
  opts: {
    fetcher: HttpFetcher;
    sleep?: Sleep;
    retryDelaysMs?: readonly number[];
    rateLimitBackoffMs?: number;
    logger?: Logger;
  },
): Promise<FetchPageResult> {
  const sleep = opts.sleep ?? realSleep;
  const retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const rateLimitMs = opts.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
  const logger = opts.logger;

  let lastError: unknown = null;
  let rateLimitedOnce = false;

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (attempt > 0) {
      const delay = retryDelays[attempt - 1];
      logger?.warn(
        `retrying ${url} (attempt ${attempt + 1}/${retryDelays.length}) after ${delay}ms`,
      );
      await sleep(delay);
    }

    let response: HttpResponse | null = null;
    try {
      response = await opts.fetcher(url);
    } catch (err) {
      lastError = err;
      logger?.warn(`fetch threw on ${url}: ${describeError(err)}`);
      continue; // network error — retry
    }

    if (response.status >= 200 && response.status < 300) {
      return { ...response, attempts: attempt };
    }

    if (response.status === 429) {
      if (rateLimitedOnce) {
        throw new RateLimitError(
          `429 after retry on ${url}`,
          response.status,
          response.headers,
        );
      }
      rateLimitedOnce = true;
      const retryAfterRaw = response.headers['retry-after'];
      const retryAfterMs = parseRetryAfterMs(retryAfterRaw, rateLimitMs);
      logger?.warn(
        `429 from ${url}; sleeping ${retryAfterMs}ms (Retry-After=${retryAfterRaw ?? 'absent'})`,
      );
      await sleep(retryAfterMs);
      // Re-attempt without consuming a 5xx retry slot.
      attempt--;
      continue;
    }

    if (response.status >= 500 && response.status < 600) {
      lastError = new Error(`HTTP ${response.status} on ${url}`);
      logger?.warn(`5xx on ${url}: status=${response.status}`);
      continue; // 5xx — retry
    }

    // Other 4xx — no retry, surface immediately.
    throw new HttpError(
      `HTTP ${response.status} on ${url}`,
      response.status,
      response.headers,
    );
  }

  throw new RetriesExhaustedError(
    `Retries exhausted for ${url}: ${describeError(lastError)}`,
  );
}

function parseRetryAfterMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  // HTTP-date form. Try to parse; otherwise fallback.
  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    return Math.max(0, at - Date.now());
  }
  return fallback;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class RateLimitError extends HttpError {
  constructor(
    message: string,
    status: number,
    headers: Record<string, string>,
  ) {
    super(message, status, headers);
    this.name = 'RateLimitError';
  }
}

export class RetriesExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetriesExhaustedError';
  }
}

// ---------------------------------------------------------------------------
// Run orchestrator
// ---------------------------------------------------------------------------

export interface RunOptions {
  args: CliArgs;
  /** Override for tests / non-default deployments. */
  dataRoot?: string;
  fetcher?: HttpFetcher;
  sleep?: Sleep;
  /** Override "now" — useful for tests. */
  now?: Date;
}

export interface RunResult {
  manifest: Manifest;
  /**
   * Path to the run folder (or `null` in dry-run mode where we don't
   * create one).
   */
  runFolder: string | null;
}

/**
 * Top-level orchestrator. Determines floor, creates the run folder
 * (unless dry-run), pages through the WP REST API, writes NDJSON +
 * manifest, returns the manifest.
 */
export async function run(opts: RunOptions): Promise<RunResult> {
  const fetcher = opts.fetcher ?? realHttpFetcher;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? new Date();
  const dataRoot = opts.dataRoot ?? resolveDataRoot();
  const rawRoot = path.join(dataRoot, 'raw');

  const cutoff = computeRelevanceCutoff(now);
  const folderStamp = toFolderStamp(now);
  const runFolder = path.join(rawRoot, folderStamp);

  // Resolve `modified_after` floor.
  let modifiedAfter: string | null;
  if (opts.args.mode === 'backfill') {
    modifiedAfter = null;
  } else if (opts.args.mode === 'explicit-since') {
    modifiedAfter = opts.args.since;
  } else {
    const prior = readPriorFloor(rawRoot);
    if (prior === null) {
      modifiedAfter = null;
      // Fall through to backfill behaviour with a console warning per Tier 3.
      console.warn(
        '[blog:fetch] no prior clean manifest found — falling through to backfill behaviour',
      );
    } else {
      modifiedAfter = prior;
    }
  }

  // Set up directories + logger if not in dry-run mode.
  let logPath: string | null = null;
  let postsPath: string | null = null;
  if (!opts.args.dryRun) {
    mkdirSync(runFolder, { recursive: true });
    logPath = path.join(runFolder, 'log.txt');
    postsPath = path.join(runFolder, 'posts.ndjson');
    // Ensure posts.ndjson exists (empty) up-front so even a zero-post
    // run has the file present.
    writeFileSync(postsPath, '');
  }
  const logger = makeFileLogger(logPath);

  logger.info(
    `start mode=${opts.args.mode} cutoff=${cutoff} modified_after=${modifiedAfter ?? 'null'} dry_run=${opts.args.dryRun}`,
  );

  const startedAt = Date.now();
  const errors: ManifestError[] = [];
  let pagesFetched = 0;
  let postCount = 0;
  let earliestPublished: string | null = null;
  let latestPublished: string | null = null;
  let earliestModified: string | null = null;
  let latestModified: string | null = null;
  let totalPagesHeader: number | null = null;

  let page = 1;
  while (true) {
    const url = buildPostsUrl({
      page,
      after: cutoff,
      modifiedAfter,
    });
    logger.info(`GET page=${page} ${url}`);

    let result: FetchPageResult;
    try {
      result = await fetchPageWithRetry(url, { fetcher, sleep, logger });
    } catch (err) {
      logger.error(`page ${page} failed: ${describeError(err)}`);
      errors.push({
        page,
        kind: err instanceof RateLimitError ? 'rate_limited' : 'fetch_failed',
        detail: describeError(err),
      });
      // Tier 3 §Robustness: continue past a failed page rather than abort.
      // For a paged endpoint that's the only way to capture downstream pages
      // when one is transiently unhappy. If page=1 fails, we have no totals,
      // so we abort the loop (no way to know when to stop).
      if (page === 1 && totalPagesHeader === null) {
        logger.error('page 1 failed and totals unknown — aborting');
        break;
      }
      // If we know the upper bound and we've reached it, stop. Otherwise the
      // loop would walk all the way to the hard 200-page safety cap on a
      // single transient failure of the last page.
      if (totalPagesHeader !== null && page >= totalPagesHeader) {
        logger.info(
          `page ${page} failed and reached X-WP-TotalPages=${totalPagesHeader}; stopping`,
        );
        break;
      }
      page++;
      continue;
    }

    pagesFetched++;

    // Capture totals from page 1 headers.
    if (page === 1) {
      const tp = Number(result.headers['x-wp-totalpages']);
      if (Number.isFinite(tp) && tp >= 0) {
        totalPagesHeader = tp;
        logger.info(`X-WP-TotalPages=${tp} X-WP-Total=${result.headers['x-wp-total'] ?? 'absent'}`);
      } else {
        logger.warn('X-WP-TotalPages header missing or non-numeric');
      }
    }

    const posts = Array.isArray(result.body) ? result.body : [];
    if (posts.length === 0) {
      logger.info(`page ${page} returned 0 posts — terminating loop`);
      break;
    }

    for (const post of posts) {
      const parsed = PostShapeSchema.safeParse(post);
      if (!parsed.success) {
        const id =
          post && typeof post === 'object' && 'id' in post
            ? String((post as { id?: unknown }).id)
            : '<unknown>';
        const detail = `post id=${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
        logger.warn(`malformed post: ${detail}`);
        errors.push({ page, kind: 'malformed_post', detail });
        continue;
      }
      const { date, modified } = parsed.data;
      if (!earliestPublished || date < earliestPublished) earliestPublished = date;
      if (!latestPublished || date > latestPublished) latestPublished = date;
      if (!earliestModified || modified < earliestModified) earliestModified = modified;
      if (!latestModified || modified > latestModified) latestModified = modified;

      if (!opts.args.dryRun && postsPath) {
        appendFileSync(postsPath, `${JSON.stringify(post)}\n`);
      }
      postCount++;
    }

    logger.info(
      `page ${page} done: posts=${posts.length} attempts=${result.attempts} cumulative=${postCount}`,
    );

    // Dry-run: only fetch page 1 per Tier 3 §CLI shape "fetch headers + first page only".
    if (opts.args.dryRun) {
      logger.info('dry-run: stopping after page 1');
      break;
    }

    if (totalPagesHeader !== null && page >= totalPagesHeader) {
      logger.info(`reached X-WP-TotalPages=${totalPagesHeader}; stopping`);
      break;
    }

    page++;
    if (page > 200) {
      // Hard safety cap.
      logger.error('hit hard page cap of 200 — aborting');
      errors.push({
        kind: 'fetch_failed',
        detail: 'hit hard page cap of 200 — aborting',
      });
      break;
    }
  }

  const manifest: Manifest = {
    ingested_at: toIsoSeconds(now),
    mode: opts.args.mode,
    endpoint: BLOG_ENDPOINT,
    params_used: {
      per_page: PER_PAGE,
      orderby: 'modified',
      order: 'asc',
      _embed: true,
      after: cutoff,
      modified_after: modifiedAfter,
    },
    relevance_cutoff: cutoff,
    pages_fetched: pagesFetched,
    post_count: postCount,
    earliest_published: earliestPublished,
    latest_published: latestPublished,
    earliest_modified_seen: earliestModified,
    latest_modified_seen: latestModified,
    duration_ms: Date.now() - startedAt,
    errors,
  };

  // Validate before writing — catches accidental schema drift in the code
  // ahead of the operator noticing.
  ManifestSchema.parse(manifest);

  // Verification checks per Tier 3 §"Verification on each run".
  // Each is logged but non-fatal — the whole point is to surface drift, not
  // to throw away good data.
  if (totalPagesHeader !== null && Math.abs(pagesFetched - totalPagesHeader) > 1 && errors.length === 0) {
    logger.warn(
      `pages_fetched=${pagesFetched} differs from X-WP-TotalPages=${totalPagesHeader} by more than 1 (no errors recorded)`,
    );
  }
  if (
    latestModified &&
    earliestModified &&
    latestModified < earliestModified
  ) {
    logger.error(
      `invariant violated: latest_modified_seen (${latestModified}) < earliest_modified_seen (${earliestModified})`,
    );
  }

  if (opts.args.dryRun) {
    logger.info('dry-run summary:');
    logger.info(JSON.stringify(manifest, null, 2));
    return { manifest, runFolder: null };
  }

  const manifestPath = path.join(runFolder, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  logger.info(`wrote manifest ${manifestPath}`);
  logger.info(
    `done: posts=${postCount} pages=${pagesFetched} errors=${errors.length} duration_ms=${manifest.duration_ms}`,
  );

  return { manifest, runFolder };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const result = await run({ args });
  if (result.manifest.errors.length > 0) {
    // Non-zero exit so a CI / cron run notices.
    process.exitCode = 1;
  }
}

// Run main() only when invoked as a script (not when imported by tests).
const isDirectInvocation = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const arg1 = process.argv[1];
    return Boolean(arg1) && path.resolve(arg1) === path.resolve(thisFile);
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main().catch((err) => {
    console.error('[blog:fetch] fatal:', err);
    process.exit(1);
  });
}
