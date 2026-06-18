# 03 — Exec (crosscut): Consent-triggered greeting pre-warm

**Status**: Tier-3 execution plan. **DRAFT, 2026-06-17.** Awaiting Alastair's ratification (§8) before any execution.
**Type**: Cross-cut (no single chunk owner — touches B orchestrator + D UI + G content). Build in a fresh worktree; HITL on main per the worktree policy.
**Implements**: the TTFT-reduction workstream in [ttft-prewarm-handover.md](../ttft-prewarm-handover.md), narrowed in the 2026-06-17 Cowork session to **just the consent-triggered pre-warm** (the handover's secondary components — cache heartbeat, effort-default change, greeting image, speculative content pre-fetch — are explicitly parked, §7).
**Decisions**: `PW-1`…`PW-6` below — all DRAFT, pending ratification.

---

## 1. Goal

Cut the **time-to-first-token** the visitor feels on their first real message. When the visitor consents to the chat — actively (the Continue button) **or** when prior consent is restored from `sessionStorage` on reload — fire one internal agent turn during the dead time before they type. That turn:

- warms the session (spins up the model turn, **warms the Anthropic prompt cache** on the ~71k-char system+tools prefix — `cache_control: ephemeral`, Perf-1),
- lets the agent's natural `list_skills`/`load_skill` happen so the loaded-skill result is already in session history when turn 1 lands,
- emits a **warm hello** so there's presence ("an AI is here, ready") while the visitor reads and composes.

The win is partly raw seconds (the setup/skill-load slice is pre-paid) and partly perceived — the hello overlaps the warm-up with the visitor's read+compose time, which is otherwise free latency. The ~5s query-dependent content loop on turn 1 is **not** addressed here (that's the parked speculative-prefetch idea, §7).

Alastair's bar (handover): "even 11s is too slow." This is the immediate, cheap, worth-it lever.

## 2. What's decided going in (honour these)

From the handover's DECIDED set + the 2026-06-17 clarification:

- **Trigger**: consent grant (active) **and** reload-that-restores-prior-consent — but only greet a **fresh session with no prior user turns** (don't hello into an existing, already-active thread).
- **v1 scope**: warm the session + let skills load + emit a hello. **No image** (`illustrate` deferred — measure its latency first, parked). Minimum tool calls.
- **No race protection** in v1. If the visitor sends a first message before the hello returns, both turns run. Alastair will trial this in the real world across `ORCHESTRATOR_EFFORT` settings to get a feel for it before deciding on a (likely general) "block send while a turn is in flight" fix. **Do not build race protection here.**
- **Effort/thinking (PW-5, ratified amended twice — 2026-06-18)**: the greeting **honours the global `ORCHESTRATOR_THINKING_ENABLED` flag** (it does *not* force thinking off), but when thinking is on it runs at the **lowest effort** (`ORCHESTRATOR_EFFORT='low'`) for that turn. Alastair's refinement: keep the hello fast *and* keep its system prefix aligned with the conversation's. Effort is a request param, not part of the cached prefix, so a thinking-on greeting now warms the **same** prompt-cache prefix turn 1 hits (the earlier thinking-off idea broke that). The greeting runs on a **dedicated low-effort runner** (§3.4); the conversation keeps the global effort.
- **Greeting copy is Alastair's** (G.7). The plan ships a placeholder; the voice pass is his.

## 3. Mechanism (grounded in the code)

The plumbing already does the hard part. Confirmed by reading the seams:

- A `/chat` turn runs through `runAgentTurn` → `runner.runAsync` ([chat.ts:622](../product/orchestrator/src/server/chat.ts)), and the agent's `instruction` is the **async InstructionProvider** in [factory.ts:215](../product/orchestrator/src/agent/factory.ts) — `prompt + skills-injection + (RL.3) thinking belt + sales-memory block`. So a greeting turn warms *exactly* the cache-stable prefix the real turns reuse, and the skills-injection that makes the agent reach for `load_skill` is already in front of it. **Nothing about the warming needs new agent wiring.**
- The consent gate is `canAcceptTurn(session)` (tier-1) at the top of the handler ([chat.ts:156](../product/orchestrator/src/server/chat.ts)). The greeting can only fire *after* consent — which is exactly our trigger. ✓
- `/chat` **rejects an empty `message`** ([chat.ts:146](../product/orchestrator/src/server/chat.ts)) and `ChatRequestSchema` is `.strict()`. So the greeting needs an explicit signal on the request, not an empty/sentinel message (PW-1).
- The warm pool (B.t10) stays at `WARM_POOL_SIZE=0`. We do **not** touch it — consent already hands us a real session to warm (handover). The greeting is the model-side warm the pool never did.
- On the UI, `useRehydrate` ([App.tsx:383](../product/ui/src/App.tsx)) already fetches `GET /session/:id/history` (B.t11) on mount and tells us whether a restored session has prior parts. **That is our "fresh session?" signal** — empty history ⇒ greet; non-empty ⇒ rehydrate the existing conversation, don't greet.

### 3.1 Recommended shape — reuse the `/chat` pipeline (PW-1, Shape A)

The agent speaking first is the only real friction, and it sits in assistant-ui (pre-1.0). Reusing `/chat` keeps the hello rendering **native** (it streams through the same transport → assistant-ui flow as a normal turn), at the cost of one suppressed synthetic user message. Flow:

1. **Wire signal** — add optional `greeting?: boolean` to `ChatRequestSchema` (`@swoop/common`; same additive, `.strict()`-safe pattern as `clientTime` / `model` / `staffToken`). Explicit + typed beats a magic message string.
2. **UI trigger** — a new `useGreeting` hook (sibling of `useRehydrate`/`usePreflight` in `product/ui/src/session/`) fires once when consent is granted **and** the session is fresh (rehydrate found no history / brand-new grant). It drives one turn through assistant-ui's runtime so the hello streams into the thread natively, passing `greeting: true` on the request body (threaded via the transport's `extraBody`). The synthetic user message that assistant-ui needs to drive the turn carries a fixed marker and is **suppressed** in `MessageView` (PW-4).
3. **Server branch** — in `chat.ts`, when `greeting === true`: skip `appendUserMessage` (no fake user turn recorded in `conversationHistory`), and run the turn with the **cms greeting prompt** as the user content instead of the request `message`. Everything else (translator, SSE, events, history-persist of the agent's hello) is unchanged. The hello + any `load_skill` land in the ADK event log normally, so they warm the session and replay correctly on a later reload.
4. **Greeting content** — a new cms file `product/cms/prompts/greeting/00_greeting.md` (content-as-data, G.11 spirit), loaded **once at boot** in `index.ts` and passed into `createChatHandler` deps as `greetingPrompt` (mirrors how `memoryLoadedHeader` is loaded at boot and threaded in). Fail-fast at boot if the file is missing/empty, per the prompts-relocated-to-cms pattern (`5ec30a9`). The prose steers a short warm hello + natural skill-load, **no content tools, no image** — steering is prompt-only (PW-3).

### 3.2 The fresh-session guard (PW-2)

`useGreeting` greets iff: consent granted AND no prior conversation turns this session.

- **Active grant** (`grantConsent()` → brand-new `sessionId`): trivially fresh → greet.
- **Restored consent + empty history** (consented, reloaded before any turn): fresh → greet (re-warm; harmless).
- **Restored consent + non-empty history**: `useRehydrate` replays the existing conversation → **do not** greet.

One-shot guard against React strict-mode double-invoke / re-render (a ref, plus optionally a `sessionStorage` `greeted` flag as belt-and-braces — PW-2 sub-question). The greeting itself records no user turn (§3.1 step 3), so "no prior **user** turns" stays a clean predicate.

### 3.3 History / rehydrate interaction

The greeting's hello is a real assistant turn in the ADK event log, so on a later reload B.t11 replays it (the visitor sees their prior hello + any conversation). That's correct and desired. The suppressed synthetic user marker must also not render on the rehydrate path (same `MessageView` rule covers both — PW-4). Verify whether the B.t11 translator emits user parts at all; if it doesn't, the marker never reaches the rehydrated thread and suppression is belt-and-braces only.

### 3.4 Fast greeting — a dedicated low-effort runner (PW-5, ratified amended twice)

The conversational agent's thinking/effort config is baked into its `ClaudeLlm` at construction ([factory.ts:130](../product/orchestrator/src/agent/factory.ts)), so a per-turn override isn't available. Following the M-PICK runner pattern ([runner-registry.ts](../product/orchestrator/src/agent/runner-registry.ts) + [index.ts:215](../product/orchestrator/src/index.ts)), build a **dedicated greeting runner at boot**:

- `buildOrchestratorAgent({ config: { ...config, ORCHESTRATOR_EFFORT: 'low' }, promptLoader, tools: connector.tools, connectorClient, memoryLoadedHeader })` — **`ORCHESTRATOR_THINKING_ENABLED` is left untouched** (honoured); only `effort` is forced to the lowest value. Thinking globally off → the greeting is thinking-off too (RL.3 belt injected, same as the conversation), effort moot. Thinking globally on → the greeting is thinking-on at `effort=low` (fast).
- wrapped in a `Runner` that **shares the default runner's `sessionService`** (`sessionService: runner.sessionService`, same `appName`/`userId`) — the M-PICK sibling-runner shape — so the greeting warms the visitor's *real* ADK session (same `sessionId`), not an isolated one.

The `/chat` greeting branch routes to this runner; visitor turns and turn 1 stay on the default runner.

**Cache alignment (the point of this amendment):** `effort` is a request param (`output_config.effort`), **not** part of the cached system prefix, and the thinking flag now matches the conversation — so the greeting's system+tools prefix is **byte-identical** to turn 1's. The greeting therefore **does** pre-warm turn-1's exact prompt cache (Perf-1), on top of skills-already-loaded + session spin-up + presence. This recovers the cache slice the earlier thinking-off idea would have forfeited, for a slightly slower hello than full thinking-off (handover table: ~11s at `effort=low` vs ~8s thinking-off — Alastair's chosen balance).

## 4. Files touched

| Workspace | File | Change |
|---|---|---|
| `@swoop/common` | `src/routes.ts` (`ChatRequestSchema`) | + optional `greeting: z.boolean().optional()` (additive, `.strict()`-safe). + export a `GREETING_USER_MARKER` constant if Shape A needs a marker string for bubble suppression. |
| orchestrator | `src/server/chat.ts` | greeting branch: skip `appendUserMessage`; run the turn with `greetingPrompt` as the user content. New `greetingPrompt?: string` on `ChatDeps`. |
| orchestrator | `src/agent/prompt-loader.ts` (or a tiny `greeting-prompt-loader.ts`) | load `cms/prompts/greeting/00_greeting.md` at boot, fail-fast on missing/empty. |
| orchestrator | `src/index.ts` | load the greeting prompt at boot; thread `greetingPrompt` into `createChatHandler`. |
| ui | `src/session/use-greeting.ts` (new) + `src/session/index.ts` | the trigger hook (consent-granted + fresh → one greeting turn via the runtime). |
| ui | `src/App.tsx` | wire `useGreeting` alongside `useRehydrate`/`usePreflight`; suppress the synthetic user marker in `MessageView`. |
| cms | `product/cms/prompts/greeting/00_greeting.md` (new) | greeting instruction — **placeholder; Alastair's voice pass (G.7)**. |
| tests | orchestrator + ui `__tests__` | greeting-branch unit tests (skips user append; uses greeting prompt; visitor path byte-identical when `greeting` absent); UI hook fires once on fresh + not on non-empty-history. |

No new dependency. No migration. No connector change. No change to the warm pool, the consent/bootstrap handshake, or the sales-memory/thinking/dateline wiring (the greeting rides through all of it untouched).

## 5. The one spike (do first, ~½ day)

The only "does the framework allow this" unknown is **assistant-ui's pre-1.0 API for making the agent speak first**: programmatically drive one turn (so the hello streams natively) and suppress the synthetic user bubble, without a `key`-bump remount (App.tsx already documents that remounting breaks the composer's Zustand state). Confirm `runtime.thread.append` / composer-send fires the transport, threads `body.greeting`, and renders the streamed hello; confirm the marker bubble suppresses cleanly live + on rehydrate. If assistant-ui can't drive a turn without a visible user message acceptably, that's the trigger to fall back to **Shape B** (PW-1). This mirrors the sales-memory "spike the framework capability before banking the build" pattern (sm-2/sm-9).

## 6. Verification

- `@swoop/common` + orchestrator + ui typecheck clean; unit suites green (greeting branch + UI hook tests added).
- **Visitor-path invariant**: a `/chat` request with `greeting` absent is byte-identical to today (assert in tests — the Sacred-Invariant posture from T3-3).
- **Live smoke** (dev stack on :8080, connector first then orchestrator — gotchas restart-order): consent → confirm one greeting turn fires, a warm hello streams, no synthetic user bubble shows; then send a first real message and confirm it behaves normally. Reload → confirm the hello rehydrates and **no second greeting** fires. Active decline → no greeting, no session.
- **TTFT measurement** with [product/scripts/ttft-probe.py](../product/scripts/ttft-probe.py): compare turn-1 TTFT **with vs without** the pre-warm, **across `ORCHESTRATOR_EFFORT` settings** (high/medium/low) — this is Alastair's real-world trial. Watch `first tool-call frame` (≈ setup, the slice we pre-pay) vs `TTFT` (first text).
- Cost sanity: one extra short Sonnet turn per consented conversation (the hello). Negligible; note it.

## 7. Out of scope (parked — named so they're not silently absorbed)

- **Cache heartbeat** (keep the shared prefix warm between visitors with a <5-min tick) — separate from per-session warming; not needed here.
- **`ORCHESTRATOR_EFFORT` default change** — Alastair trials it as a variable; no default change baked in here.
- **Image on the hello** (`illustrate`) — measure its latency first.
- **Speculative content pre-fetch** (e.g. `find_inspiring("Patagonia")` for the common broad opener) — the only lever that touches the ~5s content cost; later, if ever.
- **Race protection** (block send while the greeting is in flight) — deliberately unbuilt; trial first, likely a general in-flight send-block later.
- **Default opening posture from `puma_session_event` opener distribution** — later analysis, if ever.

## 8. Decisions to ratify (the HITL questions)

All DRAFT. Alastair's call before execution.

- **PW-1 — Wire mechanism.** *Recommend Shape A* (reuse `/chat` + typed `greeting:true`; native hello rendering; one suppressed synthetic user bubble; tiny server branch). *Alternative Shape B*: a dedicated `POST /session/:id/greeting` SSE endpoint (server-owned content, no synthetic user message) — cleaner server-side but the UI must bypass assistant-ui's transport to inject the streamed hello (harder, more assistant-ui-fighting). *Swap cost: medium — the two differ in the new server surface and the UI injection path.*
- **PW-2 — Fresh-session guard.** *Recommend*: greet iff consent granted AND rehydrate found no prior history; one-shot ref guard. Sub-question: also persist a `sessionStorage` `greeted` flag as belt-and-braces, or is "history empty" enough? *Swap cost: trivial.*
- **PW-3 — Greeting content + tool scope.** *Recommend*: content-as-data at `cms/prompts/greeting/00_greeting.md` (your voice; placeholder for now), steering a warm hello + natural skill-load, **no content tools / no image** — steering **prompt-only**, not a hard tool restriction. *Swap cost: trivial (prose edit).*
- **PW-4 — Synthetic user message (Shape A only).** *Recommend*: accept that the greeting drives the turn via a synthetic user marker that is **suppressed** in the UI (live + rehydrate) and **not** recorded as a user turn server-side (skip `appendUserMessage`). *Swap cost: n/a (collapses if Shape B chosen).*
- **PW-5 — Effort for the greeting. ✅ RATIFIED amended twice (2026-06-18): honour the thinking flag; lowest effort when thinking is on.** The greeting inherits the global `ORCHESTRATOR_THINKING_ENABLED` and overrides only `ORCHESTRATOR_EFFORT` to `low` for its turn (§3.4) — fast hello *and* a cache prefix aligned with the conversation. (Supersedes both the original "inherit global" and the first "thinking-OFF" amendment.) *Swap cost: low — the greeting runner is additive at boot.*
- **PW-6 — No race protection.** Confirm: v1 does **not** guard first-message-before-hello; trial first. (Restating the decided position for the record.) *Swap cost: n/a.*

---

## HITL ratification record

**Ratified by Alastair, 2026-06-18 Cowork session** (answering §8):

- **PW-1 → Shape A** (reuse `/chat` + typed `greeting:true`; native hello rendering; suppressed synthetic user message).
- **PW-2 → agreed** (greet iff consent granted AND no prior history; "history empty" is sufficient — no extra `greeted` flag).
- **PW-3 → agreed** (greeting content in `cms/`, prompt-only steering, no content tools / no image).
- **PW-4 → agreed** (synthetic user marker suppressed in the UI + not recorded as a user turn server-side).
- **PW-5 → amended twice**: honour the global thinking flag, but force the **lowest effort** (`effort=low`) for the greeting turn when thinking is on — fast hello *and* a cache prefix aligned with turn 1 (Alastair's refinement after the cache-nuance heads-up). See §3.4 + the amended PW-5 above.
- **PW-6 → agreed** (no race protection in v1; trial first).

Execution authorised ("Proceed"). Build in this worktree (`frosty-neumann-57339f`); HITL on main — do not commit until Alastair reviews.
