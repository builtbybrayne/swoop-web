# 03 — Execution: C.t4 Tool implementations (eight handlers + data primitives)

**Status**: **HITL-ratified 2026-05-01 — ready for execution.**
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §2.2 (tool surface) + §2.3 (no-composer handler pattern) + §2.4 (data primitives) + §10 — the **C.t4** task. Operationalises decisions C.13, C.18, C.24, C.25, C.26, C.30, C.30b, C.34.
**Depends on**: **C.t1 closed** (connector service skeleton + Postgres pool + MCP HTTP transport boot path); **C.t2 closed** (entity model + tool I/O Zod schemas + production-quality `description.md` for every intent-named tool — already shipped 2026-04-30); **C.t3 closed** (domain tables populated from the SQL dump + blog snapshot in `puma_dev`); **C.t3a closed** (embedding pass + Haiku ETL classifiers populate the five derived tables and write `embedding` / `tsv` / `content_hash` / `persona_summary` / `persona_embedding` columns end-to-end); E.t2/E.t3 already shipped (`submitHandoff()` is the wired side-effect under `handoff_submit`).
**Blocks**: **B.t3a** (orchestrator's connector adapter rewrite — registers the eight intent-named tools against the new wire surface and drops `Search*` / `GetDetail*`); **D.t9** (chat-surface widget rewrite — renders the five new `*PublicSchema` outputs). These are *downstream consumers*; this plan only mentions them as the next dominoes.
**Produces**:
- A per-tool handler at `product/connector/src/tools/<tool>.ts` for each of the eight tools — `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`, `illustrate`, `handoff`, `handoff_submit`.
- A data-primitive layer at `product/connector/src/data/<primitive>.ts` — the SQL + vector helpers each handler composes over.
- A small bootstrap module at `product/connector/src/tools/index.ts` that registers every handler with the connector's MCP server, **loading each tool's rich description from `cms/prompts/tools/<tool>/description.md` per C.34**.
- Per-tool integration tests at `product/connector/src/tools/__tests__/<tool>.int.test.ts` against a populated `puma_dev` (or a per-test ephemeral Postgres if local convention prefers that).
- A small handful of decision-log entries in `planning/decisions.md` for any C.t4-emergent calls (likely candidates: `ef_search` runtime knob, RRF constant, MCP-tool description-load failure mode).
- An execution log appended to this Tier 3 plan summarising what landed.
**Estimate**: ~2 days of focused work, in two halves — day 1 lands the data primitives + the four content tools (`find_inspiring` / `find_someone_who` / `find_proof` / `lookup`) end-to-end against `puma_dev`; day 2 lands `find_options` (TripCard internals are still settling per C.t2 §"Out of scope"), `illustrate` (placeholder hookup if C.t6 hasn't populated the image annotations), and the `handoff` / `handoff_submit` pair (the latter is mostly a thin wrapper over the already-shipped `submitHandoff()`). Plus integration tests + the description-load wiring.

---

## ★ Read this first — calibration before you touch a handler

> Before writing a line of handler code, **re-read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) "★ Read this first — the WHY of chunk C" end-to-end.** Then re-read [`03-exec-c-t2.md`](03-exec-c-t2.md) "★ Read this first" (its compressed reminder for contract authoring). The same discipline applies to handler authoring — perhaps even more so, because at this layer the temptation to think bottom-up is highest. Your hands will be on SQL strings; the database tables will feel like the universe.

C.t4 is the moment where a Claude session is most likely to slip into bottom-up reasoning, because it implements the place where SQL meets the agent. The trap looks like this:

> *"`find_inspiring` queries `inspire_passage`. So the handler runs a hybrid-search SQL against that table, optionally filters by region, sorts by RRF score, returns the top N rows. Done."*

That's correct mechanically. It's also wrong as a starting point. Each handler is **a conversational move encoded as a SQL plan**. The starting point is the journey moment, not the table.

Before authoring each handler, write a one-paragraph "why this tool exists in the conversation" in your own words. Reference the tool's `cms/prompts/tools/<tool>/description.md` and the four+1 jobs framing in the chunk-C ★ section. Only then look at the migrations to see which tables back the tool. If you find yourself saying *"the data lets us also expose X"* — stop. C.t2 settled the surface; C.t4 implements it; **don't add fields, don't add filters, don't expand inputs**. If C.t2's contract feels insufficient, that's a signal to revisit C.t2 *with Al present*, not to bolt on widening at C.t4.

The other temptation worth pre-empting: **don't introduce a composer.** C.24 removed them deliberately. If you find yourself wanting an internal Haiku call inside a handler "to make the output feel right" — stop. That's the bottom-up trap returning. Sonnet at the orchestrator does the synthesis; the handler returns concrete row-shaped output. One LLM call per turn. Period.

---

## Outcomes

When this task is done:

- The connector service (post-C.t1) advertises **all eight intent-named tools** over MCP-HTTP. The orchestrator's tool discovery surfaces them with their full markdown descriptions loaded from `cms/prompts/tools/<tool>/description.md` (per C.34).
- A Sonnet turn over the live agent can route into any of the five conversational tools (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`), receive a Zod-validated, row-shaped response, and weave it into `<utter>`. Verified end-to-end on a populated `puma_dev` (smoke test § below).
- Each tool's handler runs as a **thin orchestration over data primitives** — input validation → 1–N primitive calls → output assembly → output validation → return. No composer code anywhere. No LLM in the request path beyond the orchestrator's Sonnet.
- The data-primitive layer is **the connector's actual brain** — typed SQL + vector helpers under `product/connector/src/data/`. Each primitive is a function over the Postgres pool returning Zod-parsed rows. Reusable across tools (e.g. `findInspirePassageByEmbedding` lives once; `find_inspiring` and `illustrate` may both consume it under different filters).
- `handoff` is a passthrough that returns `{ status: 'widget_triggered', widgetToken }` — opening the lead-capture widget over the assistant-ui tool-call lifecycle. **No durable side-effect at this surface** (decision E.13 — submission is a separate HTTP route).
- `handoff_submit` is a **thin wrapper over the already-shipped `submitHandoff()` from `@swoop/connector/src/handoff/submit.ts`**. The MCP tool boundary exists for completeness (Sonnet shouldn't ever invoke it; the widget POSTs to `/handoff/submit` directly per E.13), but the wire surface ships so future surface-area changes are additive rather than schema-breaking. See §"`handoff_submit` boundary" below.
- `illustrate` returns image sets matched against keywords + optional region, **with a graceful degradation path for the period before C.t6 has populated full annotation coverage**: handler returns whatever's available + a flag the widget can read; deferring full visual coverage to the post-C.t6 catalogue run is acceptable for M1.
- All handlers emit an `tool.invoked` observability event per F-a (existing surface) with the tool name, input shape, output count, and elapsed-ms. No PII leaks (visitor inputs are `concern` / `signal` / `question` strings, treat as public; no contact details flow through these handlers — those go through the separate `/handoff/submit` HTTP route).
- The connector workspace's test count grows by ~10–15 integration tests; the existing 46 pass unchanged. `npm test --workspace @swoop/connector` is green.
- Errors are handled uniformly with a single shared helper (see §"Error handling" — pre-empts the 8x repeated try/catch anti-pattern flagged in the 2026-04-30 review's H4).

**Not outcomes**:
- **B.t3a** — orchestrator's connector adapter rewrite. Owned by chunk B; gated on this task closing.
- **D.t9** — widget rewrite. Owned by chunk D; gated on this task closing.
- **C.t6** — image annotation pipeline. Owned by C.t6; this task degrades gracefully if C.t6 hasn't run yet.
- **Connector deploy infrastructure** — Cloud Run wiring belongs to C.t8 / M4. This task ships the in-process workspace dep + the MCP-HTTP boot path; production deploy is downstream.
- **Tool description voice refinement** — already shipped at C.t2 ("production first-pass"); this task only *loads* the markdown, never *edits* it.

---

## Out of scope (name it so future agents don't drift)

- No `src/composers/` directory. No internal Haiku LLM calls inside any handler. C.24 is load-bearing.
- No new tool I/O Zod schemas. C.t2 settled the surface; if a field feels missing, that's an HITL conversation, not a handler-time addition.
- No new domain or derived tables. C.t2 owns migrations; if a query needs a column that isn't there, **stop and re-anchor** — likely the wrong query.
- No `Search*` / `GetDetail*` removal. They're still imported by the orchestrator until B.t3a; this task lives within the same `tools.ts` deprecation contract.
- No widget rendering work. D.t9 picks up the new `*PublicSchema` outputs.
- No SMTP wiring. `handoff_submit` reuses the already-wired `submitHandoff()` (E.t2/E.t3); the mailer flip-on is a Julie-blocked ops decision unrelated to this task.
- No `find_options` deepening beyond the published `TripCardPublicSchema` surface. Trip-side internals are still settling (per C.t2 §"Out of scope" — *"leave the trip side alone until trips ingestion is genuinely understood"*); this handler ships against whatever `trip_card` rows C.t3a populates and treats their column set as the source of truth.

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — especially §2.2 (tool surface), §2.3 (no-composer pattern), §2.4 (data primitives — the canonical primitive list).
- [`03-exec-c-t2.md`](03-exec-c-t2.md) — the contract C.t4 implements. Read the schema sketches for `inspire_passage` / `customer_story` / `trust_proof` / `inform_chunk` / `trip_card` and the `*PublicSchema` projections — those are the row shapes your primitives produce and your handlers wrap.
- `product/ts-common/src/tools.ts` + `derived.ts` — the I/O contract. Don't edit; consume.
- `product/cms/prompts/tools/<tool>/description.md` — for each of the five intent-named tools. These are **production-quality first-pass** prose (per C.t2 closure); the handler-loader reads them at boot.
- `product/connector/migrations/001_extensions.sql` → `006_customerreview_tables.sql` — the schema your SQL queries run against. Especially migration `004_indexes.sql` for what's actually indexed (HNSW on every `embedding` column with `vector_cosine_ops` and package defaults `m=16, ef_construction=64`; GIN on every `tsv`; pg_trgm GIN on the location-name columns; B-tree on the obvious query keys).
- `product/connector/src/handoff/submit.ts` — the existing `submitHandoff()` your `handoff_submit` tool wraps.
- `product/connector/src/handoff/store.ts` + `mailer.ts` + `template-renderer.ts` — read for context only; they're already wired.
- `product/orchestrator/test-fixtures/stub-connector.ts` — the current stub that this task replaces in production. Read once for shape; don't carry it forward.
- [`decisions.md`](decisions.md) — C.13 (golden thread), C.18 (Voyage-3 / 1024d / pgvector HNSW), C.24 (no composer), C.25 (eight tools), C.26 (find_someone_who live), C.30 (persona-summary natural-language shape — the Mirror tool's matching mechanism), C.30b (image_id is FK; public projection wraps the joined image record), C.34 (markdown owns prose; runtime loads it).
- [`gotchas.md`](../gotchas.md) — Postgres connection (puma_dev URL), `dotenv({ override: true })` for env keys, the connector workspace's `zod` cross-package gotcha (cast-once-at-boundary discipline still applies).
- [`progress.md`](progress.md) §"C.t2 contract layer + C.26 graduation" + the per-workspace test counts to know the baseline.

---

## Architectural principles

These are the load-bearing rules. If a design choice violates one of them, it's almost certainly wrong.

1. **Top-down from the conversation.** Each handler exists because it serves a moment in the visitor's journey. The data shapes serve the conversation, not the other way around. Re-read the calibration callout above before authoring any handler. Write the journey-moment paragraph first.
2. **Thin handlers, brain-in-the-primitives.** A handler is ~30–80 lines. Input validation → 1–N primitive calls → output assembly → output validation → return. Anything more than that is a smell — usually a primitive trying to escape into the handler.
3. **Reusable primitives.** A primitive is a single typed SQL/vector function returning Zod-parsed rows. Multiple handlers may compose the same primitive under different filters. The primitive layer is what survives the next architectural shift; handlers are dispensable scaffolding above it.
4. **No LLM in the request path.** Sonnet at the orchestrator is the *only* request-path LLM. Composers are out (C.24); inline Haiku calls are out; the temptation to "make the output nicer" is the bottom-up trap returning.
5. **Markdown owns prose; runtime loads it.** Tool descriptions live in `cms/prompts/tools/<tool>/description.md`; the handler-registration boot path reads them at startup and caches the result. The `TOOL_DESCRIPTIONS` map in `tools.ts` is *runtime-label-only* — never the surface Sonnet sees in production. Per C.34.
6. **Embeddings stay server-side.** The `embedding` / `persona_embedding` / `tsv` / `content_hash` / `source_provenance` columns never appear in any tool I/O. The `*PublicSchema` projections are how this is enforced; the primitives are how it's authored.
7. **One canonical error helper, not eight try/catches.** A single shared utility (see §"Error handling") wraps the handler-body fragment, surfaces typed errors, emits the F-a observability event, and returns the wire shape. Pre-empts the 4x → 8x repetition the 2026-04-30 code review flagged as H4.
8. **Forward-only data assumptions.** Handlers assume the migrations are at HEAD and the derived tables are populated. They do *not* gracefully degrade when an embedding column is null (that's a C.t3a integrity issue, not a handler concern). Exception: `illustrate` does degrade gracefully against incomplete C.t6 annotation coverage — see §"`illustrate` and the C.t6 dependency".
9. **Voyage-3 / 1024d everywhere.** Embedding vectors are always 1024-dimensional cosine-distance HNSW. The handler never knows the dimensionality directly — it just calls `embedTextForSearch(visitor_input)` from a shared helper that wraps the Voyage call. Pinning the dimensionality lives in C.t1's pool config, not in handler code. Per C.18.
10. **`puma_dev` is the integration test surface.** Per-tool integration tests run against the live local Postgres, not mocks. Mocks at the unit level are fine for isolated primitive shape; the handler-level tests need real SQL plans. Per discoveries.md note that data tools are exactly the surface mocks fail to validate.

---

## Components, file paths, and signatures (sketch — not executable code)

### `product/connector/src/data/` — the data primitive layer

One file per primitive. Each function takes typed inputs and returns Zod-parsed rows. Pool dependency injected via the connector's already-shipped DB module (lands in C.t1).

Recommended primitive set, mirroring §2.4 of the Tier 2 plan:

| File | Purpose | Backs |
|---|---|---|
| `data/hybrid-search.ts` | Generic RRF (Reciprocal Rank Fusion) helper combining pgvector + tsvector ranks. Single implementation; specialised by table. | Multiple (the four content tools all hit it) |
| `data/find-inspire-passages.ts` | `findInspirePassagesByText(text, { region?, mood?, limit })` → `InspirePassage[]` via hybrid retrieval over `inspire_passage`. Joins through `image_id` to assemble the `DerivedImage` companion record per C.30b. | `find_inspiring` + (light reuse from `illustrate`'s region path) |
| `data/find-customer-stories.ts` | `findCustomerStoriesByPersonaSignal(signal, { region?, limit })` → `CustomerStory[]` via cosine similarity on `persona_embedding` (Mirror's only retrieval mechanism per C.30 — *not* hybrid; persona-shaped, not topic-shaped). | `find_someone_who` |
| `data/find-trust-proofs.ts` | `findTrustProofsByConcern(concern, { topic?, limit })` → `TrustProof[]` via hybrid retrieval over `trust_proof`. Topic filter is a B-tree narrowing pre-RRF. | `find_proof` |
| `data/find-inform-chunks.ts` | `findInformChunksByQuestion(question, { limit })` → `InformChunk[]` via hybrid retrieval over `inform_chunk`. | `lookup` |
| `data/query-trips.ts` | `queryTripCardsByFilter({ region?, durationMin?, durationMax?, budgetBand?, activity?, accommodationStyle?, limit })` → `TripCard[]` via SQL filter over `trip_card`. **No vector retrieval here — structured filter only.** | `find_options` |
| `data/resolve-image.ts` | `resolveImageById(id)` → `DerivedImage` (the joined imagery record). Used to assemble the public projection's `image` field per C.30b. | All five content tools (each row that has a non-null `image_id` resolves through here at projection time) |
| `data/find-images-by-keywords.ts` | `findImagesByKeywords(keywords[], { regionSlug?, limit })` → `image[]` via hybrid (pgvector on `image.embedding` + GIN on `image.subject_tags` / `image.region_tags` / `image.mood_tags`). | `illustrate` |
| `data/find-tags-by-utterance.ts` *(optional this pass)* | `findTagsByUtterance(utterance, { limit })` → `tag[]` via cosine over the 79-row embedded `ntag` taxonomy. Useful inside `find_inspiring` and `find_proof` when the input is too vague to query content directly; defer until the simpler hybrid path proves insufficient. | Internal, not advertised. Skip unless a handler genuinely needs it. |
| `data/embed-query.ts` | `embedTextForSearch(text)` → `number[]` (length 1024) — Voyage-3 single-text embedding call. Caches identical inputs in-process for the connector lifetime (cheap; visitor utterances repeat within a session). | All vector retrieval |

Each primitive enforces:
- **Input validation** at the boundary (Zod parse).
- **SQL parameterisation** — never string-interpolate visitor input into SQL. `pg`-driver `$1`-style throughout.
- **Output validation** — every row run through the `*Schema` (full, not public) before returning.
- **Single SQL call where possible.** Hybrid retrieval should ideally be a CTE-based single query (`WITH vec_ranked AS (… ORDER BY embedding <=> $1 LIMIT 50), text_ranked AS (… ORDER BY ts_rank(...) LIMIT 50) SELECT … FROM rrf(vec_ranked, text_ranked) LIMIT $limit`). Two roundtrips (one for vector, one for text) is fine if cleaner; revisit only if latency budget pinches.

### `product/connector/src/tools/` — the eight handlers

One file per tool. Each exports a single `handle<ToolName>(input: <InputType>, deps: HandlerDeps): Promise<<OutputType>>` function. `HandlerDeps` is a typed bag: `{ pool, embedQueryFn, observability }` etc. — injected at registration time so unit tests can swap.

**The eight files:**

| File | Sketch (≤80 lines target) |
|---|---|
| `tools/find_inspiring.ts` | (1) Validate `FindInspiringInputSchema`. (2) Call `findInspirePassagesByText(query, { region, mood, limit })`. (3) For each row with a non-null `image_id`, hydrate `DerivedImage` via `resolveImageById`. (4) Project to `InspirePassagePublicSchema`. (5) Return `{ passages, count }`. |
| `tools/find_someone_who.ts` | (1) Validate `FindSomeoneWhoInputSchema`. (2) Call `findCustomerStoriesByPersonaSignal(signal, { region, limit })` — single primitive, persona-shaped match per C.30. (3) Resolve images. (4) Project to `CustomerStoryPublicSchema`. (5) Return `{ stories, count }`. |
| `tools/find_proof.ts` | (1) Validate `FindProofInputSchema`. (2) Call `findTrustProofsByConcern(concern, { topic, limit })`. (3) Project to `TrustProofPublicSchema` (no image companion — Reassure rows don't carry imagery in C.t2's contract). (4) Return `{ proofs, count }`. |
| `tools/lookup.ts` | (1) Validate `LookupInputSchema`. (2) Call `findInformChunksByQuestion(question, { limit })`. (3) Project to `InformChunkPublicSchema`. (4) Return `{ chunks, count }`. |
| `tools/find_options.ts` | (1) Validate `FindOptionsInputSchema`. (2) Call `queryTripCardsByFilter({ ...filters, limit })` — pure SQL, no vector retrieval. (3) Hydrate `DerivedImage` via `resolveImageById`. (4) Project to `TripCardPublicSchema`. (5) Return `{ cards, count }`. **TripCard internals are still settling per C.t2's "Out of scope" — this handler reads whatever `trip_card` columns C.t3a populated; no defensive fallback for missing data, just typed-failure if a row doesn't pass the schema.** |
| `tools/illustrate.ts` | (1) Validate `IllustrateInputSchema`. (2) Call `findImagesByKeywords(keywords, { regionSlug, limit: count ?? 4 })`. (3) Map to `IllustrateOutputSchema`. (4) Return. **Graceful degradation against incomplete C.t6 coverage** — see §"`illustrate` and the C.t6 dependency". |
| `tools/handoff.ts` | (1) Validate `HandoffInputSchema`. (2) Generate a `widgetToken` (`crypto.randomUUID()`). (3) Return `{ status: 'widget_triggered', widgetToken }`. **No durable side-effect.** The widget consumes the token + the input args via the assistant-ui tool-call lifecycle; submission is a separate HTTP route per E.13. |
| `tools/handoff_submit.ts` | (1) Validate `HandoffSubmitInputSchema`. (2) **Thin wrapper** — call `submitHandoff()` from `@swoop/connector/src/handoff/submit.ts`. (3) Map the result to `HandoffSubmitOutputSchema`. **See §"`handoff_submit` boundary" — Sonnet should not invoke this; the widget POSTs to `/handoff/submit` directly. The MCP surface exists for symmetry/future-proofing.** |

### `product/connector/src/tools/index.ts` — registration boot path

Single module that:
1. **Reads each tool's `cms/prompts/tools/<tool>/description.md` once at startup** — paths resolved via the connector's CMS-root config (mirrors B.t1a's `SYSTEM_PROMPT_DIR` pattern; new env key `CMS_ROOT` or similar lands in C.t1's config schema). Caches the contents in-process for the connector lifetime. **Fails fast on missing description.md** for any of the five intent-named tools — one of those files missing means the contract Sonnet was authored against is drifting from runtime, and silent degradation is the worst possible outcome.
2. **Loads `illustrate` / `handoff` / `handoff_submit` description.md files if present**; falls back to the short `TOOL_DESCRIPTIONS` runtime label if not (these three are utility-shaped and were already advertised by the PoC; degradation is acceptable here, unlike the five content tools).
3. **Registers each handler** with the connector's MCP server (the registration shim lands in C.t1) — passes the rich loaded markdown as the description string, the input/output Zod schemas, and the handler function.
4. **Wires the shared `HandlerDeps`** (pool, `embedTextForSearch`, observability sink) once and partial-applies it into each handler before registration.

### Tool description load contract — clarifying C.34

Per decision C.34, prose lives in markdown; the runtime loads it. Three load-time questions land here:

| Question | This task's answer |
|---|---|
| **Cache or re-read per call?** | **Cache at startup**. Tool descriptions are static within a process lifetime; re-reading on every tool call is unnecessary I/O. Hot-reload (`NODE_ENV !== 'production'`) gets the same `withFileTypes` + lexicographic sort treatment as B.t1a's `prompt-loader.ts`, so authors editing markdown locally see changes after the next connector restart. **Pull-through cache is overkill.** |
| **Failure mode when a description.md is missing?** | **Fail-fast at boot for the five intent-named tools** (`find_inspiring` / `find_someone_who` / `find_proof` / `lookup` / `find_options`); these are contract surfaces. **Fall back to short runtime labels for `illustrate` / `handoff` / `handoff_submit`** (utilities; PoC-style minimal descriptions are sufficient). |
| **Is the loader generic across `cms/prompts/{system,skills,tools}/`?** | **No** — different load contracts per subdirectory (per G.11). System prompts concatenate; skills are ADK directories; tools are a flat one-file-per-tool read. This task ships its own `tools/<tool>/description.md` reader; doesn't piggyback on the system-prompt loader. |

### Error handling — the shared helper (pre-empts H4)

The 2026-04-30 code-level review flagged H4 — *"4× repeated try/catch in tool handlers; will become 8× when the new surface lands"*. Pre-empt that here.

A single shared utility at `product/connector/src/tools/_handler-runtime.ts` (or `@swoop/common/streaming` if H4's `parseToolResult` cross-cut helper has landed by C.t4 execution time — **check `planning/03-exec-crosscut-common-helpers-fix.md` before authoring**). Shape:

```text
runHandler<I, O>(
  toolName: string,
  inputSchema: ZodSchema<I>,
  outputSchema: ZodSchema<O>,
  body: (input: I, deps: HandlerDeps) => Promise<O>,
): MCPHandler
```

Behaviour:
- Validates input against `inputSchema`. On failure → typed `tool_input_invalid` envelope.
- Times `body()` and emits `tool.invoked` event (F-a) with `{ tool_name, input_shape, output_count, elapsed_ms, ok: true }`.
- On thrown error inside `body()` → emits `{ ok: false, error_kind }` event, maps to the `{ ok: false, reason }` envelope MCP expects (matching the existing `safeParse()` envelope unwrapper in `widget-shell.tsx` per the 2026-04-24 discovery).
- Validates output against `outputSchema`. On failure → typed `tool_output_invalid` envelope (this is a Should Never Happen — primitives validate already — but defence-in-depth is cheap).

Each of the eight handlers is a one-liner: `export default runHandler('find_inspiring', FindInspiringInputSchema, FindInspiringOutputSchema, findInspiringBody)`. Eight try/catches collapse to one helper.

**If H4's cross-cut helper has already landed in `@swoop/common`**, this task uses it directly — no parallel implementation. If it hasn't, this task ships a connector-local version with a TODO pointing back to the cross-cut for future consolidation.

### `handoff_submit` boundary — clarifying the wrapper layer

Decision E.13 (2026-04-28) settled that **the widget submits via a discrete HTTP route (`POST /handoff/submit`)**, not via an MCP tool call. So why ship a `handoff_submit` MCP tool at all?

Three reasons it stays in the surface:

1. **Symmetry with the eight-tool advertised contract** — every tool the orchestrator's tool-call lifecycle references has a corresponding MCP registration. Stripping `handoff_submit` from MCP means the assistant-ui's tool-result registry no longer has a registered shape to validate the success-marker against.
2. **Future-proofing for an MCP-fronted submission path** — if the widget ever needs to flow through MCP rather than a discrete HTTP call (e.g. a future hosted-MCP architecture where the widget runs in a sandbox without HTTP-fetch privileges), the schema and handler are already in place.
3. **The handler is genuinely thin** — three lines of code wrapping `submitHandoff()`. The cost of having it is essentially zero.

**What this means for C.t4:** ship the handler as a thin wrapper. Document explicitly (in code comment + this plan) that **Sonnet should not invoke `handoff_submit`** — the widget owns the submission path. The MCP registration carries the description string `"Internal: called by the lead-capture widget when the visitor submits contact details + tier-2 consent. Not invoked by the model directly."` (already in `TOOL_DESCRIPTIONS` per C.t2; no `cms/prompts/tools/handoff_submit/description.md` needed since it's not a Sonnet-facing tool).

If the registration test reveals Sonnet *does* try to invoke it, we add a CLAUDE-side gate at orchestrator-side tool-filtering — out of scope for this task; downstream of B.t3a if it manifests.

### `illustrate` and the C.t6 dependency

C.t6 (image annotation pipeline) populates `image.embedding`, `image.subject_tags`, `image.mood_tags`, `image.region_tags`, and `image.description` for the ~6.3K images that don't already have an `image.description` upstream (per the 2026-04-29 discovery — 47.5% of images already carry source-side descriptions, cutting C.t6's actual workload in half).

C.t4 should be implementable **before C.t6 completes its full-catalogue run**. Strategy:

- **Handler ships against whatever's annotated.** `findImagesByKeywords()` runs the hybrid retrieval over `image.embedding` + GIN-on-tag-arrays. Where annotation is absent, those rows simply don't match keyword embeddings and won't surface. No defensive fallback in the handler; the data layer is the source of truth.
- **Pre-M1 starter sample** — per the Tier 2 plan §2.7, ~50 representative images get annotated pre-M1 to power the vertical slice's `illustrate` responses. C.t4 verifies against that starter sample (smoke test: `illustrate({ keywords: ['torres del paine'] })` returns ≥1 image).
- **Full-catalogue run is a C.t6 milestone** — when C.t6 completes, `illustrate` quality silently improves with no handler changes.

If C.t6 hasn't run *at all* by C.t4 execution time (no annotations, no embeddings on `image`), the handler still ships and integration tests skip with a clear `xtest` marker. Don't gate C.t4 closure on C.t6.

---

## Verification

Task is done when:

1. `cd product && npm run typecheck` is green across the workspace.
2. `cd product && npm run lint` is green (pre-existing 34-problem baseline noted in C.t2 closure tolerated; this task adds zero new lint problems).
3. `cd product && npm test --workspace @swoop/connector` is green — the 46 existing tests pass, plus ~10–15 new integration tests for the eight handlers.
4. **Per-tool integration test** against a populated `puma_dev` (preconditions: C.t3 + C.t3a have run): each of the five conversational tools returns Zod-valid output for a representative input. Specifically:
    - `find_inspiring({ query: "torres del paine in autumn" })` returns ≥1 InspirePassagePublic.
    - `find_someone_who({ signal: "solo female traveller in her 40s" })` returns ≥1 CustomerStoryPublic.
    - `find_proof({ concern: "is Swoop legitimate?" })` returns ≥1 TrustProofPublic.
    - `lookup({ question: "how long is the W trek?" })` returns ≥1 InformChunkPublic.
    - `find_options({ region: "patagonia", durationMax: 10 })` returns ≥1 TripCardPublic (or `count: 0` with explanation if `trip_card` isn't populated yet — flag it, don't fail it).
    - `illustrate({ keywords: ["glacier"] })` returns ≥1 image (pre-M1 starter sample dependency — see §"`illustrate` and the C.t6 dependency").
    - `handoff({ verdict: "qualified", reasonCode: "x", conversationSummary: "y", motivationAnchor: "z" })` returns `{ status: "widget_triggered", widgetToken: <uuid> }`.
    - `handoff_submit(<valid payload>)` writes a record under `var/handoffs/` (verifying the `submitHandoff` wrap), returns `{ status: "accepted", handoffId: <uuid> }`.
5. **Description-load contract test**: connector boot loads each of the five conversational tools' `description.md` into the registered description string; **fails fast at boot** if any of those files is missing (test verifies the failure mode). `illustrate` / `handoff` / `handoff_submit` boot succeeds either way.
6. **End-to-end smoke test**: a real Sonnet turn through the orchestrator (`product/orchestrator`) selects one of the five intent-named tools given a representative visitor utterance ("Tell me about doing the W trek alone"), receives the connector's response, and weaves it into a final assistant message. **This is the load-bearing verification** — it's what makes the eight-tool surface "real" for downstream B.t3a / D.t9 work. Run manually against the dev orchestrator + connector via the existing mock-host harness; capture a screenshot or transcript fragment in the execution log.
7. Decision-log entries added in `planning/decisions.md` for any C.t4-emergent calls (likely candidates: `ef_search` runtime knob if not default; RRF constant `k=60` standard; description-load failure-mode codification per §"Tool description load contract"; `handoff_submit`-not-invokable-by-Sonnet codification).
8. Execution log section appended to this Tier 3 plan summarising what landed, what was deferred, what surfaced for downstream tasks (B.t3a + D.t9 specifically).

---

## Sub-step ordering (recommended sequence for a single execution agent)

1. **Read the inputs end-to-end.** Including the chunk-C ★ section. Especially the chunk-C ★ section.
2. **Confirm preconditions.** `puma_dev` is populated. Run a quick `\dt` + `SELECT count(*) FROM inspire_passage` etc. to sanity-check that C.t3 + C.t3a actually shipped before authoring against their output.
3. **Author the data primitive layer first.** Start with `embedTextForSearch` + `hybrid-search.ts` (the RRF helper) since every content tool depends on them. Then `find-inspire-passages.ts`. Test it standalone against `puma_dev` with a `node --eval`-style smoke. Only once that's proven correct, fan out to the other primitives.
4. **Author the shared `runHandler` helper** (or import the cross-cut helper if it's landed). This is the unit that prevents the 8x try/catch repetition. Get it right once.
5. **Author handlers in dependency order**: `find_inspiring` first (it exercises the most plumbing — text + region + image hydration + RRF). Then `lookup` (similar shape, simpler). Then `find_someone_who` (different retrieval — persona-only, no hybrid). Then `find_proof`. Then `find_options` (no vector retrieval; SQL filter only). Then `illustrate`. Then `handoff` (passthrough). Then `handoff_submit` (thin wrapper).
6. **Author the registration boot path** + the description-load contract. Wire it into C.t1's connector boot. Verify the fail-fast behaviour with a manual missing-file simulation.
7. **Write integration tests** per tool. Run against `puma_dev`. Iterate on SQL queries until each returns sensible results for the representative inputs in §Verification.
8. **End-to-end smoke** — boot orchestrator + connector, run a real Sonnet turn through the mock-host. Capture transcript.
9. **Land decisions** in `decisions.md` for any C.t4-emergent calls.
10. **Append the execution log** to this plan.
11. **Run typecheck + lint + workspace tests** from `product/`. All green before stopping.

---

## Open questions

(For HITL review — these are settled-as-recommendations but worth Al's eye before execution.)

### 1. `illustrate` — implementable in C.t4 with placeholders, or hard-blocked on C.t6?

**Recommendation**: implementable in C.t4 with whatever annotation coverage exists at execution time. Pre-M1 starter sample (~50 images) is enough for the integration test to pass. Full-catalogue annotation completes via C.t6 in parallel; quality silently improves post-C.6 with no handler changes.

**Open consideration**: should the handler emit a `coverage_warning` flag in the output when fewer than `count` results are returned? Argues for transparency; argues against as schema noise. **HITL ask**: leave the schema alone, log the gap as an observability event, surface on the F-a dashboard once it exists.

### 2. `handoff_submit` — keep as MCP tool, or strip entirely?

**Recommendation**: **keep**, per §"`handoff_submit` boundary" above. Three reasons (symmetry / future-proof / near-zero cost). Document that Sonnet should not invoke it; gate at orchestrator-side tool-filtering only if it manifests as a real misbehaviour.

**Open consideration**: an alternative is to register it under MCP but with a description that explicitly says *"DO NOT INVOKE — for widget callbacks only"* + an orchestrator-side filter that hides it from Sonnet's tool selection prompt. **HITL ask**: prefer the simpler path (keep + comment + observe) until/unless Sonnet misbehaves with it.

### 3. Description-load failure mode — fail-fast vs degrade-gracefully?

**Recommendation**: **fail-fast for the five conversational tools** (contract drift = silent quality regression — worst possible outcome); **degrade gracefully for the three utilities** (`illustrate`/`handoff`/`handoff_submit`). Per §"Tool description load contract".

**Open consideration**: should there be a startup banner in connector logs listing every loaded description path + first 60 chars? Argues for ops visibility (does the deployed connector have the description Al just edited?). Trivial cost. **HITL ask**: yes, log it once at boot.

### 4. RRF constant + `ef_search` — defaults or tuned?

**Recommendation**: **package defaults at C.t4** — RRF `k=60` (standard literature default), pgvector HNSW `ef_search` left at install default (`hnsw.ef_search = 40`). No tuning at this stage; visit at C.t8 / post-launch when real query volume reveals the latency/recall envelope.

**Open consideration**: should `ef_search` be set per-query via `SET LOCAL hnsw.ef_search = N` for tools that want recall over latency (`find_someone_who` argues for recall — small corpus, semantic match matters more than millis)? Defer to C.t8.

### 5. Per-handler observability — separate event kind per tool, or one shared `tool.invoked`?

**Recommendation**: **one shared `tool.invoked` event with `tool_name` discriminator**. F-a's existing schema already supports it; eight new event kinds is dilution.

### 6. `handoff` widgetToken lifecycle — store-side, or stateless?

**Recommendation**: **stateless for M1**. The widget echoes the token back via the assistant-ui tool-result lifecycle; no server-side validation needed because the submission path validates against session id + tier-1 consent regardless. Token is a debugging breadcrumb, not an auth surface.

**HITL ask**: confirm. Adding a server-side store would mean a small Redis/Postgres write per `handoff` call — cheap but unnecessary if the security model doesn't require it.

### 7. `find_options` — defensive against missing `trip_card` rows?

**Recommendation**: **no defence**. Per C.t2 §"Out of scope", trip-side internals are still settling. `trip_card` is whatever C.t3a populates; if C.t3a hasn't fully populated the column set yet, the handler returns empty rather than synthesising data. This is correct behaviour — don't paper over a data integrity problem in handler code.

**Open consideration**: should the integration test be `xtest`'d when `trip_card` is empty? Yes — flag the empty state, don't fail the suite.

---

## Risks

These are the things most likely to bite during execution. Pre-empt where possible; flag the rest for HITL.

### R1. Hybrid retrieval SQL is more nuanced than it looks
RRF over pgvector + tsvector is well-trodden but easy to get subtly wrong (rank ties, score normalisation, `LIMIT` interaction with subquery selection). The first cut may need iteration. **Mitigation**: start with the simplest possible SQL (CTE union all + RRF score in outer SELECT); compare results against a manual `<=>` query and a manual `ts_rank` query; only optimise once correctness is proven on `puma_dev`.

### R2. C.t3a's persona-summary prose may be too sparse for cosine matching to find good Mirror matches
Per the 2026-04-30 customerreview corpus shape discovery, ~80% of rows are short snippets. The Phase 1 inspection landed the by-reviewer aggregation strategy for C.t3a's persona generation; if that hasn't shipped (or shipped but produced thin summaries), `find_someone_who`'s integration test may produce results that "match" by embedding but feel off-the-mark. **Mitigation**: don't let this block C.t4 closure. The handler is correct against whatever C.t3a produced. If matching quality is poor, that's a C.t3a iteration, not a handler iteration.

### R3. `find_options` may have nothing to query against
Trip-side ingestion is the most-deferred surface in chunk C (C.t2 explicitly flags it). If `trip_card` is empty or sparse at C.t4 execution, the handler ships against the schema but the integration test is effectively xtest'd. **Mitigation**: ship + flag. Trip-side population is a separate concern; downstream consumers (B.t3a, D.t9, the eventual M1 demo) need the handler interface, even if the data is thin at first integration.

### R4. The `runHandler` helper / cross-cut H4 may collide
If `planning/03-exec-crosscut-common-helpers-fix.md` has landed an H4 helper between this plan's authoring and execution, the connector-local version will conflict. **Mitigation**: pre-authoring step in §"Sub-step ordering" item 4 — *check the cross-cut*. Always.

### R5. Description-load fail-fast could break dev workflows
If Al edits `description.md` in a way that empties a file (e.g. an in-progress save), connector boot fails until the file is fixed. Fail-fast is correct in production; might frustrate locally. **Mitigation**: `NODE_ENV !== 'production'` could downgrade fail-fast to warn-and-fall-back. **HITL ask**: probably not worth the complexity; one-character-empty saves are rare and the error is loud + obvious.

### R6. Sonnet may not pick the right tool from the markdown descriptions, even with C.t2's voice work
The whole premise of the no-composer architecture is that tool descriptions encode the conversational moment well enough that Sonnet selects accurately. C.t2's first pass is "production first-pass — ship-ready as-is", not perfection. The end-to-end smoke test (Verification §6) is where this either works or surfaces a real gap. **Mitigation**: if smoke reveals systematic mis-selection (e.g. Sonnet always reaches for `lookup` when the visitor's energy is exploratory and `find_inspiring` would be right), that's a G.t1/G.t5 description-tuning iteration, not a handler iteration. Plan accordingly — surface the gap in the execution log; route to G.

### R7. The Voyage-3 endpoint may be slow / rate-limited
Single-call latency for Voyage-3 is typically 100–300ms. Five conversational tools each making one embedding call adds latency to every turn. Caching `embedTextForSearch` for identical inputs within a process lifetime (per primitive list above) helps for repeat queries within a session; doesn't help cold turns. **Mitigation**: monitor; optimise post-launch. Don't pre-optimise here.

### R8. The connector's `pg` pool may not be sized for parallel primitive calls
Some handlers will run primitives in parallel (e.g. `find_inspiring` may parallelise the embedding call + the region-tag resolution). Pool size from C.t1 needs to accommodate this. **Mitigation**: confirm pool config in C.t1's plan; flag if undersized. Default Postgres `max_connections=100`; pool of 10 is usually plenty for one connector.

---

## Coordination

- **C.t1** — connector skeleton must have shipped: pool, MCP-HTTP boot, env config (including `CMS_ROOT` for the description loader), connector entrypoint. **C.t4 cannot start until C.t1 closes.**
- **C.t2** — contract layer (the eight tool I/O Zod schemas, the five derived public projections, the production-quality `description.md` files). Already shipped 2026-04-30. **C.t4 consumes; never edits.**
- **C.t3** — populates domain tables in `puma_dev`. **C.t4 cannot pass integration tests until C.t3 closes.**
- **C.t3a** — populates derived tables (embeddings + persona summaries + classifier outputs). **C.t4 cannot pass integration tests until C.t3a closes** (or the verification step accepts xtest'd cases on partial population).
- **C.t6** — image annotation pipeline. **Loose coupling**: `illustrate` ships against whatever annotation coverage exists; quality silently improves post-C.t6.
- **B.t3a** — *downstream*. Once C.t4 closes, B.t3a rewrites `product/orchestrator/src/connector/tools.ts` to register ADK FunctionTool wrappers for the eight intent-named tools and drops the deprecated `Search*`/`GetDetail*`. Owned by chunk B.
- **D.t9** — *downstream*. Once C.t4 closes, D.t9 adds widgets in `product/ui/src/widgets/*` for the five new `*PublicSchema` outputs. Owned by chunk D.
- **H4 cross-cut** (`runHandler` / `parseToolResult` shared helper) — *check at execution time*. If landed in `@swoop/common`, consume; if not, ship a connector-local version with a TODO.
- **G.t1 / G.t5** — *post-execution*. If the end-to-end smoke reveals Sonnet mis-selecting tools, surface for G iteration; don't block C.t4 closure on it.

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*

### 2026-05-02 — C.t4 landed (executing agent: a8969883db628d1c2)

Eight tool handlers + data primitive layer + MCP registration + H1/H2 cross-cuts shipped across nine commits on `worktree-agent-a8969883db628d1c2` from base `ad105e4`.

**Commit hashes** (oldest → newest):

- `c5e9b15` — `feat(common): H1 — messageOf(err) helper + initial site sweep`
- `4ca90bb` — `feat(common): H1 — complete site sweep across remaining 4 workspaces` (sweeps 23 sites in orchestrator/ui/harness/ingestion)
- `abef9af` — `feat(common): H2 — emitErrorRaised helper`
- `2845040` — `feat(common): H2 — sweep 10 error.raised emission sites onto helper`
- `a8b1efb` — `feat(common): C.t4 — tool.invoked event kind (Q5)`
- `8eee1d1` — `feat(connector): C.t4 — data primitive expansion (vector + RRF + filter composition)`
- `6e394f1` — `feat(connector): C.t4 — eight tool handlers over data primitives`
- `1a7bd2b` — `feat(cms): C.t4 — handoff/handoff_submit/illustrate tool descriptions`
- `e2169d5` — `feat(connector): C.t4 — register 8 tools on MCP server (retires ping; fail-fast description loading)`

**Files changed (high-level)**:

- `product/ts-common/src/errors.ts` (new) — `messageOf(err)` H1 helper.
- `product/ts-common/src/emit-event.ts` — `emitErrorRaised(...)` H2 helper.
- `product/ts-common/src/events.ts` + `fixtures/event.sample.ts` — `tool.invoked` event kind + sample fixture (Q5).
- `product/connector/src/data/` (new files): `embed-query.ts`, `hybrid-search.ts`, `find-inspire-passages.ts`, `find-customer-stories.ts`, `find-trust-proofs.ts`, `find-inform-chunks.ts`, `query-trips.ts`, `find-images-by-keywords.ts`, `resolve-image.ts`.
- `product/connector/src/tools/` (new directory): `_handler-runtime.ts`, `deps.ts`, `description-loader.ts`, `index.ts` (registration), 8 handler files (`find_inspiring.ts`, `find_someone_who.ts`, `find_proof.ts`, `lookup.ts`, `find_options.ts`, `illustrate.ts`, `handoff.ts`, `handoff_submit.ts`), 2 test files.
- `product/connector/src/server/mcp.ts` — full rewrite (was the no-op `ping` tool; now delegates to `registerAllTools`).
- `product/connector/src/server/app.ts` + `index.ts` — wire pool/embedQuery/descriptions through.
- `product/connector/src/server/__tests__/mcp.test.ts` — full rewrite (verifies the 8 tools surface).
- `product/connector/src/config/{schema,load}.ts` — added `TOOLS_PROMPT_DIR` + `VOYAGE_API_KEY` + derived `toolsPromptDirAbsolutePath`.
- `product/cms/prompts/tools/{handoff,handoff_submit,illustrate}/description.md` (new) — three description files so all 8 tools fail-fast cleanly per Q3.
- 17 sweep files across orchestrator/ui/harness/ingestion (H1 + H2 sites).

**Verification (all foreground, blocking, fresh install)**:

```
cd product && rm -rf node_modules && npm install
npm run typecheck --workspaces --if-present  # all 6 green
npm test --workspaces --if-present
# ts-common      — 118 (was 102)  +16 from H1+H2 helpers + tool.invoked fixture
# orchestrator   — 158 (unchanged) — 1 new orchestrator change preserved tests
# connector      —  97 + 3 skipped (was 84+3)  +13 from new tool runtime / desc-loader / mcp tests
# ui             —  71 (unchanged)
# ingestion      — 233 (unchanged)
# harness        —  74 (unchanged)
# total          — 751 + 3 skipped (was 722 + 3 baseline)
```

**Sample MCP `tools/list` output** (from `mcp.test.ts` "lists exactly the eight intent-named tools" assertion): `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`, `illustrate`, `handoff`, `handoff_submit`. The no-op `ping` tool is gone.

**Per-tool integration test status**: integration tests against populated `puma_dev` are deferred — the connector runs against a fresh DB locally only when `DATABASE_URL` is set, and the agent that ran C.t4 had no live `puma_dev` connection. Integration tests therefore land as a follow-on (`npm test` skips them at unit level via the same `describeIfDb` gate as the existing `pool.test.ts`). The runHandler runtime + description-loader + MCP wiring tests cover the structural correctness; SQL-shape correctness against live data is the next iteration's concern. Flagging this for downstream B.t3a:

- `find_inspiring` / `find_someone_who` / `find_proof` / `lookup` / `find_options` SQL plans exist; first live-DB run is when B.t3a brings the orchestrator's connector adapter onto the `:3002` surface and a real Sonnet turn exercises them.
- `illustrate` ships against whatever C.t6 has populated. Pre-M1 starter sample test (per the plan §"Verification" item 4) deferred to the same window.
- `handoff` returns `{status:'widget_triggered', widgetToken: <UUID>}` — verified in mcp.test.ts.
- `handoff_submit` rejects with a pointer to `POST /handoff/submit` — verified by the unit test of the body, since per Q2 Sonnet should never invoke it.

**Deviations from the plan**:

- **`handoff_submit` body** ships as a **rejection-with-pointer** rather than a "thin wrapper over `submitHandoff()`". The plan §`handoff_submit` boundary called for the wrapper, but the MCP-shape input (`HandoffSubmitInputSchema`: widgetToken + contact + consent) is **not** the same shape as the full `HandoffPayload` `submitHandoff()` consumes (which carries verdict, conversation summary, motivation anchor, plus the consent + contact). Mapping MCP-input → `HandoffPayload` would require either inferring fields from session state (state the connector doesn't have visibility into) or renegotiating the `HandoffSubmitInputSchema` shape (out of C.t4's scope per "no new tool I/O Zod schemas"). Since per Q2 Sonnet should never invoke this tool anyway, returning a structured rejection that names the correct route is the safer interim posture. **Surface for B.t3a / future submission-mode work**: if a future architecture wants the MCP path to actually submit, it should redesign `HandoffSubmitInputSchema` to carry the full payload + add a session-state lookup, then drop this rejection.
- **`embed-query.ts` cache** is in-process and unbounded — fine for M1 (visitor utterances per session are bounded), revisit at C.t8.
- **HNSW `ef_search`** left at install default (40 per Q4); no `SET LOCAL` per call. Deferred to C.t8.
- **Typecheck-fixed shape** in `pool.test.ts` fixture — added `TOOLS_PROMPT_DIR` + `toolsPromptDirAbsolutePath` to the test Config builder. No behavioural change.

**Surfaced for downstream**:

- **B.t3a** can now register the eight intent-named tools against `:3002` and drop the deprecated `Search*` / `GetDetail*` adapter wrappers. The orchestrator's `parseToolResult` H4 helper correctly handles the `{ok:false, code, detail}` envelope `runHandler` produces.
- **D.t9** can render the five new `*PublicSchema` outputs (the connector returns the schema-validated public projection — widgets just consume it).
- **G.t1 / G.t5** — once a real Sonnet turn through B.t3a runs, watch for systematic mis-selection between the 5 conversational tools. C.t2's first-pass description.md is "production first-pass — ship-ready"; tuning passes back to G if needed.
- **C.t6** integration: `illustrate` quality silently improves as more images get annotated; no handler change needed.



---

## 2026-05-01 HITL ratification

Open questions resolved per Al's HITL session 2026-05-01. Status flipped from DRAFT to ready-for-execution.

### Resolutions

1. **`illustrate` and the C.t6 dependency** (Q1): as recommended. Ship in C.t4 against whatever annotation coverage exists at execution time. No `coverage_warning` schema field; log as F-a observability event instead.
2. **`handoff_submit` boundary** (Q2): as recommended. MCP tool as thin wrapper over `submitHandoff()` (E.t2/E.t3-shipped HTTP endpoint). Sonnet does not invoke it; widget owns submission via `POST /handoff/submit` per E.13.
3. **Description-load failure mode** (Q3): **fail-fast on ALL 8 tools** (not just the 5 conversational ones). Al wants visibility during development; better to see breakage early than to have utilities silently degrade.
4. **RRF constant + `ef_search`** (Q4): as recommended. Package defaults (RRF `k=60`, HNSW `ef_search=40`) at C.t4; per-query `SET LOCAL hnsw.ef_search` deferred to C.t8.
5. **Per-handler observability** (Q5): one shared `tool.invoked` event with a `tool_name` discriminator. As recommended.
6. **`handoff` widgetToken lifecycle** (Q6): stateless for M1. As recommended.
7. **`find_options` defensiveness** (Q7): no defence against missing `trip_card` rows. As recommended.

### Notes for the executing agent

- **H1 + H2 cross-cut helpers should land FIRST in this agent's commits.** Pair with the chunk-C work as documented in next-steps.md. The new tool handlers' error envelopes will use `messageOf()` and `emitErrorRaised()` from day one. See `planning/03-exec-crosscut-common-helpers-fix.md` §H1 + §H2 for the helper specs.
- Q3's "fail-fast on ALL 8" supersedes the agent's recommendation that the 3 utilities (`illustrate` / `handoff` / `handoff_submit`) degrade gracefully on description-load failure. Reason: development-time visibility. If a utility's description goes missing, we want a hard failure at boot.

---

## 2026-05-18 — `illustrate` tag-gate removal (HITL with Al)

### Symptom

Live chat: agent calls `illustrate` (e.g. `keywords: ["patagonia", "mountains", "glaciers", "torres del paine", "hiking"]`, `count: 6`), tool returns `ok: true, value: { images: [] }`, agent yields to the empty-state silence. Two retries, both empty. Dev trace screenshot in the conversation log.

### Diagnosis (two compounding causes — see also [discoveries.md 2026-05-18](../discoveries.md))

1. **Vision pipeline never wrote the four tag arrays.** [product/ingestion/src/images/vision-client.ts:117-120](../product/ingestion/src/images/vision-client.ts) (authored 2026-05-02, commit `a1592f2`) injects a user-message reminder: *"Return ONLY a JSON object with `description` and `annotation` keys, no preamble."* The same-day fold (decision **C.40 — Vision call produces 6 outputs in one call**) bumped the *system* prompt to v2 (six outputs) and updated `output-schema.ts` + `write-back.ts`; this in-message reminder was missed. The Zod schema's `.default([])` on the four tag arrays parses prose-only model output as valid. `puma_dev` confirms: all 5,325 annotated rows have `subject_tags` / `mood_tags` / `region_tags` / `tags` as `{}` (empty arrays, not NULL).

2. **`findImagesByKeywords` AND-gated cosine ANN behind exact-string tag overlap.** The pre-fix SQL: `WHERE embedding IS NOT NULL AND (subject_tags && $2 OR mood_tags && $2 OR region_tags && $2 OR tags && $2)`. With every tag array empty in the corpus, the AND clause was always false → zero rows regardless of embedding rank. Even with the corpus tags populated, the gate would still be brittle: visitor keywords (`"torres del paine"`, `"glaciers"`, `"mountains"`) don't overlap tag vocabulary verbatim (`torres-del-paine`, `glacier`, `granite`/`peak`).

### Architectural reframe (HITL with Al, 2026-05-18)

The tag arrays were librarian-shaped against a prose substrate. The agent doesn't know the (model-invented) tag vocabulary, can't fuzzy-match against it, and the values themselves aren't embedded — only `ntag` (Swoop's canonical typed-tag taxonomy) carries embeddings, and only `region_tags` was authored to align with `ntag` slugs. Three of the four arrays have no semantic route from agent utterance to image.

The `annotation` column — 1–2 sentences of literal, keyword-rich scene description authored for retrieval — *is* embedded (`image.embedding`, 6,118 rows populated). Cosine ANN over that substrate carries the load. Smushing structured intent into a single embedding is acceptable for the agent's simplest mode; richer axis-aware intent expression is a future v2 concern.

**Decision (this addendum)**: drop the tag-overlap AND-gate. Rank `illustrate` results on cosine ANN against `image.embedding` only. Retain `regionSlug` as an optional hard filter on `region_tags @> ARRAY[$slug]` — no-op today (column empty), lights up automatically when a future re-annotation pass populates `region_tags`. No re-annotation required to ship.

**Future (parked in [inbox.md 2026-05-18](../inbox.md))**: per-facet image embeddings — one image → N vectors, one per facet (mood / content / region / activity). Tool surface evolves to let the agent express axis-specific intent. That's the design the tag arrays were reaching for. Decision: don't re-run image annotation now; see how good single-embedding cosine ANN gets first; revisit if quality is meh.

### Decisions logged

- **C.illustrate-tag-gate-1** (numeric id TBD at merge): `findImagesByKeywords` ranks on cosine ANN against `image.embedding` only; tag-array overlap removed as a hard gate. Forward-compatible with the v2 facet-aware design.
- **C.illustrate-tag-gate-2** (numeric id TBD at merge): `regionSlug` retained as an optional hard filter on `region_tags @> [$slug]`. Today a no-op (column empty across the corpus); preserved for the future re-annotation lighting it up automatically.
- **C.illustrate-tag-gate-3** (numeric id TBD at merge): re-annotation of the 5,325 already-annotated images is **deferred**, not actioned in this fix. The `vision-client.ts:117-120` reminder bug is the root cause of empty tag arrays; left in place pending the v2 facet decision. If v2 lands and goes facet-aware, the prompt + reminder both want a refactor; fix-then-re-annotate is wasted work if the schema is about to change.

### Files changed

- `product/connector/src/data/find-images-by-keywords.ts` — top doc-comment rewritten (the prior "Hybrid: cosine ANN UNION array overlap" framing was load-bearing-incorrect). Dropped the `keywords: ReadonlyArray<string>` parameter (unused now that the OR-block is gone). Dropped the `(subject_tags && OR …)` block from the WHERE clause. Kept `embedding IS NOT NULL` gate and `region_tags @> ARRAY[$slug]` optional filter.
- `product/connector/src/tools/illustrate.ts` — caller updated to drop the now-removed `keywords` argument from the `findImagesByKeywords` call. The tool's public `IllustrateInput` shape (`keywords[]` + `regionSlug?` + `count?`) is **unchanged** — minimum blast radius; no agent-facing tool-description rewrite required.
- `product/connector/src/data/__tests__/find-images-by-keywords.test.ts` **(new)** — unit tests for SQL shape (cosine ANN, no tag-overlap, optional regionSlug clause) + row-parse + null-caption branch. Plus DB-gated integration tests (`DATABASE_URL + GEMINI_API_KEY`) that embed real visitor queries via `buildEmbedQuery` and assert non-empty rows against `puma_dev`.

### Verification

- New unit tests; pre-existing tests unaffected (the test file is new).
- DB-gated integration test asserts `findImagesByKeywords` returns non-empty results for the screenshot's exact query (`patagonia mountains glaciers torres del paine hiking`) against live `puma_dev`. Logs the rows for operator inspection of relevance quality.
- Live-smoke result captured below at execution time.

### Live smoke (captured 2026-05-18)

Run against `puma_dev` with `GEMINI_API_KEY` sourced from `product/connector/.env`.

**Query 1**: `keywords = ["patagonia", "mountains", "glaciers", "torres del paine", "hiking"]`, `limit = 6` (the screenshot scenario from the conversation log).

Result: 6 / 6 images returned. All Torres del Paine. All hiking-themed. Captions track tightly with the query intent.

```
id    | caption                                                    | url-tail
------+------------------------------------------------------------+--------------------------------------------------------
 9097 | Hiking in Torres del Paine, Patagonia, Chile               | EXPL_4_EXPL_RTD_Hiking-in-Torres-del-Paine.jpg
  963 | Hiking in Patagonia, Torres del Paine, Chile, Patagonia    | Explora_Trekking.jpg
  738 | Hiking in Patagonia, Torres del Paine, Chile, Patagonia    | Explora_Excursions_4.jpg
10493 | Hiking on Mt Paine, Torres del Paine, Patagonia, Chile     | SWO_4_DAVID_ALL_Mt-Paine-horse-ride-and-hike.jpg
 9804 | Hiking on Mt Paine, Torres del Paine, Patagonia, Chile     | HOTELLASTORRES_4_HLT_RTD_Mt-Paine-horseride-and-trek.jpg
 8711 | On a hike in Torres del Paine, Patagonia, Chile            | CN_4_CN_RTD_Zapata-River-Hike.jpg
```

Latency: 563ms (Gemini embed + Postgres ANN combined). Sits inside `illustrate`'s 562ms-observed envelope from the screenshot (which had returned 0 rows). Cosine substrate alone is doing real journey-relevant work.

**Query 2**: `keywords = ["granite tower at golden hour"]`, `regionSlug = "torres-del-paine"`, `limit = 4`.

Result: 0 rows — exactly as expected (`region_tags` is empty across the corpus per the 2026-05-18 diagnosis; the optional hard filter excludes every row until a future re-annotation populates the column). The filter wired correctly, didn't error, and is forward-compatible.

**Coverage characterisation note**: the upstream `description` column (where pre-populated by Swoop's upstream curation, ~47.5% of the catalogue per the C.t6 plan) is what `image.embedding` was derived from for the 793 images that have an embedding but no `annotation` from C.t6. Those rows participate in cosine ANN today — they're not blocked on the C.t6 annotation pass. The 6,118 total = 5,325 (C.t6 annotations) + 793 (upstream descriptions). The "still has neither" tail (~6.9K) is the population a future C.t6 re-run would extend coverage over.

**Cost of the smoke**: 2 Gemini embedding calls + 2 Postgres ANN queries. Sub-cent.

### Surfaces for downstream

- **Quality monitoring**: `ui.widget_rendered{widgetType: 'inspiration', toolName: 'illustrate', outputCount: N}` already exists per F-a wiring. Post-launch, watch the distribution of `outputCount` per `illustrate` call — if many calls still return 0 results, the cosine substrate is the bottleneck and the facet-aware v2 becomes urgent.
- **Agent empty-state silence**: the brave-pare wave (2026-05-13) still applies — when `illustrate` returns 0, the widget renders nothing and the agent's prose carries the moment. No agent-prompt change needed for this fix.
- **C.t6 prompt + reminder**: when a future v2 effort touches the image annotation pipeline, the [vision-client.ts:117-120](../product/ingestion/src/images/vision-client.ts) reminder string is the first thing to fix. The system prompt + Zod schema + write-back SQL are already aligned to six outputs; only the reminder lags.

### 2026-05-27 — reminder string aligned

Verified at HEAD: bug still present. `vision-client.ts:117-120` reminder named only `description` + `annotation`; `output-schema.ts` declares all six fields (four with `.default([])`); `cms/prompts/etl/image-annotation/prompt.md` is `version: 2` demanding six outputs. C.40 fold gap confirmed; nothing was silently patched in the five intervening weeks.

Changed `vision-client.ts:117-120` to list all six keys (`description`, `annotation`, `subject_tags`, `mood_tags`, `region_tags`, `tags`), kept the "no preamble" instruction. Added guarding test in `__tests__/vision-client.test.ts` (`reminder names all six v2 output fields`) — red before fix, green after. Full ingestion suite green against a fresh `rm -rf node_modules && npm install`: 291/291 passing, typecheck clean.

Re-annotation of the 5,325 already-annotated images stays deferred per the parked v2 facet decision; this fix closes the latent footgun so any future re-run produces all six outputs. Commit `6692326`, branch `worktree-agent-aaccca0099e0d9f48` (off main; harness did not pre-create the worktree, so the agent branched from main locally — no main commit). Awaiting human review + merge.
