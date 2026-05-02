/**
 * Unit tests for the write-back surface. The pg client is faked just
 * enough to record the parametrised SQL that fires.
 *
 * Post-fold (2026-05-02): write-back is one SQL UPDATE that touches
 * description (COALESCE-gated), annotation (always-when-non-empty), and
 * the four tag arrays (always-write).
 */

import { describe, expect, it } from 'vitest';
import { writeAnnotation } from '../write-back.js';

interface QueryCall {
  sql: string;
  params: unknown[];
  result: { rows: unknown[] };
}

function fakePg(reply: { rows: unknown[] }): {
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  return {
    client: {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params, result: reply });
        return reply;
      },
    },
    calls,
  };
}

describe('writeAnnotation', () => {
  it('writes all six fields when description + annotation + tags are present', async () => {
    const { client, calls } = fakePg({
      rows: [{ desc_written: true, ann_written: true, tags_written: true }],
    });
    const r = await writeAnnotation(client as never, {
      imageId: 42,
      description: ' Granite towers at golden hour. ',
      annotation: ' Three peaks. ',
      subjectTags: ['granite', 'tower'],
      moodTags: ['golden-hour'],
      regionTags: ['torres-del-paine'],
      tags: ['clear'],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/UPDATE image/);
    // Single SQL covers all six fields.
    expect(calls[0]?.sql).toMatch(/COALESCE\(NULLIF\(TRIM\(description\), ''\), NULLIF\(\$2, ''\)\)/);
    expect(calls[0]?.sql).toMatch(/annotation\s*=\s*NULLIF\(\$3, ''\)/);
    expect(calls[0]?.sql).toMatch(/subject_tags\s*=\s*\$4::text\[\]/);
    expect(calls[0]?.sql).toMatch(/mood_tags\s*=\s*\$5::text\[\]/);
    expect(calls[0]?.sql).toMatch(/region_tags\s*=\s*\$6::text\[\]/);
    expect(calls[0]?.sql).toMatch(/tags\s*=\s*\$7::text\[\]/);
    // Prose params trimmed; arrays passed through.
    expect(calls[0]?.params[1]).toBe('Granite towers at golden hour.');
    expect(calls[0]?.params[2]).toBe('Three peaks.');
    expect(calls[0]?.params[3]).toEqual(['granite', 'tower']);
    expect(calls[0]?.params[4]).toEqual(['golden-hour']);
    expect(calls[0]?.params[5]).toEqual(['torres-del-paine']);
    expect(calls[0]?.params[6]).toEqual(['clear']);
    expect(r.descriptionWritten).toBe(true);
    expect(r.annotationWritten).toBe(true);
    expect(r.tagsWritten).toBe(true);
  });

  it('passes empty arrays when tags omitted', async () => {
    const { client, calls } = fakePg({
      rows: [{ desc_written: true, ann_written: true, tags_written: false }],
    });
    const r = await writeAnnotation(client as never, {
      imageId: 7,
      description: 'desc',
      annotation: 'ann',
      // No tag arrays passed — should default to [].
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params[3]).toEqual([]);
    expect(calls[0]?.params[4]).toEqual([]);
    expect(calls[0]?.params[5]).toEqual([]);
    expect(calls[0]?.params[6]).toEqual([]);
    expect(r.tagsWritten).toBe(false);
  });

  it('writes tags even when prose is empty (illustrate-only annotation pass)', async () => {
    const { client, calls } = fakePg({
      rows: [{ desc_written: false, ann_written: false, tags_written: true }],
    });
    const r = await writeAnnotation(client as never, {
      imageId: 7,
      description: '',
      annotation: '',
      subjectTags: ['penguin'],
    });
    expect(calls).toHaveLength(1);
    expect(r.descriptionWritten).toBe(false);
    expect(r.annotationWritten).toBe(false);
    expect(r.tagsWritten).toBe(true);
  });

  it('writes nothing when both prose fields AND all tag arrays are empty', async () => {
    const { client, calls } = fakePg({ rows: [] });
    const r = await writeAnnotation(client as never, {
      imageId: 7,
      description: '   ',
      annotation: '\n\t',
      subjectTags: [],
      moodTags: [],
      regionTags: [],
      tags: [],
    });
    expect(calls).toHaveLength(0);
    expect(r.descriptionWritten).toBe(false);
    expect(r.annotationWritten).toBe(false);
    expect(r.tagsWritten).toBe(false);
  });

  it('does not propagate the description value as a literal — uses parameterised SQL', async () => {
    const { client, calls } = fakePg({
      rows: [{ desc_written: true, ann_written: true, tags_written: false }],
    });
    await writeAnnotation(client as never, {
      imageId: 1,
      description: "Robert'); DROP TABLE image;--",
      annotation: 'a',
    });
    // SQL has no inlined description; it's a $-param.
    expect(calls[0]?.sql).not.toMatch(/Robert/);
    expect(calls[0]?.params[0]).toBe(1);
    expect(calls[0]?.params[1]).toBe("Robert'); DROP TABLE image;--");
    expect(calls[0]?.params[2]).toBe('a');
  });
});
