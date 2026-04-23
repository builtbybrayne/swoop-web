# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Immediate (unblocks M1 polish)

### 1. Stub connector fixture schema alignment [~30 min]

The agent triggers tool calls and the UI renders `"This content couldn't be displayed."` because the stub's responses don't match `@swoop/common` output schemas.

**Files:**
- `product/orchestrator/test-fixtures/stub-connector.ts` (read current responses)
- `product/ts-common/src/tools.ts` (`SearchOutputSchema`, `GetDetailOutputSchema`, `IllustrateOutputSchema`, `HandoffOutputSchema`)
- `product/ts-common/src/fixtures/` (reuse existing Patagonia-flavoured samples)

**What to do:**
1. For each tool in the stub, parse its current response body through the matching Zod output schema and note validation errors.
2. Reshape payloads to match. Reuse fixtures; extend them if a widget-needed field is missing from the domain fixture rather than inlining in the stub.
3. Test via the live UI — triggering `search` etc. should render real widgets (card grid, detail view, carousel) instead of the malformed placeholder.

### 2. Markdown rendering in text parts [~30 min]

`**bold**` currently renders literally.

**Files:**
- `product/ui/src/parts/fyi-signaling-text.tsx` (current text renderer, D.t2-wrapped)

**What to do:**
1. `cd product/ui && npm install react-markdown remark-gfm @tailwindcss/typography`.
2. Enable the typography plugin in `product/ui/tailwind.config.js` (`plugins: [require('@tailwindcss/typography')]`).
3. Rewrite `fyi-signaling-text.tsx` to render its text content via `<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>`, wrapped in a `<div className="prose prose-slate ...">` or minimal custom styles. Preserve D.t2's `text-arrived` emission on first non-empty render.
4. Safety: do not enable the `rehype-raw` plugin — don't render HTML from the model.
5. Link handling: all links open in new tab with `rel="noopener noreferrer"`.
6. Verify via live UI — markdown renders cleanly.

Both fixes can go in a single session. Neither touches the orchestrator, translator, or agent loop.

---

## After M1 polish

### 3. Deferred D chunks [~half day]

- **D.t5 Error states** — orchestrator unreachable, SSE drop, tool failure, session expired, rate-limited.
- **D.t6 Session handling** — session expiry UX, reconnection flow.
- **D.t7 Mobile reflow pass** — already partially tested at 375px; dedicated pass for widget responsiveness.
- **D.t8 Handover doc** — brand-extension surface (CSS vars / component override slots) for Swoop's in-house team.

### 4. Chunk C — Retrieval & data [~3–4 days after Friday hackathon]

- **C.t0** Friday 24 Apr data hackathon synthesis — API-direct vs scrape decision, media library access path, URL-reconstruction feasibility. Update `planning/02-impl-retrieval-and-data.md` + `questions.md` post-hackathon.
- Produce Tier 3 plans for C.t1–t8 just-in-time.
- Replace the stub connector with the real `@swoop/connector` package running against Vertex AI Search.
- Image annotation pipeline (parallelisable — can start as soon as media library access lands).

### 5. Chunk G — Content [~3–4 days incl. HITL]

- **G.t0** — HITL conversational flow mapping session with Al. Covers Patagonia triage inflections, user-type differentiation, motivation anchoring, handoff triggers. Output: narrative spec at `planning/patagonia-conversational-architecture.md` (or similar).
- **G.t1** — WHY system prompt first pass (Patagonia-voiced).
- **G.t3** — At least two seed skills in `product/cms/skills/`.
- **G.t5** — Refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).

### 6. Chunk E — Handoff & compliance [~2–3 days]

- **E.t1** — Finalise handoff payload schema (verdict + reason taxonomy).
- **E.t2–t4** — Durable handoff store (Firestore), verdict-aware email delivery, end-to-end consent flow.
- **E.t5** — Draft real legal copy (`product/cms/legal/*`).
- **E.t6–t8** — Retention enforcement, data-deletion runbook, compliance bundle.
- **E.t9** — Swoop's legal counsel review (external; gates M5).

### 7. Chunk F — Observability [~1–1.5 days]

- Authoring `emitEvent` helper and full event schema into `@swoop/common/events.ts`.
- Retrofitting existing B/C/D/E code to use the helper instead of `console.log`.
- Spot-check runbook.
- BigQuery export readiness (schema-only; enable actual export only if Swoop asks).

### 8. Chunk H — Validation harness [~2–3 days]

- TypeScript harness scaffold.
- 10–15 starter scenarios drawn from G.t0's HITL output.
- Claude Opus judge + rubric calibration.
- CI integration (non-gating at launch).

### 9. Chunk B — Deferred [~1–1.5 days]

- **B.t8** — Response-format parser (conditional; only if post-M1 real conversations surface the need).
- **B.t9** — Modular-guidance loader via ADK-native skill primitive (pairs with chunk G).
- **B.t10** — Warm session pool.

### 10. M4 deployment

- Swoop-provided GCP "AI Pat Chat" IAM (blocked on Thomas Forster).
- Cloud Run deploys for orchestrator + connector; Cloud Run Job for ingestion.
- Session backend flips from in-memory → Vertex AI Session Service or Firestore.
- Secrets via GCP Secret Manager.
- CI extended with `deploy.yml` workflow.

### 11. M5 ship

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
