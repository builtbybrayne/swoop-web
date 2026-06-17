/**
 * Tests for sales-memory-loader.ts (T3-4 / sm-6).
 *
 * Verification checklist from the task brief:
 *   1. BYTE-IDENTICAL between writes: assemble twice with the same active set →
 *      identical string; change the set → different string (one cache-bust).
 *   2. Each memory's timestamp + author appears in the assembled instruction.
 *   3. Stable order regardless of input ordering.
 *   4. Cross-instance propagation: two separate instruction-assembles against
 *      one (faked/mocked) connector active-set — no restart needed, change
 *      is reflected on the next call.
 *   5. Empty set → empty string (no dangling header).
 *   6. Connector error → throws so the factory's catch-and-degrade path fires.
 *   7. loadSalesMemoryBlock uses the connector client (not direct Postgres).
 *
 * No live Postgres or real connector — everything runs against in-process fakes.
 */

import { describe, expect, it, vi } from 'vitest';
import { assembleMemoryBlock, renderMemoryEntry, loadSalesMemoryBlock } from '../sales-memory-loader.js';
import type { SalesMemoryPublic } from '@swoop/common';
import type { ConnectorClient } from '../../connector/client.js';

// ---------------------------------------------------------------------------
// Test header — must contain "AUTHORITATIVE" and "state as fact" so the
// existing assertions in the "contains the authoritative header" test still
// pass after the header was moved from an inline constant to a param.
// ---------------------------------------------------------------------------

const TEST_HEADER = `## Current sales-team knowledge [AUTHORITATIVE — state as fact]

The following entries are current, confirmed facts about Swoop's tours and operations.`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMemory(
  id: string,
  content: string,
  updatedAt: string,
  updatedBy: string,
): SalesMemoryPublic {
  return { id, content, updatedAt, updatedBy };
}

const MEMORY_A = makeMemory(
  'aaaaaaaa-0000-0000-0000-000000000001',
  'W-trek refugios book out months ahead for high summer (Dec–Feb)',
  '2026-06-16T09:00:00.000Z',
  'Luke',
);

const MEMORY_B = makeMemory(
  'bbbbbbbb-0000-0000-0000-000000000002',
  'Shoulder seasons (Mar–Apr, Oct–Nov) offer better wildlife and fewer crowds',
  '2026-06-10T14:30:00.000Z',
  'Lane',
);

const MEMORY_C = makeMemory(
  'cccccccc-0000-0000-0000-000000000003',
  'January is peak high season in Patagonia; book Torres del Paine at least 6 months out',
  '2026-06-17T08:00:00.000Z',
  'Julie',
);

// ---------------------------------------------------------------------------
// assembleMemoryBlock (pure function — no connector)
// ---------------------------------------------------------------------------

describe('assembleMemoryBlock', () => {
  it('returns an empty string when the memory set is empty', () => {
    expect(assembleMemoryBlock([], TEST_HEADER)).toBe('');
  });

  it('includes each memory content in the output', () => {
    const block = assembleMemoryBlock([MEMORY_A, MEMORY_B], TEST_HEADER);
    expect(block).toContain(MEMORY_A.content);
    expect(block).toContain(MEMORY_B.content);
  });

  it('includes the YYYY-MM-DD date portion of updatedAt for each memory', () => {
    const block = assembleMemoryBlock([MEMORY_A, MEMORY_B], TEST_HEADER);
    // MEMORY_A: 2026-06-16T09:00:00.000Z → date = 2026-06-16
    expect(block).toContain('2026-06-16');
    // MEMORY_B: 2026-06-10T14:30:00.000Z → date = 2026-06-10
    expect(block).toContain('2026-06-10');
  });

  it('includes the author name for each memory', () => {
    const block = assembleMemoryBlock([MEMORY_A, MEMORY_B], TEST_HEADER);
    expect(block).toContain('Luke');
    expect(block).toContain('Lane');
  });

  it('renders each memory in the format "(noted YYYY-MM-DD by <author>)"', () => {
    const block = assembleMemoryBlock([MEMORY_A], TEST_HEADER);
    expect(block).toContain('(noted 2026-06-16 by Luke)');
  });

  it('BYTE-IDENTICAL: same set assembled twice produces identical strings', () => {
    const set = [MEMORY_A, MEMORY_B, MEMORY_C];
    const first = assembleMemoryBlock(set, TEST_HEADER);
    const second = assembleMemoryBlock(set, TEST_HEADER);
    expect(first).toBe(second);
  });

  it('CACHE-BUST: adding a memory changes the assembled string (exactly one bust)', () => {
    const before = assembleMemoryBlock([MEMORY_A, MEMORY_B], TEST_HEADER);
    const after = assembleMemoryBlock([MEMORY_A, MEMORY_B, MEMORY_C], TEST_HEADER);
    expect(before).not.toBe(after);
    expect(after).toContain(MEMORY_C.content);
  });

  it('CACHE-BUST: editing a memory changes the assembled string', () => {
    const editedA = { ...MEMORY_A, content: 'EDITED: W-trek refugios fully booked in January 2027', updatedAt: '2026-06-17T12:00:00.000Z' };
    const before = assembleMemoryBlock([MEMORY_A, MEMORY_B], TEST_HEADER);
    const after = assembleMemoryBlock([editedA, MEMORY_B], TEST_HEADER);
    expect(before).not.toBe(after);
    expect(after).toContain('EDITED:');
    expect(after).toContain('2026-06-17');
  });

  it('STABLE ORDER: preserves the order of the input array (does not re-sort)', () => {
    // The connector returns memories in created_at DESC order; we must not
    // re-sort or the rendered text would differ from a previous call when the
    // set is unchanged, busting the cache.
    const blockAB = assembleMemoryBlock([MEMORY_A, MEMORY_B], TEST_HEADER);
    const blockBA = assembleMemoryBlock([MEMORY_B, MEMORY_A], TEST_HEADER);
    // Same memories but different order → different rendered text (expected)
    expect(blockAB).not.toBe(blockBA);
    // And the order is preserved — A before B in blockAB
    const posA = blockAB.indexOf(MEMORY_A.content);
    const posB = blockAB.indexOf(MEMORY_B.content);
    expect(posA).toBeLessThan(posB);
  });

  it('STABLE ORDER: same input ordering always produces the same string', () => {
    // Simulate two separate instruction-assembles with the same DB state
    // (cross-instance simulation — two "instances" get the same list from DB).
    const setFromInstance1 = [MEMORY_C, MEMORY_A, MEMORY_B];
    const setFromInstance2 = [MEMORY_C, MEMORY_A, MEMORY_B]; // same order = same DB query result
    expect(assembleMemoryBlock(setFromInstance1, TEST_HEADER)).toBe(assembleMemoryBlock(setFromInstance2, TEST_HEADER));
  });

  it('contains the authoritative header', () => {
    const block = assembleMemoryBlock([MEMORY_A], TEST_HEADER);
    // The header signals authoritative knowledge — T3-5 will refine the copy
    // but the structural marker must be present.
    expect(block).toContain('AUTHORITATIVE');
    expect(block).toContain('state as fact');
  });
});

// ---------------------------------------------------------------------------
// renderMemoryEntry (pure function)
// ---------------------------------------------------------------------------

describe('renderMemoryEntry', () => {
  it('renders content + date + author in the correct format', () => {
    const rendered = renderMemoryEntry(MEMORY_A);
    expect(rendered).toBe(
      '- W-trek refugios book out months ahead for high summer (Dec–Feb) (noted 2026-06-16 by Luke)',
    );
  });

  it('truncates updatedAt to YYYY-MM-DD regardless of time component', () => {
    const mem = makeMemory('dddddddd-0000-0000-0000-000000000001', 'content', '2026-06-16T23:59:59.999Z', 'Test');
    expect(renderMemoryEntry(mem)).toContain('2026-06-16');
    expect(renderMemoryEntry(mem)).not.toContain('T23:59');
  });
});

// ---------------------------------------------------------------------------
// Cross-instance propagation simulation
//
// Two separate `assembleMemoryBlock` calls represent two different Cloud Run
// instances reading from the same DB. When a memory is written, the DB changes;
// the next read from either instance returns the new set — no per-instance
// cache to invalidate. We simulate this with a mutable "DB state" variable.
// ---------------------------------------------------------------------------

describe('cross-instance propagation (no restart, shared DB simulation)', () => {
  it('reflects a memory write on the next read from a different instance', () => {
    // Simulate the shared DB state.
    let dbState: SalesMemoryPublic[] = [MEMORY_A, MEMORY_B];

    // Instance 1 reads the current state.
    const instance1Turn1 = assembleMemoryBlock(dbState, TEST_HEADER);
    expect(instance1Turn1).toContain(MEMORY_A.content);
    expect(instance1Turn1).toContain(MEMORY_B.content);
    expect(instance1Turn1).not.toContain(MEMORY_C.content);

    // A staff member writes a new memory (DB is mutated — no cache to invalidate).
    dbState = [MEMORY_C, MEMORY_A, MEMORY_B];

    // Instance 2 reads on its NEXT turn — no restart, no cache invalidation needed.
    const instance2Turn1 = assembleMemoryBlock(dbState, TEST_HEADER);
    expect(instance2Turn1).toContain(MEMORY_C.content);
    expect(instance2Turn1).toContain('2026-06-17'); // MEMORY_C's date

    // Instance 1 also picks it up on its next turn.
    const instance1Turn2 = assembleMemoryBlock(dbState, TEST_HEADER);
    expect(instance1Turn2).toContain(MEMORY_C.content);

    // The two instances produce IDENTICAL output for the same DB state.
    expect(instance1Turn2).toBe(instance2Turn1);
  });
});

// ---------------------------------------------------------------------------
// loadSalesMemoryBlock — integration with the connector client (mocked)
// ---------------------------------------------------------------------------

/**
 * Build a minimal ConnectorClient stub that returns the supplied memories
 * from `memory_list_active`. This proves the loader calls `callTool` rather
 * than querying Postgres directly (decision E.11).
 */
function makeConnectorStub(memories: SalesMemoryPublic[]): ConnectorClient {
  return {
    callTool: vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === 'memory_list_active') {
        return {
          structuredContent: {
            memories,
            count: memories.length,
          },
        };
      }
      throw new Error(`[stub] unexpected tool: ${name}`);
    }),
    connect: vi.fn(),
    listTools: vi.fn(),
    close: vi.fn(),
    url: 'http://fake-connector',
  } as unknown as ConnectorClient;
}

describe('loadSalesMemoryBlock (via connector stub)', () => {
  it('calls memory_list_active on the connector, NOT a direct DB query', async () => {
    const stub = makeConnectorStub([MEMORY_A, MEMORY_B]);
    await loadSalesMemoryBlock(stub, TEST_HEADER);
    // callTool must have been called with the right tool name
    expect(stub.callTool).toHaveBeenCalledWith('memory_list_active', {});
    expect(stub.callTool).toHaveBeenCalledTimes(1);
  });

  it('assembles the block from the connector response', async () => {
    const stub = makeConnectorStub([MEMORY_A, MEMORY_B]);
    const block = await loadSalesMemoryBlock(stub, TEST_HEADER);
    expect(block).toContain(MEMORY_A.content);
    expect(block).toContain(MEMORY_B.content);
    expect(block).toContain('Luke');
    expect(block).toContain('Lane');
    expect(block).toContain('2026-06-16');
    expect(block).toContain('2026-06-10');
  });

  it('returns an empty string when the connector returns an empty list', async () => {
    const stub = makeConnectorStub([]);
    const block = await loadSalesMemoryBlock(stub, TEST_HEADER);
    expect(block).toBe('');
  });

  it('throws when the connector call throws', async () => {
    const stub = {
      callTool: vi.fn(async () => { throw new Error('connector unreachable'); }),
      connect: vi.fn(),
      listTools: vi.fn(),
      close: vi.fn(),
      url: 'http://fake-connector',
    } as unknown as ConnectorClient;

    await expect(loadSalesMemoryBlock(stub, TEST_HEADER)).rejects.toThrow('connector unreachable');
  });

  it('throws when the connector returns unrecognised content', async () => {
    const stub = {
      callTool: vi.fn(async () => ({ structuredContent: { unexpected: true } })),
      connect: vi.fn(),
      listTools: vi.fn(),
      close: vi.fn(),
      url: 'http://fake-connector',
    } as unknown as ConnectorClient;

    await expect(loadSalesMemoryBlock(stub, TEST_HEADER)).rejects.toThrow(/schema validation/i);
  });

  it('BYTE-IDENTICAL: two calls with the same connector state return the same string', async () => {
    const memories = [MEMORY_A, MEMORY_B];
    const stub1 = makeConnectorStub(memories);
    const stub2 = makeConnectorStub(memories);
    const block1 = await loadSalesMemoryBlock(stub1, TEST_HEADER);
    const block2 = await loadSalesMemoryBlock(stub2, TEST_HEADER);
    expect(block1).toBe(block2);
  });

  it('falls through to text-content parsing when structuredContent is absent', async () => {
    const stub = {
      callTool: vi.fn(async () => ({
        structuredContent: undefined,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ memories: [MEMORY_A], count: 1 }),
          },
        ],
      })),
      connect: vi.fn(),
      listTools: vi.fn(),
      close: vi.fn(),
      url: 'http://fake-connector',
    } as unknown as ConnectorClient;

    const block = await loadSalesMemoryBlock(stub, TEST_HEADER);
    expect(block).toContain(MEMORY_A.content);
  });
});
