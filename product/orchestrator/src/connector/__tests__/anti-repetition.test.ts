/**
 * Unit tests for the anti-repetition helpers + invokeTool bracketing.
 *
 * Plan: planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
 *
 * Three scopes:
 *   1. `computeExcludes`: read seenItems → produce per-tool exclude payload.
 *   2. `extractSeenDelta`: read structured tool output → produce SeenItems delta.
 *   3. `invokeTool` bracketing: with a real (in-memory) SessionStore,
 *      verify (a) excludes get injected, (b) returned ids merge into seenItems,
 *      (c) trip/tour carve-out holds, (d) embedded image URLs are marked,
 *      (e) pool exhausted returns empty, (f) no-op when sessionStore absent.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defaultEmptySeenItems, mergeSeen } from '@swoop/common';
import type { SeenItems } from '@swoop/common';

import { computeExcludes, extractSeenDelta } from '../anti-repetition.js';
import type { CallToolRawResult, ConnectorClient } from '../client.js';
import { __testing } from '../tools.js';
import { InMemorySessionStore } from '../../session/in-memory.js';

const { invokeTool, TOOL_SPECS } = __testing;

function specFor(name: string) {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`test setup: unknown tool spec "${name}"`);
  return spec;
}

function stubClient(overrides: Partial<ConnectorClient> = {}): ConnectorClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockRejectedValue(new Error('callTool not stubbed')),
    close: vi.fn().mockResolvedValue(undefined),
    url: 'http://stub/mcp',
    ...overrides,
  };
}

/** Wrap a result payload in the SDK's CallToolRawResult envelope. */
function envelope(value: unknown): CallToolRawResult {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

// ---------------------------------------------------------------------------
// computeExcludes — read seenItems, produce per-tool exclude args
// ---------------------------------------------------------------------------

describe('computeExcludes', () => {
  function seedSeenItems(): SeenItems {
    return {
      ...defaultEmptySeenItems(),
      inspire_passage: ['p1', 'p2'],
      customer_story: ['s1'],
      trust_proof: ['tp1'],
      inform_chunk: ['ic1'],
      image: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      hotel: ['12', '13'],
      region_base: ['9'],
      customer_tip: ['101', '102'],
    };
  }

  it('find_inspiring receives passage uuids + image URLs', () => {
    const out = computeExcludes('find_inspiring', seedSeenItems());
    expect(out).toEqual({
      excludeIds: ['p1', 'p2'],
      excludeImageCanonicalUrls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
    });
  });

  it('find_someone_who receives story uuids + image URLs', () => {
    const out = computeExcludes('find_someone_who', seedSeenItems());
    expect(out).toEqual({
      excludeIds: ['s1'],
      excludeImageCanonicalUrls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
    });
  });

  it('find_proof receives proof uuids only (no images)', () => {
    const out = computeExcludes('find_proof', seedSeenItems());
    expect(out).toEqual({ excludeIds: ['tp1'] });
  });

  it('lookup receives chunk uuids only', () => {
    const out = computeExcludes('lookup', seedSeenItems());
    expect(out).toEqual({ excludeIds: ['ic1'] });
  });

  it('find_tips receives INTEGER tip ids (numified from the stringified seen-set)', () => {
    const out = computeExcludes('find_tips', seedSeenItems());
    expect(out).toEqual({ excludeIds: [101, 102] });
  });

  it('illustrate receives image canonical URLs (not ids)', () => {
    const out = computeExcludes('illustrate', seedSeenItems());
    expect(out).toEqual({
      excludeCanonicalUrls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
    });
  });

  it('find_options synthesises per-type {type,id} entries — hotel + region_base only (carve-out)', () => {
    const out = computeExcludes('find_options', seedSeenItems());
    expect(out).toEqual({
      exclude: [
        { type: 'hotel', id: '12' },
        { type: 'hotel', id: '13' },
        { type: 'region_base', id: '9' },
      ],
    });
  });

  it('find_options NEVER emits trip or tour entries (carve-out is structural)', () => {
    // Even if a future bug stuffed trip/tour into seenItems, computeExcludes
    // would not surface them because SeenItems has no such keys.
    const seen = seedSeenItems();
    const out = computeExcludes('find_options', seen);
    if (!out || !('exclude' in out)) {
      throw new Error('expected find_options excludes');
    }
    const types = out.exclude.map((e) => e.type);
    expect(types).not.toContain('trip');
    expect(types).not.toContain('tour');
  });

  it('handoff / handoff_submit get no auto-injection', () => {
    expect(computeExcludes('handoff', seedSeenItems())).toBeUndefined();
    expect(computeExcludes('handoff_submit', seedSeenItems())).toBeUndefined();
  });

  it('empty seenItems produces no auto-exclude fields', () => {
    const out = computeExcludes('find_inspiring', defaultEmptySeenItems());
    expect(out).toEqual({
      excludeIds: undefined,
      excludeImageCanonicalUrls: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// extractSeenDelta — read tool output, produce SeenItems delta
// ---------------------------------------------------------------------------

describe('extractSeenDelta', () => {
  it('find_inspiring returns passage ids + embedded image URLs', () => {
    const delta = extractSeenDelta('find_inspiring', {
      passages: [
        {
          id: 'p1',
          text: 'x',
          image: { canonicalUrl: 'https://cdn.example.com/a.jpg' },
        },
        { id: 'p2', text: 'y' },
        {
          id: 'p3',
          text: 'z',
          image: { canonicalUrl: 'https://cdn.example.com/b.jpg' },
        },
      ],
      count: 3,
    });
    expect(delta.inspire_passage).toEqual(['p1', 'p2', 'p3']);
    expect(delta.image).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
    ]);
  });

  it('find_someone_who marks story ids + embedded image URLs', () => {
    const delta = extractSeenDelta('find_someone_who', {
      stories: [{ id: 's1', image: { canonicalUrl: 'https://cdn.example.com/c.jpg' } }],
      count: 1,
    });
    expect(delta.customer_story).toEqual(['s1']);
    expect(delta.image).toEqual(['https://cdn.example.com/c.jpg']);
  });

  it('find_proof marks proof ids only (no images on TrustProof)', () => {
    const delta = extractSeenDelta('find_proof', {
      proofs: [{ id: 'tp1' }, { id: 'tp2' }],
      count: 2,
    });
    expect(delta.trust_proof).toEqual(['tp1', 'tp2']);
    expect(delta.image).toBeUndefined();
  });

  it('lookup marks chunk ids', () => {
    const delta = extractSeenDelta('lookup', {
      chunks: [{ id: 'ic1' }],
      count: 1,
    });
    expect(delta.inform_chunk).toEqual(['ic1']);
  });

  it('find_tips marks tip ids stringified (integer ids → string seen-set)', () => {
    const delta = extractSeenDelta('find_tips', {
      tips: [{ id: 101 }, { id: 102 }],
      count: 2,
    });
    expect(delta.customer_tip).toEqual(['101', '102']);
  });

  it('illustrate marks image canonical URLs (from `url` field)', () => {
    const delta = extractSeenDelta('illustrate', {
      images: [
        { id: '1', url: 'https://cdn.example.com/x.jpg', altText: '' },
        { id: '2', url: 'https://cdn.example.com/y.jpg', altText: '' },
      ],
    });
    expect(delta.image).toEqual([
      'https://cdn.example.com/x.jpg',
      'https://cdn.example.com/y.jpg',
    ]);
  });

  it('find_options carve-out: marks hotel + region_base ids but NOT trip / tour ids', () => {
    const delta = extractSeenDelta('find_options', {
      cards: [
        { type: 'trip', id: '1', headline: 'a' },
        { type: 'tour', id: '9', headline: 'b' },
        { type: 'hotel', id: '12', headline: 'c' },
        { type: 'region_base', id: '7', headline: 'd' },
      ],
      count: 4,
    });
    expect(delta.hotel).toEqual(['12']);
    expect(delta.region_base).toEqual(['7']);
    // The carve-out: trip + tour are absent from the delta.
    expect((delta as Record<string, unknown>).trip).toBeUndefined();
    expect((delta as Record<string, unknown>).tour).toBeUndefined();
  });

  it('find_options still marks embedded images on ANY card type (incl. trip / tour)', () => {
    // A trip card with a hero image: the IMAGE was on screen, so it should
    // be marked shown, even though the trip itself is in the carve-out.
    const delta = extractSeenDelta('find_options', {
      cards: [
        {
          type: 'trip',
          id: '1',
          headline: 'a',
          image: { canonicalUrl: 'https://cdn.example.com/trip-hero.jpg' },
        },
        {
          type: 'tour',
          id: '9',
          headline: 'b',
          image: { canonicalUrl: 'https://cdn.example.com/tour-hero.jpg' },
        },
      ],
      count: 2,
    });
    expect(delta.image).toEqual([
      'https://cdn.example.com/trip-hero.jpg',
      'https://cdn.example.com/tour-hero.jpg',
    ]);
  });

  it('empty result arrays produce an empty delta', () => {
    expect(extractSeenDelta('find_inspiring', { passages: [], count: 0 })).toEqual({});
    expect(extractSeenDelta('illustrate', { images: [] })).toEqual({});
    expect(extractSeenDelta('find_options', { cards: [], count: 0 })).toEqual({});
  });

  it('handoff / handoff_submit / unknown tool produces empty delta', () => {
    expect(extractSeenDelta('handoff', {})).toEqual({});
    expect(extractSeenDelta('handoff_submit', {})).toEqual({});
    expect(extractSeenDelta('mystery_tool', { foo: 'bar' })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// invokeTool bracketing — the load-bearing end-to-end behaviour
// ---------------------------------------------------------------------------

describe('invokeTool with anti-repetition bracketing', () => {
  let store: InMemorySessionStore;
  let sessionId: string;

  beforeEach(async () => {
    store = new InMemorySessionStore();
    const granted = {
      granted: true,
      timestamp: '2026-05-27T10:00:00.000Z',
    };
    const session = await store.create({
      consent: {
        conversation: granted,
        handoff: { granted: false, timestamp: granted.timestamp },
      },
    });
    sessionId = session.sessionId;
  });

  it('lookup: ids returned this call appear in seenItems.inform_chunk afterwards', async () => {
    const fakeChunks = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        text: 'chunk one',
        question: null,
        canonicalUrl: 'https://www.swoop-patagonia.com/q1',
        topicTags: [],
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        text: 'chunk two',
        question: null,
        canonicalUrl: 'https://www.swoop-patagonia.com/q2',
        topicTags: [],
      },
    ];
    const callTool = vi.fn().mockResolvedValue(envelope({
      chunks: fakeChunks,
      count: fakeChunks.length,
    }));
    const client = stubClient({ callTool });

    const result = await invokeTool(
      client,
      specFor('lookup'),
      { question: 'how long is the w trek?' },
      { sessionStore: store, sessionId },
    );

    expect(result.ok).toBe(true);
    const after = await store.get(sessionId);
    expect(after?.seenItems.inform_chunk).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('second call to the same tool injects excludeIds from session state', async () => {
    // Seed session state with one already-shown chunk id.
    await store.update(sessionId, (s) => ({
      ...s,
      seenItems: mergeSeen(s.seenItems, {
        inform_chunk: ['11111111-1111-4111-8111-111111111111'],
      }),
    }));

    const callTool = vi.fn().mockResolvedValue(envelope({ chunks: [], count: 0 }));
    const client = stubClient({ callTool });

    await invokeTool(
      client,
      specFor('lookup'),
      { question: 'how long is the w trek?' },
      { sessionStore: store, sessionId },
    );

    // The connector saw an injected excludeIds carrying the seeded id.
    expect(callTool).toHaveBeenCalledTimes(1);
    const [name, args] = callTool.mock.calls[0]!;
    expect(name).toBe('lookup');
    expect(args.excludeIds).toEqual(['11111111-1111-4111-8111-111111111111']);
  });

  it('trip / tour carve-out: cards returned do NOT enter seenItems', async () => {
    const cards = [
      {
        type: 'trip',
        id: '1',
        headline: 'A',
        canonicalUrl: 'https://www.swoop-patagonia.com/trips/1',
        activityTags: [],
      },
      {
        type: 'tour',
        id: '9',
        headline: 'B',
        canonicalUrl: 'https://www.swoop-patagonia.com/tours/9',
        activityTags: [],
      },
      {
        type: 'hotel',
        id: '12',
        headline: 'C',
        canonicalUrl: 'https://www.swoop-patagonia.com/hotels/12',
        pricingUnit: 'per_night',
      },
      {
        type: 'region_base',
        id: '7',
        headline: 'D',
        canonicalUrl: 'https://www.swoop-patagonia.com/regions/el-calafate',
        fromPrice: null,
        nearbyTripsCount: 5,
      },
    ];
    const callTool = vi.fn().mockResolvedValue(
      envelope({ cards, count: cards.length }),
    );
    const client = stubClient({ callTool });

    const result = await invokeTool(
      client,
      specFor('find_options'),
      { limit: 4 },
      { sessionStore: store, sessionId },
    );
    expect(result.ok).toBe(true);

    const after = await store.get(sessionId);
    // Hotel + region_base recorded.
    expect(after?.seenItems.hotel).toEqual(['12']);
    expect(after?.seenItems.region_base).toEqual(['7']);
    // Trip / tour absent — the SeenItems schema has no such keys, and
    // extractSeenDelta does not emit them. (Sanity: spot-check the typed
    // surface doesn't expose those keys at all.)
    expect((after?.seenItems as Record<string, unknown>).trip).toBeUndefined();
    expect((after?.seenItems as Record<string, unknown>).tour).toBeUndefined();
  });

  it('embedded image URL on an inspire_passage is marked shown', async () => {
    const passage = {
      id: '33333333-3333-4333-8333-333333333333',
      text: 'Granite towers at dawn.',
      canonicalUrl: 'https://www.swoop-patagonia.com/p',
      image: {
        id: 42,
        canonicalUrl: 'https://cdn.example.com/granite.jpg',
        altText: 'granite',
        subjectTags: [],
        moodTags: [],
        regionTags: [],
      },
    };
    const callTool = vi.fn().mockResolvedValue(
      envelope({ passages: [passage], count: 1 }),
    );
    const client = stubClient({ callTool });

    await invokeTool(
      client,
      specFor('find_inspiring'),
      { query: 'patagonia' },
      { sessionStore: store, sessionId },
    );

    const after = await store.get(sessionId);
    expect(after?.seenItems.inspire_passage).toContain(passage.id);
    expect(after?.seenItems.image).toContain('https://cdn.example.com/granite.jpg');
  });

  it('subsequent illustrate call sees the marked image URL in excludeCanonicalUrls', async () => {
    // Seed: image was already shown.
    await store.update(sessionId, (s) => ({
      ...s,
      seenItems: mergeSeen(s.seenItems, {
        image: ['https://cdn.example.com/granite.jpg'],
      }),
    }));

    const callTool = vi.fn().mockResolvedValue(envelope({ images: [] }));
    const client = stubClient({ callTool });

    await invokeTool(
      client,
      specFor('illustrate'),
      { keywords: ['mountains'] },
      { sessionStore: store, sessionId },
    );

    const [, args] = callTool.mock.calls[0]!;
    expect(args.excludeCanonicalUrls).toEqual([
      'https://cdn.example.com/granite.jpg',
    ]);
  });

  it('pool exhausted: handler returns empty array; session state stays the same', async () => {
    // Seed: every passage already shown.
    await store.update(sessionId, (s) => ({
      ...s,
      seenItems: mergeSeen(s.seenItems, { inspire_passage: ['p-existing'] }),
    }));
    const callTool = vi.fn().mockResolvedValue(
      envelope({ passages: [], count: 0 }),
    );
    const client = stubClient({ callTool });

    const result = await invokeTool(
      client,
      specFor('find_inspiring'),
      { query: 'patagonia' },
      { sessionStore: store, sessionId },
    );
    expect(result.ok).toBe(true);
    const after = await store.get(sessionId);
    // Unchanged — empty result means no new ids to add.
    expect(after?.seenItems.inspire_passage).toEqual(['p-existing']);
  });

  it('no sessionStore + no sessionId: behaves exactly as pre-AntiRepetition', async () => {
    // Without the deps, no read, no write, no merging.
    const callTool = vi.fn().mockResolvedValue(envelope({
      chunks: [],
      count: 0,
    }));
    const client = stubClient({ callTool });

    const result = await invokeTool(client, specFor('lookup'), {
      question: 'q',
    });
    expect(result.ok).toBe(true);
    // Confirm the connector received no auto-injected excludeIds.
    const [, args] = callTool.mock.calls[0]!;
    expect(args.excludeIds).toBeUndefined();
  });

  it('find_options unions orchestrator-supplied excludes with agent-supplied ones', async () => {
    // Seed: hotel 12 already shown.
    await store.update(sessionId, (s) => ({
      ...s,
      seenItems: mergeSeen(s.seenItems, { hotel: ['12'] }),
    }));
    const callTool = vi.fn().mockResolvedValue(envelope({
      cards: [],
      count: 0,
    }));
    const client = stubClient({ callTool });

    await invokeTool(
      client,
      specFor('find_options'),
      {
        limit: 4,
        // Agent supplies its own exclude for trip 1 — orchestrator's hotel 12
        // unions in additively. Agent excludes can ADD but never SUBTRACT.
        exclude: [{ type: 'trip', id: '1' }],
      },
      { sessionStore: store, sessionId },
    );

    const [, args] = callTool.mock.calls[0]!;
    // Both entries present in the unioned list.
    expect(args.exclude).toContainEqual({ type: 'trip', id: '1' });
    expect(args.exclude).toContainEqual({ type: 'hotel', id: '12' });
  });
});
