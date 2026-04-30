# Code-Level Review — Swoop Web Discovery (Puma)

**Date**: 2026-04-30
**Method**: 12-expert parallel council (10 code-quality lenses + forward/reverse drift auditors), grounded in deterministic preflight at `.review/preflight.md`. Each finding cites `file:line` per evidence rule.
**Trigger**: Alastair's HITL request for a code-level review after the planning-level review (`2026-04-30-state-of-play.md`) plus the close-out merge `48fc6fe`.
**Scope**: ~24,600 LOC across 6 npm workspaces. 416/416 tests passing pre-review. Typecheck clean.

---

## How to work this checklist (for future agents)

If you're an agent picking up this review for the first time:

1. **Recommended order**: take the 🔴 R-class items in [next-steps.md](../../next-steps.md) "Pre-chunk-work close-out" section before starting any new chunk-C / chunk-G work. They're cheap, they're production blockers, and most of them touch the schema spine that downstream chunk work depends on.
2. **Per-item dispatch**: pick a 🔲 row from the checklist below → follow the link to the addendum (in `planning/03-exec-<chunk>-<task>.md` "## 2026-04-30 code-review fixes" section) or cross-cut file (`planning/03-exec-crosscut-*-fix.md`). Each row carries problem (with file:line evidence), fix-shape, verification, and a `Commits:` slot. That's a complete dispatch brief.
3. **On completion**:
   - Tick the checkbox in this review's checklist (🔲 → ✅).
   - Append the commit ref to the addendum's `Commits:` slot.
   - Commit message format: `fix(<scope>): close <item-id> — <one-liner> (2026-04-30 review)`.
4. **Cross-cut items**: H1–H5 should pair with whatever chunk-work is touching the same files (e.g. land H1 messageOf when next in `@swoop/common`). Don't create a "review fixes" sprint divorced from chunk work — interleave for maximum efficiency.
5. **Deferred items** (Perf-2, plus the "not in this review" rows in the strategic table) are intentional non-actions. Don't second-guess; revisit at the inflection points named.

---

## Headline verdict

**The code is in unusually good shape for ~10 days of intensive build.** No structural problems. Architectural choices defensible. Plan↔code traceability is high — 30 sampled surfaces, ~3 silent additions, all small. Decision discipline strongly traceable (decision-log → code → test in <60 seconds for any anchor).

**Severity inventory**:
- **3 🔴 ship-blockers for production launch** (not for M1; today's traffic is dev-only): one race condition that's currently latent, one schema gap from yesterday's Q5 propagation, two security/PII issues
- **~25 🟡 watch items** clustered into 5 themes (below)
- Strong 🟢 baseline across 7 of 10 lenses

The previous review's claim — "wobbles are real but the system is detecting them" — holds at the code layer too. Self-disclosure in execution logs, schema reject-paths, hashed message bodies in observability, atomic file writes — all working as designed.

---

## 🔴 Close-out items (ranked by leverage / fix cost)

### R1. `TriageStateSchema` is missing the `inconclusive` variant (Contract integrity #1)
- **Evidence**: `product/ts-common/src/session.ts:70-75` lists `none / qualified / referred_out / disqualified`. Yesterday's Q5 propagation extended `HandoffVerdictSchema` (handoff.ts:39-44) and `SessionEndedEvent.payload.finalTriageVerdict` (events.ts:131-138) but stopped at the session triage discriminator.
- **Implication**: An `inconclusive` verdict cannot be persisted into `SessionState.triage` — the discriminated union will reject it. `chat.ts:148-159` reads `updated.triage.verdict !== 'none'` to emit `triage.decided`; if the triage classifier ever returns `inconclusive`, parse will fail at runtime.
- **Fix**: ~5 min. Add `TriageStateInconclusiveSchema`, include in the union.

### R2. `void appendToHistory(...)` writes race the SSE turn (Agent loop #3)
- **Evidence**: `chat.ts:213-219` (reasoning sink), `chat.ts:258` (`void persistPart(...)`), and `appendToHistory` does `store.update(sessionId, s => ({...s, conversationHistory: [...]}))` (`chat.ts:445-454`). Multiple unawaited promises mutate the same session concurrently. Works today because `InMemorySessionStore` happens to serialise via the JS event loop's microtask queue.
- **Implication**: For ANY async-backed session store (Firestore stub, future Postgres `SessionService` per B.22), this is a textbook lost-update bug — last write wins, history can drop entries, turn indices can collide, reasoning can persist *after* the next user message. Will silently break the moment B.22 lands.
- **Fix**: ~30 min. Per-session async mutex on `store.update`, OR batch all entries from the turn and write once at `event: done`.

### R3. Email-header injection vector via `contact.name` (Security #1)
- **Evidence**: `connector/src/handoff/mailer.ts:193` builds `Swoop lead — ${payload.contact.name} (qualified, …)` and passes it as nodemailer `subject`. `ts-common/src/handoff.ts:172` defines `name: z.string()` with no `.regex()`, no `.max()`, no newline filter.
- **Implication**: A visitor entering `Foo\r\nBcc: attacker@example.com` may smuggle a header. Nodemailer's modern encoding mostly defends, but the subject is a controlled trust boundary and explicit sanitisation is the right posture.
- **Fix**: ~15 min. Apply `.regex(/^[^\r\n]{1,200}$/)` on every `HandoffContactSchema` string field; strip control chars in `computeSubject` and email-bound template fields.

### R4. No length caps on visitor-supplied PII / chat input (Security #2)
- **Evidence**: `chat.ts:81-87` only checks `typeof message === 'string'` + non-empty. `express.json({ limit: '64kb' })` (`server/index.ts:89`) is the only ceiling. `HandoffContactSchema` has no `.max()`. `motivationAnchor` is unbounded.
- **Implication**: 60kb "name" lands in `var/handoffs/<id>.json`, in event payload sha256 inputs, and in email subject. Storage abuse + DoS surface.
- **Fix**: ~15 min. `.max(200)` on contact fields, `.max(8_000)` on `message`, `.max(2_000)` on `motivationAnchor`. Lower `express.json` to 16kb after.

---

## 🟡 The five themes (each backed by 2–4 lenses)

### Theme A — Schema/contract spine has narrow gaps the council found via cross-validation

In addition to R1 above:
- **Three HTTP routes hand-roll body validation instead of Zod**: `consent.ts:49-62`, `chat.ts:73-89`, `session-bootstrap.ts:63-67` use bare `typeof` guards. Only `/handoff/submit` Zod-parses (`handoff-submit.ts:64`). Inconsistent posture; UI clients can't typecheck against a shared schema. Define `ChatRequestSchema`, `ConsentRequestSchema`, `SessionBootstrapRequestSchema` in `@swoop/common` and parse at boundary. (Contract Integrity #3, Security #5)
- **`HandoffSubmitRequestSchema.reasonCode` is `z.string().min(1)` with no per-verdict re-validation at the wire boundary**. `handoff-submit.ts:272` casts `as never` straight into per-verdict payload; only `submitHandoff()` re-validates downstream. User gets generic "invalid_request" instead of "this code isn't valid for this verdict". Tighten with a `z.discriminatedUnion('verdict', [...])` over the request schema. (Contract Integrity #2, Handoff Pipeline)
- **`VerdictEnum` duplicated in `events.ts:43-48`** distinct from `HandoffVerdictSchema`. They match today; nothing prevents drift. Re-export from a common module. (Contract Integrity #5)
- **`ToolCalledEvent.payload.toolName` is `z.string()`** while `TOOL_NAMES` const exists. Use `z.enum([...Object.values(TOOL_NAMES)])`. (Contract Integrity #7)
- **Documented `handoff.email.{sent,skipped,failed}` event family doesn't exist in `events.ts`** — only the comment at `mailer.ts:43-44` describes it. Drift between doc and schema. (Error Handling Cross-lens, Test discipline)

### Theme B — Test coverage hides gaps that "416/416 passing" obscures

- **Eval harness is 10/13 stubs**. `harness/scenarios/` has 13 YAMLs; 10 are `*-placeholder.yaml` with `assertions: []` + `judge: null`. The project's stated validation strategy ("integration + behavioural coverage in the H harness" per `product/CLAUDE.md`) is contractually deferred. (Test Discipline #1)
- **Mailer `inconclusive` branch coded but not tested**. `mailer.ts:141-143` returns `{status:'skipped', reason:'verdict_inconclusive'}`. `connector/src/handoff/__tests__/mailer.test.ts` has zero `inconclusive` references. A regression that re-routes inconclusive payloads to the qualified inbox — the GDPR-sensitive bug E.t3 was created to prevent — would not be caught. (Test Discipline #2)
- **Client-disconnect abort comment lies about coverage**. `server.test.ts:21` claims a "disconnect aborts the turn" test exists; instrumentation exists at `:65-89`; no `it(...)` block actually calls `request(app)...abort()` or asserts `runner.lastAborted() === true`. Scaffolding without assertion. (Test Discipline #4 — flagged 🔴 by the lens but lower than the four R-items above)
- **Lead-capture widget over-mocks `postHandoffSubmit`**. The widget test and orchestrator route test never actually fire the real wire shape against each other. A divergence between the two would not be caught. (Test Discipline #6)
- **No integration test for /chat error paths** — model-API-down / agent-throws / connector-unreachable scenarios are unverified at the HTTP layer. `chat.ts:166,331-343` writes `event: error` frames; no test exercises this. (Test Discipline #3)

### Theme C — Performance + observability cliffs

- **No prompt caching anywhere**. `claude-llm.ts:117-125` builds `system`, `tools`, `messages` on every call with no `cache_control`. ~2,500 static tokens × every turn × every conversation. Anthropic's 5-min ephemeral cache fits multi-turn chat exactly. **Single biggest free win** (estimated 30–50% input-token cost reduction). Pre-empts the cost spike when G.t1 fills `00_why.md` and the CMS-loaded tool descriptions land. (Performance #1)
- **Triage classifier runs serially before every SSE turn**. `chat.ts:137-180` awaits `triageClassifier.classify(...)` BEFORE `res.flushHeaders()` at `:189`. User's first SSE byte cannot arrive until Haiku has fully responded. The classifier verdict is *advisory only* — it could run concurrently or be fired-and-forgotten with the verdict landing on `session.triage` for the *next* turn. (Agent Loop #1, Performance #2)
- **Email-send failures are silent end-to-end**. `mailer.ts:177-183` returns `{status:'failed'}` → `submit.ts:124-135` propagates → `handoff-submit.ts:158-164` maps to `emailDeliveryStatus: 'bounced'` inside `handoff.submitted` → no `error.raised` emitted. SMTP outage = zero structured signal in observability stream. The documented `handoff.email.failed` event doesn't exist. (Error Handling #1)
- **`error.raised` emission boilerplate at 9+ sites with inconsistent slicing**. `chat.ts:176` and `index.ts:230` slice to 500 chars; `connector/tools.ts:219` doesn't. A single `emitErrorRaised(...)` helper in `@swoop/common` would deduplicate and enforce the slice. (Duplication #3)

### Theme D — Security posture is solid for dev but has 4 gaps for public launch

- **PII at rest has no permission discipline**. `store.ts:87` `mkdir({recursive:true})` uses default umask. `writeFile(tmpPath, ...)` no `mode` — default 0o666 & umask. Visitor name/email/phone/conversation-summary in cleartext JSON, world-readable on a shared host. (Security #1, Handoff Pipeline #1) Fix: `mkdir({mode:0o700})` + `writeFile({mode:0o600})`.
- **No rate-limiting / abuse cap / auth**. Acknowledged out of scope per Tier 1, but for public launch a token-bucket on `/session`, `/chat`, `/handoff/submit` is minimum viable. (Security #3)
- **No security headers**. `server/index.ts:84-97` only does `app.disable('x-powered-by')` + CORS. Missing CSP (especially `frame-ancestors` for the iframe-embedded surface), HSTS, Referrer-Policy, X-Frame-Options. Add `helmet({...})` to `buildServer`. (Security #4)
- **`entryUrl` not URL-validated at `/session` boundary**. `session-bootstrap.ts:63` accepts any string. The schema declares `z.string().url().optional()` but the route does its own typeof-string parse and never Zod-parses the body. Arbitrary `javascript:`/`data:` URLs propagate into events. Fixed by Theme A item 1 (`SessionBootstrapRequestSchema`). (Security #5)

### Theme E — Modest duplication + small architectural seams

- **`err instanceof Error ? err.message : String(err)` repeated 16+ sites**. UI's `messageOf` (`errors/classify.ts:39-53`) is the most defensive form. Lift into `@swoop/common`. (Duplication #1)
- **Two SSE consumer/parsers** — `harness/orchestrator-client.ts:183-300` vs `ui/runtime/orchestrator-adapter.ts:244-295`. Same wire format, same buffering algorithm, two implementations diverge in subtle ways (`.trim()` vs `.trimStart()`). Extract `parseSseFrames(stream)` into `@swoop/common/streaming`. (Duplication #2)
- **Tool-result Zod parsing duplicated 4× by tool name** in `orchestrator/connector/tools.ts:197-254`. Will balloon to 8× when chunks C/E ship more tools. A `parseToolResult(name, schema, raw)` helper would collapse them. (Duplication #6)
- **`orchestrator-adapter.ts` (660 LOC) has clear seams**: `translatePart()` (~100 LOC switch) + `parseSseStream` async generator → could split into `parts-to-uichunks.ts` + `sse-parser.ts`. Not urgent. (Boundaries #4, Agent Loop #6)
- **`claude-llm.ts` schema-normaliser** (genai → JSON Schema 2020-12, ~70 LOC at `:411`) is independently testable; splitting into `claude-llm/schema-normaliser.ts` would shed concern. (Boundaries #4)
- **`event-capture.ts` lives only in decisions log** (H.14), not in any Tier 3 plan. Backfill a one-paragraph subsection into `03-exec-validation-scaffold.md`. (Reverse Drift #1)
- **UI `disclosure/` and `shared/` directories partly invented** — ~8 files implement planned outcomes by means the plans don't enumerate. Retrofit a single note in `02-impl-chat-surface.md`. (Reverse Drift #2)
- **`fyi-channel.ts` is a module-singleton** broadcasting to ALL FyiRenderer instances globally. Self-skip claim only holds in single-thread scenarios. Discoveries.md already lists `<fyi>` part-type as a candidate to retire post-M1; that retirement is the cleanest fix. (UI #2)
- **`useThread` deprecation reach-in is acknowledged but unguarded** (`use-runtime-errors.ts:52-64`). Add a vitest contract test that fails when the hook is renamed by upstream. (UI #3)
- **`opening-screen` modal lacks focus trap and Escape binding** despite `aria-modal="true"`. Comment at `:67` says "by-design" — but the aria claim is technically false without a trap. (UI #1)

---

## Cross-lens patterns (these are the ones to act on first)

1. **The schema boundary is the single biggest leverage point**. R1 (TriageStateSchema), Theme A's wire-validation gaps, R3 (contact name), R4 (length caps) all close cleanly with one focused PR adding ~6 schemas and 4 `.max()`/`.regex()` constraints. Five lenses converge on this. **Estimated time: 90 minutes; impact: massive.**

2. **The race condition (R2) is the single highest-confidence latent bug**. The Agent Loop tracer caught it; the test-discipline lens corroborated by noting the integration test is happy-path only. It's invisible today because `InMemorySessionStore` serialises by accident. Will silently break with B.22 (Postgres `SessionService`). Fix BEFORE B.22 lands.

3. **Observability has a coherent gap pattern**: documented event family that doesn't exist (`handoff.email.*`), inconsistent `sanitisedContext` slicing, silent SMTP failures. A single `emitErrorRaised(...)` helper + adding the email event kinds would close all three.

4. **Cost cliff is mechanical** — prompt caching alone shifts the per-turn price by ~30–50%. The planning lens noted "G.t1 + CMS tool loader will spike token cost"; the perf lens shows caching pre-empts that cliff. Pre-launch must.

5. **Self-correction is real**: `find_someone_who` description was over-executed (plan said placeholder, agent wrote 3 paragraphs). The execution log self-flagged it. C.26 graduated 2026-04-30 making the over-execution correct in hindsight. Pattern of self-disclosure → log → recovery works.

6. **Test counts mislead**: 416/416 looks complete. Reality: 10/13 harness scenarios are stubs; mailer's `inconclusive` branch untested; client-disconnect plumbing has no assertion. **The integration-coverage gap is the single biggest test investment to make next.**

---

## Counterweights — what's working unusually well

1. **Plan ↔ code traceability is high.** Forward drift (4 sampled plans): every requirement Implemented or Drifted-acceptably-with-record. Reverse drift (~30 sampled surfaces): ~3 silent additions, all small infra. Decision-log → code → test traceable in <60 seconds for any anchor.
2. **Comment hygiene is excellent.** 13 TODOs total across 24,600 LOC, EVERY ONE chunk-tagged (`TODO(E.t5)`, `TODO(C.t4)`). Zero FIXME/HACK/XXX. Large files open with rationale docblocks (why this exists), not what-the-code-does narration.
3. **Schema-as-code drift detection has teeth**. `handoff-schema.test.ts:154-209` covers cross-verdict code leakage, contact-on-disqualified, contact-on-inconclusive, empty reason text, unknown verdict — exactly the drift the schema design is meant to catch.
4. **`@swoop/common` is the contract spine** — every other workspace depends on it; it depends on nothing internal. Zero circular dependencies. 32 orchestrator + 16 UI files import from it.
5. **No hidden model calls per turn.** Only Sonnet (orchestrator) + Haiku (triage). Composer-pattern reversal stuck — no resurrection. No per-tool sub-LLMs. No runtime embeddings.
6. **Streaming is end-to-end O(n)**. UI adapter, block parser, AnthropicSDK consumption, ADK translator. No buffering hot spots.
7. **Abort propagation is end-to-end correct**: `req.on('close')` → `AbortController` → `runner.runAsync` → `claude-llm.ts` → Anthropic SDK `signal`.
8. **PII discipline mostly excellent**: hashed message bodies in events, `sanitisedContext: message.slice(0, 500)` applied consistently in error events, gitignored `var/handoffs/`, `randomUUID`-minted handoff IDs (no embedded sessionId).
9. **CI is correctly scoped**: path-filtered (`paths: product/**`), label-gated harness (`eval` label only), secret-presence guarded, concurrency-grouped. No surprise £1-3/PR charges.
10. **Block-parser is exemplary**: 18 unit tests covering char-by-char streaming, mid-tag-boundary splits, dangling end() flushes. Genuinely unit-testable thing, genuinely unit-tested.

---

## Recommended next moves — close-out checklist

Each item below is captured as a fix-tracking entry in either an existing Tier 3 plan addendum (under a `## 2026-04-30 code-review fixes` section) or a `03-exec-crosscut-*-fix.md` file. Status legend: 🔲 not started · 🟡 in flight · ✅ landed.

### Quick wins — sub-30 minutes each, do this week

| Status | Item | Tracked at | Severity |
|---|---|---|---|
| 🔲 | Add `inconclusive` to `TriageStateSchema` | [03-exec-handoff-t1.md#R1](../03-exec-handoff-t1.md) | 🔴 R1 |
| 🔲 | `mkdir({mode:0o700})` + `writeFile({mode:0o600})` on `FsHandoffStore` | [03-exec-handoff-t2-t3.md#Sec-1](../03-exec-handoff-t2-t3.md) | 🟡 |
| 🔲 | `.regex(/^[^\r\n]{1,200}$/)` on `HandoffContactSchema` strings | [03-exec-handoff-t1.md#R3](../03-exec-handoff-t1.md) | 🔴 R3 |
| 🔲 | `.max()` on contact fields, `motivationAnchor`, message body + lower `express.json` to 16kb | [03-exec-handoff-t1.md#R4](../03-exec-handoff-t1.md) + [03-exec-agent-runtime-t5.md#R4](../03-exec-agent-runtime-t5.md) | 🔴 R4 |
| 🔲 | Add `helmet` middleware (CSP frame-ancestors, HSTS, Referrer-Policy) | [03-exec-agent-runtime-t5.md#Sec-2](../03-exec-agent-runtime-t5.md) | 🟡 |
| 🔲 | `messageOf(err)` helper in `@swoop/common` (16-site sweep) | [03-exec-crosscut-common-helpers-fix.md#H1](../03-exec-crosscut-common-helpers-fix.md) | 🟢 hygiene |
| 🔲 | `emitErrorRaised(...)` helper + `handoff.email.{sent,skipped,failed}` event kinds | [03-exec-crosscut-common-helpers-fix.md#H2-H3](../03-exec-crosscut-common-helpers-fix.md) | 🟡 |
| 🔲 | Skip triage on turn 1 (cheap perf gate) | [03-exec-agent-runtime-t7.md#Perf-3](../03-exec-agent-runtime-t7.md) | 🟢 |
| 🔲 | Test mailer `inconclusive` skip-reason | [03-exec-handoff-t2-t3.md#Test-2](../03-exec-handoff-t2-t3.md) | 🟡 |
| 🔲 | Decide retain-or-delete on dead `HandoffReasonSchema` | [03-exec-handoff-t1.md#Theme-A.5](../03-exec-handoff-t1.md) | 🟢 |
| 🔲 | Tool-name event-payload narrow to `TOOL_NAMES` enum | [03-exec-handoff-t1.md#Theme-A.4](../03-exec-handoff-t1.md) | 🟢 |
| 🔲 | Dedup `VerdictEnum` in `events.ts` against `HandoffVerdictSchema` | [03-exec-handoff-t1.md#Theme-A.3](../03-exec-handoff-t1.md) | 🟢 |

### Medium — 30 min – 2 hours each, do before production

| Status | Item | Tracked at | Severity |
|---|---|---|---|
| 🔲 | Per-session async mutex on `store.update` (closes R2 before B.22 lands) | [03-exec-agent-runtime-t5.md#R2](../03-exec-agent-runtime-t5.md) | 🔴 R2 |
| 🔲 | Anthropic prompt caching (`cache_control: ephemeral`) on system + tools | [03-exec-agent-runtime-t1.md#Perf-1](../03-exec-agent-runtime-t1.md) | 🟡 |
| 🔲 | Define `ChatRequestSchema`, `ConsentRequestSchema`, `SessionBootstrapRequestSchema` in `@swoop/common`; replace 3 hand-rolled route validations | [03-exec-agent-runtime-t5.md#Theme-A.1](../03-exec-agent-runtime-t5.md) | 🟡 |
| 🔲 | Tighten `HandoffSubmitRequestSchema` to `z.discriminatedUnion('verdict', [...])` with per-verdict reason enums | [03-exec-handoff-t1.md#Theme-A.2](../03-exec-handoff-t1.md) | 🟡 |
| 🔲 | Integration tests for `/chat` error paths (mid-stream throw, client disconnect, connector unreachable) | [03-exec-agent-runtime-t5.md#Test-1](../03-exec-agent-runtime-t5.md) | 🟡 |
| 🔲 | Lift SSE frame parser into `@swoop/common/streaming`; harness + UI both consume | [03-exec-crosscut-shared-sse-parser-fix.md#H5](../03-exec-crosscut-shared-sse-parser-fix.md) | 🟢 |
| 🔲 | `parseToolResult(name, schema, raw)` helper for connector adapter | [03-exec-crosscut-common-helpers-fix.md#H4](../03-exec-crosscut-common-helpers-fix.md) | 🟢 |

### Strategic — defer / schedule (these need design decisions, not just fix-and-ship)

| Status | Item | Tracked at | Notes |
|---|---|---|---|
| 🔲 deferred | Triage classifier parallel-not-serial | [03-exec-agent-runtime-t7.md#Perf-2](../03-exec-agent-runtime-t7.md) | Single biggest p50 latency win; revisit after G.t0 lands real classifier prompt |
| 🔲 not in this review | Replace stub harness scenarios with real conversation seeds | (gated on G.t0 HITL output) | Test discipline #1 |
| 🔲 not in this review | Backfill `event-capture` interface into `03-exec-validation-scaffold.md` | TBD | Reverse-drift #1 |
| 🔲 not in this review | Disclosure/shared retrofit note into `02-impl-chat-surface.md` | TBD | Reverse-drift #2 |
| 🔲 not in this review | Rate limiting (per-IP token bucket on `/session`, `/chat`, `/handoff/submit`) | TBD | Tier 1 deferred; ship-blocker for production |
| 🔲 not in this review | `product/RUNBOOK.md` consolidating the 3 README hops | TBD | DX #3 |
| 🔲 not in this review | Refactor `orchestrator-adapter.ts` into smaller modules (after H5 lifts the parser) | TBD | Pairs with B-stream work |

---

## Commit convention for close-out

Each fix commits as `fix(<scope>): close <item-id> — <one-liner> (2026-04-30 review)`. Example: `fix(common): close R1 — inconclusive on TriageStateSchema (2026-04-30 review)`. The status table above gets ticked from 🔲 → ✅ as items land; commit refs are appended in the per-plan addenda.

---

## Closing

The code answers your "structure sound? architecture good? crazy duplication? plan adherence?" questions cleanly:
- **Structure**: sound. Workspace boundaries are honest, dependency graph is acyclic, public surface explicit.
- **Architecture**: good for M1. Three large files (`claude-llm.ts`, `orchestrator-adapter.ts`, `chat.ts`) are large because the problems are; only one (`orchestrator-adapter.ts`) has obvious seams.
- **Duplication**: none crazy. Three small consolidation opportunities (error-message helper, SSE parser, `emitErrorRaised`) all under 30 min each.
- **Plan adherence**: high. 4-of-4 sampled plans Implemented-or-Drifted-acceptably-with-record. Reverse drift caught only ~3 small infrastructural surfaces lacking a Tier 3 home.

The 🔴 items are narrow, the 🟡 themes are coherent, and the counterweights are substantial. Code review #1 (planning) and review #2 (code) tell the same story from two angles: **the system is detecting and self-correcting its own drift, and the discipline visible in the codebase explains why M1 shipped clean and on-time.**

Worth re-running the code council at the next inflection point (B.22 Postgres SessionService landing, or M4 deploy).
