# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Status (2026-04-24, late)

M1 live. D.t5 error-states shipped earlier today (five surfaces, adapter emitter pattern, `cms/errors/en.json`, "New conversation" button, decisions D.12–D.14). Wave-1 parallel swarm then landed:

- **D.t6** — proactive session preflight. New `GET /session/:id/ping`; mount/focus/idle triggers with 2s debounce + in-flight guard; expiry routes through D.t5's adapter emitter. Decisions D.15–D.20.
- **D.t7** — mobile reflow. Header label `sm:hidden`; lead-capture inputs `w-full`. Tailwind defaults unchanged.
- **E.t1** — handoff payload schema. Per-verdict enums (14 codes, disjoint), `.strict()` validation, `HandoffSubmitConsentGate` backstop type.
- **F-a** — 20-kind event schema + `emitEvent` helper (pluggable sink, validation-failure fallback, never throws).
- **H.t1** — `@swoop/harness` workspace. Bespoke Node CLI, YAML scenarios, 13 seeds (3 filled + 10 stubs), non-gating label-gated CI. Decisions H.9–H.13.

Also added today (plan-level, not code): **G.10 — two-layer voice control** (§2.1a in content Tier 2). Positive examples in `why.md` + explicit anti-pattern list at `cms/prompts/style-avoid.md`. Triggered by real AI-slop output observed during D.t5 live testing (em-dashes, "delve", empty affirmations).

**Tests**: 221/221 green across `@swoop/common` (43), `@swoop/orchestrator` (101), `@swoop/ui` (58), `@swoop/harness` (19). Full workspace typecheck clean.

Friday hackathon is superseded — Swoop engineering committed to a full SQL dump for **Mon 2026-04-27**. Chunk C reshapes around that.

---

## Next up

### 1. Monday 2026-04-27 SQL-dump ingest + chunk C unblocking [~half day]

Swoop engineering ship a full SQL dump Monday. Session to: inspect schema, map against `data-ontology.md` first-pass, decide one-off vs. scheduled feed, close the "is this the upstream source of truth?" question. Outputs: updated `data-ontology.md`, closed questions in `questions.md` (schema section), ready-to-author Tier 3 plans for C.t1–t8.

### 2. D.t8 — handover doc [~half day]

Last remaining chunk-D task. Brand-extension surface for Swoop's in-house team: CSS custom-properties surface (colour/spacing/radius tokens), component override slots, iframe embed recipe + origin/CSP guidance. Documents what Swoop's team CAN and CANNOT change without forking Puma. Unblocks M5 iframe embed on Swoop's site.

### 3. G.10 — style-avoid authoring (can start solo) [~half day]

Doesn't need the G.t0 HITL session. Al authors `product/cms/prompts/style-avoid.md` from his own `alastair-writing-style` skill + offenders observed during D.t5 testing. Starter list is in `planning/02-impl-content.md` §2.1a; refine + add new tells. Independent of G.t0; compounds with it later.

### 4. Chunk C — Retrieval & data [~3–4 days after Monday]

- **C.t0** — SQL dump synthesis (#1 above).
- Produce Tier 3 plans for C.t1–t8 just-in-time.
- Replace stub connector with real `@swoop/connector` against whatever storage layer the Monday session settles on.
- Image annotation pipeline (parallelisable — can start as soon as media access path is clear).

### 5. Chunk G — Content (bulk) [~3–4 days incl. HITL]

- **G.t0** — HITL conversational flow mapping with Al (Patagonia triage inflections, user-type differentiation, motivation anchoring, handoff triggers). Output: `planning/patagonia-conversational-architecture.md`.
- **G.t1** — WHY system prompt first pass; references `style-avoid.md` from #3.
- **G.t3** — ≥2 seed skills in `product/cms/skills/`.
- **G.t5** — Refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).

### 6. Remaining chunk E — Handoff & compliance [~2–3 days]

E.t1 shipped in wave 1. Still open:
- **E.t2–t4** — Durable handoff store (Firestore), verdict-aware email delivery, end-to-end consent flow + connector-side backstop using `HandoffSubmitConsentGate`.
- **E.t5** — Draft real legal copy (`product/cms/legal/*`).
- **E.t6–t8** — Retention enforcement, data-deletion runbook, compliance bundle.
- **E.t9** — Swoop's legal counsel review (external; gates M5).

### 7. F-b — Observability retrofit [~1 day]

F-a shipped in wave 1 (schema + `emitEvent` helper). F-b retrofits every producer:
- Orchestrator: replace `console.log` sites in `server/chat.ts`, `session/*`, `functional-agents/*`, `server/session-ping.ts` with `emitEvent` calls.
- Connector: tool invocation / tool error.
- UI: conversation open/close, widget render, handoff triggered.
- Spot-check runbook.
- BigQuery export readiness (schema-only; enable only if Swoop asks).

### 8. Remaining chunk H — Validation harness [~2 days]

H.t1 (scaffold) shipped. Still open:
- **H.t3** — assertion catalogue (tool-call, triage-verdict, handoff-event, disclosure, refusal). Imports from `@swoop/common/events` once F-b stabilises.
- **H.t4** — real evalset from G.t0's HITL output (replaces the 10 stubs).
- **H.t5** — Claude Opus judge + Cohen's κ calibration.
- **H.t7** — living-evalset runbook (real conversations feed new scenarios).

### 9. Chunk B — Deferred [~1–1.5 days]

- **B.t8** — Response-format parser (conditional; only if post-M1 real conversations surface the need).
- **B.t9** — Modular-guidance loader via ADK-native skill primitive (pairs with chunk G).
- **B.t10** — Warm session pool.

### 9. M4 deployment

- Swoop-provided GCP "AI Pat Chat" IAM (blocked on Thomas Forster).
- Cloud Run deploys for orchestrator + connector; Cloud Run Job for ingestion.
- Session backend flips from in-memory → Vertex AI Session Service or Firestore.
- Secrets via GCP Secret Manager.
- CI extended with `deploy.yml` workflow.

### 10. M5 ship

- Legal sign-off from Swoop's counsel.
- Iframe embed by Swoop's in-house team (Thomas/Richard).
- Brand styling (Swoop-owned).

---

## Open dependencies on Swoop

Tracked in [questions.md](questions.md). Blockers:

- **Friday 24 Apr data hackathon** — shapes chunk C.
- **Patagonia sales-thinking doc** (Luke + Lane, ~May 4) — shapes chunk G.
- **GCP "AI Pat Chat" IAM** (Thomas) — required for M4.
- **Claude account tier confirmation** (Julie → Tom) — affects scraper cost routing in C.
- **Sales inbox + SMTP** (Julie) — blocks M3.
- **Legal counsel review** (Swoop-owned) — blocks M5.
- **Analytics platform preference** (Julie) — shapes F's schema and BigQuery export decision.

---

## Process gotchas to watch for

See full list in [gotchas.md](gotchas.md). The greatest hits:
- `dotenv({ override: true })` — Claude Code's shell injects empty `ANTHROPIC_API_KEY`.
- Haiku 4.5 model id: `claude-haiku-4-5-20251001` (NOT `-20250929`).
- Orchestrator restart → in-memory sessions die → clear `sessionStorage` + re-consent.
- `preview_stop` + `preview_start` if Vite modules get stuck.

---

## What NOT to do

- Don't touch the ChatGPT PoC at `chatgpt_poc/` — read-only reference (symlink to `~/Studio/projects/swoop/`).
- Don't inline content (prompts, brand copy, legal text) in TypeScript — use `product/cms/`.
- Don't commit `.env` files.
- Don't hand back to Swoop without the legal counsel sign-off loop (M5 gate).
- Don't re-raise parked threads (Prompt Loom integration, Platform48 joint pitch) without Al explicitly reopening them — see `swoop` skill's "What not to do" section.
