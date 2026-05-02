/**
 * Resumable-run state for the C.t6 image annotation pipeline.
 *
 * One JSON file per run namespace under
 * `product/ingestion/data/image-annotations/<namespace>/checkpoint.json`.
 * Default namespace is `default`; an operator can pass `--namespace=v2`
 * to test a prompt revision in isolation without polluting the main run.
 *
 * Storage shape:
 *
 *     {
 *       "version": 1,
 *       "namespace": "default",
 *       "createdAt": "2026-05-02T13:00:00.000Z",
 *       "updatedAt": "2026-05-02T13:05:00.000Z",
 *       "runs": [...],         // one entry per CLI invocation
 *       "byId": {
 *         "12345": { "status": "done", "lastError": null, "attempts": 1, "ts": "..." },
 *         "12346": { "status": "failed", "lastError": "vision_403", "attempts": 3, "ts": "..." },
 *         ...
 *       }
 *     }
 *
 * The `byId` map is the load-bearing index: a `--resume` run reads it,
 * skips ids with `status: 'done'`, retries `failed` if `--retry-failed`
 * is passed, and ignores `pending` (in-flight from a crashed run; treat
 * as retryable).
 *
 * Idempotency: writes are atomic (tmp file + rename). Concurrent
 * processes touching the same checkpoint are out of scope — the
 * pipeline runs as a single Cloud Run Job in production. Local-dev
 * concurrent runs against the same namespace are an operator error.
 *
 * The checkpoint is gitignored via the workspace-level
 * `product/ingestion/data/` exclusion pattern (see the parent
 * `.gitignore`). Annotations are derived data; their checkpoint is
 * scratch.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';

export type CheckpointStatus = 'pending' | 'done' | 'skipped' | 'failed';

export interface CheckpointEntry {
  status: CheckpointStatus;
  lastError: string | null;
  attempts: number;
  ts: string;
}

export interface CheckpointRunSummary {
  startedAt: string;
  endedAt: string | null;
  mode: 'dry-run' | 'live' | 'batches';
  candidatesCount: number;
  succeeded: number;
  skipped: number;
  failed: number;
  estimatedUsd: number;
}

export interface CheckpointFile {
  version: 1;
  namespace: string;
  createdAt: string;
  updatedAt: string;
  runs: CheckpointRunSummary[];
  byId: Record<string, CheckpointEntry>;
}

export interface CheckpointOptions {
  namespace?: string;
  /** Override the default storage directory; primarily for tests. */
  baseDir?: string;
}

/**
 * Resolve the on-disk checkpoint path for a namespace. The default lives
 * inside the @swoop/ingestion package so it doesn't leak across
 * workspaces.
 */
export function resolveCheckpointPath(opts: CheckpointOptions = {}): string {
  const namespace = opts.namespace ?? 'default';
  const baseDir =
    opts.baseDir ??
    (() => {
      // here = .../product/ingestion/src/images
      const here = path.dirname(fileURLToPath(import.meta.url));
      const ingestionRoot = path.resolve(here, '..', '..');
      return path.resolve(ingestionRoot, 'data', 'image-annotations');
    })();
  return path.resolve(baseDir, namespace, 'checkpoint.json');
}

/**
 * Load a checkpoint from disk; if missing, return an empty in-memory
 * shape ready to be saved. Save is explicit — callers stage entries
 * via `recordEntry` and persist via `saveCheckpoint` to avoid an
 * fsync per row in tight loops.
 */
export function loadCheckpoint(opts: CheckpointOptions = {}): {
  file: CheckpointFile;
  filePath: string;
} {
  const filePath = resolveCheckpointPath(opts);
  if (!existsSync(filePath)) {
    const now = new Date().toISOString();
    return {
      file: {
        version: 1,
        namespace: opts.namespace ?? 'default',
        createdAt: now,
        updatedAt: now,
        runs: [],
        byId: {},
      },
      filePath,
    };
  }
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  // Permissive parse: we own the format. If an older schema appears we
  // upgrade lazily (today there's only version 1).
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: number }).version !== 1
  ) {
    throw new Error(
      `[annotate] checkpoint at ${filePath} has unsupported version; expected 1.`,
    );
  }
  return { file: parsed as CheckpointFile, filePath };
}

/**
 * Atomic write — rename-from-tmp so a crash mid-write doesn't truncate
 * the file. The rename within the same directory is atomic on POSIX.
 */
export function saveCheckpoint(filePath: string, file: CheckpointFile): void {
  file.updatedAt = new Date().toISOString();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(tmp, filePath);
}

/**
 * Record a per-id outcome. Increments attempts when the id was
 * already present; resets `lastError` to null on `done`.
 */
export function recordEntry(
  file: CheckpointFile,
  id: number,
  status: CheckpointStatus,
  lastError: string | null,
): void {
  const key = String(id);
  const prior = file.byId[key];
  const attempts = (prior?.attempts ?? 0) + 1;
  file.byId[key] = {
    status,
    lastError: status === 'done' ? null : lastError,
    attempts,
    ts: new Date().toISOString(),
  };
}

/**
 * Add a fresh run summary stub. Caller mutates it as the run progresses
 * (succeeded / skipped / failed counters); the final saveCheckpoint
 * persists the full summary.
 */
export function startRun(
  file: CheckpointFile,
  mode: CheckpointRunSummary['mode'],
  candidatesCount: number,
  estimatedUsd: number,
): CheckpointRunSummary {
  const summary: CheckpointRunSummary = {
    startedAt: new Date().toISOString(),
    endedAt: null,
    mode,
    candidatesCount,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    estimatedUsd,
  };
  file.runs.push(summary);
  return summary;
}

/**
 * Filter ids that should be skipped per the checkpoint state.
 *
 * - `done` ids are skipped unconditionally.
 * - `failed` ids are skipped UNLESS `retryFailed` is true.
 * - `skipped` (model emitted empty output) ids are skipped (they're
 *   non-Patagonia / unreachable; re-running spends a call for nothing).
 * - `pending` ids are NOT skipped — those are in-flight rows from a
 *   crashed run and should be retried.
 */
export function shouldSkipId(
  file: CheckpointFile,
  id: number,
  retryFailed: boolean,
): boolean {
  const entry = file.byId[String(id)];
  if (!entry) return false;
  if (entry.status === 'done') return true;
  if (entry.status === 'skipped') return true;
  if (entry.status === 'failed' && !retryFailed) return true;
  return false;
}
