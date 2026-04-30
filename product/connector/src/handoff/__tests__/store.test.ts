/**
 * Unit tests for the file-backed handoff store.
 *
 * Each test runs in an isolated `mkdtempSync` directory so they don't
 * share state. The directory is removed in `afterEach`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
} from '@swoop/common/fixtures';
import type { HandoffPayload } from '@swoop/common';

import { FsHandoffStore, HANDOFF_ID_PATTERN } from '../store.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'puma-handoff-store-'));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// save() — happy path + idempotence.
// ---------------------------------------------------------------------------

describe('FsHandoffStore.save', () => {
  it('writes a JSON file at <dir>/<handoffId>.json and returns ok', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    const result = await store.save(SampleHandoffQualified);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handoffId).toBe(SampleHandoffQualified.handoffId);
      expect(result.absolutePath).toBe(
        path.join(dir, `${SampleHandoffQualified.handoffId}.json`),
      );
    }

    // Round-trip: file exists, parses, equals the original.
    const reread = await store.get(SampleHandoffQualified.handoffId);
    expect(reread).toEqual(SampleHandoffQualified);
  });

  it('overwrites on second save (last-write-wins idempotence)', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    await store.save(SampleHandoffQualified);
    const updated: HandoffPayload = {
      ...SampleHandoffQualified,
      motivationAnchor: 'updated motivation',
    };
    const result = await store.save(updated);
    expect(result.ok).toBe(true);
    const reread = await store.get(SampleHandoffQualified.handoffId);
    expect(reread?.motivationAnchor).toBe('updated motivation');
  });

  it('creates the directory if it does not exist yet', async () => {
    const dir = makeTempDir();
    const nested = path.join(dir, 'a', 'b', 'c');
    const store = new FsHandoffStore(nested);
    const result = await store.save(SampleHandoffQualified);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid handoffId before any filesystem operation', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    const bad: HandoffPayload = {
      ...SampleHandoffQualified,
      handoffId: '../escape',
    };
    const result = await store.save(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('handoff_id_invalid');
    }
  });

  it('saves a referred-out variant successfully', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    const result = await store.save(SampleHandoffReferredOut);
    expect(result.ok).toBe(true);
    const reread = await store.get(SampleHandoffReferredOut.handoffId);
    expect(reread).toEqual(SampleHandoffReferredOut);
  });

  it('saves a disqualified variant successfully (no contact field)', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    const result = await store.save(SampleHandoffDisqualified);
    expect(result.ok).toBe(true);
    const reread = await store.get(SampleHandoffDisqualified.handoffId);
    expect(reread).toEqual(SampleHandoffDisqualified);
  });

  // Sec-1 (2026-04-30 code review): visitor PII at rest must be 0o600 in a
  // 0o700 directory.
  it('writes the record file at 0o600 inside a 0o700 directory (PII discipline)', async () => {
    const dir = makeTempDir();
    const nested = path.join(dir, 'handoffs');
    const store = new FsHandoffStore(nested);
    const result = await store.save(SampleHandoffQualified);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fileStat = statSync(result.absolutePath);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const dirStat = statSync(nested);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });
});

// ---------------------------------------------------------------------------
// get() — failure modes.
// ---------------------------------------------------------------------------

describe('FsHandoffStore.get', () => {
  it('returns null when the file does not exist', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    expect(await store.get('does_not_exist')).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    writeFileSync(path.join(dir, 'bad_json.json'), '{not json', 'utf8');
    expect(await store.get('bad_json')).toBeNull();
  });

  it('returns null when the JSON does not validate against the schema', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    writeFileSync(
      path.join(dir, 'schema_invalid.json'),
      JSON.stringify({ verdict: 'qualified', missing: 'required-fields' }),
      'utf8',
    );
    expect(await store.get('schema_invalid')).toBeNull();
  });

  it('rejects an invalid handoffId without touching the filesystem', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    expect(await store.get('../escape')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list() — discovery + filtering.
// ---------------------------------------------------------------------------

describe('FsHandoffStore.list', () => {
  it('returns ids for every saved handoff, alphabetically', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    await store.save(SampleHandoffQualified);
    await store.save(SampleHandoffReferredOut);
    await store.save(SampleHandoffDisqualified);

    const ids = await store.list();
    expect(ids).toEqual(
      [
        SampleHandoffQualified.handoffId,
        SampleHandoffReferredOut.handoffId,
        SampleHandoffDisqualified.handoffId,
      ].sort(),
    );
  });

  it('ignores non-json files', async () => {
    const dir = makeTempDir();
    const store = new FsHandoffStore(dir);
    await store.save(SampleHandoffQualified);
    writeFileSync(path.join(dir, 'README.md'), 'docs', 'utf8');
    writeFileSync(path.join(dir, 'leftover.tmp'), 'partial', 'utf8');
    const ids = await store.list();
    expect(ids).toEqual([SampleHandoffQualified.handoffId]);
  });

  it('returns empty list when the directory does not exist', async () => {
    const store = new FsHandoffStore(path.join(tmpdir(), `puma-no-such-${Date.now()}`));
    expect(await store.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// HANDOFF_ID_PATTERN — sanity.
// ---------------------------------------------------------------------------

describe('HANDOFF_ID_PATTERN', () => {
  it('accepts the canonical fixture id shape', () => {
    expect(HANDOFF_ID_PATTERN.test('handoff_puma_demo_qualified_001')).toBe(true);
    expect(HANDOFF_ID_PATTERN.test('A-B-C-123')).toBe(true);
  });

  it('rejects path-traversal and reserved chars', () => {
    expect(HANDOFF_ID_PATTERN.test('../escape')).toBe(false);
    expect(HANDOFF_ID_PATTERN.test('a/b')).toBe(false);
    expect(HANDOFF_ID_PATTERN.test('a.b')).toBe(false);
    expect(HANDOFF_ID_PATTERN.test('')).toBe(false);
    expect(HANDOFF_ID_PATTERN.test('with space')).toBe(false);
  });
});
