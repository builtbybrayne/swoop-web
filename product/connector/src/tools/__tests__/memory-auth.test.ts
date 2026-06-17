/**
 * T3-3 — staff-token enforcement on the sales-memory tool handlers (sm-4).
 *
 * The mutating tools (store/edit/retire) MUST reject a call without a valid
 * staff token BEFORE any DB work. These tests verify:
 *   - The built-in presence backstop (no injected assertStaffToken) rejects a
 *     tokenless / blank-token mutation and never calls withClient.
 *   - An injected `assertStaffToken` is consulted and can reject (throw), and
 *     when it passes the mutation proceeds.
 *   - A present token passes the presence backstop and the mutation proceeds.
 *   - The read-only tools (list_active / show_history) require no token.
 *
 * No live Postgres: withClient is a spy. We only assert the gate, not the SQL
 * (the data layer is covered by data/__tests__/sales-memory.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';

import { memoryStoreBody } from '../memory_store.js';
import { memoryEditBody } from '../memory_edit.js';
import { memoryRetireBody } from '../memory_retire.js';
import { memoryListActiveBody } from '../memory_list_active.js';
import { assertStaffTokenPresent, type ToolHandlerDeps } from '../deps.js';

/**
 * Build a ToolHandlerDeps whose withClient returns whatever the data layer
 * would — here a minimal valid memory row — and records whether it was called.
 */
function makeDeps(
  overrides?: Partial<ToolHandlerDeps>,
): { deps: ToolHandlerDeps; withClientCalled: () => boolean } {
  let called = false;
  const deps: ToolHandlerDeps = {
    withClient: (async (fn: (client: unknown) => Promise<unknown>) => {
      called = true;
      // The mutating data fns return a memory row; the read fns return arrays.
      // We hand the inner fn a stub client it never actually queries because
      // we override the data call via the fn body in the handler — but the
      // handler DOES call the real data fn, so instead we throw a recognizable
      // marker to prove we got PAST the auth gate without standing up a DB.
      return fn({
        query: async () => {
          throw new Error('DB_REACHED');
        },
      });
    }) as ToolHandlerDeps['withClient'],
    embedQuery: async () => {
      throw new Error('embedQuery should not be called by memory tools');
    },
    ...overrides,
  };
  return { deps, withClientCalled: () => called };
}

describe('memory tool staff-token enforcement (sm-4)', () => {
  describe('presence backstop (no injected assertStaffToken)', () => {
    it('memory_store rejects a missing token before any DB work', async () => {
      const { deps, withClientCalled } = makeDeps();
      await expect(
        memoryStoreBody({ content: 'x', author: 'Alice' } as never, deps),
      ).rejects.toThrow(/staffToken is required/i);
      expect(withClientCalled()).toBe(false);
    });

    it('memory_store rejects a blank token', async () => {
      const { deps, withClientCalled } = makeDeps();
      await expect(
        memoryStoreBody({ content: 'x', author: 'Alice', staffToken: '   ' } as never, deps),
      ).rejects.toThrow(/staffToken is required/i);
      expect(withClientCalled()).toBe(false);
    });

    it('memory_edit rejects a missing token before any DB work', async () => {
      const { deps, withClientCalled } = makeDeps();
      await expect(
        memoryEditBody(
          { id: 'm1', content: 'x', expectedVersion: 1, author: 'Alice' } as never,
          deps,
        ),
      ).rejects.toThrow(/staffToken is required/i);
      expect(withClientCalled()).toBe(false);
    });

    it('memory_retire rejects a missing token before any DB work', async () => {
      const { deps, withClientCalled } = makeDeps();
      await expect(
        memoryRetireBody({ id: 'm1', author: 'Alice' } as never, deps),
      ).rejects.toThrow(/staffToken is required/i);
      expect(withClientCalled()).toBe(false);
    });

    it('memory_store with a present token passes the gate and proceeds to the DB layer', async () => {
      const { deps, withClientCalled } = makeDeps();
      // Past the gate, the handler invokes the data layer, which our stub
      // client makes throw DB_REACHED — proving the gate was cleared.
      await expect(
        memoryStoreBody(
          { content: 'x', author: 'Alice', staffToken: 'valid.jwt.token' } as never,
          deps,
        ),
      ).rejects.toThrow(/DB_REACHED/);
      expect(withClientCalled()).toBe(true);
    });
  });

  describe('injected assertStaffToken verifier', () => {
    it('is consulted and can reject the mutation', async () => {
      const assertStaffToken = vi.fn((_token: string | undefined) => {
        throw new Error('TOKEN_INVALID');
      });
      const { deps, withClientCalled } = makeDeps({ assertStaffToken });

      await expect(
        memoryStoreBody(
          { content: 'x', author: 'Alice', staffToken: 'tampered' } as never,
          deps,
        ),
      ).rejects.toThrow(/TOKEN_INVALID/);
      expect(assertStaffToken).toHaveBeenCalledWith('tampered');
      expect(withClientCalled()).toBe(false);
    });

    it('when it passes, the mutation proceeds to the DB layer', async () => {
      const assertStaffToken = vi.fn(async (_token: string | undefined) => {
        /* ok — no throw */
      });
      const { deps, withClientCalled } = makeDeps({ assertStaffToken });

      await expect(
        memoryStoreBody(
          { content: 'x', author: 'Alice', staffToken: 'good' } as never,
          deps,
        ),
      ).rejects.toThrow(/DB_REACHED/);
      expect(assertStaffToken).toHaveBeenCalledWith('good');
      expect(withClientCalled()).toBe(true);
    });
  });

  describe('read-only tools require no token', () => {
    it('memory_list_active runs without a staff token', async () => {
      // Return an empty result set from the data layer so the handler completes.
      const deps: ToolHandlerDeps = {
        withClient: (async (fn: (client: unknown) => Promise<unknown>) =>
          fn({
            query: async () => ({ rows: [], rowCount: 0 }),
          })) as ToolHandlerDeps['withClient'],
        embedQuery: async () => {
          throw new Error('unused');
        },
      };
      const out = await memoryListActiveBody({} as never, deps);
      expect(out.count).toBe(0);
      expect(out.memories).toEqual([]);
    });
  });

  describe('assertStaffTokenPresent helper', () => {
    it('throws on undefined / blank, passes on a non-empty token', () => {
      expect(() => assertStaffTokenPresent(undefined, 'memory_store')).toThrow();
      expect(() => assertStaffTokenPresent('', 'memory_store')).toThrow();
      expect(() => assertStaffTokenPresent('  ', 'memory_store')).toThrow();
      expect(() => assertStaffTokenPresent('tok', 'memory_store')).not.toThrow();
    });
  });
});
