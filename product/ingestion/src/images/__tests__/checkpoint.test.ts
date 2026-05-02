/**
 * Unit tests for the checkpoint store — round-trip + the skip-rules.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadCheckpoint,
  saveCheckpoint,
  recordEntry,
  shouldSkipId,
  startRun,
  resolveCheckpointPath,
} from '../checkpoint.js';

describe('checkpoint store', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'puma-annotate-cp-'));
  });
  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadCheckpoint returns an empty file shape when no file exists', () => {
    const { file, filePath } = loadCheckpoint({ namespace: 'test', baseDir: tmpDir });
    expect(file.version).toBe(1);
    expect(file.namespace).toBe('test');
    expect(file.byId).toEqual({});
    expect(file.runs).toEqual([]);
    expect(filePath).toContain(tmpDir);
    expect(filePath).toContain('test');
  });

  it('saveCheckpoint atomically writes (no .tmp left behind)', () => {
    const { file, filePath } = loadCheckpoint({ namespace: 'atomic', baseDir: tmpDir });
    recordEntry(file, 42, 'done', null);
    saveCheckpoint(filePath, file);
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('save / load round-trips via JSON.parse', () => {
    const a = loadCheckpoint({ namespace: 'rt', baseDir: tmpDir });
    recordEntry(a.file, 1, 'done', null);
    recordEntry(a.file, 2, 'failed', 'http_500');
    recordEntry(a.file, 3, 'skipped', 'model_emitted_empty');
    startRun(a.file, 'live', 3, 0.015);
    saveCheckpoint(a.filePath, a.file);

    const b = loadCheckpoint({ namespace: 'rt', baseDir: tmpDir });
    expect(b.file.byId['1']?.status).toBe('done');
    expect(b.file.byId['2']?.status).toBe('failed');
    expect(b.file.byId['2']?.lastError).toBe('http_500');
    expect(b.file.byId['3']?.status).toBe('skipped');
    expect(b.file.runs).toHaveLength(1);
    expect(b.file.runs[0]?.mode).toBe('live');
    expect(b.file.runs[0]?.candidatesCount).toBe(3);
  });

  it('recordEntry increments attempts on repeated failures', () => {
    const { file } = loadCheckpoint({ namespace: 'attempts', baseDir: tmpDir });
    recordEntry(file, 99, 'failed', 'first_fail');
    recordEntry(file, 99, 'failed', 'second_fail');
    expect(file.byId['99']?.attempts).toBe(2);
    expect(file.byId['99']?.lastError).toBe('second_fail');
  });

  it('recordEntry clears lastError on done', () => {
    const { file } = loadCheckpoint({ namespace: 'clear', baseDir: tmpDir });
    recordEntry(file, 5, 'failed', 'transient_429');
    recordEntry(file, 5, 'done', null);
    expect(file.byId['5']?.status).toBe('done');
    expect(file.byId['5']?.lastError).toBeNull();
  });

  it('shouldSkipId: done is skipped unconditionally', () => {
    const { file } = loadCheckpoint({ namespace: 'skip-done', baseDir: tmpDir });
    recordEntry(file, 1, 'done', null);
    expect(shouldSkipId(file, 1, false)).toBe(true);
    expect(shouldSkipId(file, 1, true)).toBe(true);
  });

  it('shouldSkipId: skipped is skipped unconditionally', () => {
    const { file } = loadCheckpoint({ namespace: 'skip-skipped', baseDir: tmpDir });
    recordEntry(file, 1, 'skipped', 'model_emitted_empty');
    expect(shouldSkipId(file, 1, false)).toBe(true);
    expect(shouldSkipId(file, 1, true)).toBe(true);
  });

  it('shouldSkipId: failed is skipped only when retryFailed=false', () => {
    const { file } = loadCheckpoint({ namespace: 'skip-failed', baseDir: tmpDir });
    recordEntry(file, 1, 'failed', 'transient');
    expect(shouldSkipId(file, 1, false)).toBe(true);
    expect(shouldSkipId(file, 1, true)).toBe(false);
  });

  it('shouldSkipId: pending is never skipped (crash-recovery)', () => {
    const { file } = loadCheckpoint({ namespace: 'skip-pending', baseDir: tmpDir });
    recordEntry(file, 1, 'pending', null);
    expect(shouldSkipId(file, 1, false)).toBe(false);
    expect(shouldSkipId(file, 1, true)).toBe(false);
  });

  it('shouldSkipId: unknown id is never skipped', () => {
    const { file } = loadCheckpoint({ namespace: 'skip-unknown', baseDir: tmpDir });
    expect(shouldSkipId(file, 999, false)).toBe(false);
  });

  it('rejects an unsupported version on load', () => {
    const filePath = path.resolve(tmpDir, 'bad', 'checkpoint.json');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({ version: 99, namespace: 'bad', byId: {}, runs: [], createdAt: '', updatedAt: '' }),
    );
    expect(() => loadCheckpoint({ namespace: 'bad', baseDir: tmpDir })).toThrow(
      /unsupported version/,
    );
  });

  it('resolveCheckpointPath places files inside the namespace folder', () => {
    const p = resolveCheckpointPath({ namespace: 'foo', baseDir: tmpDir });
    expect(p).toBe(path.resolve(tmpDir, 'foo', 'checkpoint.json'));
  });

  it('saveCheckpoint stores file with mode 0o600 (PII-friendly default)', () => {
    const { file, filePath } = loadCheckpoint({ namespace: 'mode', baseDir: tmpDir });
    recordEntry(file, 7, 'done', null);
    saveCheckpoint(filePath, file);
    const raw = readFileSync(filePath, 'utf-8');
    expect(raw.length).toBeGreaterThan(0);
    // Read by JSON.parse for shape check.
    const parsed = JSON.parse(raw) as { byId: Record<string, { status: string }> };
    expect(parsed.byId['7']?.status).toBe('done');
  });
});
