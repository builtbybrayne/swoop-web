# 03 — Execution: A.t2 — `ts-common` package

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: A (foundations).
**Task**: t2 — shared types package.
**Implements**: `planning/02-impl-foundations.md` §2.2 + §6 (stub contracts).
**Depends on**: A.t1 (workspace scaffolded).
**Produces**: `product/ts-common/` package — Zod schemas + TS types + fixtures for every cross-chunk contract.
**Unblocks**: every downstream chunk (B, C, D, E, F, G, H all consume `@swoop/common`).
**Estimate**: 3–5 hours.

---

## Purpose

Author stub schemas for every cross-chunk contract so that downstream chunks can import them and mock each other at interface boundaries during parallel fan-out (top-level §5). Stubs are **real Zod schemas**, not placeholders — they must validate fixtures. Bodies are minimal; bodies fill in as real implementations meet constraints during Phase 1.

---

## Deliverables

### `product/ts-common/` package skeleton

| File | Role |
|---|---|
| `product/ts-common/package.json` | `"name": "@swoop/common"`, `"private": true`, `"main": "./src/index.ts"`, `"types": "./src/index.ts"` (no build step for now — downstream packages import source via workspace link). Dev deps: `typescript`, `zod`. |
| `product/ts-common/tsconfig.json` | Extends `../tsconfig.base.json`. `module: "Node16"`, `moduleResolution: "Node16"`, `outDir: "./dist"`, `rootDir: "./src"`, `lib: ["ES2022"]`, `noEmit: false`. |

### Schema modules under `product/ts-common/src/`

All schemas use Zod. Each module exports both the Zod schemas and the inferred TS types.

| File | What it defines |
|---|---|
| `domain.ts` | Core content entities: `Trip`, `Tour`, `Region`, `Story`, `Image`. Shapes are **placeholder-plausible** — the Friday hackathon's data-ontology session refines them. At minimum each has `id`, `slug`, `title`, `summary`, plus 1–2 representative fields per type. `Image` includes an optional `annotations` field (see chunk C §2.6a) as a freeform record of tag strings — structure refined during chunk C. |
| `tools.ts` | Tool I/O schemas for the Puma tool set (chunk C §2.5): `search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`. Each with `Input` + `Output` schema. Also: `TOOL_DESCRIPTIONS` constant — map of tool name → description string, used by chunk B when registering tools with ADK. Carry over the descriptive pattern from `chatgpt_poc/product/ts-common/src/tools.ts` (the WHY/HOW/WHAT × User/Agent/Swoop matrix). |
| `streaming.ts` | Message-part types aligned to Vercel AI SDK v5 `message.parts` (verify exact shape at implementation time — library moves). Minimum: `TextPart`, `ToolCallPart` (with the three lifecycle states `input-streaming` / `input-available` / `output-available`), `ReasoningPart`, and a `CustomDataPart` discriminated-union slot for `data-fyi` (and future custom part types). |
| `session.ts` | `SessionState` shape per chunk B §2.6: conversation history, triage state (`null` / `qualified` / `referred_out` / `disqualified` + reason), wishlist-in-progress, **consent state** (`conversation` + `handoff` + `marketing`, each a `{ granted: boolean, timestamp: string, copyVersion?: string }` object), session metadata. |
| `handoff.ts` | `HandoffPayload` per chunk E §2.1: verdict, reason (structured code + freeform text), visitor profile, wishlist, motivation anchor, contact (qualified/referred_out only), consent flags, session metadata, raw-conversation reference. |
| `events.ts` | Per chunk F §2.1 + §2.2: event envelope (type, version, timestamp, session id, turn index, actor, payload) + per-event-type payload schemas. Cover the minimum set from chunk F §2.2 — at least `conversation.started`, `turn.received`, `turn.completed`, `tool.called`, `tool.returned`, `triage.decided`, `handoff.submitted`, `session.ended`, `error.raised`. Remaining event types can be added incrementally by chunk F's agent. |
| `index.ts` | Re-exports everything consumers will import. |

### Fixtures under `product/ts-common/src/fixtures/`

One hand-crafted, schema-valid instance per top-level type. Committed alongside the schemas so all chunks validate against the same examples.

- `fixtures/trip.sample.ts`
- `fixtures/tour.sample.ts`
- `fixtures/region.sample.ts`
- `fixtures/story.sample.ts`
- `fixtures/image.sample.ts`
- `fixtures/session.sample.ts`
- `fixtures/handoff.sample.ts`
- `fixtures/event.sample.ts`

Each exports a `Sample<TypeName>` constant. Content is plausibly Patagonia-flavoured (a "Torres del Paine W Trek" trip, a "Solo Adventurer Group Tour" tour, etc.) — invented but flavoured.

### Sanity tests

`product/ts-common/src/__tests__/fixtures.test.ts` — minimal Vitest file that parses every fixture against its schema. This is the one test that ships with ts-common: catches schema/fixture drift.

---

## Key implementation notes

### 1. Zod is the validation library

Every contract is `z.object(…)`. TS types derived via `z.infer<typeof Schema>`. No `interface` or `type` declarations without a matching Zod schema.

### 2. Discriminated unions for variant types

Triage verdict, handoff verdict, tool lifecycle state — use Zod discriminated unions (`z.discriminatedUnion('field', [...])`) so consumers get exhaustive-match safety.

### 3. Placeholder-plausible, not empty

Stubs are real enough to demo the shape. A `Trip` has at least `id`, `slug`, `title`, `summary`, `heroImageUrl`, `durationDays` — not an empty `z.object({})`. The Friday data-ontology session refines the field set; the scaffold just reserves the location.

### 4. No build step for now

Downstream packages import `ts-common` as source via workspace links. TypeScript-to-TypeScript. No `npm run build` required in `ts-common` during Phase 1. Add build + publish later if we need it for Cloud Run deploys (likely — flagged for chunk A review before M4).

### 5. Comments where the why is non-obvious

Consent state carrying copy-version id — comment that. Discriminated-union design choice over enum+separate fields — comment if it's not self-evident. No prose on every field.

### 6. Fixtures are imported by downstream tests

Chunks B/C/D/E/H will all import fixtures. Keep them ergonomic: plain constants, not factories. Duplication between fixtures is fine.

---

## References from the PoC

- `chatgpt_poc/product/ts-common/src/tools.ts` — starting point for tool description patterns. `TOOL_DESCRIPTIONS` constant carries forward in spirit.
- `chatgpt_poc/product/ts-common/src/domain.ts` — structural reference for content types. Antarctica-flavoured; Puma needs Patagonia equivalents with Tour added.
- `chatgpt_poc/product/ts-common/src/enrichment.ts` — the readiness × warmth model. **Do not carry this forward verbatim**; top-level theme 3 demoted the enrichment model's over-structured role. Some residual concepts may inform `SessionState` triage fields.
- `chatgpt_poc/product/ts-common/src/widgets.ts` — widget schemas. Useful reference for tool-output `structuredContent` shapes; keep only what chunk D's widget port actually needs.

---

## Verification

1. `cd product && npm install` (already succeeded post-A.t1) now resolves `@swoop/common` as a workspace package.
2. `cd product/ts-common && npx tsc --noEmit` passes green.
3. `cd product && npm run typecheck -w @swoop/common` passes green.
4. `cd product && npx vitest run -w @swoop/common` (or equivalent) runs the fixtures test and it passes.
5. Every fixture round-trips through its schema — `Schema.parse(fixture)` returns the same shape it went in as.
6. `grep -r "interface \|type " product/ts-common/src/ --include='*.ts'` returns only `z.infer`-derived types (no hand-written types that escape Zod validation).
7. Importing `@swoop/common` from a placeholder downstream package (A.t4 creates those) resolves without path hacks.

---

## Handoff notes

- **Do not add real implementation to any schema.** Schemas evolve during downstream Phase 1 work; keep Puma-valid but minimal.
- **Do not wire anything to external services here.** `ts-common` is pure types + schemas + fixtures.
- **Do not add conversation content or prose.** Content-as-data lives in `product/cms/` (chunk G).
- If a schema turns out to need a field the Tier 2 docs didn't mention, propose it via a planning-doc PR first, then add to the Zod schema.
- Chunk A's decision log (A.t5) records the Zod version chosen.
