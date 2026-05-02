import { describe, it, expect } from 'vitest';
import { contentHash, ntagSnapshotHash, EMBED_HASH_VERSION } from '../hash.js';

describe('contentHash', () => {
  it('is deterministic across runs', () => {
    const a = contentHash('hello world', 'page_intro');
    const b = contentHash('hello world', 'page_intro');
    expect(a).toBe(b);
  });

  it('differs across source types — segregation', () => {
    const a = contentHash('hello', 'inspire_passage');
    const b = contentHash('hello', 'customer_story');
    expect(a).not.toBe(b);
  });

  it('differs when version bumps — forces re-embed', () => {
    const v1 = contentHash('hello', 'tag', 1);
    const v2 = contentHash('hello', 'tag', 2);
    expect(v1).not.toBe(v2);
  });

  it('differs across input texts', () => {
    const a = contentHash('hello', 'tag');
    const b = contentHash('hello world', 'tag');
    expect(a).not.toBe(b);
  });

  it('uses default EMBED_HASH_VERSION when version omitted', () => {
    const explicit = contentHash('hello', 'tag', EMBED_HASH_VERSION);
    const implicit = contentHash('hello', 'tag');
    expect(explicit).toBe(implicit);
  });

  it('returns 64-char hex (sha256)', () => {
    const h = contentHash('x', 'y');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ntagSnapshotHash', () => {
  it('is deterministic when input is reordered', () => {
    const a = ntagSnapshotHash([
      { id: 1, alias: 'a', type: 'interest' },
      { id: 2, alias: 'b', type: 'area' },
    ]);
    const b = ntagSnapshotHash([
      { id: 2, alias: 'b', type: 'area' },
      { id: 1, alias: 'a', type: 'interest' },
    ]);
    expect(a).toBe(b);
  });

  it('changes when a row is added — invalidates blog-tag normalisation', () => {
    const before = ntagSnapshotHash([{ id: 1, alias: 'a', type: 'interest' }]);
    const after = ntagSnapshotHash([
      { id: 1, alias: 'a', type: 'interest' },
      { id: 2, alias: 'b', type: 'area' },
    ]);
    expect(before).not.toBe(after);
  });

  it('changes when an alias changes', () => {
    const a = ntagSnapshotHash([{ id: 1, alias: 'old', type: 'interest' }]);
    const b = ntagSnapshotHash([{ id: 1, alias: 'new', type: 'interest' }]);
    expect(a).not.toBe(b);
  });
});
