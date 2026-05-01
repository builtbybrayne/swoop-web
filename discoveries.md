# Discoveries — Swoop Web Discovery (Puma)

Non-obvious architectural truths we learned during the build. Add entries when you learn something that future-you (or a future agent) would have wanted to know up front.

**Format**: `## YYYY-MM-DD — one-line topic` then body. Latest at top.

---

## 2026-05-02 — Self-referencing FKs need two-pass writes; soft FK orphans want nullify, hard FK orphans want drop

C.t3 surfaced two FK-management patterns worth pinning for any future ETL touching this kind of legacy CMS schema.

**Self-referencing FKs in multi-row INSERTs.** `page.parent_id REFERENCES page(id)` is non-deferrable. When you build a single multi-row INSERT statement with hundreds of pages, child rows can land in the VALUES list before their parents — Postgres rejects the row whose target id isn't yet inserted. The fix is two-pass:

1. Insert all rows with `parent_id = NULL`.
2. Run a second pass: `UPDATE page SET parent_id = CASE WHEN id = $1 THEN $2 WHEN id = $3 THEN $4 … END WHERE id IN (…)` in batches.

That's not idempotent-friendly with ON CONFLICT semantics — but here the second pass is a pure UPDATE, no upsert. On re-runs the WHERE-id-IN clause matches the same set; the CASE produces the same parent_id values; the update is a no-op for rows whose parent_id already matches. Same pattern would work for any future self-FK at our scale (hierarchical content types, threaded comments, etc.).

Alternative we didn't take: declare the FK `INITIALLY DEFERRED` so PG only checks at end of transaction. That works but requires migration changes; the two-pass approach is a pure ETL-side fix and the migration's existing `REFERENCES page(id)` constraint stays restrictive in production reads.

**FK orphans: nullify or drop.** Source dumps reference targets we filter out (Profile pagetype pages, soft-deleted images, etc.). Two policy choices:

- **Nullify** for soft FKs (`page.image_id`, `contentblock.page_id`, `trip.page_id`, `customerreview.image_id`). Downstream tools handle missing image_id / page_id gracefully — D.t9's widget code degrades cleanly to "no image" or "no deep-link". The ON DELETE SET NULL semantics in the migration encode this preference; we apply the same shape at insert time so we don't have to land an orphan that ON DELETE eventually nulls anyway.
- **Drop** for hard NOT NULL FKs (`cabin.vessel_id`, `customerreview_trip.{customerreview_id, trip_id}`, `tour_item.tour_id`). Inserting a row with a missing required FK is impossible; the only viable boundary policy is "don't load this row".

C.t3's `flushBuffer` takes an array of FkRule entries (`{column, validIds, mode: 'nullify' | 'drop'}`) per table. Each rule is bundle-able and explicit. The skip-reason tally surfaces `fk_nulled_<col>` / `fk_drop_<col>` counts so an operator can see at a glance how much got dropped versus how much got soft-loaded with FK=null.

Pattern to remember: **for any FK whose target might be filtered, name the policy at the boundary, count the affected rows, and surface the count in the operator-facing tally.** Letting Postgres reject the insert without recording how many rows you lost is the wrong default.

**Within-batch dedupe by UNIQUE secondary keys.** Source dumps occasionally carry multiple rows with colliding values for what's a UNIQUE column on our derived schema (`page.canonical_url`, `tag.alias`, `trip.slug`, etc. — legacy alt versions of the same content). Multi-row INSERT then fails not on the first conflict-targeted row but on the *batch* (the within-batch values violate UNIQUE before ON CONFLICT can resolve). Fix: dedupe in code keyed by the UNIQUE column, lowest-id winner. Generic `SECONDARY_UNIQUE_KEY` map in `flushBuffer` covers all the affected tables uniformly.

These three patterns are why ETL transforms are not just SQL — Postgres's strictness on FK + UNIQUE within-batch needs explicit code-side handling that pgloader's CAST DSL can't naturally express. Argument for the HITL Q1 Option-B pick all over again.

---

## 2026-05-01 — pg `client.query()` deprecation in `on('connect')` is real; libpq startup options are the cleanest fix

`pg.Pool` exposes an `on('connect', client => ...)` lifecycle hook that callers (including the original C.t1 implementation) commonly use to set per-connection state like `statement_timeout`. Live-smoke testing of the new connector surfaced a runtime warning that unit tests didn't catch:

> `(node:39106) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.`

The cause: pg runs an internal driver-init query (e.g. `SELECT typname, typtype, oid FROM pg_type` for type parsing) immediately on connection. The user-supplied `on('connect')` callback fires before that init query completes; queueing a second `client.query` while the first is still in flight is what pg is now warning about.

The clean fix is to skip the on('connect') round-trip entirely and pass the per-connection state via the libpq `options` startup parameter:

```ts
const poolConfig: pg.PoolConfig = {
  // ...
  options: `-c statement_timeout=${PG_STATEMENT_TIMEOUT_MS}`,
};
```

`-c key=value` is libpq's escape syntax for "apply this `SET` at session start". Postgres applies it before the very first user query, so there's no race against pg's internal init. Cloud SQL honours startup options (verified empirically; documented at https://cloud.google.com/sql/docs/postgres). On-prem and Postgres.app likewise.

ETL paths (C.t3 / C.t3a) that need a longer ceiling than the service-wide default still override per-connection via `client.query("SET LOCAL statement_timeout = ${ms}")` inside their batch transactions — that's running inside a transaction borrowed via `withPgClient`, no race against driver init. Override stays per-call, not service-wide.

Pattern to remember: **prefer libpq startup options over `on('connect')` for any per-connection state that should apply from query #1**. Use `on('connect')` only for *state that must be observed* by user code (e.g. registering a custom type parser via `client.setTypeParser` — that one's safe because it's synchronous metadata, not a query).

The same pattern applies to other pool tunables that may show up in C.t8 runbook content — `lock_timeout`, `idle_in_transaction_session_timeout`, etc. All of them go via `options` if at all possible. Captured in `gotchas.md` too.

---

## 2026-05-01 — Connector is now a runnable service; orchestrator continues to talk to the stub until B.t3a

C.t1 turned `@swoop/connector` from "a workspace that exports handoff helpers as in-process imports" into a service: Express + MCP-over-HTTP at `:3002`, Postgres pool, health endpoints, migration runner. **But the orchestrator still talks to the stub at `:3001`** because the new connector boots with one no-op `ping` tool — the eight intent-named tools register in C.t4.

This is the right transition shape but it has one operational consequence: during the C.t1 → C.t4 window, *both* services run side-by-side in dev. The stub continues to deliver `search` / `get_detail` / `illustrate` / `handoff` / `handoff_submit` to the orchestrator from `@swoop/common/fixtures`; the new connector serves `ping` to anyone curious enough to point `mcp inspect` at `:3002`. After B.t3a's swap (which lives in chunk B because it's an orchestrator-side rewrite), `:3001` retires entirely and the stub at `product/orchestrator/test-fixtures/stub-connector.ts` can be deleted.

Architectural reason this is correct: standing up the empty MCP server early means C.t4's diff is purely "register N tools" — no transport stand-up, no Express wiring, no port choice. The 30 minutes of glue paid forward dominates the cost of running an empty MCP server in dev for a few days. The Tier 2 plan §"Verification" item 1 ("data-connector service starts, registers the eight tools over MCP, responds to a discovery ping") is now half-satisfied.

Pattern to remember: **for transports that have a non-trivial "stand the surface up" step, decouple it from "register the actual handlers" so the surface and the handlers can ship in different commits**. The same shape applies if we later add a second transport (e.g. a private gRPC endpoint for ETL only) — surface in one task, handlers in another.

---

## 2026-04-30 — Five-jobs / eight-tools / no-composer is the load-bearing substrate of chunk C

After two architectural false starts (the 2026-04-22 Vertex-AI-Search + data-shaped tool surface; the 2026-04-28 Haiku-composer + ten-tool sales-shaped surface), the 2026-04-29 review reset chunk C around a **first-principles top-down derivation** that has held under stress and finally feels stable enough to call durable.

**The substrate**: Puma's agent moves appropriate visitors through Awareness → Interest → Strong Consideration toward a warm specialist handoff (decision **C.13**). At every conversational moment, content does one of four+1 jobs *for the visitor*:

| Job | What it does | Tool |
|---|---|---|
| Inspire | Turns vague interest into vivid anticipation | `find_inspiring` |
| Mirror | Lets the visitor see themselves in someone who's been there | `find_someone_who` |
| Reassure | Converts curiosity into confidence to talk to a human | `find_proof` |
| Inform | Answers a concrete question | `lookup` |
| Propose options | Offers concrete trips to consider | `find_options` |

Plus three utilities (`illustrate`, `handoff`, `handoff_submit`) → **eight tools total** (decision **C.25**, supersedes C.19).

**No composer layer in the request path** (decision **C.24**, supersedes C.22). The 2026-04-28 plan put a Haiku sub-agent inside each "vague" sales-shaped tool to translate intent into data calls. With intent-named tools whose outputs are concrete row shapes, Sonnet at the orchestrator handles synthesis directly. One LLM call per turn, lower latency, fewer failure modes. Cheap LLM (Haiku) earns its keep at ETL — blog-post job classification, persona-summary aggregation, image annotation, blog-tag normalisation against `ntag`. Done once, persisted to columns; never on the conversational path.

**Five job-shaped derived tables match the five tools**: `inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`. Each table holds rows shaped for the job, regardless of which source row they originally came from. A blog post can land in `inspire_passage` (if narrative) or `trust_proof` (if a B-Corp piece) or both.

If you ever find yourself unsure whether to add a tool, a column, a table — ask: *"does it serve a job at a moment in the journey?"* If yes, build it. If you're justifying it from the data side ("we have this, so we should expose it"), that's bottom-up reasoning — the next discoveries.md entry covers why it's the recurring failure mode.

The architecture is enshrined in code (`product/connector/migrations/`, `product/ts-common/src/{tools,derived}.ts`, `product/cms/prompts/tools/<tool>/description.md`) and in the planning suite (top-level §3.0 + theme 11; chunk-C ★ Read this first; C.t2 ★ Read this first). Decisions C.13, C.24, C.25, C.26, C.27, C.28, C.29 carry the rationale.

---

## 2026-04-30 — Top-down from the sales journey; bottom-up from the data is the recurring failure mode

Three Claude sessions on this engagement have walked into the same trap before being caught: starting from the data (tables, columns, what's available) and asking *"what tool would query this?"* The result is always librarian-shaped tools (`search_pages`, `find_trips`, `query_tags`, `get_blog_post`) that are correct against the database but wrong against the conversation. Visitors get a search engine, not a knowledgeable friend.

The 2026-04-28 plan tried to patch this by adding Haiku composers between the data and the agent — middlemen translating librarian-output into sales-output. That was a symptom, not a fix; it preserved the bottom-up tool boundaries while papering them over with extra LLM hops.

The 2026-04-29 review's reset: **shape the tools by the job, not the data, in the first place.** Composers become unnecessary; Sonnet weaves directly. The five-jobs framing (previous discoveries entry) is what falls out of the right starting question.

The discipline is now load-bearing in three places so future agents can't miss it:
- [planning/01-top-level.md](planning/01-top-level.md) §3.0 (the substrate themes shape against) + theme 11 (the eleventh commitment, named explicitly).
- [planning/02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md) "★ Read this first — the WHY of chunk C" — calibration layer for any agent touching this chunk.
- [planning/03-exec-c-t2.md](planning/03-exec-c-t2.md) opening callout pointing back to the chunk-C anchor.

**The anti-pattern signals** (from the chunk-C anchor section):
- *"We have data X, what tool should query it?"* — Wrong direction. Always.
- *"Let's design tools that mirror the database structure."* — That's CRUD, not conversation.
- *"More tools means more flexibility."* — Usually wrong. Eight is enough at our scale; more dilutes Sonnet's selection accuracy.
- *"The data tells us what's possible."* — Yes, but doesn't tell us what's *useful in the conversation*.
- *"Just expose the entities, the agent can figure out what to do."* — That's how you get a librarian, not a knowledgeable friend.

**The right question, always**: *"Whose journey am I serving, and at what point in their journey? What conversational move does this enable?"* — if you can't answer concretely from the conversational arc, you're reasoning bottom-up. Stop. Re-anchor.

This entry exists to make the failure mode legible enough to prevent the fourth occurrence. If a future session ends up re-litigating the tool surface or proposing a composer layer to "make tools feel right", that's the bottom-up trap returning. Recognise it and re-read the anchor sections before changing anything.

---

## 2026-04-30 — Customerreview corpus shape: 80/20 short-snippet vs long-form; aggregate-by-reviewer for persona generation

Phase 1 inspection of the 2026-04-30 supplementary `customerreview_tables_-_swoop-patagonia_prod.sql` dump (2,563 rows + 163 trip junctions) surfaced findings that materially shape how C.t3a's persona-summary classifier should run.

**The 80/20 split**:
- ~80% of rows are short snippet fragments (≤200 chars, often single sentences like *"Carys was great"* or *"Plan early to get the best flights"*). These look like extracted feedback fragments harvested from a longer questionnaire — likely the rows that link via `feedbacksnippet_id` (target table not in dump). Many reviewers have 9–12 such snippet rows under the same `name`.
- ~20% are substantive 300–1000-char first-person testimonials. Real customer voice, named guides, named hotels, sometimes practical tips, sometimes emotional travelogue.

**Implication for C.t3a**: per-row persona generation produces thin summaries (*"customer who liked their guide"*). Per-reviewer aggregation (group by `name` first, concatenate prose, then classify) produces real personas (*"mid-50s couple, post-retirement, valued quiet trails over crowds"*). C.t3a's Haiku classifier prompt should aggregate before generating.

**Geographic anchors are STRONG**: regional features and named treks are preserved richly in the prose (Torres del Paine, El Chaltén, Perito Moreno, Fitz Roy, Cape Horn, Tierra Patagonia hotel, Explora, EcoCamp, named tour names). Mirror's *"someone who did exactly what you're considering"* job is well-served.

**Trip linking is sparse**: only 6% of reviews are structurally `customerreview_trip`-tagged (158 rows → 56 distinct trips). Region/season retrieval for `find_someone_who` will lean on **prose embedding**, not structured trip joins. That's already how the Mirror tool works (cosine similarity on `persona_embedding`).

**Date coverage is solid** (99.9%) — supports seasonal filtering if a future use case wants it.

**Image associations are sparse** (5.8%, ~150 rows). `customer_story.image_id` populates for ~6% of derived rows.

**PII is a non-issue**: per Al 2026-04-30, *"these reviews are all public domain — they're literally public customer reviews on the website."* Names, locations, inline specialist mentions all preserved through the domain layer (`customerreview` + `customerreview_trip`) into `customer_story` derivation. No NER scrubbing, no name/location column drops, no regex flagging. The privacy fence around the prose itself is much smaller than the privacy fence around the customer record they came from.

**Customertip remains pending**. The 2026-04-30 dump didn't include `customertip` (119 expected) or `pressreview`. Separate Swoop ask outstanding; the 119 `contentblock_customertip` junction rows continue to dangle until then. ETL ignores them.

---

## 2026-04-29 — `customerreview` + `customertip` source tables MISSING from SQL dump *(superseded 2026-04-30 — see top entries)*

> **Update 2026-04-30**: Swoop delivered the supplementary `customerreview_tables_-_swoop-patagonia_prod.sql` dump (2,563 reviews + 163 trip junctions). The 2,390 dangling junction rows in `contentblock_customerreview` now resolve cleanly. `find_someone_who` graduated to live (decision C.26). **`customertip` and `pressreview` source tables are still absent**; the 119 `contentblock_customertip` junction rows continue to dangle. See the 2026-04-30 entries above for the corpus-shape finding and the architectural reframe.

The 2026-04-27 SQL export contains junction tables `contentblock_customerreview` (2,390 rows) and `contentblock_customertip` (119 rows) — both carry FK constraints to source tables `customerreview.id` and `customertip.id`, but **those source tables don't exist in the dump**. The 2,390 + 119 junction rows are dangling.

This was supposed to be the agent's primary corpus of curated customer-prose for `recall_someone_who` and `build_confidence`. It isn't there. Either Sequel Ace's export filtered it (PII?) or the schema migrated and the FKs are stale.

**Implication**: until Thomas/Richard clarify (question raised in `questions.md`), the customer-story surface for the agent leans entirely on the parallel WordPress blog stream (~108 in-window posts via `03-exec-blog-ingest.md`). C.t3 should not gate on resolving this — blog corpus is a sufficient first-pass.

---

## 2026-04-29 — `daybyday` is way sparser than its 88K row count suggests

`daybyday` has 88,367 rows but most are dead weight:

- **Only 13 trips** have an `active` `tripvariant`.
- 50,685 rows have `trip_id IS NULL` (orphan drafts).
- Rows split by type: 75,810 `postsale` (booking-confirmation documents) vs 12,497 `presale` (sales-page itineraries) vs 60 NULL.
- Of 12,497 `presale` rows, 12,415 have `tripvariant_id=NULL`, 72 are draft, 10 retired, **0 active**.

The canonical filter for agent-relevant day-by-day data is `WHERE type='presale' AND trip_id IS NOT NULL AND deleted IS NULL`, joined directly on `trip.id` (not via `tripvariant`). That yields ~12,415 candidate rows for 852 trips — many trips will have no data.

`tripvariant` is operational draft-management, not visitor-facing variants. `season` is fiscal-year scoping, not marketing seasonality. Both excluded from agent surface.

Captured as decision-pending question for Swoop ops to confirm the website renders presale rows. Don't block C.t3 on it.

---

## 2026-04-29 — Image filenames live on `file`, not `image` — two-table model

`image` (13,261 rows) holds metadata (title, caption, description, copyright, credit, width, height, quality_rating). It carries **no filename column**. The actual filename comes via `image.image_id → file.id` (FK constraint) and `file.name`.

`file` (135,807 rows) is the master physical-file table — includes PDFs, docx, images. Filter to images by `file.extension IN ('jpg', 'png', 'jpeg', 'heic')` or `file.type LIKE 'image/%'`.

`file.path` carries the legacy CDN domain (`http://images.swoop-patagonia.com`). The imgix transformation (`https://swoop-patagonia.imgix.net/<file.name>?<render-params>`) is a website-runtime concern; we apply it ourselves in the data primitive `resolve_image_set`. Don't read `file.path` for agent-facing URLs.

**Image text-field population** (useful for C.t6 image annotation pipeline):
- `image.title` is 99.7% populated.
- `image.description` is 47.5% populated — where present, prefer over running Claude Vision.
- `image.caption` is 35.2% populated — secondary fallback.

Cuts the C.t6 cost estimate substantially: ~6.3K of the 13.3K images already have a description; only the rest need vision.

---

## 2026-04-29 — `ntag` is a clean polymorphic m:m, but `ntags_lookup` carries an enquiry firehose

`ntag` (79 rows, 5 types: 27 interest / 21 area / 17 activity / 7 trip-type / 7 style) is the live tag taxonomy per Julie ruling. Lookups via `ntags_lookup` with shape `(entity_type, entity_id, tag_id)`.

`ntags_lookup` has 157,537 rows, but **148K of them are `entity_type='enquiry'`** — i.e. tagging customer queries (PII). The agent-relevant subset is much smaller:

| entity_type | rows | Agent? |
|---|---|---|
| enquiry | 147,959 | **NO — PII, exclude** |
| image | 4,491 | YES |
| trip | 2,973 | YES |
| response | 1,103 | NO |
| partner | 622 | NO |
| contentblock | 255 | YES |
| video | 134 | YES |

`export.sql` should `WHERE entity_type IN ('image', 'trip', 'contentblock', 'video')` when ETL'ing `ntags_lookup`. ~7,853 useful rows, not 157K.

---

## 2026-04-29 — Currency mapping was wrong in the first-pass ontology: 4 ≠ EUR, 4 = AUD

[S-INDEX] inspection guessed `currency_id` 1/2/4 = GBP/USD/EUR (with 4 maybe a "composite"). [S-SQLDUMP-2026-04-27] §S1 confirms: **1=GBP, 2=USD, 3=EUR, 4=AUD**. The public feed didn't expose EUR-priced trips because they happen to be rare; the EUR id is 3.

Full mapping (11 entries via `currency.iso_3`): 1=GBP, 2=USD, 3=EUR, 4=AUD, 5=CLP, 6=ZAR, 7=ARS, 8=NZD, 9=CAD, 10=NOK, 11=DKK. ETL just copies `currency.iso_3` — no hand-mapping needed.

---

## 2026-04-29 — `adventurousness` is a deprecated style classifier, NOT a difficulty/wilderness legend

The first-pass guess was that the `adventurousness` table (11 rows) carried the user-facing legend for the trip-level `difficulty` (1–5) and `wilderness` (0–5) integer fields. It doesn't. The 11 rows name *trip styles* — Adventurous / OBT (off-the-beaten-track) / Camping / Huts/W Trek / Day Hikes / Luxury / Winter / Group / Budget / Yurt / Independent — all with `rating: 5` (a column that's universally unused).

Per Julie ruling: deprecated. The trip-style concept it was meant to encode now lives in `ntag` (types `style` and `trip-type`). Don't ETL `adventurousness`.

`trip.difficulty` and `trip.wilderness` are raw integers 0–5; **no legend exists in the DB**. Agent surfaces raw integers without trying to map them to user-facing words at ETL time.

---

## 2026-04-29 — URL construction rule: `override_url || alias` works universally

Confirmed by [S-SQLDUMP-2026-04-27] §S9: 100% of trips have `alias`; 67% additionally have `override_url`. 100% of pages have `alias`; 91% have `override_url`. The fallback rule `override_url || alias` works for every record.

ETL writes a derived `canonical_url` column on `trip`, `page`, `hotel`, `location`, `tour` — callers never apply the rule themselves. Construction: `"https://www.swoop-patagonia.com/" + (override_url || alias)`.

Sample trip URLs surface the SEO-friendly path on `override_url` (e.g. `chile/torres-del-paine/hiking/w-trek/original`); `alias` is the slug fallback (e.g. `w-trek-torres-del-paine`).

---

## 2026-04-29 — Page-as-hub pattern, but trips also have direct image joins

Confirmed by [S-SQLDUMP-2026-04-27] §S8:

- **Trips** have BOTH paths: direct via `image_trip` (3,361 rows), AND via `trip.page_id → image_page` (453 rows).
- **Hotels** have ONLY the page path: `hotel.page_id → image_page`. No `image_hotel` table.
- **Locations** have direct: `image_location` (count not measured but table exists).

Multiple records can share the same `page_id` — e.g. trips 1052 + 1053 both → page 3 (`argentina/welsh-patagonia`). So `page` acts as a *region/topic hub*, not strictly a per-record page. Image sets attached to a page apply to all records hubbed there.

ETL primitive `resolve_image_set(record)`:
1. If record has direct image join (`image_trip`, `image_location` etc.), return those.
2. Else if `record.page_id` is set, return `image_page` for that page.
3. Else return empty.

Images can also be tagged via `image_tag` (and via `ntags_lookup WHERE entity_type='image'`) for filterable retrieval.

---

## 2026-04-29 — Trip count in dump is 852, not 111

The public Trip Finder feed surfaces ~111 trips; the dump has **852**. The long tail is legacy/internal/alt records. Most are draft/retired/orphan via `tripvariant` (only 13 trips have an active variant — see the daybyday discovery above for the full sparseness picture).

ETL should filter to "active and surfaceable" trips. Best-guess filter (subject to confirmation): `WHERE deleted IS NULL AND publishstate_id = 3` (the publishstate value seen on the public feed; needs SELECT to confirm).

---

## 2026-04-28 — Form submission is a discrete user action, not a chat turn — give it its own HTTP surface

When the lead-capture widget needs to "submit" the visitor's contact details to a backend that will persist a record + send an email, three patterns present themselves: (a) the widget calls `props.addResult` and the agent decides on the next turn to call a `handoff_submit` MCP tool that runs the side-effect, (b) the orchestrator intercepts the addResult inside the chat SSE handler and runs the side-effect inline, (c) the widget POSTs to a discrete HTTP endpoint and resolves the assistant-ui tool call locally with a success-marker once the POST returns.

Going with (c). The form submission has its own HTTP semantics, its own success/failure shape, its own loading state, its own retry affordance. Threading it through the chat SSE flow (a) wastes an LLM call and adds latency; (b) tangles two lifecycles inside one handler. The discrete endpoint at `POST /handoff/submit` lets the widget render an inline "couldn't send — try again" affordance directly off the response code, with no agent retry logic. The endpoint is also fully tested in isolation (`product/orchestrator/src/server/__tests__/handoff-submit.test.ts`) without spinning up the runner.

`addResult` still fires (with `HandoffSubmitOutput { status: 'accepted', handoffId }`) so assistant-ui's tool-call lifecycle resolves cleanly and the agent gets a tidy result for the next turn. Decision **E.13**.

---

## 2026-04-28 — Server enriches the handoff payload from session state — never trust the client to bundle it

The widget could in principle bundle the entire `HandoffPayload` (handoffId, session metadata, wishlist accumulator, visitor profile, tier-1 consent timestamp) before POSTing. We don't. The widget sends only what it has direct knowledge of: agent tool-call args (verdict, reasonCode, reasonText, motivationAnchor) + form contact + tier-2 consent + sessionId. Everything else is derived server-side in `enrichPayload()` (`product/orchestrator/src/server/handoff-submit.ts`).

Three reasons: (i) widget tampering — a malicious or buggy client could falsify tier-1 consent timestamps, conversation start times, turn counts. The server is the source of truth for those. (ii) Staleness — session state evolves between the agent triggering the widget and the visitor clicking submit (e.g. a wishlist item added in a later turn). Server-side enrichment captures the freshest state. (iii) Single trust path — the durable record reflects what the server knows, not a client-asserted snapshot.

Wire shape is `.strict()`-validated (`HandoffSubmitRequestSchema`) so unknown fields bounce. The full `HandoffPayload` is built only in the route handler. Decision **E.14**.

---

## 2026-04-28 — File-backed `FsHandoffStore` is a legitimate interim — interface is what survives

GCP IAM is blocked on Thomas. The Tier 2 plan named Firestore as the durable backend (decision E.1) but waiting on it would have blocked all of E.t2/E.t3. Built a tiny `FsHandoffStore` (one JSON file per handoff under `var/handoffs/<id>.json`, atomic write via tmp-file-rename, filename safety regex, schema-validated round-trip on read) behind the same `HandoffStore` interface that the eventual `FirestoreHandoffStore` will satisfy.

Important property: caller code (`submitHandoff`, the route handler, the orchestrator wiring, every test) depends on the interface, not the implementation. Swap is one new class file plus one config flip in `index.ts`. The E.t1 contract (`HandoffSubmitConsentGate`) is honoured by `submitHandoff()` regardless of backend. Decision **E.12**.

The `var/handoffs/` directory is gitignored — visitor PII never enters git. `product/orchestrator/var/` and `product/connector/var/` both covered.

---

## 2026-04-28 — Connector workspace home for handoff side-effects, not the orchestrator

The mailer + durable store + `submitHandoff()` orchestration first landed in `product/orchestrator/src/handoff/` because the connector workspace was empty (`export {};`). Within the same day they were relocated to `product/connector/src/handoff/`. Why: per the chunk-C / chunk-E split, connector owns data + side-effects; orchestrator owns the agent loop. Conflating them in `orchestrator/` only because connector was unscaffolded would have created later refactor pressure.

The orchestrator imports from `@swoop/connector` as a workspace dep. `nodemailer` moved with the code (now a connector dep, removed from orchestrator). The `POST /handoff/submit` route handler stays in the orchestrator because it's part of the orchestrator's HTTP surface — it just delegates the side-effect work via in-process import.

When MCP-fication eventually happens (the connector grows a `handoff_submit` tool exposed over MCP-HTTP), the route handler swaps the in-process import for an MCP client call. Same `submitHandoff` function on the connector side; minimal disturbance. Decision **E.11**.

---

## 2026-04-27 — System-prompt loader is the file system, not a CMS framework

G.10 (2026-04-24) decided to split style guidance into `why.md` + `style-avoid.md` but left the wiring undefined — "referenced from the WHY prompt" with no mechanism. Live testing on 2026-04-27 surfaced the gap: the avoidance file existed on disk but no code loaded it. The agent never saw the rules.

Resolved by giving `cms/prompts/` a deliberate sub-structure (`system/`, `skills/`, `tools/`) with one well-defined load contract per concern. The system-prompt half is the file system as content management:

- Files matching `^\d{2}_[a-z0-9-]+\.md$` in `system/` are concatenated in lexicographic order, separated by `\n\n---\n\n`. Two-digit numeric prefixes give deterministic ordering past 9; sparse numbering (00, 10, 20…) leaves gaps for inserts without renumbering.
- Files outside the pattern (drafts, `README.md`, sub-dirs) are silently skipped.
- No metadata layer, no manifest, no interpolation. Anyone can `cat cms/prompts/system/*.md` and see what the agent sees.

Skills use ADK 1.0's native `loadAllSkillsInDir` (one folder per skill, `SKILL.md` + frontmatter). Tools fragments are read explicitly by tool code from `tools/<tool-name>/`.

The two-layer voice control from G.10 now actually works: positive examples in `00_why.md` + avoidance list in `10_style-avoid.md` are both auto-loaded; neither file needs to reference the other; both iterate independently. Decision **G.11** + Tier 3 plan in `planning/03-exec-agent-runtime-t1a.md`.

---

## 2026-04-24 — LLM voice regresses under load; positive examples are necessary but not sufficient

Observed during D.t5 live testing: Claude Sonnet's default register bleeds through any "voice guide" approach that uses only positive examples. Specific tells surfacing under load (long conversations, tool orchestration, strong lean on visitor phrasing): em-dash-heavy rhythm; corporate hedges ("it's worth noting", "that said"); AI-signature verbs ("delve", "unpack", "dive into", "navigate the complexities"); empty-affirmation openers ("Great question!", "I'd be happy to…"); trailing offers ("Let me know if you'd like to explore…"); bullet-heavy responses where a sentence would do.

Chunk G's original §2.1 stance was "a couple of illustrative paragraphs, not a style guide — show, don't tell". That stance is correct for anchoring positive voice but insufficient for suppression. Remedy (landed as G.10 / §2.1a of `planning/02-impl-content.md`): **two-layer voice control**. (a) Positive-example paragraphs in `cms/prompts/why.md` (anchor good). (b) Explicit avoidance block at `cms/prompts/style-avoid.md`, referenced from the WHY prompt (suppress specific defaults). Separating the files means the taste-driven positive pass (Al authors once) stays decoupled from the pattern-driven avoidance list (updates whenever a new tell surfaces).

Living-doc posture: this is the single most likely `cms/` file to iterate post-launch. Chunk F's event log is the long-term source for regression-pattern capture — tells that slip through get logged, clustered, and rolled into the next `style-avoid.md` revision.

---

## 2026-04-24 — Clearing assistant-ui thread state without library internals: re-key the provider + churn the transport

Problem encountered in D.t5: the "New conversation" button (and the error-banner's "Start over" path) needed to tear down the visible chat history AND rebootstrap the server session without bouncing the visitor back to the OpeningScreen. The naive route — call `consent.reset()`, flip status to `pending`, let React re-render — leaves stale assistant-ui state because the `useChatRuntime({ transport })` call in `App.tsx` lives above the re-rendered subtree; the runtime instance and its thread-state survive the re-render and the old messages come back as soon as `hasConsented` flips true again.

Two-part pattern that works:
1. Maintain a `resetKey` integer in `App.tsx`, bumped on every restart.
2. Use `resetKey` as a dep of `useMemo(() => createOrchestratorTransport(), [resetKey])` so a new transport is constructed per restart. Because `useChatRuntime` is passed a new transport reference each time, it initialises a fresh runtime.
3. Pass `key={resetKey}` on `<AssistantRuntimeProvider>` so React fully remounts the subtree — belt-and-braces for any runtime state that might otherwise leak across instances.

This is the simplest honest way to clear assistant-ui thread state at 0.12.25 without reaching for `useThreadRuntime` internals (most of which are deprecated in favour of the forthcoming `aui.*` API). When that new API lands it may expose a first-class "clear thread" affordance, at which point the resetKey pattern can retire. Documented as decision D.14 in `planning/decisions.md`.

Do NOT try to detect "errored message in thread state" as the restart trigger: pre-stream failures (session missing, fetch rejects before any message exists) have no thread-state entry to look at. Adapter-side module emitter (D.12) sidesteps that hole.

---

## 2026-04-24 — Swoop data ontology first pass captured — not canonical

Before Swoop engineering agreed to ship a full SQL dump (Monday 2026-04-27), we did a first-pass inspection of their public Trip Finder JSON feed + one detail page. That produced two durable reference artefacts:

- [data-ontology.md](data-ontology.md) — entity-by-entity inventory: which records are observed vs. implied, which fields are declared-but-empty, controlled tag vocabularies fully enumerated, a prioritised "what to ask Swoop for" table.
- [planning/02-impl-retrieval-and-data-source-exploration.md](planning/02-impl-retrieval-and-data-source-exploration.md) — wrapper context: sources inspected, call confirmations (activities = tags only, Accommodation + Location ARE records, "Pages" is a new entity), Monday pickup checklist.

**Treat both as first-pass references, not canonical.** The SQL dump supersedes them. Once the dump is modelled, the ontology file gets updated with a new `S-SQLDUMP-2026-04-27` source tag and the exploration doc retires to `planning/archive/` (or folds into the parent chunk C doc). Outstanding questions parked under "Data pipeline" in [questions.md](questions.md).

---

## 2026-04-24 — Connector returns `{ok, value}` envelopes — widgets must unwrap

The MCP connector adapter (`product/orchestrator/src/connector/tools.ts`) returns `invokeTool` results as `{ok: true, value: <validated data>}` so structured errors can flow alongside successful payloads through the same channel.

That envelope passes through ADK's `functionResponse.response` and the translator's `tool-call` part `output` field unchanged. Widgets receive `props.result === {ok, value}` and parsing it against `SearchOutputSchema` etc. fails — the schema expects `{hits, totalMatches}`, not the wrapper.

Fix lives in `product/ui/src/widgets/widget-shell.tsx`: the shared `safeParse()` helper auto-detects and unwraps the `{ok: true, value}` envelope before passing to the Zod parser. Backwards-compatible — non-enveloped values pass through.

If you ever change the connector's envelope shape, update `unwrapEnvelope` in `widget-shell.tsx` to match. Or migrate widgets to use the AI SDK envelope conventions if they emerge.

---

## 2026-04-23 — Anthropic tool schemas need JSON Schema draft 2020-12, genai emits draft-04-style

When the orchestrator (`claude-llm.ts`) translates ADK `FunctionDeclaration`s into Anthropic's `tools` array, three divergences must be normalised:
1. **Type enum strings** — genai uses `"OBJECT"` / `"STRING"` / `"INTEGER"` / `"ARRAY"` uppercase. JSON Schema 2020-12 wants lowercase.
2. **Numeric constraints as strings** — genai serialises `minLength: "1"`, `minItems: "1"` etc. as strings (protobuf Long). JSON Schema requires numbers.
3. **Draft-04 exclusiveMinimum booleans** — genai emits `exclusiveMinimum: true` + `minimum: 0`. Draft 2020-12 wants `exclusiveMinimum: 0` directly, with no bare `minimum`.

The normaliser in `claude-llm.ts` handles all three. If you ever build tool declarations some other way, re-apply these rules — Anthropic rejects non-compliant schemas with `"JSON schema is invalid. It must match JSON Schema draft 2020-12"`.

---

## 2026-04-23 — AI SDK v6 `DefaultChatTransport` can't talk to Puma's orchestrator

`DefaultChatTransport` from the `ai` package expects an OpenAI-compatible endpoint accepting `{messages: UIMessage[]}` and returning AI-SDK-formatted stream chunks. Puma's `/chat` takes `{sessionId, message: string}` and returns raw `data: <MessagePart-json>\n\n` SSE events.

The bridge is a **custom `ChatTransport` implementation** in `product/ui/src/runtime/orchestrator-adapter.ts`. It extracts the latest user message text from the `UIMessage[]` array, posts the Puma shape, reads the SSE, and converts each `MessagePart` to the `UIMessageStreamPart` events assistant-ui expects.

If you ever upgrade AI SDK or assistant-ui, re-test this bridge — both libraries are pre-1.0 and their part-type taxonomies churn.

---

## 2026-04-23 — Google ADK 1.0 ships no Claude provider — custom `BaseLlm` shim required

ADK 1.0 (`@google/adk`) has `LlmAgent` + `BaseLlm` + `SessionService` primitives, but the only built-in providers are `Gemini` and `ApigeeLlm`. Claude needs a hand-written `BaseLlm` subclass that translates ADK `LlmRequest`s into Anthropic Messages API calls and yields `LlmResponse` objects from the streaming response.

The shim lives at `product/orchestrator/src/agent/claude-llm.ts`. Translation pieces that matter:
- `content_block_delta` text → `Part.text`
- `thinking_delta` → `Part.text` with `thought: true` — **load-bearing** because the translator keys on `Part.thought` to filter reasoning from the outbound SSE.
- `input_json_delta` → accumulate into per-block buffer; emit `functionCall` only on `content_block_stop`.
- `stop_reason` mapping: `end_turn|stop_sequence|tool_use|pause_turn` → `STOP`; `max_tokens` → `MAX_TOKENS`; `refusal` → `SAFETY`.

---

## 2026-04-23 — assistant-ui is a renderer, not an agent orchestrator

Despite "state management" and "tool calling" language on assistant-ui's site, those refer to **client-side UI state** (thread rendering, tool-call UI registry, widget hydration) — NOT agent orchestration. The agent loop runs server-side.

Reasons to keep the agent server-side:
- API keys can't sit in a browser.
- MCP-exposure future — Puma's orchestrator can eventually double as an MCP server third-party clients consume.
- Per-agent model selection (orchestrator Sonnet + functional Haiku classifier + future specialised agents).
- Warm pool, session persistence, structured observability all require server state.

Recorded formally as decision **D.11** in `planning/decisions.md`.

---

## 2026-04-23 — Two-layer agent model works cleanly in ADK

The **orchestrator** is one ADK `LlmAgent` running Claude Sonnet. **Functional internal agents** (e.g. the triage classifier) run inside tool execution / pre-turn side-effects using their own `BaseLlm.generateContentAsync` call with a different model (Haiku 4.5) — invisible to the orchestrator, which sees a tool result.

This is proven live in `product/orchestrator/src/__tests__/integration/hello-world.test.ts` and verified in the browser (the classifier's Haiku invocation is logged alongside the orchestrator's Sonnet turn).

Scaling the pattern: every new layer-2 agent adds itself to `getModelFor(role)` in `src/config/models.ts` and picks its own model via config (`FUNCTIONAL_CLASSIFIER_MODEL` etc.). No orchestrator-graph complexity needed.

---

## 2026-04-23 — GDPR tier-1 consent must pair with disclosure at conversation start

Session state accumulates conversation data the moment a visitor types. GDPR requires a lawful basis **before** processing. Deferring consent to the handoff (as the original Tier 2 draft had it) would mean processing personal data without a basis.

Puma's posture: **one paired opening screen** — AI disclosure (EU AI Act Art. 50) + tier-1 consent (GDPR basis for conversation storage), with Continue / No thanks. Tier-2 consent at handoff submission covers the more specific contact-detail + outreach step.

Encoded in chunk E Tier 2 (§2.3) and implemented via D.t4. Decision **E.4** in the log.

---

## 2026-04-23 — `<reasoning>` parts must be filtered out of the outbound SSE

Keeping the agent's own reasoning private to the session (but persisted!) is a hard invariant:
- Session history stores the full response across all four block types (`<fyi>`, `<reasoning>`, `<adjunct>`, `<utter>`) so the agent has continuity across turns.
- The outbound SSE to the UI **never** carries reasoning parts.
- UI has a `reasoning-guard` (D.t2) that throws in dev if one sneaks through — catches translator bugs.

Orchestrator translator (B.t4) strips them unconditionally. If you're ever rewriting the translator, preserve this invariant.

---

## 2026-04-23 — `<fyi>` as a tool call is cleaner than a custom part type

User's observation mid-build (captured in `inbox.md`). The current implementation is a state-machine parser + custom `data-fyi` AI SDK part. A cleaner long-term design: register a thin `announce_status` tool; model emits `tool-call` parts which assistant-ui's registry renders as ephemeral status affordances.

Pros: native across ADK + AI SDK + assistant-ui; no custom parser; no custom part type; models are reliable at structured tool-call output.

Swap cost post-M1 is small — retire `block-parser.ts` + `data-fyi` part type, add a tool + one assistant-ui renderer registration.

Captured in `inbox.md` as a post-M1 candidate.

---

## 2026-04-22 — ADK-native skill primitive replaces custom `load_skill` tool

Initial Tier 2 draft had a `load_skill` custom MCP tool. Google ADK 1.0 supports "agent skills" natively — no custom tool needed. Chunk B.t9 wires the native primitive; chunk G authors skill content files. Decision **C.11** in the log.

Verify the native API when you implement B.t9 — the ADK surface is young and may have shifted.

---

## 2026-04-22 — PoC widgets carry layout, not styling or hydration

The ChatGPT PoC's widgets live at `chatgpt_poc/product/ui-react/src/widgets/`. Tempting to copy-paste, but they're **styled for ChatGPT** and **hydrated via ChatGPT's `useApp` / `structuredContent` mechanism**. Neither carries to Puma:
- Styling: Puma wants vanilla Tailwind so Swoop's team can apply brand identity on top.
- Hydration: Puma uses assistant-ui's tool-call registry, not ChatGPT's iframe runtime.

Treat PoC widgets as **wireframes / information-architecture specs**. Extract "what fields" + "what order" and rebuild. Documented in D.t3 plan.

---

## 2026-04-22 — "Derived datasource" terminology is load-bearing

ETL artefacts (Cloud Storage + Vertex AI Search index + annotations) are **derived data** from an authoritative source (Swoop's website / API). This labelling in code + docs prevents future devs / agents from treating the derived store as a write target.

October 2026 Swoop data consolidation will rewrite the ingestion utility — the derived store shape doesn't need to change because it's already derived.

Chunk C Tier 2 §2.2 makes this explicit. Decision **C.12**.
