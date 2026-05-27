# 03 — Execution: Crosscut — AntiRepetition (server-side session-scoped exclude tracking)

> **Status**: HITL-ratified 2026-05-27 — ready for execution. (Authored 2026-05-27, worktree `agent-a287106f12323edf1`, base [ee21254 — house-keeping](#). Decision IDs proposed `C.anti-rep-{1..}` (wave-named, numeric ids TBD on merge). Authored in response to Alastair's 2026-05-27 framing: *the agent should never repeat content it has already shown to a visitor in the same session — for **all** content types except trips and tours, which Swoop is literally trying to sell.* See "2026-05-27 HITL ratification" addendum at the bottom of this file for resolutions to all nine open questions in §6.)
>
> Sister plans this builds on / supersedes-in-default: [03-exec-crosscut-find-options-v2-backfill.md §2.5.b — agent-supplied exclude list (C.focused-shamir-5)](03-exec-crosscut-find-options-v2-backfill.md). The agent-supplied `exclude` lever stays as an override channel; the new default is **automatic, server-side, per-session tracking**.

---

## ★ Read this first — the problem this closes

Two states of the world frame this plan:

**Today (May 2026).** Anti-repetition exists only on `find_options`, and only as an **agent-supplied** lever: Sonnet decides what to exclude from each call and passes `exclude: [{type, id}, ...]` per [C.focused-shamir-5 — agent-supplied exclude list on find_options primitives](03-exec-crosscut-find-options-v2-backfill.md). The agent carries the burden of remembering what it showed last turn (and the turn before, and the turn before). The other six conversational tools (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `illustrate`, plus future `customer_tip` retrieval) have **no anti-repetition**: every call can — and does — return the same top hits the visitor has already seen.

**The framing shift.** Repeating the same `inspire_passage` "Granite towers at dawn…" two turns in a row reads as the agent not paying attention. Same for a `customer_story`, a `trust_proof`, an `inform_chunk`, an `illustrate` image. The exception is trips and tours — **Swoop is literally trying to sell these**, so repeating an option ("did you want me to revisit the Highlights of Patagonia trip?") is *the work*, not a bug.

**The future-state context (Luke's right-panel UI, parked).** Luke has stated intent that cards and images move to a right-hand panel while conversation stays in the left panel. With that UI shape, *all* items a tool returns are auto-shown to the visitor — the agent has no role in selecting what to display. "Marked as shown" cleanly equals "everything the tool returned." This plan lays groundwork for that UI without implementing it. Mark-as-shown happens at the connector handler boundary on every tool return, regardless of whether today's UI shows all of them or not.

This plan:
- Adds a `seenItems` slice to ADK session state — per-type sets of ids the visitor has already encountered.
- Wires the connector's tool handlers to read the seen-set on entry (inject as `excludeIds` into the data primitives) and to mark all returned ids as shown on exit.
- Carves out `trip` and `tour` from the auto-tracking — Swoop's saleable surfaces stay repeatable.
- Preserves the existing agent-supplied `exclude` lever as an additive override.
- Touches **no schema** in Postgres. Touches **no new datastore**. Lives entirely in ADK conversation session state, which already persists for the session lifetime (in-memory today; future-Postgres post-M4 per [B.t11 — server-side session history projection](03-exec-agent-runtime-t11.md)).

---

## 1. Outcome

After this lands:

- Within a single session, `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, and `illustrate` (and future `customer_tip` retrieval) never return an item the visitor has already been shown.
- `find_options` continues to return trips and tours freely on repeat — these are explicitly NOT tracked. Hotels and region_bases ARE tracked (they're not the saleable surface; repeating a hotel is the same UX scar as repeating a story).
- The agent's existing optional `exclude: [{type, id}, ...]` parameter on `find_options` remains as an additive override: Sonnet can still nominate specific cards it wants omitted (e.g. a card the visitor explicitly rejected), and those merge into the auto-injected exclude set.
- Session ends → seen-set evaporates with the session. No TTL logic. No cleanup job.
- Connector remains stateless across requests — the seen-set rides in via the request boundary (see §2.1) and out via the response, the same way ADK already plumbs conversation history.

## 1.5 What this does **not** change

Clarifying because the architectural invitation is to over-design:

- **No new Postgres table.** Seen-items live in ADK session state, not in a database.
- **No new datastore.** No Redis. No KV. No in-process Map on the connector. ADK's session-state mechanism IS the persistence boundary.
- **No TTL, no eviction, no LRU.** Session-scoped means session-scoped. ADK's session lifecycle owns cleanup.
- **No prompt change for the agent.** Sonnet doesn't need to know this exists. It calls the tools as before; results are silently de-repeated. The existing `find_options.exclude` lever stays documented in [find_options/description.md](../product/cms/prompts/tools/find_options/description.md) as it is today.
- **No tool surface change.** The eight intent-named tools' public Zod schemas are unchanged. Anti-repetition is an internal connector concern.
- **No widget change.** D.t9 (chat-surface widgets rendering the five `*PublicSchema` outputs) render whatever the tool returns — and the tool now returns fresh items by construction.

The plan's only job: at the connector handler boundary, automatically inject `excludeIds` from session state into the data primitives, and automatically merge returned ids back into session state on success.

---

## 2. Target functionalities

### 2.1 `seenItems` slice on `SessionState` — schema in `@swoop/common`

Extend [SessionStateSchema in product/ts-common/src/session.ts](../product/ts-common/src/session.ts) with a new optional field:

```typescript
// Per-type sets of "already shown to the visitor in this session". Used by
// the connector's anti-repetition layer to auto-exclude on tool entry and
// auto-mark-shown on tool return. Trip and tour are DELIBERATELY NOT tracked
// here — those are Swoop's saleable surface; repeats are fine and expected.
//
// Keying conventions per type:
//   inspire_passage : passage.id (uuid string)
//   customer_story  : story.id (uuid string)
//   trust_proof     : proof.id (uuid string)
//   inform_chunk    : chunk.id (uuid string)
//   image           : image.id (stringified integer)
//   blog_post       : blog_post.id (stringified integer; reserved for future)
//   hotel           : hotel.id (stringified integer)
//   region_base     : area.id (stringified integer)
//   customer_tip    : tip.id (uuid string; reserved for future)
//
// Persisted as arrays in JSON; serialised as Set in-process where mutation
// is hot (the marking pass during a tool return). Zod schema treats arrays
// as the canonical wire shape and the in-memory Set as derived; conversion
// happens at the read/write boundary in the connector handler.
export const SeenItemsSchema = z.object({
  inspire_passage: z.array(z.string()).default([]),
  customer_story:  z.array(z.string()).default([]),
  trust_proof:     z.array(z.string()).default([]),
  inform_chunk:    z.array(z.string()).default([]),
  image:           z.array(z.string()).default([]),
  blog_post:       z.array(z.string()).default([]),
  hotel:           z.array(z.string()).default([]),
  region_base:     z.array(z.string()).default([]),
  customer_tip:    z.array(z.string()).default([]),
});
export type SeenItems = z.infer<typeof SeenItemsSchema>;
```

Then in `SessionStateSchema`:

```typescript
seenItems: SeenItemsSchema.default({}),  // each per-type array defaults to []
```

**Why arrays not Sets at the schema layer**: Zod doesn't have a built-in JSON-serialisable Set; arrays-of-strings-with-an-implicit-uniqueness-invariant is the standard ADK-session-friendly shape. The connector converts to `Set<string>` at use sites for O(1) membership.

**Why no `trip` and `tour` keys**: deliberate. Their absence from the schema is the carve-out — no per-type entry, no tracking surface, no temptation for a future agent to "just add it for symmetry."

**Why no derived key types (no `(source_provenance, source_id)` keying)**: the inspect schema audit (2026-05-27) confirms every tracked type already exposes a single canonical id at the `*PublicSchema` projection layer ([InspirePassagePublicSchema.id is uuid](../product/ts-common/src/derived.ts), `CustomerStoryPublicSchema.id` is uuid, etc.). No type today needs `(provenance, source_id)` keying. If a future type does (the open `customer_tip` shape is the candidate; that plan is being authored in parallel), this schema gets a `customer_tip_key` entry that stores the composite — by the time the schema lands, the call will be settled.

### 2.2 Session state access from connector tool handlers

This is the load-bearing piece. **Today, the connector cannot reach the orchestrator's ADK session state.** They're separate processes; they communicate via MCP HTTP. The connector knows the MCP transport's `mcp-session-id` (set by the SDK on initialize), but has no channel back to `SessionState.seenItems`.

Two architectural options. Recommendation in §2.2.b.

#### 2.2.a Option A — payload-mode (per-call argument)

The orchestrator's `ConnectorClient.callTool` injects the current `seenItems` slice into every tool call as a hidden internal argument (e.g. `__seenItems`), and the handler returns a `__newlySeen` delta in its response envelope. The orchestrator merges the delta back into session state before the next turn.

Wire shape:
```typescript
// Orchestrator side, in createConnectorTools execute path:
const seenItems = await sessionStore.get(sessionId).then(s => s?.seenItems ?? {});
const result = await client.callTool(name, { ...args, __seenItems: seenItems });
// result.__newlySeen is the connector's per-type ids-just-returned delta
await sessionStore.update(sessionId, (s) => ({
  ...s,
  seenItems: mergeSeen(s.seenItems, result.__newlySeen),
}));
```

**Pros**: connector stays purely stateless and request-scoped. Easy to reason about. Easy to test (just pass `__seenItems` directly in unit tests). Survives a connector restart with no data loss because state lives orchestrator-side.

**Cons**: every tool call carries a payload that grows linearly with session length. After 100 visitor turns on a long session, `__seenItems` could be hundreds of ids per type. Negligible in absolute terms (each id is ~36 bytes for a uuid, so 100 ids × 9 types × 36 bytes = ~32KB worst case), but it's "noise" in every MCP envelope. Also requires the eight tool schemas to either accept an unknown `__seenItems` field (`z.object().passthrough()`) or to lift it out before validation.

#### 2.2.b Option B — callback-mode (deps-injected accessor)

Extend `ToolHandlerDeps` with a `seenItems` accessor that the orchestrator wires per-call (per-session) at MCP server creation time. The connector's [tools/index.ts registerAllTools](../product/connector/src/tools/index.ts) currently builds `baseDeps` once with `sessionId: 'connector-host'` (a constant) — this needs to become per-session.

Wire shape:
```typescript
interface ToolHandlerDeps {
  withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  embedQuery: EmbedQueryFn;
  // New:
  seenItems: {
    get(type: SeenItemType): ReadonlyArray<string>;
    markShown(type: SeenItemType, ids: ReadonlyArray<string>): void;
  };
}
```

But the connector is a separate process — the accessor can't talk back to orchestrator session state directly. So Option B in practice **degrades to Option A under the hood** with a thin wrapper. The accessor reads from a per-call snapshot injected at the transport boundary; markShown writes to a per-call delta returned at the transport boundary.

**Recommendation: Option A wire shape, Option B handler-facing accessor.** Payload rides the MCP envelope (one place to plumb); the handler API is a clean accessor (zero churn in each of the 6 tool bodies — they call `deps.seenItems.get('inspire_passage')` and `deps.seenItems.markShown('inspire_passage', ids)` and don't know how the snapshot got there).

This means the wire-level work lives entirely in:
- `ConnectorClient.callTool` (orchestrator-side) — inject `__seenItems` into args; extract `__newlySeen` from result envelope.
- The handler runtime in [_handler-runtime.ts](../product/connector/src/tools/_handler-runtime.ts) — read `__seenItems` from the raw input, build the per-call accessor, pass into the handler body's deps, collect the markShown calls into `__newlySeen`, attach to the result envelope.
- Each tool body — calls `deps.seenItems.get(...)` to derive `excludeIds`, then `deps.seenItems.markShown(...)` after computing the result.

**One subtle design call**: do `get` and `markShown` operate on the **same in-flight snapshot** (so a handler that calls `markShown` mid-body sees those marks reflected in subsequent `get` calls within the same call)? **Recommendation: no.** `get` returns the snapshot the orchestrator sent at call entry; `markShown` accumulates into the outbound delta. The handler doesn't read its own writes. Simpler invariant, smaller foot-gun surface.

### 2.3 Handler-side: auto-injection on entry, auto-mark on exit

Every tool that retrieves trackable content gets the same shape. Worked example for `find_inspiring`:

```typescript
// In find_inspiring.ts (sketch, not committed code):
export async function findInspiringBody(
  input: FindInspiringInput,
  deps: ToolHandlerDeps,
): Promise<FindInspiringOutput> {
  // 1. Read seen ids for this type from the per-call snapshot.
  const seenInspire = deps.seenItems.get('inspire_passage');
  const seenImages  = deps.seenItems.get('image');

  // 2. Pass as excludeIds into the primitive (primitives gain an
  //    optional excludeIds parameter — see §2.4).
  const passages = await deps.withClient(client =>
    findInspirePassagesByText(client, input.query, {
      region: input.region,
      mood: input.mood,
      limit: input.limit,
      excludeIds: seenInspire,        // exclude uuid strings
      excludeImageIds: seenImages,    // exclude image ids embedded inside passages
    }),
  );

  // 3. Mark everything returned as shown — passage id AND embedded image id.
  deps.seenItems.markShown('inspire_passage', passages.map(p => p.id));
  deps.seenItems.markShown(
    'image',
    passages.flatMap(p => (p.image ? [String(p.image.id)] : [])),
  );

  return { passages, count: passages.length };
}
```

Per-tool touchpoints:

| Tool | Tracks (auto-exclude + auto-mark) | Trip/tour carve-out applies? |
|---|---|---|
| `find_inspiring` | `inspire_passage` + embedded `image` | n/a |
| `find_someone_who` | `customer_story` + embedded `image` | n/a |
| `find_proof` | `trust_proof` | n/a |
| `lookup` | `inform_chunk` | n/a |
| `illustrate` | `image` | n/a |
| `find_options` | **only** hotel + region_base; trip + tour pass through unchanged | **Yes — carve-out applies**. Returned trip/tour ids are NOT marked shown |
| `find_customer_tip` (future) | `customer_tip` | n/a |
| `handoff` / `handoff_submit` | (none — utility tools) | n/a |

**Embedded image rule (Q6 in §6 below — recommended default ratified inline)**: when a tracked content row carries an `image_id` (e.g. an `inspire_passage` row's hero image), the **image is also marked shown**. The visitor saw both. This means a subsequent `illustrate` call won't return that same image again.

### 2.4 Data-primitive interface — extend `excludeIds`

The find_options primitives already accept `excludeIds?: number[]` (per [C.focused-shamir-5 — agent-supplied exclude list](03-exec-crosscut-find-options-v2-backfill.md)). Extend the same shape to the other content primitives:

| Primitive | File | Today's exclude support | New |
|---|---|---|---|
| `findInspirePassagesByText` | `connector/src/data/find-inspire-passages.ts` | none | `excludeIds?: string[]` (uuid), `excludeImageIds?: number[]` |
| `findCustomerStoriesByPersonaSignal` | `connector/src/data/find-customer-stories.ts` | none | `excludeIds?: string[]` (uuid), `excludeImageIds?: number[]` |
| `findTrustProofsByConcern` | `connector/src/data/find-trust-proofs.ts` | none | `excludeIds?: string[]` (uuid) |
| `findInformChunksByQuestion` | `connector/src/data/find-inform-chunks.ts` | none | `excludeIds?: string[]` (uuid) |
| `findImagesByKeywords` | `connector/src/data/find-images-by-keywords.ts` | none | `excludeIds?: number[]` |
| `queryTripCardsByFilter` | `connector/src/data/query-trips.ts` | `excludeIds?: number[]` (agent-supplied) | unchanged — agent-supplied only; auto-injection skipped |
| `queryTourCardsByFilter` | `connector/src/data/query-tour-cards.ts` | `excludeIds?: number[]` (agent-supplied) | unchanged — agent-supplied only; auto-injection skipped |
| `queryHotelCardsByFilter` | `connector/src/data/query-hotels.ts` | `excludeIds?: number[]` (agent-supplied) | extend: union of agent-supplied + auto-injected from `seenItems.hotel` |
| `queryRegionBaseCardsByFilter` | `connector/src/data/query-region-bases.ts` | `excludeIds?: number[]` (agent-supplied) | extend: union of agent-supplied + auto-injected from `seenItems.region_base` |

SQL pattern (empty-array safe, mirrors the existing trip/tour primitive treatment):
```sql
AND id <> ALL($N::int[])    -- for integer-id types
AND id <> ALL($N::uuid[])   -- for uuid-id types
```

### 2.5 `find_options` exclude merge rule

Today, [find_options.ts](../product/connector/src/tools/find_options.ts) passes the agent-supplied `exclude` list through `excludeIdsForType()` and then into each primitive. After this plan:

- For `trip` and `tour` primitives: behaviour unchanged. Agent-supplied excludes are honoured. **No auto-injection from `seenItems`** (because there are no `seenItems.trip` / `seenItems.tour` keys).
- For `hotel` and `region_base` primitives: each primitive's `excludeIds` parameter is **the union** of:
  1. Agent-supplied excludes for that type (via `excludeIdsForType(input.exclude, 'hotel')` etc.).
  2. Auto-injected `seenItems.hotel` / `seenItems.region_base` (via `deps.seenItems.get('hotel')` / `deps.seenItems.get('region_base')`).
- After the call returns: `find_options` calls `deps.seenItems.markShown('hotel', ...)` and `deps.seenItems.markShown('region_base', ...)` for the hotel/region_base cards in the result. **Does not** call `markShown` for trip or tour cards.

**Merge rule rationale (Q3 in §6 — recommended inline)**: union, with no override. The agent's explicit `exclude` lever is additive — it can only add to what's already excluded, never subtract. If a future need emerges to let the agent *force-include* something the server thinks is shown (rare; "revisit the W Trek inspire passage as a callback"), that's a separate `forceInclude` parameter, not a subtraction from `seenItems`. Don't conflate the two.

### 2.6 Image deduplication — `image_id` is the key

When the same image is reachable via multiple paths — `image_trip` join, `image_page` join, embedded inside an `inspire_passage` row — the question is whether to key by `image.id` or by `image.canonical_url`. **Recommendation: `image.id`** (Q5 in §6). It's the source-of-truth identity; URLs are derived. Two image rows with different ids but identical canonical_urls would be a data integrity issue worth surfacing, not papering over at the dedup layer.

### 2.7 Wire-level plumbing: orchestrator side

In [product/orchestrator/src/connector/tools.ts](../product/orchestrator/src/connector/tools.ts), the `invokeTool` function gains a session-state read+write pair:

```typescript
// Before invoking:
const session = await sessionStore.get(sessionId);
const seenItems = session?.seenItems ?? defaultEmptySeenItems();

// Inject into args (hidden field):
const augmentedArgs = { ...parsedInput.data, __seenItems: seenItems };
const raw = await client.callTool(spec.name, augmentedArgs);

// After invoking, on success:
const newlySeen = extractNewlySeen(raw);  // from raw.structuredContent.__newlySeen
if (newlySeen) {
  await sessionStore.update(sessionId, (s) => ({
    ...s,
    seenItems: mergeSeen(s.seenItems, newlySeen),
  }));
}
```

`extractNewlySeen` lives alongside `parseToolResult` in the same file. `mergeSeen` is a pure helper in `@swoop/common` (per-type array-union with de-dup, see §2.8).

The `sessionStore` and `sessionId` need to be in scope of `invokeTool`. Today, `createConnectorTools` doesn't take a `sessionStore`. This requires:
- Threading `sessionStore` into `BuildConnectorToolsParams`.
- Threading `sessionId` into each tool's `execute` callback — needs an ADK-side mechanism to read the current invocation's session id. The B.t11 plan ([B.t11 — server-side session history projection endpoint](03-exec-agent-runtime-t11.md)) faces a similar plumbing challenge for `BuildServerDeps`. **Open at execution**: confirm ADK provides a per-call session id to FunctionTool execute callbacks; if not, use the InvocationContext shape that ADK passes (similar to how `sessionService` flows through `runner.sessionService` per B.t11). This is the riskiest plumbing call in the plan; the alternative — payload-only via the existing MCP `mcp-session-id` transport correlation — is the fallback. See §6 Q1.

### 2.8 Helpers in `@swoop/common`

Two pure utilities, no I/O:

```typescript
// product/ts-common/src/seen-items.ts (new file)
export function defaultEmptySeenItems(): SeenItems {
  return {
    inspire_passage: [], customer_story: [], trust_proof: [],
    inform_chunk: [], image: [], blog_post: [],
    hotel: [], region_base: [], customer_tip: [],
  };
}

export function mergeSeen(a: SeenItems, b: Partial<SeenItems>): SeenItems {
  const out = { ...a };
  for (const [type, ids] of Object.entries(b)) {
    if (!ids || !ids.length) continue;
    const merged = new Set([...(out[type as keyof SeenItems] ?? []), ...ids]);
    out[type as keyof SeenItems] = [...merged];
  }
  return out;
}
```

The connector-side accessor in `_handler-runtime.ts` builds and returns the per-call delta from accumulated `markShown` calls; orchestrator side calls `mergeSeen` to commit.

### 2.9 Tests

- **Unit (ts-common)**: `mergeSeen` — empty + populated, dedup invariant, unknown type ignored gracefully.
- **Unit (connector handler runtime)**: a fake handler calling `deps.seenItems.markShown` accumulates correctly into the result envelope's `__newlySeen` field. Snapshot read via `deps.seenItems.get` returns the injected `__seenItems`.
- **Unit (each tool body)**: handler is called with a populated `seenItems` snapshot; the primitive is called with `excludeIds` equal to the seen ids; the result envelope's `__newlySeen` contains every returned id.
- **Integration (each content tool, against `puma_dev`)**: call the tool twice in sequence with the same input; assert the second call returns a disjoint set of ids from the first (or returns empty if the pool is exhausted — see §6 Q9 on exhaustion behaviour).
- **Trip/tour carve-out test**: call `find_options` (preferredType: 'trip') twice with the same filters; assert the second call CAN return the same trips (no auto-exclude); assert `seenItems.trip` does not exist as a key.
- **Mixed-type test on find_options blendCards**: a blended response has trips, tours, hotels, region_bases. After the call, `seenItems.hotel` and `seenItems.region_base` contain the returned hotel/region_base ids; trips and tours are NOT tracked.
- **Embedded image test**: `find_inspiring` returns a passage carrying an image. After the call, both `seenItems.inspire_passage` and `seenItems.image` contain the relevant ids. A subsequent `illustrate` call cannot return the same image.

### 2.10 Decisions to log

Proposed entries in [decisions.md](decisions.md), wave-named to avoid collisions:

- **C.anti-rep-1** — Anti-repetition is server-side and per-session for all content types EXCEPT trip and tour. Trip and tour are Swoop's saleable surface and repeats are expected. Replaces the agent-managed-only posture established in C.focused-shamir-5 (the agent-supplied exclude lever remains as an additive override for find_options, never subtractive).
- **C.anti-rep-2** — Seen-items state lives in ADK conversation session state (`SessionState.seenItems`), per-type sets of stringified ids. No new datastore. No TTL. Session-scoped lifetime; cleanup happens when the ADK session ends.
- **C.anti-rep-3** — Marking-as-shown happens at the connector handler boundary: every item the connector returns from a tracked tool gets marked. The agent has no role in deciding what counts as shown — prepares for Luke's future right-panel + carousel UI where the agent doesn't select what to display.
- **C.anti-rep-4** — Plumbing pattern: orchestrator-side `ConnectorClient.callTool` injects `__seenItems` into args and extracts `__newlySeen` from the result envelope; connector-side `_handler-runtime.ts` exposes a clean `deps.seenItems` accessor to handler bodies. Wire-level shape lives in one place; handler-facing API is uniform.
- **C.anti-rep-5** — Image dedup is keyed on `image.id`. When a tracked content row carries an embedded image, both the row AND the image get marked shown.

### 2.11 Doc updates (in the same PR — none required pre-execution)

- **`product/cms/prompts/tools/find_options/description.md`** — the existing language about the `exclude` parameter stays accurate (the agent's lever is unchanged). No edit needed unless an HITL ratification specifically requests one.
- **`progress.md`** — add a row under "shipped" once execution lands (`Anti-repetition default-on for 5 conversational tools + hotel/region_base; trip/tour carve-out preserved.`)
- **`discoveries.md`** — short entry on the orchestrator-connector session-state plumbing pattern (the `__seenItems` / `__newlySeen` envelope convention) so future cross-cuts that need similar per-session connector context have a template.

---

## 3. Architectural principles applied here

- **Server-side default; agent-supplied override.** The agent shouldn't be the source of truth for what's been shown — it has imperfect recall and its job is conversation, not bookkeeping. The connector knows exactly what it returned; that's the authoritative shown-set.
- **Session state is the persistence boundary.** ADK already owns session lifetime, archival, and (post-M4) Postgres-backed durability. Riding on that surface means zero new infra and zero new cleanup logic.
- **Treat content types as data; treat trip and tour as different.** The carve-out isn't a special-case in the code path; it's a structural absence from the `SeenItemsSchema` shape. No conditional "if (type !== 'trip')" lurks in the handler — the keys simply don't exist for those types.
- **Mark all returned items as shown.** Not "what the agent decided to surface" — the visitor's reality is whatever the connector returned. Prepares for the right-panel UI cleanly.
- **One canonical wire shape, one canonical accessor.** `__seenItems` lives in the MCP envelope; `deps.seenItems` lives in the handler. Two layers, one canonical interface each; no per-tool variation.
- **Embeddings stay server-side; seen-set stays server-side too.** The visitor never sees a `seenItems` field. The agent never sees a `seenItems` field. It's an internal contract between orchestrator and connector.

---

## 4. Implementation order

1. **Schema first**: add `SeenItemsSchema` + extend `SessionStateSchema` in `@swoop/common`. Add `mergeSeen` + `defaultEmptySeenItems` helpers. Test.
2. **Handler runtime**: extend `_handler-runtime.ts` to extract `__seenItems` from input on call entry, build the per-call accessor, accumulate `markShown` calls into `__newlySeen` on the result envelope. Test the accessor in isolation.
3. **`ToolHandlerDeps`**: extend to carry the `seenItems` accessor. Update [deps.ts](../product/connector/src/tools/deps.ts).
4. **Data primitives** (mechanical, mirror the existing find_options primitive treatment): extend `findInspirePassagesByText`, `findCustomerStoriesByPersonaSignal`, `findTrustProofsByConcern`, `findInformChunksByQuestion`, `findImagesByKeywords` to accept `excludeIds` (and image variants where relevant) and apply `AND id <> ALL($N::uuid[])` or `::int[]` as appropriate. Test each.
5. **Tool bodies** (one at a time, in this order — easiest → hardest):
   - `lookup` — simplest, single primitive, no embedded image.
   - `find_proof` — same shape, no image.
   - `find_inspiring` — adds embedded image dedup.
   - `find_someone_who` — same as find_inspiring shape-wise.
   - `illustrate` — image-only tool.
   - `find_options` — hotel/region_base auto-exclude + carve-out for trip/tour. Most subtle change.
6. **Orchestrator-side plumbing**: thread `sessionStore` + `sessionId` through `createConnectorTools` / `invokeTool`. Inject `__seenItems` on call; extract `__newlySeen` on response; `mergeSeen` into session. Test against in-memory session store.
7. **End-to-end test**: drive a real Sonnet turn that calls `find_inspiring` twice with the same query against `puma_dev`; assert no overlap in returned passages.
8. **Verification gates** per §5.
9. **Decisions logged + docs updated** per §2.10 / §2.11.
10. **Commit + push (no merge to main)**.

---

## 5. Verification gates

### Fresh-install gate (per [feedback_swarm_fresh_install_verify.md](../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_swarm_fresh_install_verify.md))

```sh
cd product && rm -rf node_modules package-lock.json && npm install \
  && npm run typecheck && npm run lint && npm test
```

### Per-tool repeat-call assertion

```sh
# Boot connector + orchestrator against puma_dev. Then:
curl -sX POST http://localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"sessionId": "test-anti-rep", "message": "Tell me something inspiring about Patagonia"}'
# Capture the returned passage ids from the orchestrator's structured log
# (find_inspiring tool.invoked event payload).

curl -sX POST http://localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"sessionId": "test-anti-rep", "message": "Tell me something else inspiring about Patagonia"}'
# Capture the returned passage ids again.

# Assertion: zero overlap between the two sets (or the second is empty if the
# pool was exhausted by the first call's limit).
```

### Trip/tour carve-out assertion

```sh
curl -sX POST http://localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"sessionId": "test-trip-repeat", "message": "Show me Patagonia trips"}'
# Capture trip card ids.

curl -sX POST http://localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"sessionId": "test-trip-repeat", "message": "Show me more Patagonia trips"}'
# Capture trip card ids again.

# Assertion: trip ids CAN overlap (they probably will — small pool). No error.
# Also: GET /session/test-trip-repeat (debug surface) should show
# seenItems.trip is undefined (key not present), seenItems.tour is undefined,
# but seenItems.hotel and seenItems.region_base populated if the blend included them.
```

### Embedded image assertion

```sh
# Call find_inspiring; note an image id in the response.
# Call illustrate with related keywords; the image id from find_inspiring
# must NOT appear in the illustrate result.
```

---

## 6. HITL questions to ratify

Nine settled-as-recommendations. Alastair ratifies on merge.

### Q1 — How does session id thread from orchestrator into connector tool handlers?

**RESOLVED (2026-05-27 HITL)**: orchestrator adds exclusions dynamically at call time. The connector remains stateless (architectural posture preserved); the orchestrator computes per-type exclude lists from its ADK session state and passes them in as **regular tool-call arguments** (the existing per-primitive `excludeIds` parameter), not as a hidden `__seenItems` envelope field. No new connector-side session-state machinery; no `__seenItems` / `__newlySeen` envelope convention.

**Implication for §2.2 / §2.7**: the elaborate `__seenItems` payload + `__newlySeen` delta machinery described in §2.2.a / §2.2.b is **not the chosen shape**. Instead: orchestrator-side `invokeTool` reads `seenItems` from session state, computes per-type exclude arrays, merges them with any agent-supplied excludes, and adds them to the regular tool-call arguments before dispatch. The connector handler bodies receive `excludeIds` (and image-equivalents where relevant) as normal tool inputs. After the call, orchestrator marks shown by reading the IDs out of the **structured tool result** (which the connector already returns) and merging into session state. Connector-side `_handler-runtime.ts` does not gain a `seenItems` accessor; handler bodies do not call `deps.seenItems.get/markShown`.

**Why**: simpler. Stateless connector preserved. No new wire convention. The existing per-primitive `excludeIds` mechanism (per [03-exec-crosscut-find-options-v2-backfill.md §2.5.b — C.focused-shamir-5](03-exec-crosscut-find-options-v2-backfill.md)) is already the right shape; this plan generalises it across every dedup-eligible tool rather than inventing a parallel mechanism.

### Q2 — Where does the session-state accessor physically live?

**RESOLVED (2026-05-27 HITL — by Q1)**: lives in the orchestrator's ADK session state, never in the connector. There is no connector-side "seen-items accessor"; the connector handlers receive exclude IDs as normal tool inputs and return result rows as normal tool outputs. All read+write of seen-state happens orchestrator-side in `invokeTool` (read pre-dispatch, write post-result), bracketing the connector call.

**Why**: a direct consequence of Q1's resolution. No connector-side state machinery means there is no accessor to physically locate.

### Q3 — Existing `excludeIds` machinery — what happens?

**RESOLVED (2026-05-27 HITL)**: **keep it — and make it the foundation**. The existing per-primitive `excludeIds` parameter in find_options v2 (per [03-exec-crosscut-find-options-v2-backfill.md §2.5.b — agent-supplied exclude list (C.focused-shamir-5)](03-exec-crosscut-find-options-v2-backfill.md)) is the foundational mechanism that AntiRepetition builds on. AntiRepetition expands it in two ways:

1. **Sole producer becomes the orchestrator.** Today the agent supplies the exclude list (via the `exclude: [{type, id}, ...]` lever on `find_options`). Post-AntiRepetition, the orchestrator computes the exclude list from its session state and supplies it. The agent's lever, where it still applies, unions in additively (never subtractively) — same union semantics as the original recommendation.
2. **Per-primitive contract extends to every dedup-eligible tool.** Today only the find_options primitives accept `excludeIds`. Post-AntiRepetition, every primitive whose tool surfaces dedup-eligible content gains the same parameter shape (per §2.4) — `findInspirePassagesByText`, `findCustomerStoriesByPersonaSignal`, `findTrustProofsByConcern`, `findInformChunksByQuestion`, `findImagesByKeywords`, plus the future `findCustomerTips`.

**Why**: union semantics are the principle of least surprise, and the existing parameter's documented intent ("cards to omit") is fully compatible with this expansion. The agent's lever stays as an additive override channel; the new default is orchestrator-supplied exclusions.

### Q4 — Turn-scoped vs whole-session shown set?

**RESOLVED (2026-05-27 HITL)**: **whole-session**. Once shown, never shown again in the same session. No turn-window, no decay, no timeout.

**Why**: the entire premise is "the visitor saw this already." That doesn't time out within a session. If a real need for "I'd like to revisit X" emerges, it's an agent-action (Sonnet calls a tool with explicit `forceInclude: [...]` or asks the visitor's permission), not a passive timeout.

### Q5 — Image dedup key: `image.id` or `canonical_url`?

**RESOLVED (2026-05-27 HITL)**: **`canonical_url`**, not `image.id`. The rule is: **never show the same picture twice**. If the same underlying picture is represented by two distinct `image.id` rows in the database (which can happen — same picture re-uploaded, same picture catalogued under different ids by different ingest passes), they still count as "the same picture" to the visitor's eye, and AntiRepetition must treat them as one.

**Same principle applies to web page references**: dedup by canonical URL. Any tool that ever surfaces a URL-bearing item (blog posts, FAQ pages, external references) keys its seen-set by canonical URL rather than by row id.

**Implication for §2.1 / §2.6**: the `SeenItemsSchema` shape changes — the per-type set for `image` (and for any future URL-bearing type such as `blog_post`) is a set of canonical URLs (strings), not stringified integer ids. Other types (uuid-keyed `inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, integer-keyed `hotel`, `region_base`) continue to key by their natural id. The data primitives' `excludeIds` parameter for image-bearing tools becomes `excludeCanonicalUrls?: string[]` (or similar — name TBD at execution time, consistent with the column name on the `image` table).

**Why**: source-of-truth identity *for the visitor's reality* is the rendered URL, not the database row. Treating two rows with the same URL as one is the user-correct behaviour. If duplicate-URL rows surface a data-integrity concern, that's a separate observability concern, not a reason to force the dedup layer to under-protect the visitor experience.

### Q6 — Images returned inside other rows: mark them shown too?

**RESOLVED (2026-05-27 HITL)**: **yes**. If an `inspire_passage` (or `customer_story`, or any other row-shape) carries an embedded `image_id` / `canonical_url`, the image is marked shown alongside the parent row. The visitor saw both.

**Why**: the visitor's reality is "I saw an image of a granite tower and read a passage about it" — both are shown content. The right-panel UI makes this even more literal. Any subsequent `illustrate` call therefore cannot re-surface the same picture, and (per Q5) it's the canonical URL that's the dedup key.

### Q7 — Where do per-tool primitives get the seen-set?

**RESOLVED (2026-05-27 HITL — by Q1/Q2)**: the orchestrator passes them in as normal tool-call arguments. Primitives don't know about session state; they just accept an exclude list. Handler bodies don't read from a connector-side accessor (there isn't one — see Q2); they receive `excludeIds` directly from the validated tool input.

**Why**: consistent with Q1 and Q2. Primitives stay pure data functions (testable in isolation against `puma_dev`); the session-state interface lives at the orchestrator boundary.

### Q8 — Connector tool surface for "show all available" / "reset shown"?

**RESOLVED (2026-05-27 HITL)**: **none for now**. No reset surface — not for the agent, not for operators. Future addition only if a real operational need surfaces.

**Why**: keeping the connector tool surface stable and minimal is a chunk-C principle ([decisions.md C.25 — eight intent-named tools, no more](decisions.md)). Reset is a debug affordance at best, and Puma doesn't have a confirmed need. Defer until live observation surfaces one.

### Q9 — What happens when the pool is exhausted (every candidate is already shown)?

**RESOLVED (2026-05-27 HITL)**: **returns empty**. The connector returns an empty array; the handler returns `{ <plural>: [], count: 0 }`. The agent handles the empty case gracefully — prose carries the moment, no special "you've seen everything" indicator on the wire.

**Why**: empty result is already the well-trodden path. Adding a `coverage_warning` channel would be schema noise. Observability via `tool.invoked` event with `outputCount: 0` is enough — once operations sees that pattern, that's the signal to either grow the corpus or revisit the carve-out (e.g. should `customer_story` actually be allowed to repeat in long sessions?).

---

## 7. Coordination with siblings

- **Customer tips data plan (parallel — being authored separately by another agent)**: will introduce `customer_tip` as a content type. The `SeenItemsSchema` field is already reserved (`customer_tip: z.array(z.string()).default([])`) so when that lands, the only additions are: a primitive with `excludeIds` support, and a tool body that reads + marks. Zero changes to the plumbing.
- **B.22 — post-M4 Postgres-backed ADK session store (custom Postgres `SessionService` writing to the same Cloud SQL instance retrieval + handoff live in)**: when ADK session state moves from in-memory `Map` to Postgres, `seenItems` rides through unchanged — it's just another field on `SessionState`. Same swap discipline as B.t11 (server-side session history projection endpoint). No plan changes required.
- **D.t9 (chat-surface widgets rendering the five `*PublicSchema` outputs)**: zero coupling. Widgets render whatever the connector returns; the connector now returns fresh items by construction. No widget edits.
- **Future Luke right-panel UI (parked)**: this plan's "mark everything returned as shown" rule lines up perfectly with that UI. When that UI lands, no handler-side change is needed.
- **find_someone_who Mirror big-fix** (separate plan, deferred): orthogonal. The data layer redesign there is about how `customer_story` rows are retrieved (persona-embedding cosine, blah); this plan is about *which* rows are excluded post-retrieval. The two changes compose cleanly.
- **G prompt tuning**: the agent's tool descriptions don't change. If Sonnet's behaviour shifts in subtle ways once results are de-repeated (e.g. it starts asking "would you like another inspiring fact?" more often because the pool empties), that's a G-side observation to handle in prompt iteration, not a structural concern here.

---

## 8. Effort estimate

**~0.75–1.5 days** for a single executor:
- Schema + helpers in `@swoop/common`: 30m
- `_handler-runtime.ts` accessor + envelope shim: 60m
- `ToolHandlerDeps` extension + plumbing in `tools/index.ts`: 30m
- Data primitive `excludeIds` extension across 5 primitives: 60m (mechanical)
- Six tool body edits (lookup, find_proof, find_inspiring, find_someone_who, illustrate, find_options): 120m
- Orchestrator-side `invokeTool` plumbing + session-store wiring: 90m (the riskiest step — ADK session-id-on-execute-callback shape needs confirming inline)
- Tests across the workspace (unit + integration): 120m
- End-to-end smoke + docs + decisions log: 60m

**Where the time-risk hides**: step 6 (orchestrator-side plumbing). The exact shape ADK exposes for "session id of the current invocation" inside a `FunctionTool.execute` callback is not pinned by this plan. If ADK requires explicit `InvocationContext` threading, that's a small additional plumbing pass. The B.t11 plan (server-side session history projection endpoint) ratified similar plumbing for `sessionService`; this plan is the second consumer of that pattern.

---

## 9. Open items at execution

These don't block the plan but the executor should resolve them inline:

1. **ADK session-id-on-execute-callback shape**: confirm via the [@google/adk InvocationContext](../product/orchestrator/node_modules/@google/adk) types that a `FunctionTool.execute` body can read the current invocation's session id. If not, the orchestrator-side wiring layers a thin closure around each tool that captures session id at invocation entry. Either works; one's cheaper to wire.
2. **`__seenItems` field validation**: the eight tool input schemas in `@swoop/common` are `z.object().strict()` (or close to it). They'll reject an unknown `__seenItems` field. The handler runtime's `inputSchema.safeParse` happens AFTER `__seenItems` is extracted from `rawInput` and stripped, so this is a question of execution order in `_handler-runtime.ts` — strip-then-parse. Confirm by reading the [_handler-runtime.ts implementation](../product/connector/src/tools/_handler-runtime.ts) at execution time.
3. **Migration coordination with B.t11 (server-side session history projection endpoint) and B.22 (post-M4 Postgres-backed ADK session store)**: B.t11's migration `010` placeholder is no-op. This plan adds no migration (state is in-memory ADK today or post-M4 Postgres-via-B.22). When B.22 lands, `seenItems` rides through with no further plan needed — the `SessionState` schema is the source of truth and the Postgres adapter persists the whole shape.
4. **Observability surface**: should there be a `tool.invoked` event payload field for "excluded N ids on this call"? Argues for visibility — operators can see whether anti-repetition is firing. Trivial addition; recommend yes. Field name: `excludedCount: number` on the tool.invoked event payload for tools that consult `seenItems`. Confirm during execution by checking the F-a event schema in `@swoop/common`.
5. **Test isolation**: integration tests should run with a fresh session id per test to avoid cross-test seen-set bleed. Standard `randomUUID()` per test does it.

---

## 10. Coordination with the existing `C.focused-shamir-5` agent-supplied exclude affordance

The agent-supplied `exclude: Array<{type, id}>` parameter on `find_options` ([C.focused-shamir-5 — agent-supplied exclude list on find_options primitives](03-exec-crosscut-find-options-v2-backfill.md)) is preserved verbatim. After this plan, its behaviour is:

- **For trip and tour**: identical to today. Agent-supplied excludes are honoured. Auto-injection does not apply (no `seenItems.trip` / `seenItems.tour` keys).
- **For hotel and region_base**: agent-supplied excludes union into the auto-injected `seenItems.hotel` / `seenItems.region_base` set. The final `excludeIds` passed to the primitive is the union.

Sonnet doesn't need to know that auto-injection is happening underneath. Its tool-description for `find_options.exclude` ([cms/prompts/tools/find_options/description.md](../product/cms/prompts/tools/find_options/description.md)) doesn't change. If, after live observation, the agent's use of `exclude` becomes redundant (because auto-injection covers the use case), we can simplify by deprecating the field — but that's a future call, not part of this plan.

---

## 2026-05-27 HITL ratification

Open questions Q1–Q9 in §6 resolved per Alastair's HITL session 2026-05-27. Status flipped from DRAFT to ready-for-execution.

### Resolutions

1. **Q1 — Session id threading**: orchestrator adds exclusions dynamically at call time. The connector stays stateless. Exclusions ride as **regular tool-call arguments** (the existing per-primitive `excludeIds` shape), not as a hidden `__seenItems` / `__newlySeen` envelope convention.
2. **Q2 — Session-state accessor location**: resolved by Q1 — lives orchestrator-side in ADK session state. There is no connector-side accessor.
3. **Q3 — Existing `excludeIds` machinery**: keep it, and make it the foundation. The per-primitive `excludeIds` parameter from [03-exec-crosscut-find-options-v2-backfill.md §2.5.b — agent-supplied exclude list (C.focused-shamir-5)](03-exec-crosscut-find-options-v2-backfill.md) generalises to every dedup-eligible tool; the orchestrator becomes the sole producer of those exclude lists; the agent's lever (where it still applies) unions in additively.
4. **Q4 — Turn-scoped vs whole-session**: whole-session. Once shown, never shown again in the same session.
5. **Q5 — Image dedup key**: **canonical_url**, not `image.id`. The rule is "never show the same picture twice." Same principle applies to web page references — dedup by canonical URL.
6. **Q6 — Embedded images mark shown too**: yes. If an `inspire_passage` or other parent row carries an `image_id` / `canonical_url`, the image is marked shown alongside the parent.
7. **Q7 — Where primitives get the seen-set**: orchestrator passes them in as normal tool-call arguments. Primitives stay pure data functions.
8. **Q8 — Reset / show-all surface**: none for now. No reset surface — for the agent or otherwise. Future addition only if a real operational need surfaces.
9. **Q9 — Pool exhausted**: returns empty array. Agent handles the empty case gracefully in prose. No special wire-level indicator.

### Notes for the executing agent

The plan's implementation shape simplifies significantly from the DRAFT:

- **Orchestrator owns the seen sets** keyed by canonical URL (for images and any URL-bearing types — blog_post when it lands, etc.) or by natural id (uuid for `inspire_passage` / `customer_story` / `trust_proof` / `inform_chunk`; integer for `hotel` / `region_base`; future `customer_tip` per the parallel customer_tips plan).
- **No new connector-side state machinery.** Drop the `__seenItems` / `__newlySeen` envelope convention. Drop the `_handler-runtime.ts` accessor proposal. Drop the `deps.seenItems.get/markShown` API. The connector handlers continue to receive validated tool inputs (now including `excludeIds`-like fields) and return validated tool outputs; nothing more.
- **Wire layer**: the existing per-primitive `excludeIds` mechanism extends across every dedup-eligible tool. For URL-bearing types (images, future blog_post), the parameter shape is `excludeCanonicalUrls?: string[]` (or equivalent — match the column name on the underlying table at execution time). For id-bearing types, `excludeIds` keeps its current shape per primitive.
- **Orchestrator-side plumbing** (§2.7): on each tool dispatch, orchestrator reads `SessionState.seenItems`, computes per-type exclude arrays, merges with any agent-supplied `find_options.exclude` lever, injects into the tool-call arguments. On result, orchestrator reads the returned row ids / canonical URLs out of the structured result and merges into `SessionState.seenItems`. The connector returns whatever it would have returned anyway.
- **Schema (§2.1)**: `SeenItemsSchema` shape adjusts — the `image` (and future `blog_post`) per-type set is canonical URLs (strings), not stringified integer ids. Keep the deliberate absence of `trip` and `tour` keys.
- **No reset surface anywhere.** No `tool.invoked` `excludedCount` field is required by HITL, though it remains a "nice to have" observability addition the executing agent may choose to include (per §9 item 4).
- **Pool exhausted**: handler returns `{ <plural>: [], count: 0 }`. Agent prose handles the moment. Add a tiny note to the harness scenarios that this is the expected behaviour for a small corpus pushed past its capacity.

The architectural elaboration in §2.2 (Option A / Option B / payload-vs-callback debate) is **historical context** — superseded by Q1's resolution. Leave it in the document as a record of the design exploration; the addendum is the authoritative answer.

### Plan is READY FOR EXECUTION

Schema updates (§2.1), data-primitive extensions (§2.4), per-tool handler edits (§2.3), orchestrator-side `invokeTool` plumbing (§2.7), helpers in `@swoop/common` (§2.8), tests (§2.9), and decision-log entries (§2.10) all stand — read each through the lens of the addendum's simplified wire shape. Where §2.2 describes the `__seenItems` envelope convention, the executing agent skips that machinery entirely and uses the existing `excludeIds` argument shape generalised across every dedup-eligible primitive.
