/**
 * Checkpoint persistence for the enrich pass.
 *
 * Plan: planning/03-exec-c-t3a.md §"Outputs — checkpoint.ts". Writes a
 * per-run JSON file under `data/etl/c-t3a-checkpoints/<run-id>.json` so a
 * killed run can resume from the last committed batch.
 *
 * Design note: the cost-cap kill-switch (cost.ts) makes "interrupted but
 * resumable" the common case, so we want this to be cheap + correct.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface CheckpointState {
  /** ISO timestamp of when this run started. */
  runId: string;
  /** Pass key (e.g. 'voyage:tag', 'haiku:persona_summary'). */
  pass: string;
  /** Last successfully-committed cursor (interpretation depends on pass). */
  cursor: string | number | null;
  /** Total rows committed so far. */
  rowsCommitted: number;
  /** Last update wall-clock. */
  updatedAt: string;
}

export class CheckpointStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  pathFor(runId: string): string {
    return path.join(this.rootDir, `${runId}.json`);
  }

  load(runId: string): Record<string, CheckpointState> {
    const p = this.pathFor(runId);
    if (!existsSync(p)) return {};
    try {
      const raw = readFileSync(p, 'utf8');
      return JSON.parse(raw) as Record<string, CheckpointState>;
    } catch {
      return {};
    }
  }

  save(runId: string, state: Record<string, CheckpointState>): void {
    const p = this.pathFor(runId);
    writeFileSync(p, JSON.stringify(state, null, 2), { encoding: 'utf8' });
  }

  update(runId: string, pass: string, partial: Partial<CheckpointState>): void {
    const all = this.load(runId);
    const existing = all[pass] ?? {
      runId,
      pass,
      cursor: null,
      rowsCommitted: 0,
      updatedAt: new Date().toISOString(),
    };
    all[pass] = {
      ...existing,
      ...partial,
      runId,
      pass,
      updatedAt: new Date().toISOString(),
    };
    this.save(runId, all);
  }
}

/**
 * Resolve the data root, walking up from `startDir` to find the repo root
 * marker (.git or .gitignore). Mirrors blog/fetch.ts's `resolveDataRoot`.
 */
export function resolveCheckpointDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, '.git')) || existsSync(path.join(dir, '.gitignore'))) {
      return path.join(dir, 'data', 'etl', 'c-t3a-checkpoints');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to startDir.
  return path.join(startDir, 'data', 'etl', 'c-t3a-checkpoints');
}
