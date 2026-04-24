# 03 — Execution: B.t10 — Warm session pool

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Implements**: planning/02-impl-agent-runtime.md §2.6a (warm session pool) + decision B.10.
**Depends on**: B.t2 (`SessionStore` interface + in-memory adapter), B.t5 (`POST /session` bootstrap), F-a (event schemas + `emitEvent`).
**Honest framing**: in-memory `POST /session` is sub-10ms; this task is latent architectural prep for a network-backed session backend, not an immediate perf win. Ship disabled (`WARM_POOL_SIZE=0`) and flip post-M4 when a real backend exists.

---

## Scope

Introduce a small pre-warmed pool of session allocations that sit in front of `POST /session`. When a request arrives, pop one from the pool (hit) or fall through to a normal `sessionStore.create()` (miss). Background refill keeps the pool at its target size. TTL recycles entries so model / skill / prompt-file churn doesn't rot them.

The pool is an allocator layered **on top of** `SessionStore`. It does not replace the store — every warm entry is a real session record the store owns. The pool only holds the `sessionId` plus metadata for lifecycle tracking.

**Out of scope for B.t10**:
- ADK-session coordination sugar. The existing `onSessionCreated` hook already pre-creates the ADK session at store-create time; warm sessions go through that same path.
- Content-change hot-flush wired to `cms/` file watchers (noted in §2.6a as a dev convenience; deferring until the dev ergonomics actually hurt).
- Observability dashboards (chunk F territory).

---

## Deliverables

### Primary (new files)

1. `product/orchestrator/src/session/warm-pool.ts` — pool implementation.
2. `product/orchestrator/src/session/warm-pool-bootstrap.ts` — eager pre-warm at startup.
3. `product/orchestrator/src/session/__tests__/warm-pool.test.ts` — 10 unit tests.

### Modified files

4. `product/orchestrator/src/config/schema.ts` — `.refine()` on TTL against idle-TTL.
5. `product/orchestrator/src/server/session-bootstrap.ts` — optional allocator parameter; pool-first claim.
6. `product/orchestrator/src/index.ts` — wire allocator + pre-warm at startup; shutdown hook stops the refill timer.

---

## Architecture

### `WarmSessionPool` (warm-pool.ts)

Stateful pool object owning:
- A `Queue<WarmEntry>` of ready sessionIds (FIFO; oldest first out so entries don't sit past their TTL).
- A `Set<sessionId>` mirror for O(1) membership tests.
- A `setInterval` that fires the refill loop at a cadence derived from TTL (default every `min(30s, TTL/4)`).

**Interface**:
```ts
interface SessionAllocator {
  // Pool-first claim. Returns a fresh SessionState either from the pool
  // (hit) or via sessionStore.create() (miss). Emits warm_pool.hit or
  // warm_pool.miss with observability-relevant fields.
  claim(initial?: Partial<SessionState>): Promise<SessionState>;
}

class WarmSessionPool implements SessionAllocator {
  constructor(opts: WarmSessionPoolOptions);
  start(): Promise<void>;     // initial pre-warm to targetSize
  stop(): Promise<void>;      // clear timer, drop remaining entries
  size(): number;             // visible for tests + /healthz later
  hasEntry(sessionId: string): boolean;  // visible for tests
}
```

**Refill loop** (invoked on timer and after every `claim` hit):
1. Walk the queue. Any entry older than TTL: remove from queue + call `sessionStore.delete(id)` to drop the stranded warm session. No event emit for recycle (not in schema, not noise-worth).
2. Count living entries. While `count < targetSize`, kick off `buildWarmEntry()` and append. Refills are serialised via a `refilling` flag to prevent timer-and-claim overlap thrashing.

**`buildWarmEntry()`** steps:
1. `sessionStore.create({})` — creates the Puma session record.
2. Call `onSessionCreated?.(sessionId)` — mirrors the behaviour in `session-bootstrap.ts`, seeding the ADK session via the same hook `src/index.ts` already wires.
3. Push `{ sessionId, createdAtMs }` onto the queue.

On failure of steps 1 or 2, unwind (delete the record if it was created) and log a warning via `emitEvent` with `eventType: "error.raised"`. Never throw — refill failures must not crash the timer.

**TTL** is the single knob controlling staleness. `WARM_POOL_TTL_MINUTES` default 30 (already declared in `config/schema.ts`). On each refill tick, entries older than TTL are dropped + replaced.

### `SessionAllocator` type

Exported alongside `WarmSessionPool`. A trivial implementation wrapping `sessionStore.create` is defined as `DirectAllocator` in the same file — used when `WARM_POOL_SIZE=0` so the bootstrap handler always has a non-null allocator. This means `session-bootstrap.ts` doesn't branch on "pool vs no pool"; it just calls `allocator.claim()`.

### `startWarmPool()` (warm-pool-bootstrap.ts)

Thin composition function called from `src/index.ts`:

```ts
function startWarmPool(config, sessionStore, onSessionCreated): SessionAllocator
```

- Returns `new DirectAllocator(sessionStore)` when `config.WARM_POOL_SIZE === 0`.
- Otherwise builds the `WarmSessionPool`, awaits `pool.start()` for initial pre-warm, returns it.
- Exposes a `stopAll()` cleanup for the shutdown handler.

Why split from `warm-pool.ts`: pool logic should be testable without the config-shape dependency. The bootstrap function is the composition seam.

### Event emits (consumer of F-a)

Both `warm_pool.hit` and `warm_pool.miss` emit on every `claim()`. Schema already landed in `ts-common/events.ts`:

- `hit.payload`: `{ poolSizeAtClaim, waitTimeMs }`
- `miss.payload`: `{ poolSizeAtClaim }`

`waitTimeMs` on a hit is always 0 in Puma (synchronous pop; no queue-for-warm behaviour). Kept in the schema so a future "wait for warm entry" strategy can populate it without a schema change. Document the 0-always behaviour in the implementation comment.

Session-id on the envelope is the claimed session's id. Actor is `"system"`. Turn-index is `null` (pre-turn event).

### Config refine

Add a `.refine()` on the full schema: `WARM_POOL_TTL_MINUTES * 60 < SESSION_TTL_IDLE_HOURS * 3600`. A warm entry outliving the idle sweep would be a footgun (pool would hand out a session the sweeper has archived between ticks).

### `session-bootstrap.ts` changes

Replace the inline `sessionStore.create(...)` + `onSessionCreated` calls with a single `allocator.claim(initial)` call. The allocator internally handles both paths. `onSessionCreated` is no longer a handler dep — it moves to the allocator construction in `src/index.ts`.

**Back-compat**: the `onSessionCreated` dep stays on `SessionBootstrapDeps` for direct-allocator callers (tests pass their own stub), but the index.ts path now routes it through the allocator.

Actually — cleaner approach: keep the dep exactly as it is, but `session-bootstrap.ts` takes `allocator?: SessionAllocator`. If allocator is present, it is called; if not, fall through to the legacy path (store + onSessionCreated) that's already there. This keeps every existing test pass path working without rewrite. The allocator is purely additive to the signature.

### `src/index.ts` changes

1. Build the allocator after the session store and runner are constructed (the allocator needs both to function).
2. Pass the allocator into `buildServer`.
3. On shutdown: call `allocator.stop?.()` before `server.close()`.

---

## Unit tests (10, per plan)

File: `product/orchestrator/src/session/__tests__/warm-pool.test.ts`.

1. **`DirectAllocator.claim` delegates to `sessionStore.create`** and emits `warm_pool.miss` with `poolSizeAtClaim: 0`.
2. **`WarmSessionPool.start()` pre-warms to `targetSize`** — `size()` returns `targetSize` after awaited start.
3. **`claim()` returns a pre-warmed entry** — `size()` drops by one; no new `create` call; emits `warm_pool.hit` with `waitTimeMs: 0`.
4. **`claim()` when pool empty falls through** — invokes `sessionStore.create`; emits `warm_pool.miss`.
5. **Refill after claim** — `claim()` triggers a background refill; after `await flushAsync()`, `size()` returns target again.
6. **TTL recycle** — advance the mocked clock past TTL; sweep runs; stale entry is deleted (verified against the store) and replaced.
7. **`onSessionCreated` hook fires per warm entry** — spy called with each warmed `sessionId`.
8. **Rollback on `onSessionCreated` failure** — if the hook throws, the warm entry is not added to the pool AND the underlying session record is deleted from the store. Pool tolerates the failure (no crash).
9. **`stop()` clears the refill timer and drops entries** — `size()` returns 0; subsequent `claim()` works as a miss.
10. **Event envelope shape** — emitted events pass `EventSchema` validation (spy sink collects; parse-check every entry).

Tests use `setEventSink` from `@swoop/common` to capture emitted events; `resetEventSink` in `afterEach` for hygiene.

Clock injection via `now?: () => number` option on `WarmSessionPool` (mirrors `InMemorySessionStore`). Refill interval is injected for tests (so tests can drive refills deterministically without waiting real milliseconds).

---

## Verification

1. `npm run typecheck` from `product/` — passes workspace-wide.
2. `npm test -w @swoop/orchestrator` — passes, 111 tests (101 existing + 10 new).
3. `npm test -w @swoop/common` — passes unchanged (43).
4. **Default is disabled**: with `WARM_POOL_SIZE=0` (default), `POST /session` behaves exactly as before — integration tests in `server.test.ts` continue to pass without modification. The `DirectAllocator` fallthrough emits `warm_pool.miss` but does not change the response shape.
5. **Cold-path fallthrough**: bring `WARM_POOL_SIZE=2` up, claim both entries (hit + hit), then claim a third (miss with fallthrough to `store.create`). Pool refills to 2 after claims complete.
6. **Session cleanliness**: after pool `stop()`, the session store contains zero warm-pool-originated sessions — every entry the pool held is deleted. Verified by tracking pool-created ids and asserting `store.get(id) === null` post-stop. This is the key invariant: a pre-warmed session is no-state (no consent, no user messages) and must not hang around after shutdown pretending to be a real visitor session.
7. **No commit** — leave working tree for Al to review.

---

## Decisions to log

Add to `planning/decisions.md` after implementation:

- **B.16** — Pool as allocator over store (not a store replacement). Swap cost: low.
- **B.17** — `DirectAllocator` for `WARM_POOL_SIZE=0` so bootstrap path is unconditional.
- **B.18** — Events emit for hit AND miss (consumer-side per F-a; no planner-fb retrofit).
- **B.19** — `waitTimeMs` is always 0 in Puma (no queueing); preserved in schema for future strategies.
- **B.20** — TTL refine at config-parse time (fail-fast, no runtime surprise).
- **B.21** — Refill serialisation via a `refilling` flag (not a lock); refill-on-claim in addition to timer tick.

---

## Merge notes (reconvene with coder-fb)

- `src/index.ts`: I add allocator construction + shutdown hook. coder-fb (F-b observability retrofit) swaps `console.log` for `emitEvent` across the startup / shutdown logs. No structural conflict — their changes are in the `app.listen` callback and `shutdown()`; mine are in the `main()` body before `buildServer`.
- `session-bootstrap.ts`: I add optional `allocator` parameter. F-b may be swapping any warn/error logs here for `emitEvent`. Both changes are additive.
- **I own** `warm_pool.hit` / `warm_pool.miss` emits. Documented agreement: planner-fb does not retrofit these.
