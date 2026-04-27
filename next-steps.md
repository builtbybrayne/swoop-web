# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Status (2026-04-24, late — waves 1 + 2 landed)

M1 live. Today's work: D.t5 error-states, wave-1 swarm (D.t6 + D.t7 + E.t1 + F-a + H.t1), wave-2 swarm (D.t8 + F-b + B.t10). Chunk D is **closed end-to-end**. Style-avoid first pass lives at `product/cms/prompts/style-avoid.md` (G.10).

Wave-2 highlights:
- **D.t8** brand-extension surface — 12 CSS custom-properties tokens scoped to `[data-swoop-root]`, 10 `data-swoop-part` attribute hooks on primitives, `product/ui/HANDOVER.md` for Swoop's in-house team, iframe embed recipe + CSP + CORS contract (D.21–D.25).
- **F-b** observability retrofit — 27 producer sites routed through `emitEvent`; 8 diagnostic console-logs kept intentionally; UI now has a thin `emit-ui-event.ts` wrapper hiding sessionStorage boilerplate.
- **B.t10** warm session pool — shipped with `WARM_POOL_SIZE=0` default (no behaviour change). LIFO stack, eager startup pre-warm, in-flight guard, sweep interval capped at 5 min. Two emitted kinds (`warm_pool.hit` / `warm_pool.miss`). Code path exists for a post-M4 flip when a network-backed session backend lands (B.16–B.21).

**Tests**: 242/242 green across `@swoop/common` (43), `@swoop/orchestrator` (111), `@swoop/ui` (69), `@swoop/harness` (19). Full workspace typecheck clean.

Friday hackathon is superseded — Swoop engineering committed to a full SQL dump for **Mon 2026-04-27**. Chunk C reshapes around that.

---

## Next up

### 1. Monday 2026-04-27 SQL-dump ingest + chunk C unblocking [~half day]

Swoop engineering ship a full SQL dump Monday. Session to: inspect schema, map against `data-ontology.md` first-pass, decide one-off vs. scheduled feed, close the "is this the upstream source of truth?" question. Outputs: updated `data-ontology.md`, closed questions in `questions.md` (schema section), ready-to-author Tier 3 plans for C.t1–t8.

### 2. G.10 — style-avoid review [~0.25 day]

First pass by me shipped at `product/cms/prompts/style-avoid.md` (voice-agnostic, pulls from Al's `alastair-writing-style` skill `Don't` list, excludes his personal preferences). Al's next pass: read, edit, add any tells I missed. Becomes living doc once real conversations feed it.

### 3. Chunk C — Retrieval & data [~3–4 days after Monday]

- **C.t0** — SQL dump synthesis (#1 above).
- Produce Tier 3 plans for C.t1–t8 just-in-time.
- Replace stub connector with real `@swoop/connector` against whatever storage layer the Monday session settles on.
- Image annotation pipeline (parallelisable — can start as soon as media access path is clear).

### 4. Chunk G — Content (bulk) [~3–4 days incl. HITL]

- **G.t0** — HITL conversational flow mapping with Al (Patagonia triage inflections, user-type differentiation, motivation anchoring, handoff triggers). Output: `planning/patagonia-conversational-architecture.md`.
- **G.t1** — WHY system prompt first pass; references `style-avoid.md` from #3.
- **G.t3** — ≥2 seed skills in `product/cms/skills/`.
- **G.t5** — Refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).

### 5. Remaining chunk E — Handoff & compliance [~2–3 days]

E.t1 shipped in wave 1. Still open:
- **E.t2–t4** — Durable handoff store (Firestore), verdict-aware email delivery, end-to-end consent flow + connector-side backstop using `HandoffSubmitConsentGate`.
- **E.t5** — Draft real legal copy (`product/cms/legal/*`).
- **E.t6–t8** — Retention enforcement, data-deletion runbook, compliance bundle.
- **E.t9** — Swoop's legal counsel review (external; gates M5).

### 6. Remaining chunk H — Validation harness [~2 days]

H.t1 (scaffold) shipped. Still open:
- **H.t3** — assertion catalogue (tool-call, triage-verdict, handoff-event, disclosure, refusal). Imports from `@swoop/common/events` (now stable after F-b).
- **H.t4** — real evalset from G.t0's HITL output (replaces the 10 stubs).
- **H.t5** — Claude Opus judge + Cohen's κ calibration.
- **H.t7** — living-evalset runbook (real conversations feed new scenarios).

### 7. Chunk B — Deferred remaining [~0.5 day]

B.t10 shipped in wave 2 (disabled by default). Still open:
- **B.t8** — Response-format parser (conditional; only if post-M1 real conversations surface the need).
- **B.t9** — Modular-guidance loader via ADK-native skill primitive (pairs with chunk G.t3).

### 8. M4 deployment

- Swoop-provided GCP "AI Pat Chat" IAM (blocked on Thomas Forster).
- Cloud Run deploys for orchestrator + connector; Cloud Run Job for ingestion.
- Session backend flips from in-memory → Vertex AI Session Service or Firestore.
- Secrets via GCP Secret Manager.
- CI extended with `deploy.yml` workflow.

### 9. M5 ship

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
