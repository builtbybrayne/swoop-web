/**
 * Unit tests for @swoop/common sales-memory schemas.
 *
 * Validates that:
 *   - SalesMemoryPublicSchema accepts and rejects the right shapes.
 *   - SalesMemoryVersionPublicSchema accepts and rejects the right shapes.
 *   - Tool I/O schemas (store / edit / retire / list / history) parse valid
 *     inputs and reject invalid ones.
 *   - MemoryEditInputSchema enforces expectedVersion is a positive integer.
 *   - Mutating schemas accept optional staffToken.
 *
 * SM.t1 (sales-memory store + CRUD, ts-common Zod schemas).
 */

import { describe, expect, it } from 'vitest';
import {
  SalesMemoryPublicSchema,
  SalesMemoryVersionPublicSchema,
  MemoryStoreInputSchema,
  MemoryEditInputSchema,
  MemoryRetireInputSchema,
  MemoryListActiveInputSchema,
  MemoryShowHistoryInputSchema,
  MemoryStoreOutputSchema,
  MemoryEditOutputSchema,
  MemoryRetireOutputSchema,
  MemoryListActiveOutputSchema,
  MemoryShowHistoryOutputSchema,
} from '../sales-memory.js';

const VALID_UUID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ISO_DATE = '2026-06-16T12:00:00.000Z';

// ---------------------------------------------------------------------------
// SalesMemoryPublicSchema
// ---------------------------------------------------------------------------

describe('SalesMemoryPublicSchema', () => {
  it('parses a valid public memory', () => {
    const result = SalesMemoryPublicSchema.parse({
      id: VALID_UUID,
      content: 'Peak season is Dec–Feb',
      updatedBy: 'Alice',
      updatedAt: ISO_DATE,
    });
    expect(result.id).toBe(VALID_UUID);
    expect(result.content).toBe('Peak season is Dec–Feb');
  });

  it('rejects missing content', () => {
    expect(() =>
      SalesMemoryPublicSchema.parse({
        id: VALID_UUID,
        updatedBy: 'Alice',
        updatedAt: ISO_DATE,
      }),
    ).toThrow();
  });

  it('rejects empty content string', () => {
    expect(() =>
      SalesMemoryPublicSchema.parse({
        id: VALID_UUID,
        content: '',
        updatedBy: 'Alice',
        updatedAt: ISO_DATE,
      }),
    ).toThrow();
  });

  it('rejects invalid uuid', () => {
    expect(() =>
      SalesMemoryPublicSchema.parse({
        id: 'not-a-uuid',
        content: 'x',
        updatedBy: 'Alice',
        updatedAt: ISO_DATE,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SalesMemoryVersionPublicSchema
// ---------------------------------------------------------------------------

describe('SalesMemoryVersionPublicSchema', () => {
  const valid = {
    id: VALID_UUID,
    memoryId: VALID_UUID,
    version: 1,
    content: 'Original',
    changeKind: 'create' as const,
    author: 'Alice',
    createdAt: ISO_DATE,
  };

  it('parses a valid version row', () => {
    const result = SalesMemoryVersionPublicSchema.parse(valid);
    expect(result.changeKind).toBe('create');
  });

  it('accepts all valid change_kind values', () => {
    for (const kind of ['create', 'edit', 'retire', 'restore'] as const) {
      expect(() =>
        SalesMemoryVersionPublicSchema.parse({ ...valid, changeKind: kind }),
      ).not.toThrow();
    }
  });

  it('rejects an unknown change_kind', () => {
    expect(() =>
      SalesMemoryVersionPublicSchema.parse({ ...valid, changeKind: 'delete' }),
    ).toThrow();
  });

  it('rejects version < 1', () => {
    expect(() =>
      SalesMemoryVersionPublicSchema.parse({ ...valid, version: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MemoryStoreInputSchema
// ---------------------------------------------------------------------------

describe('MemoryStoreInputSchema', () => {
  it('parses valid input with staffToken', () => {
    const result = MemoryStoreInputSchema.parse({
      content: 'New memory',
      author: 'Alice',
      staffToken: 'tok-abc123',
    });
    expect(result.staffToken).toBe('tok-abc123');
  });

  it('parses valid input without staffToken (optional field)', () => {
    const result = MemoryStoreInputSchema.parse({
      content: 'New memory',
      author: 'Alice',
    });
    expect(result.staffToken).toBeUndefined();
  });

  it('rejects empty content', () => {
    expect(() =>
      MemoryStoreInputSchema.parse({ content: '', author: 'Alice' }),
    ).toThrow();
  });

  it('rejects content exceeding 4000 chars', () => {
    expect(() =>
      MemoryStoreInputSchema.parse({
        content: 'x'.repeat(4001),
        author: 'Alice',
      }),
    ).toThrow();
  });

  it('rejects missing author', () => {
    expect(() =>
      MemoryStoreInputSchema.parse({ content: 'x' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MemoryEditInputSchema
// ---------------------------------------------------------------------------

describe('MemoryEditInputSchema', () => {
  const valid = {
    id: VALID_UUID,
    content: 'Updated content',
    expectedVersion: 1,
    author: 'Bob',
    staffToken: 'tok-xyz',
  };

  it('parses a valid edit input', () => {
    const result = MemoryEditInputSchema.parse(valid);
    expect(result.expectedVersion).toBe(1);
  });

  it('rejects expectedVersion = 0', () => {
    expect(() =>
      MemoryEditInputSchema.parse({ ...valid, expectedVersion: 0 }),
    ).toThrow();
  });

  it('rejects expectedVersion as non-integer', () => {
    expect(() =>
      MemoryEditInputSchema.parse({ ...valid, expectedVersion: 1.5 }),
    ).toThrow();
  });

  it('rejects invalid id uuid', () => {
    expect(() =>
      MemoryEditInputSchema.parse({ ...valid, id: 'bad-id' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MemoryRetireInputSchema
// ---------------------------------------------------------------------------

describe('MemoryRetireInputSchema', () => {
  it('parses valid retire input', () => {
    const result = MemoryRetireInputSchema.parse({
      id: VALID_UUID,
      author: 'Carol',
      staffToken: 'tok-retire',
    });
    expect(result.id).toBe(VALID_UUID);
  });

  it('staffToken is optional', () => {
    const result = MemoryRetireInputSchema.parse({
      id: VALID_UUID,
      author: 'Carol',
    });
    expect(result.staffToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MemoryListActiveInputSchema
// ---------------------------------------------------------------------------

describe('MemoryListActiveInputSchema', () => {
  it('parses empty object', () => {
    expect(() => MemoryListActiveInputSchema.parse({})).not.toThrow();
  });

  it('rejects extra fields (strict)', () => {
    expect(() =>
      MemoryListActiveInputSchema.parse({ foo: 'bar' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MemoryShowHistoryInputSchema
// ---------------------------------------------------------------------------

describe('MemoryShowHistoryInputSchema', () => {
  it('parses valid uuid', () => {
    const result = MemoryShowHistoryInputSchema.parse({ id: VALID_UUID });
    expect(result.id).toBe(VALID_UUID);
  });

  it('rejects non-uuid', () => {
    expect(() =>
      MemoryShowHistoryInputSchema.parse({ id: 'not-a-uuid' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Output schemas — round-trip smoke
// ---------------------------------------------------------------------------

describe('output schema round-trips', () => {
  const publicMemory = {
    id: VALID_UUID,
    content: 'Some content',
    updatedBy: 'Alice',
    updatedAt: ISO_DATE,
  };

  it('MemoryStoreOutputSchema accepts valid output', () => {
    expect(() =>
      MemoryStoreOutputSchema.parse({ memory: publicMemory }),
    ).not.toThrow();
  });

  it('MemoryEditOutputSchema accepts valid output', () => {
    expect(() =>
      MemoryEditOutputSchema.parse({ memory: publicMemory }),
    ).not.toThrow();
  });

  it('MemoryRetireOutputSchema accepts valid output', () => {
    expect(() =>
      MemoryRetireOutputSchema.parse({ id: VALID_UUID, status: 'retired' }),
    ).not.toThrow();
  });

  it('MemoryRetireOutputSchema rejects unknown status', () => {
    expect(() =>
      MemoryRetireOutputSchema.parse({ id: VALID_UUID, status: 'deleted' }),
    ).toThrow();
  });

  it('MemoryListActiveOutputSchema accepts empty memories list', () => {
    expect(() =>
      MemoryListActiveOutputSchema.parse({ memories: [], count: 0 }),
    ).not.toThrow();
  });

  it('MemoryShowHistoryOutputSchema accepts valid history', () => {
    expect(() =>
      MemoryShowHistoryOutputSchema.parse({
        memoryId: VALID_UUID,
        versions: [
          {
            id: VALID_UUID,
            memoryId: VALID_UUID,
            version: 1,
            content: 'x',
            changeKind: 'create',
            author: 'Alice',
            createdAt: ISO_DATE,
          },
        ],
        count: 1,
      }),
    ).not.toThrow();
  });
});
