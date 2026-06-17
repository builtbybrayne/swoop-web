# 03 — Crosscut: reasoning-leak fix via native Anthropic thinking

> **For Claude executing this:** work phase-by-phase. Each phase ends in a green check + a commit. Never `git push`. The signature round-trip (Phase 2) is **conditional** — only build it if the Phase-1 smoke proves it's needed.

**Status**: Ratified in conversation by Alastair 2026-06-17 (HITL). Authored on worktree `claude/reasoning-leak` (branched off `luke-questioning-tone`, rebased on `main` @ `d28d893`).
**Implements / completes**: decision **B.13** ("Response format — B.9 resolved") — the *producer* half of native thinking that was specced but never wired.
**Back-links**: [reasoning-leak-handoff.md](../reasoning-leak-handoff.md) (root-cause investigation, other agent, 2026-06-17) · [02-impl-agent-runtime.md §2.5a](02-impl-agent-runtime.md) (original 4-block design).
**Spans**: B (agent runtime) · G (content) · D (chat adapter) · H (harness re-baseline). Crosscut, no single chunk owner.

---

## ✅ Execution status (2026-06-17, worktree `claude/reasoning-leak`)

| Phase | Status | Commit(s) / note |
|---|---|---|
| 0 — worktree setup | ✅ done | env copied; `npm install`; baseline green; SDK `@anthropic-ai/sdk@0.90.0` confirmed to type `thinking:{type:'adaptive'}` + `output_config.effort` — **no bump needed**. |
| 1 — minimal native thinking | ✅ done | `725f987` (RL.1–5) + `006ebb8` (temp-with-thinking 400 fix — omit sampling params when thinking on). |
| **1 smoke (decides Phase 2)** | ✅ **leak gone, loop survives** | session `0fee8d42`: 8 tool-call frames then text; first visible text = the answer (no narration); `reasoningCount:28` server-side; **0** reasoning frames on the wire; full `list_skills→load_skill→find_inspiring→illustrate→answer` loop with **no 400**. ~23s latency (noted; effort lever available). |
| 2 — signature round-trip | ⏭️ **SKIPPED** | Conditional on smoke (b) failing; it passed → not required. See RL.6 + discoveries 2026-06-17. Phase 2 recipe stays on file if a future path 400s. |
| 3 — conditional belt | ✅ done | `daa1be1` (RL.3). Off-path behavioural smoke (step 4) **skipped** — belt injection is unit-tested (`factory.test.ts`), it's the degrade path, and live off-path recovery cost outweighed the signal. |
| 4 — whitespace-concat fix | ✅ done | `bf986e8` (RL.7). UI suite green (227 tests). |
| 5 — docs + re-baseline | 🔄 in progress | decisions/discoveries/gotchas updated; harness re-baseline (RL.8) + fresh-install sweep at close. **Not merged to main — Alastair's "apply" call.** |

---

## ★ Context — the problem in one paragraph

The conversational agent prints its planning / tool-narration as **visible text before the answer** ("I'll start by checking the pattern library… this opening is wide open, a Browser or early Dreamer, let me load those postures…" → tool calls → the real answer). Root cause: B.13 re-architected reasoning isolation from `<reasoning>`/`<utter>` tags to **native Anthropic thinking blocks**, but only the *consumer* half shipped — [reasoning-filter.ts](../product/orchestrator/src/translator/reasoning-filter.ts) strips reasoning parts, and [claude-llm.ts:249-276](../product/orchestrator/src/agent/claude-llm.ts) maps `thinking_delta` → `thought:true`. The *producer* half was never wired: `thinking` is never set on the request ([claude-llm.ts:182-192](../product/orchestrator/src/agent/claude-llm.ts)) and the system prompt has no output discipline. With no reasoning channel, the model narrates in plain `text`. The tool-heavy `list_skills → load_skill → find_*` flow gives it several hops to narrate across. Default Sonnet 4.5 leaks ~1 segment; Opus 4.8 (via the dev model picker) leaks ~2. Plausibly part of Luke's 16/06 "responses got longer" feedback.

The fix is to wire the producer: enable native thinking so the model reasons in the (stripped) thinking channel instead of in visible text.

---

## Decisions ratified (HITL 2026-06-17)

| # | Decision | Rationale |
|---|---|---|
| **RL.1** | Move `DEFAULT_ORCHESTRATOR_MODEL` `claude-sonnet-4-5-20250929` → **`claude-sonnet-4-6`** (bare alias, no date suffix) | 4.6 supports clean **adaptive** thinking (`{type:'adaptive'}`); 4.5 only the legacy `{enabled,budget_tokens}` mode. Same $3/$15 tier. Re-baseline is happening anyway, so incremental cost ≈ nil. |
| **RL.2** | New env `ORCHESTRATOR_THINKING_ENABLED` (bool, **default on**) gates the `thinking` request param | Latency escape hatch — flip off if thinking proves too slow, without a code change. |
| **RL.3** | **Conditional belt**: a "reason silently / don't narrate your working or tool use" instruction is injected **only when thinking is disabled**. Never when thinking is on. | Alastair: a blanket silent-working instruction is *dangerous* with thinking on — the thinking channel already isolates reasoning; layering suppression on top risks clipping transparency / the visible answer. The belt is the graceful degrade for the gate-off path (prompt-only mitigation, not raw leak). |
| **RL.4** | New env `ORCHESTRATOR_EFFORT` (`low\|medium\|high\|max`, optional, **omit by default**). Server-side config only — **not** a UI control. Applied only when thinking is on and the model supports `effort` (4.6+/Opus 4.6+/Fable). | Tuning lever for the thinking-depth ↔ latency tradeoff on a latency-sensitive discovery chat. Omitting → model default (`high`). |
| **RL.5** | Bump `ORCHESTRATOR_MAX_TOKENS` default 2048 → **8192** | Adaptive thinking consumes output tokens; 2048 starves the answer. Streaming is already on, so large `max_tokens` is timeout-safe. |
| **RL.6** | **Signature round-trip is conditional** — build only if the Phase-1 smoke shows the post-tool turn 400s without it | Anthropic *may* require the thinking block (with `signature`) to be preserved in the assistant turn that carries a `tool_use` when tool results are sent back. The current code drops thinking on replay ([claude-llm.ts:421-427](../product/orchestrator/src/agent/claude-llm.ts)) and ignores `signature_delta` ([:280-281](../product/orchestrator/src/agent/claude-llm.ts)). Don't build the complex path speculatively — let the smoke settle it. |
| **RL.7** | Whitespace-concat fix (`…alive.Patagonia`) in the UI adapter — independent, folded in | Separate cosmetic bug: adjacent text parts joined with no separator. |
| **RL.8** | Re-baseline the `luke-01…12` judged harness family afterward | Thinking changes outputs; the 5/12 baseline must be re-measured. ~£3–4, ~20 min. |

Decisions to log in [decisions.md](decisions.md) at close: RL.1–RL.8 (or renumber to the house `B.`/`G.` scheme at Alastair's discretion).

---

## Files touched

- **Config**: [product/orchestrator/src/config/schema.ts](../product/orchestrator/src/config/schema.ts) — `DEFAULT_ORCHESTRATOR_MODEL`, `ORCHESTRATOR_MAX_TOKENS` default, new `ORCHESTRATOR_THINKING_ENABLED` + `ORCHESTRATOR_EFFORT`. Mirror in `product/orchestrator/.env.example`.
- **LLM shim**: [product/orchestrator/src/agent/claude-llm.ts](../product/orchestrator/src/agent/claude-llm.ts) — thinking param (per-family), effort, (conditional) signature capture + replay. `ClaudeLlmParams` gains `thinkingEnabled` + `effort`.
- **Factory**: [product/orchestrator/src/agent/factory.ts](../product/orchestrator/src/agent/factory.ts) — pass `thinkingEnabled`/`effort` into `ClaudeLlm`; conditional belt injection into the instruction provider (same site as the skills-prompt injection).
- **CMS**: new `product/cms/prompts/fallbacks/silent-working.md` (non-auto-loaded — outside the `^\d{2}_*.md` system-prompt glob), read explicitly by the factory when thinking is off.
- **UI adapter**: [product/ui/src/runtime/orchestrator-adapter.ts](../product/ui/src/runtime/orchestrator-adapter.ts) — `translatePart` text-join fix.
- **Docs at close**: [decisions.md](decisions.md), [discoveries.md](../discoveries.md), [gotchas.md](../gotchas.md) (the "thinking never enabled → narration" lesson).

---

## Phase 0 — worktree setup (no product edits)

1. Copy env from the project folder into this worktree's workspaces (gitignored; per Alastair):
   `cp /Users/al/Studio/projects/swoop_web/product/orchestrator/.env product/orchestrator/.env` (+ `connector`, `ui`). Re-append `MODEL_PICKER_ALLOWLIST=claude-opus-4-8,claude-sonnet-4-6,claude-fable-5` to `product/orchestrator/.env` for the smoke.
2. `cd product && npm install` (fresh worktree). 
3. Baseline green check: `npm run -w @swoop/orchestrator test` and `npm run -w @swoop/orchestrator typecheck` pass **before** any edit (so regressions are attributable).
4. **SDK capability check** (load-bearing): confirm the installed `@anthropic-ai/sdk` types `thinking: {type:'adaptive'}` and `output_config.effort` on `MessageCreateParamsStreaming`. `grep -r "adaptive" product/orchestrator/node_modules/@anthropic-ai/sdk/resources/messages/ | head` and inspect the `ThinkingConfig*` types. If absent → the SDK predates adaptive thinking; bump `@anthropic-ai/sdk` (note any breaking changes) before Phase 1, or fall back to a typed cast for the `thinking` field. **Do not proceed to Phase 1 until the request shape is known to be accepted.**

No commit (env + node_modules are gitignored).

---

## Phase 1 — minimal native thinking (the must-have)

Goal: model reasons in the thinking channel; visible text is just the answer. **No** signature round-trip yet (keep the current drop-on-replay).

1. **Config** (`schema.ts`): 
   - `DEFAULT_ORCHESTRATOR_MODEL = 'claude-sonnet-4-6'` (RL.1).
   - `ORCHESTRATOR_MAX_TOKENS` default `2048` → `8192` (RL.5).
   - Add `ORCHESTRATOR_THINKING_ENABLED` — pattern mirrors `SMTP_SECURE`: `z.string().default('true').transform((s) => s.toLowerCase() !== 'false' && s !== '0')` (default on, RL.2).
   - Add `ORCHESTRATOR_EFFORT: z.enum(['low','medium','high','max']).optional()` (RL.4).
   - Mirror all four in `.env.example` with comments.
   - Unit test: parse with each new var set/unset; assert defaults. Run `npm run -w @swoop/orchestrator test`.
2. **`claude-llm.ts`** — add to `ClaudeLlmParams`: `thinkingEnabled?: boolean`, `effort?: 'low'|'medium'|'high'|'max'`. Add a pure helper `buildThinkingConfig(modelId, { enabled, effort, maxTokens })` returning the request fragment:
   - `enabled === false` → `{}` (no thinking; **Fable note**: never send `{type:'disabled'}` — omit entirely).
   - adaptive family (sonnet-4-6, opus-4-6/4-7/4-8, fable) → `{ thinking: {type:'adaptive'}, ...(effort ? {output_config:{effort}} : {}) }`.
   - legacy family (sonnet-4-5, opus ≤4-5, haiku) → `{ thinking: {type:'enabled', budget_tokens: Math.max(1024, Math.floor(maxTokens/2))} }`, **no** effort (errors on 4.5/haiku). Defensive — default model is now 4.6, picker is 4.6/4.8/fable, so this branch is rarely hit.
   - Spread the fragment into `params` at [:182-192](../product/orchestrator/src/agent/claude-llm.ts).
   - Pure-function unit tests for `buildThinkingConfig` across all families + enabled/disabled + effort set/unset. (This is exactly the deterministic-mapping surface the chunk-A/B test philosophy says is worth unit-testing.)
3. **`factory.ts`**: read `config.ORCHESTRATOR_THINKING_ENABLED` + `config.ORCHESTRATOR_EFFORT`, pass into `new ClaudeLlm({...})`.
4. **Green check**: `npm run -w @swoop/orchestrator test && npm run -w @swoop/orchestrator typecheck`.
5. **Commit**: `feat(orchestrator): wire native thinking (adaptive) + thinking/effort/max-tokens config; default → sonnet-4-6 (RL.1–5)`.
6. **★ Phase-1 SMOKE (decides Phase 2)** — boot the stack (connector :3002 → orchestrator :8080 with the copied `.env`, `SESSION_BACKEND=postgres`) and run the differential curl repro from the handoff: `POST /session` → `PATCH /session/:id/consent` → `POST /chat {message:"Tell me about Patagonia"}`. Parse SSE MessageParts. Verify:
   - **(a) Leak gone**: no `text` segment before/between tool-calls; the only visible text is the final answer.
   - **(b) Tool loop survives**: the turn completes through `find_*`/`illustrate` without a `400` on the post-tool-result continuation. Watch orchestrator stderr for `400` / "thinking" / "signature" errors.
   - If **(b) passes** → signature round-trip not needed; **skip Phase 2**, record that in the plan + discoveries.
   - If **(b) 400s** (likely message: thinking/`signature` block required before `tool_use`) → **do Phase 2**.
   - Also eyeball a thinking-on conversation for over-suppression / quality regression.

---

## Phase 2 — signature round-trip (CONDITIONAL on Phase-1 (b) failing)

> ⏭️ **SKIPPED (2026-06-17).** The Phase-1 smoke (b) passed — the full tool loop completed with no 400 — so the signature round-trip is not required for this path. Steps below are retained as the ready recipe if a future model/path 400s for a missing pre-`tool_use` thinking block.

Only if the smoke 400s. Persist thinking blocks (with signature) so they replay before `tool_use`.

1. **Read first** (haven't yet): the B.t4 translator (`adkEventsToParts` / equivalent) and the session-persistence sink path, to confirm how a non-partial `thought:true` Part flows to (i) the SSE wire (must be stripped by reasoning-filter) and (ii) session history (must persist). Confirm genai `Part` carries `thoughtSignature` in the installed `@google/genai`.
2. **Capture** `signature_delta` (currently ignored at [:280-281](../product/orchestrator/src/agent/claude-llm.ts)): accumulate per thinking block.
3. **Consolidate**: at `content_block_stop` for a thinking block, emit ONE non-partial thinking Part `{ text: accumulatedThinking, thought:true, thoughtSignature: sig }` so ADK appends it to session history (mirrors the existing message_stop text-consolidation rationale at [:302-312](../product/orchestrator/src/agent/claude-llm.ts)).
4. **Replay**: in `assistantPartsToBlocks` ([:421-427](../product/orchestrator/src/agent/claude-llm.ts)), for `p.thought === true`, emit `{ type:'thinking', thinking: p.text, signature: p.thoughtSignature }` instead of dropping. Drop only if signature is absent (defensive).
5. **Confirm the strip still holds**: reasoning-filter must still remove the consolidated thinking Part from the **SSE wire** (visitor never sees it) while it persists to session. Verify via network inspection — no thinking text on the wire.
6. Unit tests for capture + replay shaping. **Green check + commit**: `fix(orchestrator): round-trip thinking blocks with signatures across the tool loop (RL.6)`.
7. **Re-run the Phase-1 smoke** — both (a) and (b) must now pass.

---

## Phase 3 — conditional belt (gate-off fallback)

1. Author `product/cms/prompts/fallbacks/silent-working.md` — concise: reason silently / put working in the thinking, not the reply / don't narrate tool use / output only the visitor-facing answer. (Voice-checked, no AI-slop.)
2. **`factory.ts`**: when `!thinkingEnabled`, read that file and append it to the instruction in the existing `InstructionProvider` wrapper (the same place skills-prompt injection happens). When `thinkingEnabled`, inject nothing (RL.3).
3. Unit test: instruction includes the belt iff thinking disabled. **Green check + commit**: `feat(orchestrator,cms): conditional silent-working belt for the thinking-off fallback (RL.3)`.
4. **Smoke the off-path**: boot with `ORCHESTRATOR_THINKING_ENABLED=false`, confirm (a) the belt is in the system prompt and (b) the leak is materially reduced vs. raw status quo (prompt-only mitigation level). — ⏭️ **Behavioural smoke skipped (2026-06-17)**: belt injection is unit-tested (`factory.test.ts` — present iff disabled), it's the degrade path (default ships thinking-on), and live off-path stack recovery cost outweighed the marginal signal. The belt's *content* is voice-checked; its *wiring* is asserted.

---

## Phase 4 — whitespace-concat fix (independent)

1. **Read** `orchestrator-adapter.ts` `translatePart` text handling to locate the lossy join.
2. Fix so adjacent text segments (e.g. pre-/post-tool prose) don't lose their boundary (`…alive.Patagonia` → `…alive. Patagonia`), without inserting spurious whitespace mid-stream.
3. UI unit test for the join. **Green check + commit**: `fix(ui): preserve separator between concatenated text parts (RL.7)`.

---

## Phase 5 — docs + harness re-baseline (close)

1. [decisions.md](decisions.md): RL.1–RL.8 with rationale + swap cost.
2. [discoveries.md](../discoveries.md): "reasoning-strip pipeline was built but `thinking` was never enabled → the model narrated its planning as visible text; producer/consumer split is a false-completeness trap." + the Phase-1 smoke outcome (whether signature round-trip was needed).
3. [gotchas.md](../gotchas.md): per-family thinking modes (4.5 enabled+budget vs 4.6+ adaptive; effort omitted on 4.5/haiku; Fable omit-vs-disabled).
4. **Re-baseline**: `npm run -w @swoop/harness eval -- --filter luke- --judge sonnet` (export `ANTHROPIC_API_KEY` from orchestrator/.env; stack on :8080). Compare to [luke-baseline-judged-2026-06-12](../product/harness/runs/luke-baseline-judged-2026-06-12/results.md). Record the new pass rate + any regressions. ~£3–4.
5. Final fresh-install verification per the swarm-merge discipline (`rm -rf node_modules && npm install` at the tip, full test sweep + typecheck across workspaces).
6. Commit docs. **Do not merge to main** — that's Alastair's "apply" call.

---

## Open questions / risks

- **SDK version** (Phase 0.4) — the one thing that could block: if `@anthropic-ai/sdk` predates adaptive thinking, a bump is required and may carry its own breaking changes.
- **Signature round-trip** (RL.6) — the genuine unknown; Phase-1 smoke resolves it. If `@google/genai`'s `Part` lacks `thoughtSignature` in the installed version, Phase 2 needs an alternative carrier (e.g. a side-map keyed by block) — surface before building.
- **temperature + adaptive thinking on 4.6** — per Alastair, stick with defaults (temp 0.7 still sent via `modelAcceptsSamplingParams`). If the API 400s on temp-with-thinking for 4.6, that surfaces in the Phase-1 smoke; minimal fix then, not pre-emptively.
- **effort default** — omitted (model default `high`). If the Phase-1 smoke shows `high` is too slow for the discovery chat, set `ORCHESTRATOR_EFFORT=medium` in `.env` and re-smoke — no code change.
