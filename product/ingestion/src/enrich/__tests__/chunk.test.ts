import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  chunkBlogHtml,
  chunkContentblockText,
  chunkFaqItem,
  aggregateReviewsByName,
  composePersonaInputProse,
  ANONYMOUS_BUCKET_KEY,
  TARGET_CHUNK_CHARS,
} from '../chunk.js';

describe('stripHtml', () => {
  it('drops <script> + <style> with contents', () => {
    const html = '<p>visible</p><script>alert(1)</script><style>.x{color:red}</style>';
    expect(stripHtml(html)).toBe('visible');
  });

  it('preserves text inside structural tags', () => {
    const html = '<h2>Heading</h2><p>Body</p>';
    const out = stripHtml(html);
    expect(out).toContain('Heading');
    expect(out).toContain('Body');
  });

  it('decodes common entities', () => {
    expect(stripHtml('hello&nbsp;world')).toContain('hello world');
    expect(stripHtml('a &amp; b')).toContain('a & b');
    expect(stripHtml("it&apos;s")).toContain("it's");
  });

  it('drops <iframe>', () => {
    expect(stripHtml('<p>x</p><iframe>spam</iframe>')).toContain('x');
    expect(stripHtml('<p>x</p><iframe>spam</iframe>')).not.toContain('spam');
  });
});

describe('chunkBlogHtml', () => {
  it('returns empty for empty input', () => {
    expect(chunkBlogHtml('')).toEqual([]);
    expect(chunkBlogHtml('   ')).toEqual([]);
  });

  it('treats no-header content as one chunk', () => {
    const out = chunkBlogHtml('<p>Just one paragraph.</p>');
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('Just one paragraph.');
  });

  it('splits on h2 boundaries', () => {
    const html =
      '<p>Intro paragraph.</p>' +
      '<h2>Section A</h2><p>Body A.</p>' +
      '<h2>Section B</h2><p>Body B.</p>';
    const out = chunkBlogHtml(html);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out[0]!.index).toBe(0);
  });

  it('sliding-window splits oversized sections', () => {
    const big = 'word '.repeat(Math.ceil(TARGET_CHUNK_CHARS / 5) + 200);
    const out = chunkBlogHtml(`<p>${big}</p>`);
    expect(out.length).toBeGreaterThan(1);
  });
});

describe('chunkContentblockText', () => {
  it('returns one chunk for small text', () => {
    const out = chunkContentblockText('A short block of text.');
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('A short block of text.');
  });

  it('returns empty for empty input', () => {
    expect(chunkContentblockText('')).toEqual([]);
  });

  it('sliding-window splits oversized text', () => {
    const big = 'foo '.repeat(Math.ceil(TARGET_CHUNK_CHARS / 4) + 100);
    const out = chunkContentblockText(big);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      // No chunk should massively exceed target.
      expect(c.text.length).toBeLessThanOrEqual(TARGET_CHUNK_CHARS + 20);
    }
  });
});

describe('chunkFaqItem', () => {
  it('combines question and answer', () => {
    const out = chunkFaqItem('When to visit?', 'Spring is best.');
    expect(out.text).toContain('When to visit?');
    expect(out.text).toContain('Spring is best.');
  });
});

describe('aggregateReviewsByName', () => {
  it('groups multiple rows under same name', () => {
    const buckets = aggregateReviewsByName([
      { id: 1, content: 'a', name: 'Margaret W', location: null, date: null, title: null, image_id: null },
      { id: 2, content: 'b', name: 'Margaret W', location: null, date: null, title: null, image_id: null },
      { id: 3, content: 'c', name: 'Pete H', location: null, date: null, title: null, image_id: null },
    ]);
    expect(buckets.size).toBe(2);
    expect(buckets.get('Margaret W')!.rows).toHaveLength(2);
    expect(buckets.get('Pete H')!.rows).toHaveLength(1);
  });

  it('puts null/empty names in anonymous bucket', () => {
    const buckets = aggregateReviewsByName([
      { id: 1, content: 'x', name: null, location: null, date: null, title: null, image_id: null },
      { id: 2, content: 'y', name: '', location: null, date: null, title: null, image_id: null },
      { id: 3, content: 'z', name: '   ', location: null, date: null, title: null, image_id: null },
    ]);
    expect(buckets.size).toBe(1);
    const anon = buckets.get(ANONYMOUS_BUCKET_KEY);
    expect(anon).toBeDefined();
    expect(anon!.rows).toHaveLength(3);
    expect(anon!.isAnonymous).toBe(true);
  });

  it('treats names case-sensitively (current behaviour; HITL Q1 may change)', () => {
    const buckets = aggregateReviewsByName([
      { id: 1, content: 'a', name: 'sarah', location: null, date: null, title: null, image_id: null },
      { id: 2, content: 'b', name: 'Sarah', location: null, date: null, title: null, image_id: null },
    ]);
    expect(buckets.size).toBe(2);
  });
});

describe('composePersonaInputProse', () => {
  it('joins prose with separators', () => {
    const out = composePersonaInputProse({
      name: 'X',
      isAnonymous: false,
      rows: [
        { id: 1, content: 'first', location: null, date: null, title: null, image_id: null },
        { id: 2, content: 'second', location: null, date: null, title: null, image_id: null },
      ],
    });
    expect(out).toContain('first');
    expect(out).toContain('second');
    expect(out).toContain('---');
  });

  it('strips HTML from each row', () => {
    const out = composePersonaInputProse({
      name: 'X',
      isAnonymous: false,
      rows: [
        { id: 1, content: '<p>spam <script>x</script>foo</p>', location: null, date: null, title: null, image_id: null },
      ],
    });
    expect(out).toContain('foo');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert');
  });

  it('skips empty rows', () => {
    const out = composePersonaInputProse({
      name: 'X',
      isAnonymous: false,
      rows: [
        { id: 1, content: '', location: null, date: null, title: null, image_id: null },
        { id: 2, content: 'real text', location: null, date: null, title: null, image_id: null },
      ],
    });
    expect(out).toBe('real text');
  });
});
