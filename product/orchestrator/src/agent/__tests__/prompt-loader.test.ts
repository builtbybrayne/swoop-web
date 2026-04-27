/**
 * Unit tests for the multi-file prompt loader (B.t1a).
 *
 * Coverage matches planning/03-exec-agent-runtime-t1a.md §"Test changes":
 *   1. Concatenation across two files in lexicographic order with the
 *      `\n\n---\n\n` separator.
 *   2. Filtering — files matching the pattern are loaded, files not matching
 *      (`README.md`, `_draft.md`, `notes.txt`, single-digit prefix, wrong
 *      extension) are ignored.
 *   3. Prod cache vs dev re-read behaviour.
 *   4. Missing directory → throws clear error at construction.
 *   5. Empty directory (no files match) → throws clear error at construction.
 *   6. Single matching file → returns its content with no leading/trailing
 *      separator.
 *
 * Each test runs in an isolated `os.tmpdir()` directory created via
 * `fs.mkdtempSync`, so tests are independent and don't pollute the repo.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPromptLoader, SYSTEM_PROMPT_FILE_PATTERN } from '../prompt-loader.js';

// Track temp dirs we create so we can clean up after each test.
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'puma-prompt-loader-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(dir: string, name: string, contents: string): void {
  writeFileSync(path.join(dir, name), contents, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Concatenation in lexicographic order with the separator.
// ---------------------------------------------------------------------------

describe('prompt-loader: concatenation', () => {
  it('joins multiple matching files in lexicographic order with `\\n\\n---\\n\\n`', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_first.md', 'FIRST');
    writeFile(dir, '10_second.md', 'SECOND');
    writeFile(dir, '20_third.md', 'THIRD');

    const loader = createPromptLoader(dir, false);
    expect(loader.load()).toBe('FIRST\n\n---\n\nSECOND\n\n---\n\nTHIRD');
  });

  it('strips trailing whitespace from each fragment before joining', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_a.md', 'ALPHA\n\n\n');
    writeFile(dir, '10_b.md', 'BETA   \n');

    const loader = createPromptLoader(dir, false);
    // Each fragment trimmed; separator inserted; the joined result has no
    // surplus whitespace at the seam.
    expect(loader.load()).toBe('ALPHA\n\n---\n\nBETA');
  });

  it('preserves leading whitespace inside fragments (for markdown structure)', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_only.md', '  indented line\nnext line');

    const loader = createPromptLoader(dir, false);
    expect(loader.load()).toBe('  indented line\nnext line');
  });
});

// ---------------------------------------------------------------------------
// 2. Filtering — pattern matching is strict.
// ---------------------------------------------------------------------------

describe('prompt-loader: filtering', () => {
  it('ignores files that do not match the load pattern', () => {
    const dir = makeTempDir();
    // Matching:
    writeFile(dir, '00_real.md', 'REAL');
    // Not matching for various reasons:
    writeFile(dir, 'README.md', 'IGNORED-no-prefix');
    writeFile(dir, '_draft.md', 'IGNORED-underscore-prefix');
    writeFile(dir, 'notes.txt', 'IGNORED-wrong-extension');
    writeFile(dir, '0_short.md', 'IGNORED-single-digit-prefix');
    writeFile(dir, '00_BAD.md', 'IGNORED-uppercase-slug');
    writeFile(dir, '00_under_score.md', 'IGNORED-underscore-in-slug');
    writeFile(dir, '00_real.markdown', 'IGNORED-wrong-extension-2');
    writeFile(dir, '99_trailing-dot.md.bak', 'IGNORED-extra-extension');

    const loader = createPromptLoader(dir, false);
    expect(loader.load()).toBe('REAL');
  });

  it('exposes the pattern as a public regex for spec parity', () => {
    expect(SYSTEM_PROMPT_FILE_PATTERN.test('00_why.md')).toBe(true);
    expect(SYSTEM_PROMPT_FILE_PATTERN.test('99_style-avoid.md')).toBe(true);
    expect(SYSTEM_PROMPT_FILE_PATTERN.test('00_a-b-c.md')).toBe(true);
    expect(SYSTEM_PROMPT_FILE_PATTERN.test('0_too-short.md')).toBe(false);
    expect(SYSTEM_PROMPT_FILE_PATTERN.test('00_BAD.md')).toBe(false);
    expect(SYSTEM_PROMPT_FILE_PATTERN.test('README.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Prod cache vs dev re-read.
// ---------------------------------------------------------------------------

describe('prompt-loader: caching behaviour', () => {
  it('in dev mode, re-reads the directory on every load() call', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_only.md', 'ORIGINAL');

    const loader = createPromptLoader(dir, false);
    expect(loader.load()).toBe('ORIGINAL');

    // Edit the file on disk.
    writeFile(dir, '00_only.md', 'EDITED');
    expect(loader.load()).toBe('EDITED');

    // Add a new fragment — also picked up.
    writeFile(dir, '10_appended.md', 'APPENDED');
    expect(loader.load()).toBe('EDITED\n\n---\n\nAPPENDED');
  });

  it('in production mode, caches the join from construction time', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_only.md', 'ORIGINAL');

    const loader = createPromptLoader(dir, true);
    expect(loader.load()).toBe('ORIGINAL');

    // On-disk edits AFTER construction must not be reflected.
    writeFile(dir, '00_only.md', 'EDITED');
    expect(loader.load()).toBe('ORIGINAL');
  });
});

// ---------------------------------------------------------------------------
// 4. Missing directory → throws at construction.
// ---------------------------------------------------------------------------

describe('prompt-loader: missing directory', () => {
  it('throws a readable error when the directory does not exist', () => {
    const missing = path.join(tmpdir(), `puma-does-not-exist-${Date.now()}`);
    expect(() => createPromptLoader(missing, false)).toThrow(
      /Failed to read system-prompt directory/,
    );
    expect(() => createPromptLoader(missing, false)).toThrow(missing);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty / no-matching-files directory → throws at construction.
// ---------------------------------------------------------------------------

describe('prompt-loader: empty directory', () => {
  it('throws when the directory exists but contains no matching files', () => {
    const dir = makeTempDir();
    // Files that should be ignored:
    writeFile(dir, 'README.md', 'docs only');
    writeFile(dir, '_draft.md', 'work in progress');

    expect(() => createPromptLoader(dir, false)).toThrow(
      /No system-prompt fragments found/,
    );
  });

  it('throws when the directory has nothing at all', () => {
    const dir = makeTempDir();
    expect(() => createPromptLoader(dir, false)).toThrow(
      /No system-prompt fragments found/,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Single-file directory → no separator.
// ---------------------------------------------------------------------------

describe('prompt-loader: single-file directory', () => {
  it('returns just the file content with no separator', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_solo.md', 'SOLO_CONTENT');

    const loader = createPromptLoader(dir, false);
    expect(loader.load()).toBe('SOLO_CONTENT');
  });
});

// ---------------------------------------------------------------------------
// 7. Sub-directories under the system dir are ignored.
// ---------------------------------------------------------------------------

describe('prompt-loader: sub-directories', () => {
  it('ignores sub-directories whose name matches the file pattern', () => {
    const dir = makeTempDir();
    writeFile(dir, '00_real.md', 'REAL');
    // A sub-directory whose name happens to match the file pattern. The
    // loader's `entry.isFile()` filter must skip it cleanly — no throw,
    // no inclusion in the joined output.
    mkdirSync(path.join(dir, '20_subdir.md'));

    const loader = createPromptLoader(dir, false);
    expect(loader.load()).toBe('REAL');
  });
});
