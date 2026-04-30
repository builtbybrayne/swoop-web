# 03 — Execution: C.t5 Image URL utility + page-as-hub resolver

**Status**: **DRAFT — for HITL review. Not yet executable.**
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t5** task ("Image URL utility + page-as-hub resolver"). Operationalises decisions C.15 (URL + image construction rules) and C.16 (page-as-hub pattern), and packages two pieces of logic that would otherwise be re-implemented inconsistently across C.t3 (ETL), C.t3a (embedding pass), C.t4 (tool handlers), and any future widget-side rendering.
**Depends on**: C.t2 closed (entity model + tool I/O schemas + migrations 001–006); A.t1–A.t5 (workspace, `ts-common` scaffold).
**Blocks**: nothing strictly — C.t3 / C.t3a / C.t4 can technically inline the logic, but they shouldn't. This task is a small but load-bearing bit of margin.
**Produces**:
- `product/ts-common/src/url.ts` — `canonicalUrl(record)` helper that mirrors the `canonical_url(override_url, alias)` SQL function from migration 005, plus a `pagePath(record)` helper for ETL-side path-only construction.
- `product/ts-common/src/image.ts` — `imgixUrl(filename, params?)` helper for the imgix-render-param composition and `resolveImageSet(record, joins)` helper that encodes the page-as-hub fallback chain.
- `product/ts-common/src/index.ts` — re-exports.
- Fixtures under `product/ts-common/src/fixtures/` — round-trippable inputs for both helpers (page record with `override_url`, page record with only `alias`, trip record with direct `image_trip` join, hotel record with only `page_id`-attached images, image filename with no params, image filename with custom params).
- Decision-log entries (`planning/decisions.md`) for any C.t5-specific calls (likely a C.35 entry on default imgix render parameters and a C.36 entry on where the imgix base host string lives).
**Estimate**: ~0.5 day. Most cost is in choosing the imgix render-param defaults (item 1 in open questions) and the join-shape contract for `resolveImageSet` (the call sites are ETL + tool handler + maybe widget; same function or three?).

---

## ★ Read this first — calibration before code

> **Before you author either helper, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"★ Read this first — the WHY of chunk C" end-to-end.** Same calibration that gates C.t2 / C.t3 / C.t4 / C.t6 — even a small utility task has to land top-down. The discipline is *especially* easy to lose on a "small task" because the design questions feel mechanical.

The compressed reminder for C.t5 specifically:

- **Both helpers exist to serve a journey moment, not because the data shape is convenient.** `canonicalUrl` exists because the agent says *"go see this page"* and the visitor needs a clickable URL that lands on the right Swoop page (Awareness → Interest deepening). `imgixUrl` + `resolveImageSet` exist because the agent says *"here's what that part of Patagonia looks like"* and the visitor needs a hero image that's properly sized, mood-matching, and genuinely from Swoop's catalogue (Inspire job, often paired with `find_inspiring` or `illustrate`).
- **The bottom-up trap here**: *"We have `image_trip` and `image_page` and `image_hotel` join tables — let's expose all of them through a `getImagesForEntity(entity)` function."* Wrong. The page-as-hub pattern (C.16) settled the right shape: direct join wins; otherwise traverse via `page_id`; otherwise empty. The helper encodes one rule, not a switch over five table layouts.
- **C.t5 is small enough that the temptation is to inline it everywhere instead of authoring the helper.** Resist. ETL writes `canonical_url` to a column; tool handlers join that column; runtime URL composition still happens (the imgix host + render params live outside the DB row). The helper is what keeps "URL composition lives in one place" honest as call sites multiply.

---

## Purpose

C.t5 packages the two pieces of URL/image construction logic that the canonical chunk-C plan has called out repeatedly. Both have already been encoded in **specific places** (the SQL `canonical_url` function in migration 005; the `image` table schema with `canonical_url` per Al's 2026-04-29 spec); C.t5 ships the **TypeScript helpers** that the runtime + ETL share.

Why a helper task at all rather than inlining at each call site:

- The imgix base host string and the default render-param set are *runtime* concerns — they change without re-running ETL. SQL columns can carry a stable filename and a derived URL, but the imgix layer doesn't belong in Postgres.
- The page-as-hub fallback chain (direct image join → page-attached → empty) appears in C.t3 (ETL populates `image_id` on derived tables), C.t4 (tool handlers join images for output), and potentially in any future widget that hydrates an image client-side. Three call sites is enough to justify a single helper.
- `canonical_url` exists as both an SQL function (migration 005, used by `export.sql`) and a TypeScript helper (this task, used by anything that constructs a URL outside Postgres — e.g. an ETL pre-flight check, a fixture authored by hand, a widget-side test).

C.t5 ships nothing new conceptually. It ships the consistency.

---

## Out of scope

Name it so a future agent doesn't drift:

- **No new schema changes**. The `canonical_url` column on `trip` / `page` / `hotel` / etc. is already in migration 002. The `canonical_url` SQL function is in migration 005. C.t5 ships TypeScript counterparts; no SQL touches.
- **No image annotation work**. The `image` table's `description` / `alt_text` / `tags` / `embedding` columns are populated by C.t6 (image annotation pipeline). C.t5 only reads filenames + URLs.
- **No data primitives**. `resolve_image_set` as a SQL helper inside the connector's `src/data/` directory is a C.t4 concern. C.t5 ships the *TypeScript* function; C.t4 may wrap it in a SQL helper or call it post-fetch.
- **No imgix CDN configuration**. Whether Swoop's imgix tenant is provisioned, what its rate limits are, and whether render params are billed per variant — all out. We assume imgix works.
- **No client-side rendering**. D.t9 widgets call these helpers (or a thin wrapper); the helpers themselves are isomorphic and don't import any DOM.
- **No removal of the SQL `canonical_url` function**. ETL keeps using it; the TypeScript helper is for runtime + non-SQL contexts.

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — especially §"★ Read this first", §2.5 (image table shape), §2.6 (image rendering and URL construction), §2.8 (deep-link URL generation).
- [`decisions.md`](decisions.md) — C.15 (URL + image construction), C.16 (page-as-hub).
- [`discoveries.md`](../discoveries.md) — 2026-04-29 entries on `override_url || alias`, page-as-hub, two-table image model (`image` ↔ `file`).
- `product/connector/migrations/002_domain_tables.sql` — the `image`, `page`, `trip`, `hotel`, `location` columns and their `canonical_url` placement.
- `product/connector/migrations/005_canonical_url_function.sql` — the SQL function this helper mirrors.
- `product/ts-common/src/derived.ts` — `DerivedImageSchema` and how the public projections wrap a joined image record.

---

## Outputs (files to write/modify, with paths)

### `@swoop/common` source

`product/ts-common/src/url.ts` (new):

- `canonicalUrl(input: { override_url?: string | null; alias: string }): string` — returns the path-only canonical (e.g. `chile/torres-del-paine/hiking/w-trek/original`). Mirrors the SQL `canonical_url(override_url, alias)` exactly: empty string treated as absent; `override_url` wins when present and non-empty; `alias` is the fallback.
- `pageUrl(input: { override_url?: string | null; alias: string }, options?: { host?: string }): string` — full URL form, prepends the Swoop host. Default host comes from a constant (see open question 2).
- Constants exported: `SWOOP_PATAGONIA_HOST` (default `https://www.swoop-patagonia.com/`).

`product/ts-common/src/image.ts` (new):

- `imgixUrl(filename: string, params?: ImgixParams): string` — composes `https://swoop-patagonia.imgix.net/<filename>?<query-string>`. Default params merged from a constant (see open question 1).
- `ImgixParams` type — at least `w`, `h`, `q`, `fit`, `auto`, `crop`. Strict object Zod-checked at call site is overkill; a TypeScript interface is sufficient.
- Constants exported: `IMGIX_HOST` (default `https://swoop-patagonia.imgix.net/`), `IMGIX_DEFAULT_PARAMS` (the baseline render set — see open question 1).
- `resolveImageSet(record: HasImageJoins, joins: ImageJoinTables): ResolvedImage[]` — the page-as-hub fallback. Pure function over already-fetched join data (the SQL is C.t4's job; this helper just walks the result).
  - Step 1: if `record.image_ids` (direct join, e.g. `image_trip`) non-empty → return those.
  - Step 2: else if `record.page_id` is set and `joins.page_images[record.page_id]` non-empty → return those.
  - Step 3: else return empty array.
  - The function does not fetch; it composes. Callers decide what counts as "fetched".

`product/ts-common/src/index.ts` — re-export everything from `url.ts` and `image.ts`.

### Fixtures

`product/ts-common/src/fixtures/` — five new tiny fixtures:

- `url-trip-with-override.ts` — `{ override_url: 'chile/torres-del-paine/hiking/w-trek/original', alias: 'w-trek-torres-del-paine' }` → expects `chile/torres-del-paine/hiking/w-trek/original`.
- `url-page-alias-only.ts` — `{ override_url: null, alias: 'about-swoop' }` → expects `about-swoop`.
- `url-empty-override.ts` — `{ override_url: '', alias: 'fallback-alias' }` → expects `fallback-alias` (empty string treated as absent, matching the SQL function).
- `image-imgix-default.ts` — filename `torres-del-paine-sunrise.jpg`, no params → expects default render set in querystring.
- `image-resolve-page-hub.ts` — hotel with `page_id: 42`, `joins.page_images[42] = [<image>]` → expects the page-attached set returned.

Plus a corresponding `__tests__/url.test.ts` and `__tests__/image.test.ts` in the existing common-package test directory (or wherever `fixtures.test.ts` lives).

### Decision log

`planning/decisions.md` — likely two entries:

- **C.35** — Default imgix render parameters. The set agreed at execution time. Carries the rationale (e.g. *"`auto=format,enhance,compress&fit=crop&q=80` for chat-inline; widget hero variants override `w` + `h`"*).
- **C.36** — Where the imgix host string lives. Recommended: as a constant in `@swoop/common/image.ts` (matching the simplicity stance — no env var unless prod actually has multiple imgix tenants). Recorded so future agents don't relitigate.

---

## Architectural principles applied here

- **One rule, one place**. `canonical_url` is in three layers — SQL function, TypeScript helper, derived `canonical_url` column. All three share the same rule. C.t5 keeps the TypeScript helper exactly synchronised with the SQL function; if either changes, the other follows in the same commit.
- **Page-as-hub is a fallback chain, not a switch**. The right shape is "try direct, fall back to page, return empty." Not a polymorphic dispatch over entity type. Decision C.16.
- **Runtime concerns stay outside Postgres**. The imgix host + render params don't belong in the DB — they shift independently. They live in `@swoop/common` constants.
- **Pure functions, no I/O**. Both helpers are referentially transparent. They can be tested with hand-authored fixtures; no Postgres, no network. The fetch is the caller's job.
- **Top-down justification**. Both helpers exist because the agent does the *"go see this page"* and *"here's what that looks like"* moves. If those moves disappear from the journey, the helpers retire.

---

## Components, file paths

| Component | Path | Existing or new |
|---|---|---|
| `canonicalUrl` + `pageUrl` | `product/ts-common/src/url.ts` | New |
| `imgixUrl` + `resolveImageSet` + `ImgixParams` | `product/ts-common/src/image.ts` | New |
| Re-exports | `product/ts-common/src/index.ts` | Existing — append |
| Tests | `product/ts-common/src/__tests__/url.test.ts`, `__tests__/image.test.ts` | New |
| Fixtures | `product/ts-common/src/fixtures/url-*.ts`, `fixtures/image-*.ts` | New |
| SQL parity reference | `product/connector/migrations/005_canonical_url_function.sql` | Existing — read-only here |

The connector and ETL workspaces *consume* the helpers but C.t5 itself doesn't touch them. C.t3, C.t3a, and C.t4 import from `@swoop/common` per their own briefs.

---

## Verification

Task is done when:

1. `cd product && npm run typecheck` is green across the workspace.
2. `cd product && npm run lint` is green.
3. `cd product && npm test --workspace @swoop/common` passes — every fixture round-trips, every helper returns the expected output for every fixture case, and a parity test confirms `canonicalUrl(...)` produces the same value as the SQL `canonical_url(...)` function for ten hand-picked inputs (parity test optional but recommended; can be a docstring-only verification step if running psql in CI is fragile).
4. `product/ts-common/src/url.ts` exports `canonicalUrl`, `pageUrl`, `SWOOP_PATAGONIA_HOST`. Each has a JSDoc comment that names the SQL function it mirrors and points at decision C.15.
5. `product/ts-common/src/image.ts` exports `imgixUrl`, `resolveImageSet`, `ImgixParams`, `IMGIX_HOST`, `IMGIX_DEFAULT_PARAMS`. Each has a JSDoc comment that names the decision it implements (C.15 + C.16).
6. The five new fixtures exist and are exercised in tests.
7. `product/ts-common/src/index.ts` re-exports everything from both new files.
8. `planning/decisions.md` has C.35 + C.36 entries (or whatever is closed at execution time).
9. Execution log appended to this Tier 3 plan summarising what landed.

---

## Open questions for execution time

Numbered for tracking. Items 1 + 2 should be closed by Al before the executing agent starts — they're style/ops calls more than implementation calls.

1. **Default imgix render parameters** — what's the baseline param set? Candidates:
   - **`auto=format,enhance,compress&fit=crop&q=80`** — minimum sensible defaults. Width / height are caller-supplied per variant.
   - **`auto=format,compress&q=80`** — leaner. Skip `enhance` (it can wash out muted Patagonia palettes; might fight Swoop's brand).
   - **No defaults — caller composes everything**. Most flexible; least DRY.

   Recommendation: start with the first option and document the call. If Swoop's brand voice on imagery comes back disliking `enhance`, drop to the second. Configurability per call site is already supported via the `params` argument; defaults only set the floor.

2. **Where does the imgix base host string live**? Candidates:
   - **Constant in `@swoop/common/image.ts`** — current recommendation. Single tenant, no env. If Swoop ever moves imgix tenants the change is one line.
   - **Env var** (`IMGIX_HOST`) — overkill for one tenant; also means the value can drift between orchestrator/connector if they pull `.env` differently.
   - **CMS config** (`product/cms/config/`) — overkill at this scale; CMS is for content, not infra strings.

   Recommendation: constant. C.36 records the call.

3. **Is `pageUrl` actually needed**, or do we always work with path-only `canonicalUrl` and let the consumer prepend the host? ETL writes `canonical_url` (path-only) to Postgres; tool handlers may want to render the full URL. Recommendation: ship both, mark `pageUrl` as a thin convenience wrapper. Negligible cost; clearer at call sites.

4. **Should `resolveImageSet`'s `joins` shape be Zod-validated**, or is a TypeScript-only contract enough? Recommendation: TypeScript interface only at this layer — the function is a pure composer over already-fetched data; the validation happened at the SQL boundary. Zod would slow tool handlers needlessly.

5. **Can `resolveImageSet` ever return more than one direct image when both `image_trip` and `image_page` paths exist for a trip?** Per the 2026-04-29 discovery: trips have BOTH paths. The helper returns direct-join images and short-circuits — page-attached images are never added on top. If a future use case wants the union (e.g. "show every image we have for this trip"), it's a separate helper, not an option flag here. Recommendation: keep the short-circuit; document it with a JSDoc note pointing at the discovery.

---

## Risks

- **Helper drifts from SQL**. If migration 005's `canonical_url` function is ever revised (e.g. to handle a new `external_url` column), the TypeScript helper must update in the same commit. Mitigation: a one-line parity-test docstring naming the migration. Optional: a CI step that runs the SQL function and the TS helper against ten shared inputs and diffs the result. Probably overkill until migration 005 actually changes.
- **Default imgix params bake in a brand decision the brand owner hasn't made**. The render-param set is content-shaped (it shapes how images feel). C.t5 picks a sensible technical default; if Swoop's brand-imagery review later wants something different, the constant moves. Mitigation: scope the constant tight; document the call in C.35 so a future agent doesn't go hunting.
- **`resolveImageSet`'s short-circuit semantics surprise a future caller**. A handler that expects "every image we have for trip X" gets only the direct-join set, not the union with page-attached. Mitigation: JSDoc + the open-question-5 stance documented inline. Test asserts on the short-circuit explicitly.
- **The two helpers feel like overkill for tiny code**. They are tiny. The value is *consistency across call sites*, not function-line-count. Mitigation: keep the brief tight; don't pad with abstractions. Both files should be under 80 lines combined.

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*
