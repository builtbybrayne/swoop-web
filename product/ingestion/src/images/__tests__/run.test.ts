/**
 * Integration test for run.ts: mocked Postgres + mocked Vision client.
 *
 * Validates the load-bearing branches:
 *   - dry-run never calls the model.
 *   - --max-budget is required to spend.
 *   - The budget gate refuses when projected > budget.
 *   - Live mode round-trips a candidate, schema-parses output, and writes
 *     to the (fake) DB only when the description column is empty.
 *   - The skip-signal (both fields blank) records `skipped` without writing.
 *   - A schema-violating model output records `failed`.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../run.js';
import type { AnthropicClientLike } from '../vision-client.js';

interface ImageRow {
  id: number;
  canonical_url: string;
  description: string | null;
  annotation: string | null;
}

class FakePgClient {
  rows: ImageRow[];
  writes: Array<{ id: number; description: string | null; annotation: string | null }> = [];

  constructor(rows: ImageRow[]) {
    this.rows = rows;
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.startsWith('SELECT COUNT(*)')) {
      const count = this.candidateRows().length;
      return { rows: [{ n: count }] };
    }

    if (trimmed.startsWith('SELECT ID, CANONICAL_URL, DESCRIPTION, ANNOTATION')) {
      const limit = (params[0] as number | undefined) ?? this.rows.length;
      return { rows: this.candidateRows().slice(0, limit) };
    }

    if (trimmed.startsWith('UPDATE IMAGE')) {
      // Both-cols, annotation-only, description-only branches all start with this.
      const id = params[0] as number;
      const target = this.rows.find((r) => r.id === id);
      if (!target) return { rows: [{ desc_written: false, ann_written: false }] };

      const isBoth = sql.includes('description = COALESCE') && sql.includes('annotation = $3');
      const isAnnOnly = !isBoth && sql.includes('annotation = $2');

      let descWritten = false;
      let annWritten = false;

      if (isBoth) {
        const newDesc = params[1] as string;
        const newAnn = params[2] as string;
        // Only fill description when previously empty/null/whitespace.
        if (target.description === null || target.description.trim() === '') {
          target.description = newDesc;
          descWritten = true;
        }
        target.annotation = newAnn;
        annWritten = true;
      } else if (isAnnOnly) {
        target.annotation = params[1] as string;
        annWritten = true;
      } else {
        // description-only
        const newDesc = params[1] as string;
        if (target.description === null || target.description.trim() === '') {
          target.description = newDesc;
          descWritten = true;
        }
      }

      this.writes.push({ id, description: target.description, annotation: target.annotation });
      return { rows: [{ desc_written: descWritten, ann_written: annWritten }] };
    }

    throw new Error(`FakePgClient unhandled SQL: ${sql.slice(0, 80)}`);
  }

  private candidateRows(): ImageRow[] {
    return this.rows.filter(
      (r) =>
        r.canonical_url !== null &&
        r.canonical_url.trim() !== '' &&
        (r.description === null || r.description.trim() === ''),
    );
  }
}

function fakeVision(jsonOut: string | (() => string)): AnthropicClientLike {
  return {
    messages: {
      create: async () => ({
        content: [
          {
            type: 'text',
            text: typeof jsonOut === 'function' ? jsonOut() : jsonOut,
          },
        ],
        stop_reason: 'end_turn',
      }),
    },
  };
}

describe('run() — annotation pipeline', () => {
  let tmpDir: string;
  let logs: string[];
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'puma-annotate-run-'));
    logs = [];
  });
  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dry-run: counts candidates, projects cost, never invokes vision', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
      { id: 2, canonical_url: 'https://x/2.jpg', description: null, annotation: null },
      { id: 3, canonical_url: 'https://x/3.jpg', description: 'already', annotation: null },
    ]);
    let calls = 0;
    const client: AnthropicClientLike = {
      messages: {
        create: async () => {
          calls += 1;
          return { content: [], stop_reason: null };
        },
      },
    };
    const result = await run({
      client: pg as never,
      mode: 'dry-run',
      visionClient: client,
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(calls).toBe(0);
    expect(result.candidatesCount).toBe(2);
    expect(result.estimate.totalUsdLive).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes('dry-run: no Vision calls fired'))).toBe(true);
    expect(pg.writes).toHaveLength(0);
  });

  it('live mode without --max-budget: aborts with operator-readable reason', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
    ]);
    const result = await run({
      client: pg as never,
      mode: 'live',
      visionClient: fakeVision('{}'),
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(result.abortedReason).toMatch(/--max-budget=N is required/);
    expect(pg.writes).toHaveLength(0);
  });

  it('live mode with --max-budget too small: refuses to spend', async () => {
    const pg = new FakePgClient(
      Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        canonical_url: `https://x/${i}.jpg`,
        description: null,
        annotation: null,
      })),
    );
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 1,
      visionClient: fakeVision('{}'),
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(result.abortedReason).toMatch(/projected/);
    expect(result.abortedReason).toMatch(/budget \$1.00/);
    expect(pg.writes).toHaveLength(0);
  });

  it('live mode happy path: parses JSON, writes both cols, records done', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
    ]);
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision(
        JSON.stringify({
          description: 'Granite towers at golden hour.',
          annotation: 'Three peaks lit by sunset. Lake foreground.',
        }),
      ),
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
      maxAttempts: 1,
    });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(pg.writes).toHaveLength(1);
    expect(pg.writes[0]?.description).toMatch(/Granite/);
    expect(pg.writes[0]?.annotation).toMatch(/Three peaks/);
  });

  it('live mode skip-signal: model returns blanks → recorded skipped, no write', async () => {
    const pg = new FakePgClient([
      { id: 9, canonical_url: 'https://x/9.jpg', description: null, annotation: null },
    ]);
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision(JSON.stringify({ description: '', annotation: '' })),
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
      maxAttempts: 1,
    });
    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(pg.writes).toHaveLength(0);
  });

  it('live mode schema-violating output: recorded failed, no write', async () => {
    const pg = new FakePgClient([
      { id: 7, canonical_url: 'https://x/7.jpg', description: null, annotation: null },
    ]);
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision('this is not json at all'),
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
      maxAttempts: 1,
    });
    expect(result.failed).toBe(1);
    expect(pg.writes).toHaveLength(0);
  });

  it('live mode strips ```json``` code-fence wrappers', async () => {
    const pg = new FakePgClient([
      { id: 11, canonical_url: 'https://x/11.jpg', description: null, annotation: null },
    ]);
    const fenced = '```json\n' + JSON.stringify({ description: 'd', annotation: 'a' }) + '\n```';
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision(fenced),
      checkpointBaseDir: tmpDir,
      log: () => {},
      maxAttempts: 1,
    });
    expect(result.succeeded).toBe(1);
  });

  it('live mode never overwrites a populated upstream description', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
      { id: 2, canonical_url: 'https://x/2.jpg', description: 'curated upstream', annotation: null },
    ]);
    // Note id=2 has populated description so it isn't a candidate; only id=1 runs.
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision(
        JSON.stringify({ description: 'GENERATED', annotation: 'A' }),
      ),
      checkpointBaseDir: tmpDir,
      log: () => {},
      maxAttempts: 1,
    });
    expect(result.succeeded).toBe(1);
    expect(pg.rows.find((r) => r.id === 2)?.description).toBe('curated upstream');
    expect(pg.rows.find((r) => r.id === 1)?.description).toBe('GENERATED');
  });

  it('--resume skips ids already marked done in the checkpoint', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
      { id: 2, canonical_url: 'https://x/2.jpg', description: null, annotation: null },
    ]);
    // First run does both.
    await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision(JSON.stringify({ description: 'd', annotation: 'a' })),
      checkpointBaseDir: tmpDir,
      log: () => {},
      maxAttempts: 1,
      checkpointNamespace: 'resume-ns',
    });
    expect(pg.writes).toHaveLength(2);
    pg.writes = [];

    // Reset the rows to "needs annotation" again so the candidate filter
    // surfaces them, then run with --resume — expect ZERO writes (skipped
    // by the checkpoint, not by the row state).
    pg.rows.forEach((r) => {
      r.description = null;
      r.annotation = null;
    });
    let calls = 0;
    const result = await run({
      client: pg as never,
      mode: 'live',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      resume: true,
      visionClient: {
        messages: {
          create: async () => {
            calls += 1;
            return {
              content: [{ type: 'text', text: JSON.stringify({ description: 'd', annotation: 'a' }) }],
              stop_reason: 'end_turn',
            };
          },
        },
      },
      checkpointBaseDir: tmpDir,
      log: () => {},
      maxAttempts: 1,
      checkpointNamespace: 'resume-ns',
    });
    expect(calls).toBe(0);
    expect(result.candidatesCount).toBe(0);
    expect(pg.writes).toHaveLength(0);
  });
});
