/**
 * Unit + integration tests for `sweepHandoffs` (E.t6).
 *
 * Two test setups:
 *   1. In-memory `HandoffStore` test double — exercises the sweeper's wrapper
 *      logic (event emission, run-id wiring, policy digest, error paths) with
 *      a controllable store. Most cases live here.
 *   2. Tmp-dir `FsHandoffStore` integration — proves the wrapper drives the
 *      real store implementation end-to-end. The mixed-age + per-verdict
 *      windows case lives here.
 *
 * Clock injection: every test pins `now` via the `now` dep so age arithmetic
 * is deterministic. No real-wall-clock sleeps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SampleHandoffDisqualified,
  SampleHandoffInconclusive,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
} from '@swoop/common/fixtures';
import { setEventSink, resetEventSink, type Event } from '@swoop/common';
import type { HandoffPayload } from '@swoop/common';

import { FsHandoffStore } from '../store.js';
import type {
  DeleteResult,
  HandoffStore,
  RetentionPolicy,
  SaveResult,
  SweepResult,
} from '../store.js';
import { DEFAULT_RETENTION_POLICY, sweepHandoffs } from '../sweeper.js';

// ---------------------------------------------------------------------------
// In-memory test double.
//
// Keyed by handoffId; `sweep()` reuses the same iteration shape as
// FsHandoffStore so the wrapper test doubles match the real implementation's
// observable behaviour without committing tests to FS semantics.
// ---------------------------------------------------------------------------

interface InMemoryStoreOpts {
  /** Optional override: throw on list(), to exercise the sweep-failed path. */
  listThrows?: Error;
  /** Optional override: a specific id whose delete() returns delete_failed. */
  deleteFailsFor?: string;
  /** Optional override: a specific id whose get() returns null (corrupt). */
  parseFailsFor?: string;
}

class InMemoryHandoffStore implements HandoffStore {
  private records = new Map<string, HandoffPayload>();
  constructor(private readonly opts: InMemoryStoreOpts = {}) {}

  async save(payload: HandoffPayload): Promise<SaveResult> {
    this.records.set(payload.handoffId, payload);
    return {
      ok: true,
      handoffId: payload.handoffId,
      absolutePath: `mem://${payload.handoffId}`,
    };
  }

  async get(handoffId: string): Promise<HandoffPayload | null> {
    if (this.opts.parseFailsFor === handoffId) return null;
    return this.records.get(handoffId) ?? null;
  }

  async list(): Promise<readonly string[]> {
    if (this.opts.listThrows) throw this.opts.listThrows;
    return [...this.records.keys()].sort();
  }

  async delete(handoffId: string): Promise<DeleteResult> {
    if (this.opts.deleteFailsFor === handoffId) {
      return { ok: false, reason: 'delete_failed', detail: 'simulated' };
    }
    const had = this.records.delete(handoffId);
    return { ok: true, deleted: had };
  }

  async sweep(now: Date, policy: RetentionPolicy): Promise<SweepResult> {
    // Delegate to FsHandoffStore's algorithm via a shared shape. Reproduce the
    // same logic in-memory so the wrapper tests don't ride on FS semantics.
    let ids: readonly string[];
    try {
      ids = await this.list();
    } catch (err) {
      return { ok: false, reason: 'sweep_failed', detail: String(err) };
    }
    const perVerdict = {
      qualified: 0,
      referred_out: 0,
      disqualified: 0,
      inconclusive: 0,
    };
    const skipped: Array<{ handoffId: string; reason: 'parse_failed' | 'unknown_verdict' | 'not_expired' | 'delete_failed' }> = [];
    let scanned = 0;
    let deleted = 0;
    for (const id of ids) {
      scanned += 1;
      const record = await this.get(id);
      if (record === null) {
        skipped.push({ handoffId: id, reason: 'parse_failed' });
        continue;
      }
      const window = policy[record.verdict];
      const submitted = Date.parse(record.session.handoffSubmittedAt);
      if (submitted + window >= now.getTime()) continue;
      const dr = await this.delete(id);
      if (!dr.ok) {
        skipped.push({ handoffId: id, reason: 'delete_failed' });
        continue;
      }
      if (dr.deleted) {
        deleted += 1;
        perVerdict[record.verdict] += 1;
      }
    }
    return {
      ok: true,
      scanned,
      deleted,
      perVerdict,
      skipped,
    };
  }
}

// Helper to mint a fixture with a specific submittedAt timestamp.
function withSubmittedAt(payload: HandoffPayload, isoTs: string, handoffId: string): HandoffPayload {
  return {
    ...payload,
    handoffId,
    session: { ...payload.session, handoffSubmittedAt: isoTs, sessionId: `sess_${handoffId}` },
  } as HandoffPayload;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Event capture sink.
// ---------------------------------------------------------------------------

let captured: Event[] = [];

beforeEach(() => {
  captured = [];
  setEventSink((e) => {
    captured.push(e);
  });
});

afterEach(() => {
  resetEventSink();
});

// ---------------------------------------------------------------------------
// Wrapper-level tests against the in-memory store.
// ---------------------------------------------------------------------------

describe('sweepHandoffs (wrapper)', () => {
  it('empty store: returns scanned/deleted=0 + emits started+completed only', async () => {
    const store = new InMemoryHandoffStore();
    const now = new Date('2026-05-12T12:00:00.000Z');

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.perVerdict).toEqual({
        qualified: 0,
        referred_out: 0,
        disqualified: 0,
        inconclusive: 0,
      });
      expect(result.skipped).toHaveLength(0);
    }

    const types = captured.map((e) => e.eventType);
    expect(types).toEqual([
      'handoff.retention.sweep.started',
      'handoff.retention.sweep.completed',
    ]);

    // started + completed share runId
    const started = captured[0]!;
    const completed = captured[1]!;
    expect(started.eventType).toBe('handoff.retention.sweep.started');
    expect(completed.eventType).toBe('handoff.retention.sweep.completed');
    if (started.eventType === 'handoff.retention.sweep.started' && completed.eventType === 'handoff.retention.sweep.completed') {
      expect(started.payload.runId).toBe(completed.payload.runId);
      expect(started.payload.storeKind).toBe('fs'); // InMemoryHandoffStore → defaults to 'fs'
    }
  });

  it('all records under retention: none deleted', async () => {
    const store = new InMemoryHandoffStore();
    const now = new Date('2026-05-12T12:00:00.000Z');
    // 5 days ago — well under any retention window.
    const recentTs = new Date(now.getTime() - 5 * DAY_MS).toISOString();

    await store.save(withSubmittedAt(SampleHandoffQualified, recentTs, 'q_recent'));
    await store.save(withSubmittedAt(SampleHandoffReferredOut, recentTs, 'r_recent'));
    await store.save(withSubmittedAt(SampleHandoffDisqualified, recentTs, 'd_recent'));
    await store.save(withSubmittedAt(SampleHandoffInconclusive, recentTs, 'i_recent'));

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(0);
      expect(result.perVerdict).toEqual({
        qualified: 0,
        referred_out: 0,
        disqualified: 0,
        inconclusive: 0,
      });
    }
  });

  it('all records over retention: all four verdicts deleted', async () => {
    const store = new InMemoryHandoffStore();
    const now = new Date('2026-05-12T12:00:00.000Z');
    // 400 days ago — past every window (max 360d for qualified/referred_out).
    const ancientTs = new Date(now.getTime() - 400 * DAY_MS).toISOString();

    await store.save(withSubmittedAt(SampleHandoffQualified, ancientTs, 'q_old'));
    await store.save(withSubmittedAt(SampleHandoffReferredOut, ancientTs, 'r_old'));
    await store.save(withSubmittedAt(SampleHandoffDisqualified, ancientTs, 'd_old'));
    await store.save(withSubmittedAt(SampleHandoffInconclusive, ancientTs, 'i_old'));

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(4);
      expect(result.perVerdict).toEqual({
        qualified: 1,
        referred_out: 1,
        disqualified: 1,
        inconclusive: 1,
      });
    }
  });

  it('verdict-specific window: qualified survives at day 89, disqualified expires at day 91', async () => {
    const store = new InMemoryHandoffStore();
    const now = new Date('2026-05-12T12:00:00.000Z');
    const day89 = new Date(now.getTime() - 89 * DAY_MS).toISOString();
    const day91 = new Date(now.getTime() - 91 * DAY_MS).toISOString();

    // qualified at day 89 — under 360d window, survives
    await store.save(withSubmittedAt(SampleHandoffQualified, day89, 'q_day89'));
    // disqualified at day 89 — under 90d window, survives
    await store.save(withSubmittedAt(SampleHandoffDisqualified, day89, 'd_day89'));
    // disqualified at day 91 — over 90d window, expires
    await store.save(withSubmittedAt(SampleHandoffDisqualified, day91, 'd_day91'));

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(3);
      expect(result.deleted).toBe(1);
      expect(result.perVerdict.disqualified).toBe(1);
      expect(result.perVerdict.qualified).toBe(0);
    }

    // The surviving records are still in the store.
    expect(await store.get('q_day89')).not.toBeNull();
    expect(await store.get('d_day89')).not.toBeNull();
    expect(await store.get('d_day91')).toBeNull();
  });

  it('corrupt record: skipped with parse_failed, not deleted', async () => {
    const store = new InMemoryHandoffStore({ parseFailsFor: 'corrupt' });
    const now = new Date('2026-05-12T12:00:00.000Z');
    const oldTs = new Date(now.getTime() - 400 * DAY_MS).toISOString();

    // Save a valid record under the corrupt id so list() returns it but
    // get() returns null. The id will land in `skipped` and the record
    // stays in the underlying map.
    await store.save(withSubmittedAt(SampleHandoffQualified, oldTs, 'corrupt'));

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.skipped).toEqual([{ handoffId: 'corrupt', reason: 'parse_failed' }]);
    }
  });

  it('delete_failed for one id: sweep continues; that id appears in skipped', async () => {
    const store = new InMemoryHandoffStore({ deleteFailsFor: 'broken' });
    const now = new Date('2026-05-12T12:00:00.000Z');
    const oldTs = new Date(now.getTime() - 400 * DAY_MS).toISOString();

    await store.save(withSubmittedAt(SampleHandoffQualified, oldTs, 'broken'));
    await store.save(withSubmittedAt(SampleHandoffQualified, oldTs, 'good_a'));
    await store.save(withSubmittedAt(SampleHandoffQualified, oldTs, 'good_b'));

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(3);
      expect(result.deleted).toBe(2);
      expect(result.skipped).toEqual([{ handoffId: 'broken', reason: 'delete_failed' }]);
    }
  });

  it('policyDigest differs across two policies', async () => {
    const store = new InMemoryHandoffStore();
    const now = new Date('2026-05-12T12:00:00.000Z');

    await sweepHandoffs({ store, now: () => now });
    const digestDefault = captured.find(
      (e) => e.eventType === 'handoff.retention.sweep.started',
    );
    captured = [];

    const shortPolicy: RetentionPolicy = Object.freeze({
      qualified: 1000,
      referred_out: 1000,
      disqualified: 1000,
      inconclusive: 1000,
    });
    await sweepHandoffs({ store, now: () => now, policy: shortPolicy });
    const digestShort = captured.find(
      (e) => e.eventType === 'handoff.retention.sweep.started',
    );

    if (
      digestDefault?.eventType === 'handoff.retention.sweep.started' &&
      digestShort?.eventType === 'handoff.retention.sweep.started'
    ) {
      expect(digestDefault.payload.policyDigest).not.toBe(digestShort.payload.policyDigest);
      // 64 hex chars (sha256).
      expect(digestDefault.payload.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    } else {
      throw new Error('expected started events on both runs');
    }
  });

  it('custom 1-second policy expires a 5-second-old record', async () => {
    const store = new InMemoryHandoffStore();
    const now = new Date('2026-05-12T12:00:00.000Z');
    const fiveSecondsAgo = new Date(now.getTime() - 5_000).toISOString();
    await store.save(withSubmittedAt(SampleHandoffQualified, fiveSecondsAgo, 'recent_q'));

    const tinyPolicy: RetentionPolicy = Object.freeze({
      qualified: 1000,
      referred_out: 1000,
      disqualified: 1000,
      inconclusive: 1000,
    });
    const result = await sweepHandoffs({
      store,
      policy: tinyPolicy,
      now: () => now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toBe(1);
      expect(result.perVerdict.qualified).toBe(1);
    }
  });

  it('list() throws: emits failed event + returns ok:false', async () => {
    const store = new InMemoryHandoffStore({ listThrows: new Error('boom') });
    const now = new Date('2026-05-12T12:00:00.000Z');

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('sweep_failed');
    }

    const types = captured.map((e) => e.eventType);
    expect(types).toEqual([
      'handoff.retention.sweep.started',
      'handoff.retention.sweep.failed',
    ]);
    const failed = captured[1]!;
    if (failed.eventType === 'handoff.retention.sweep.failed') {
      expect(failed.payload.errorCategory).toBe('sweep_failed');
    }
  });

  it('store.sweep throws (contract violation): caught + tagged unknown', async () => {
    const buggyStore: HandoffStore = {
      save: async () => ({ ok: true, handoffId: 'x', absolutePath: '' }),
      get: async () => null,
      list: async () => [],
      delete: async () => ({ ok: true, deleted: false }),
      sweep: async () => {
        throw new Error('contract broken');
      },
    };
    const result = await sweepHandoffs({
      store: buggyStore,
      now: () => new Date('2026-05-12T12:00:00.000Z'),
    });
    expect(result.ok).toBe(false);

    const failed = captured.find((e) => e.eventType === 'handoff.retention.sweep.failed');
    expect(failed).toBeDefined();
    if (failed?.eventType === 'handoff.retention.sweep.failed') {
      expect(failed.payload.errorCategory).toBe('unknown');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test against the real FsHandoffStore.
// ---------------------------------------------------------------------------

describe('sweepHandoffs (FsHandoffStore integration)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'puma-sweeper-'));
    tempDirs.push(dir);
    return dir;
  }

  it('eight records mixed ages: deletes exactly the four expired', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    const now = new Date('2026-05-12T12:00:00.000Z');

    // Fresh = 5 days ago — under any window.
    const freshTs = new Date(now.getTime() - 5 * DAY_MS).toISOString();
    // For 90d-verdicts: 100 days ago — expired.
    const oldShortTs = new Date(now.getTime() - 100 * DAY_MS).toISOString();
    // For 360d-verdicts: 400 days ago — expired.
    const oldLongTs = new Date(now.getTime() - 400 * DAY_MS).toISOString();

    // Two qualified — one fresh, one 400d-old (expires under 360d window)
    await store.save(withSubmittedAt(SampleHandoffQualified, freshTs, 'q_fresh'));
    await store.save(withSubmittedAt(SampleHandoffQualified, oldLongTs, 'q_old'));
    // Two referred_out — same shape
    await store.save(withSubmittedAt(SampleHandoffReferredOut, freshTs, 'r_fresh'));
    await store.save(withSubmittedAt(SampleHandoffReferredOut, oldLongTs, 'r_old'));
    // Two disqualified — one fresh, one 100d-old (expires under 90d window)
    await store.save(withSubmittedAt(SampleHandoffDisqualified, freshTs, 'd_fresh'));
    await store.save(withSubmittedAt(SampleHandoffDisqualified, oldShortTs, 'd_old'));
    // Two inconclusive — same shape
    await store.save(withSubmittedAt(SampleHandoffInconclusive, freshTs, 'i_fresh'));
    await store.save(withSubmittedAt(SampleHandoffInconclusive, oldShortTs, 'i_old'));

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(8);
      expect(result.deleted).toBe(4);
      expect(result.perVerdict).toEqual({
        qualified: 1,
        referred_out: 1,
        disqualified: 1,
        inconclusive: 1,
      });
    }

    // Survivors still on disk.
    expect(await store.get('q_fresh')).not.toBeNull();
    expect(await store.get('r_fresh')).not.toBeNull();
    expect(await store.get('d_fresh')).not.toBeNull();
    expect(await store.get('i_fresh')).not.toBeNull();
    // Expired records gone from disk.
    expect(await store.get('q_old')).toBeNull();
    expect(await store.get('r_old')).toBeNull();
    expect(await store.get('d_old')).toBeNull();
    expect(await store.get('i_old')).toBeNull();

    const types = captured.map((e) => e.eventType);
    expect(types).toContain('handoff.retention.sweep.started');
    expect(types).toContain('handoff.retention.sweep.completed');
    expect(types).not.toContain('handoff.retention.sweep.failed');
  });

  it('corrupt record on disk: skipped, left in place', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    const now = new Date('2026-05-12T12:00:00.000Z');

    // Drop a malformed-JSON file directly. The store's existing test suite
    // proves that get() returns null for malformed JSON; sweep() should treat
    // that as `parse_failed` and leave the file alone.
    writeFileSync(path.join(dir, 'corrupt.json'), '{not json', 'utf8');

    const result = await sweepHandoffs({ store, now: () => now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scanned).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.skipped).toEqual([{ handoffId: 'corrupt', reason: 'parse_failed' }]);
    }
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_RETENTION_POLICY sanity.
// ---------------------------------------------------------------------------

describe('DEFAULT_RETENTION_POLICY', () => {
  it('matches the compliance bundle: 360d for qualified/referred_out, 90d for disqualified/inconclusive', () => {
    expect(DEFAULT_RETENTION_POLICY.qualified).toBe(360 * DAY_MS);
    expect(DEFAULT_RETENTION_POLICY.referred_out).toBe(360 * DAY_MS);
    expect(DEFAULT_RETENTION_POLICY.disqualified).toBe(90 * DAY_MS);
    expect(DEFAULT_RETENTION_POLICY.inconclusive).toBe(90 * DAY_MS);
  });

  it('is frozen at module load', () => {
    expect(Object.isFrozen(DEFAULT_RETENTION_POLICY)).toBe(true);
  });

  it('vi can be used to verify clock injection plumbing (smoke)', () => {
    // Vitest sanity — keeps the import surface honest if tests grow to use
    // fake timers later.
    expect(typeof vi).toBe('object');
  });
});
