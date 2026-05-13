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
  subject_tags?: string[];
  mood_tags?: string[];
  region_tags?: string[];
  tags?: string[];
}

class FakePgClient {
  rows: ImageRow[];
  writes: Array<{
    id: number;
    description: string | null;
    annotation: string | null;
    subject_tags: string[];
    mood_tags: string[];
    region_tags: string[];
    tags: string[];
  }> = [];

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
      // Single-shape SQL post-fold: $1=id, $2=desc, $3=ann, $4-$7=tag arrays.
      const id = params[0] as number;
      const target = this.rows.find((r) => r.id === id);
      if (!target) {
        return {
          rows: [{ desc_written: false, ann_written: false, tags_written: false }],
        };
      }

      const newDesc = (params[1] as string) ?? '';
      const newAnn = (params[2] as string) ?? '';
      const newSubject = (params[3] as string[]) ?? [];
      const newMood = (params[4] as string[]) ?? [];
      const newRegion = (params[5] as string[]) ?? [];
      const newTags = (params[6] as string[]) ?? [];

      let descWritten = false;
      let annWritten = false;

      // Description: COALESCE(NULLIF(TRIM(description), ''), NULLIF($2, ''))
      // Only writes when upstream is empty AND new desc is non-empty.
      if (
        (target.description === null || target.description.trim() === '') &&
        newDesc !== ''
      ) {
        target.description = newDesc;
        descWritten = true;
      }

      // Annotation: NULLIF($3, '') — writes always when non-empty.
      if (newAnn !== '') {
        target.annotation = newAnn;
        annWritten = true;
      } else {
        target.annotation = null;
      }

      target.subject_tags = newSubject;
      target.mood_tags = newMood;
      target.region_tags = newRegion;
      target.tags = newTags;

      const tagsWritten =
        newSubject.length + newMood.length + newRegion.length + newTags.length > 0;

      this.writes.push({
        id,
        description: target.description,
        annotation: target.annotation,
        subject_tags: newSubject,
        mood_tags: newMood,
        region_tags: newRegion,
        tags: newTags,
      });

      return {
        rows: [
          {
            desc_written: descWritten,
            ann_written: annWritten,
            tags_written: tagsWritten,
          },
        ],
      };
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

  it('live mode with --limit + tight --max-budget: budget gate respects the limit (does NOT abort)', async () => {
    // Regression: pre-fix the cost gate aborted against the full 1000-row
    // projection ($5.00) even when --limit=20 meant only $0.10 would be
    // spent. The fix scales the gate by the limit via withLimit().
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
      limit: 20,
      apiKey: 'fake-key',
      visionClient: fakeVision(
        JSON.stringify({ description: 'd', annotation: 'a' }),
      ),
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(result.abortedReason).toBeUndefined();
    // Only 20 rows should have been processed (succeeded + failed + skipped ≤ 20).
    expect(result.succeeded + result.failed + result.skipped).toBeLessThanOrEqual(20);
    // The log should announce the limit-adjusted projection.
    expect(logs.some((l) => l.includes('--limit=20 applied') && l.includes('effective 20 of 1,000'))).toBe(true);
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
    // Tag arrays default to [] when omitted by the model.
    expect(pg.writes[0]?.subject_tags).toEqual([]);
    expect(pg.writes[0]?.mood_tags).toEqual([]);
    expect(pg.writes[0]?.region_tags).toEqual([]);
    expect(pg.writes[0]?.tags).toEqual([]);
  });

  it('live mode writes the four tag arrays end-to-end (C.t3a fold)', async () => {
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
          description: 'Granite towers.',
          annotation: 'Three peaks. Lake.',
          subject_tags: ['granite', 'tower', 'lake'],
          mood_tags: ['golden-hour', 'vast'],
          region_tags: ['torres-del-paine'],
          tags: ['clear', 'summer'],
        }),
      ),
      checkpointBaseDir: tmpDir,
      log: () => {},
      maxAttempts: 1,
    });
    expect(result.succeeded).toBe(1);
    expect(pg.writes).toHaveLength(1);
    expect(pg.writes[0]?.subject_tags).toEqual(['granite', 'tower', 'lake']);
    expect(pg.writes[0]?.mood_tags).toEqual(['golden-hour', 'vast']);
    expect(pg.writes[0]?.region_tags).toEqual(['torres-del-paine']);
    expect(pg.writes[0]?.tags).toEqual(['clear', 'summer']);
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

  // -------------------------------------------------------------------------
  // BATCH-C.t6 — batches-mode wiring tests
  // -------------------------------------------------------------------------

  function fakeBatchClient(opts: {
    submit?: () => Promise<{ batchId: string; count: number }>;
    poll?: () => Promise<{
      batchId: string;
      status: 'in_progress' | 'canceling' | 'ended';
      endedAt?: Date | null;
      counts: {
        processing: number;
        succeeded: number;
        errored: number;
        canceled: number;
        expired: number;
      };
      resultsUrl?: string | null;
    }>;
    fetchResults: () => Promise<
      Array<{
        customId: string;
        status: 'succeeded' | 'errored' | 'canceled' | 'expired';
        rawText: string | null;
        error?: string;
        inputTokens: number;
        outputTokens: number;
      }>
    >;
  }) {
    return {
      submit:
        opts.submit ??
        (async () => ({ batchId: 'batch_fake', count: 0 })),
      poll:
        opts.poll ??
        (async () => ({
          batchId: 'batch_fake',
          status: 'ended' as const,
          counts: {
            processing: 0,
            succeeded: 0,
            errored: 0,
            canceled: 0,
            expired: 0,
          },
        })),
      fetchResults: opts.fetchResults,
    };
  }

  it('batches mode happy path: submits, waits, writes back, records done', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
      { id: 2, canonical_url: 'https://x/2.jpg', description: null, annotation: null },
    ]);
    const batchClient = fakeBatchClient({
      submit: async () => ({ batchId: 'batch_abc', count: 2 }),
      poll: async () => ({
        batchId: 'batch_abc',
        status: 'ended',
        counts: { processing: 0, succeeded: 2, errored: 0, canceled: 0, expired: 0 },
      }),
      fetchResults: async () => [
        {
          customId: 'image-1',
          status: 'succeeded',
          rawText: JSON.stringify({ description: 'Glacier face.', annotation: 'Blue ice wall.' }),
          inputTokens: 100,
          outputTokens: 50,
        },
        {
          customId: 'image-2',
          status: 'succeeded',
          rawText: JSON.stringify({ description: 'Andean peaks.', annotation: 'Sunset light.' }),
          inputTokens: 100,
          outputTokens: 50,
        },
      ],
    });
    const result = await run({
      client: pg as never,
      mode: 'batches',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      // visionClient won't be used by the batches path because batchClient is injected.
      visionClient: fakeVision('{}'),
      batchClient,
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(pg.writes).toHaveLength(2);
    expect(pg.writes[0]?.description).toMatch(/Glacier/);
    expect(pg.writes[1]?.description).toMatch(/Andean/);
    expect(logs.some((l) => l.includes('batch submitted'))).toBe(true);
    expect(logs.some((l) => l.includes('batch ended'))).toBe(true);
  });

  it('batches mode: errored result records failed with reason; succeeded result writes back', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
      { id: 2, canonical_url: 'https://x/2.jpg', description: null, annotation: null },
    ]);
    const batchClient = fakeBatchClient({
      submit: async () => ({ batchId: 'batch_mix', count: 2 }),
      fetchResults: async () => [
        {
          customId: 'image-1',
          status: 'succeeded',
          rawText: JSON.stringify({ description: 'd', annotation: 'a' }),
          inputTokens: 100,
          outputTokens: 50,
        },
        {
          customId: 'image-2',
          status: 'errored',
          rawText: null,
          error: 'overloaded_error: server is busy',
          inputTokens: 0,
          outputTokens: 0,
        },
      ],
    });
    const result = await run({
      client: pg as never,
      mode: 'batches',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision('{}'),
      batchClient,
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(pg.writes).toHaveLength(1);
    expect(pg.writes[0]?.id).toBe(1);
  });

  it('batches mode: schema-violating rawText records failed without write', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
    ]);
    const batchClient = fakeBatchClient({
      submit: async () => ({ batchId: 'batch_bad', count: 1 }),
      fetchResults: async () => [
        {
          customId: 'image-1',
          status: 'succeeded',
          rawText: '{not valid json',
          inputTokens: 100,
          outputTokens: 50,
        },
      ],
    });
    const result = await run({
      client: pg as never,
      mode: 'batches',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision('{}'),
      batchClient,
      checkpointBaseDir: tmpDir,
      log: () => {},
    });
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(pg.writes).toHaveLength(0);
  });

  it('batches mode: skip-signal records skipped without write', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
    ]);
    const batchClient = fakeBatchClient({
      submit: async () => ({ batchId: 'batch_skip', count: 1 }),
      fetchResults: async () => [
        {
          customId: 'image-1',
          status: 'succeeded',
          rawText: JSON.stringify({ description: '', annotation: '' }),
          inputTokens: 100,
          outputTokens: 50,
        },
      ],
    });
    const result = await run({
      client: pg as never,
      mode: 'batches',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision('{}'),
      batchClient,
      checkpointBaseDir: tmpDir,
      log: () => {},
    });
    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(pg.writes).toHaveLength(0);
  });

  it('batches mode without exposed messages.batches surface AND no batchClient: bails with SDK-missing reason', async () => {
    const pg = new FakePgClient([
      { id: 1, canonical_url: 'https://x/1.jpg', description: null, annotation: null },
    ]);
    // vision client without messages.batches → adapter returns null → bail
    const result = await run({
      client: pg as never,
      mode: 'batches',
      maxBudgetUsd: 10,
      apiKey: 'fake-key',
      visionClient: fakeVision('{}'),
      // no batchClient injected
      checkpointBaseDir: tmpDir,
      log: (l) => logs.push(l),
    });
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(pg.writes).toHaveLength(0);
    expect(
      logs.some((l) =>
        l.includes(
          "doesn't expose messages.batches.{create,retrieve,results}",
        ),
      ),
    ).toBe(true);
  });
});
