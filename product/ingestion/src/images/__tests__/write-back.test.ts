/**
 * Unit tests for the write-back surface. The pg client is faked just
 * enough to record the parametrised SQL that fires.
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
  it('writes both columns when description + annotation present', async () => {
    const { client, calls } = fakePg({ rows: [{ desc_written: true, ann_written: true }] });
    const r = await writeAnnotation(client as never, {
      imageId: 42,
      description: ' Granite towers at golden hour. ',
      annotation: ' Three peaks. ',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/UPDATE image/);
    expect(calls[0]?.sql).toMatch(/COALESCE\(NULLIF\(TRIM\(description\), ''\), \$2\)/);
    expect(calls[0]?.sql).toMatch(/annotation = \$3/);
    // params trimmed.
    expect(calls[0]?.params[1]).toBe('Granite towers at golden hour.');
    expect(calls[0]?.params[2]).toBe('Three peaks.');
    expect(r.descriptionWritten).toBe(true);
    expect(r.annotationWritten).toBe(true);
  });

  it('writes only annotation when description is empty', async () => {
    const { client, calls } = fakePg({ rows: [{ ann_written: true }] });
    const r = await writeAnnotation(client as never, {
      imageId: 7,
      description: '',
      annotation: 'just the annotation',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/annotation = \$2/);
    expect(calls[0]?.sql).not.toMatch(/COALESCE/);
    expect(r.descriptionWritten).toBe(false);
    expect(r.annotationWritten).toBe(true);
  });

  it('writes only description when annotation is empty', async () => {
    const { client, calls } = fakePg({ rows: [{ desc_written: true }] });
    const r = await writeAnnotation(client as never, {
      imageId: 7,
      description: 'just the description',
      annotation: '',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/description = COALESCE/);
    expect(calls[0]?.sql).not.toMatch(/annotation = /);
    expect(r.descriptionWritten).toBe(true);
    expect(r.annotationWritten).toBe(false);
  });

  it('writes nothing when both fields are blank', async () => {
    const { client, calls } = fakePg({ rows: [] });
    const r = await writeAnnotation(client as never, {
      imageId: 7,
      description: '   ',
      annotation: '\n\t',
    });
    expect(calls).toHaveLength(0);
    expect(r.descriptionWritten).toBe(false);
    expect(r.annotationWritten).toBe(false);
  });

  it('does not propagate the description value as a literal — uses parameterised SQL', async () => {
    const { client, calls } = fakePg({ rows: [{ desc_written: true, ann_written: true }] });
    await writeAnnotation(client as never, {
      imageId: 1,
      description: "Robert'); DROP TABLE image;--",
      annotation: 'a',
    });
    // SQL has no inlined description; it's a $-param.
    expect(calls[0]?.sql).not.toMatch(/Robert/);
    expect(calls[0]?.params).toEqual([1, "Robert'); DROP TABLE image;--", 'a']);
  });
});
