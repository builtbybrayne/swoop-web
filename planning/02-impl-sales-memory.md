# 02 — Implementation: Sales-Team Agent Memory

**Status**: Tier 2 implementation plan. **DRAFT, 2026-06-16.** Awaiting Alastair's ratification before any T3 execution.

**Implements**: Luke's 16/06/26 feedback — the agent lacks current, authoritative sales knowledge (e.g. Patagonian seasonality and refugio availability) and reasons unreliably about season-relative-to-date — reframed by Alastair (this session) into a general **sales-team-authored agent-memory** capability. Closes the long-deferred [01-top-level.md §2.2 JTBD](01-top-level.md) item *"(Post-Puma) shape AI behaviour without developer tickets"* by giving non-technical sales staff an **inline, conversational** way to teach the agent.

**Takes off the shelf**: the git-PR / override-repo / "Curator" design ([03-exec-crosscut-sales-team-prompt-curation.md](03-exec-crosscut-sales-team-prompt-curation.md) + [03-exec-crosscut-prompts-repo-split.md](03-exec-crosscut-prompts-repo-split.md), both deprecated 2026-05-27 as *too heavy for non-technical contributors*). Those plans explicitly parked the "if sales-team write access becomes a real need later" option; this plan is that need, realised in a far lighter, inline form — no second repo, no PATs, no git.

**Depends on**: B (agent runtime — the orchestrator, `factory.ts`'s per-turn `InstructionProvider`, B.t13 Postgres session store), C (connector — Postgres, MCP tools, data primitives, side-effect ownership per E.11), D (chat surface — the iframe widget + session bootstrap), G (content — the system prompt + skills the memory agent reasons against).

**Coordinates with**: the live sales-feedback workflow docs ([docs/sales-team-prompt-workflow-sales.md](../docs/sales-team-prompt-workflow-sales.md) + [-devs.md](../docs/sales-team-prompt-workflow-devs.md)). This is the **inline realisation** of the "future sales-team-facing Claude skill" those docs anticipate — the Google-Doc-relay loop stays for *behaviour/voice* change requests; this mechanism handles the *knowledge* slice (facts the agent should hold), authored conversationally.

**Precedent for shape**: this is a named Tier-2 capability (not a lettered chunk A–H), arising from client feedback — same posture as [02-impl-visual-sidebar.md](02-impl-visual-sidebar.md).

**Decisions**: logged as `sm-1`…`sm-8` in [decisions.md](decisions.md).

---

## Purpose

Give the Swoop sales team a way to **tell the live agent things to remember**, inline, in plain conversation, with no git / files / second tool — and have those memories load into every future visitor conversation as **authoritative, current** sales knowledge.

The triggering need is concrete: Luke watched the agent fumble Patagonian seasonality (treating January as if availability were open; not grounding "season" against the actual date). That knowledge — *high-summer refugios book out months ahead; shoulder seasons stay open longer and suit wildlife* — is tacit human sales wisdom that **does not and will not exist in the SQL dump** (decision C.14: no departures/availability data). The only viable home is authored prose the agent always holds. The general capability this plan builds lets the team keep feeding that kind of knowledge in over time, themselves.

**The hard constraint that shapes everything**: the sales person must be able to **test the public agent faithfully** (as a visitor experiences it) *and* manage memory, in one place. So the conversational experience must stay byte-identical to production; memory management is layered alongside, never altering what's being tested.

---

## 1. Outcomes

When this capability is done:

- An authenticated sales-team member, on the live site, can say *"remember that the W-trek refugios book out months ahead for high summer"* and — after an explicit confirm — that memory is persisted.
- Every subsequent visitor conversation loads that memory into the agent's instruction as **authoritative, timestamped** knowledge the agent may state as fact (distinct from `00_why.md`'s illustrative, "source-from-tools" examples).
- The sales member can **edit, supersede, and delete** memories conversationally, and review what's currently held.
- Each memory is **versioned, attributed** (author name), and **timestamped**, with the timestamp surfaced in-prompt so the agent can reason about staleness against the dateline (B.t12) — exactly as §5 of `00_why.md` already makes it weigh pricing contemporaneity.
- A **public (unauthenticated) visitor never sees, discovers, or can invoke** any memory tool. Authentication gates *which capabilities the server wires*, not a client flag.
- The sales member experiences the **real Sonnet public agent** for testing — memory management runs on a separate Opus agent that never touches the conversational path being tested.
- Memory changes **propagate to all live conversations on their next turn**, with no per-instance cache to invalidate (correct under horizontal Cloud Run scale-out, not just single-VM).

**Not outcomes**: per-visitor memory (the no-cross-session-memory wall, `00_why.md` §10, stands); behaviour/voice changes (those stay in the Google-Doc → prompt-engineer loop); a sales-team admin web UI; embeddings/retrieval over memories (see §10 — a curated list never needs it).

---

## 2. Target functionalities

### 2.1 Two agents, one chat, orchestrator-routed (decision sm-1, sm-2)

The orchestrator runs **two agents over the same Postgres-backed session**:

- **Conversational agent** — the production agent, unchanged: **Claude Sonnet**, the eight public tools, `00_why.md` + skills. Drives every visitor turn, and every *test* turn a staff member takes. This is what guarantees faithful testing.
- **Memory agent** — **Claude Opus**, the same base prompt + a memory-mode wrapper + the memory CRUD tools, invoked only inside an authenticated staff session when the staff member explicitly asks to manage memory.

The "handoff" between them is **orchestrator-level routing**, *not* ADK inter-agent transfer. The orchestrator already chooses what to run per request; it reads a per-session `mode` flag (`conversation` | `memory`) and dispatches the turn to the right agent. Both agents read the same session history from the B.t13 Postgres session store, so "the memory agent sees the whole conversation" is free. This keeps us inside the existing "one `LlmAgent` per runner, orchestrator routes" pattern and **never engages ADK's multi-agent machinery**, which Puma has deliberately never used (theme 6). The memory agent is an *admin-only, staff-session-only functional agent* — it is never in a visitor's loop, so theme 6's single-agent-conversational-loop principle is preserved (it is the kind of behind-the-boundary functional agent decision B.4 explicitly permits).

> **Open technical risk — spike before banking the build (§7).** The contained unknown is the cleanest way to give the Opus agent the conversation history and run it: (a) two runners sharing one ADK session, or (b) read the stored transcript and run a separate Opus loop seeded with it. An afternoon decides it. This is the only "does the framework allow this" risk in the design.

### 2.2 Entry, confirm, and handback (decision sm-3)

- **Entry to memory mode is *explicit only*. The agent MUST NOT infer it.** Only the staff member stating intent to persist ("remember that…", "save this for the agent", "forget the shuttle note", "what do you currently hold about seasons?") flips `mode` to `memory`. No "this seems important" classifier; no proactive offers. This is the line that keeps a *test* utterance from leaking into the store that loads into every public conversation.
- **Natural-language trigger + confirm-before-write.** The staff member phrases it naturally; the memory agent opens with a confirm — *"Capturing this as a memory: '…' — right?"* — so a misfire is caught before anything is written. (Natural keeps it inline per Alastair's "tell thing, change thing" ethos; the confirm makes a misfire harmless.)
- **No-inference governs the *write*, too.** In memory mode, Opus persists *what it is told*, confirms, and never silently adds memories of its own. It MAY *suggest* ("you also made a shoulder-season point — capture that too?") but only writes on an explicit yes.
- **Handback is an explicit signal.** Opus calls a `finish_memory` tool (or equivalent) when the exchange stops being about memory; the orchestrator flips `mode` back to `conversation`. Rule in the wrapper: *hand back the moment the staff member's turn is no longer a memory instruction — a "done", a "thanks", or a return to testing; when unsure, ask once and hand back unless told otherwise.* Low-stakes and recoverable (re-entering is just another instruction), plus an explicit user exit (typed `done` / a UI control) as backstop.

### 2.3 Authentication — gated server-side, behind a swappable strategy (decision sm-7, sm-4)

There is **no UI-side agent** (decision D.11; the UI is a pure renderer). The browser never receives tool definitions — only rendered tool-call *events* for tools that actually fire. Therefore **all gating is server-side and sufficient**: the orchestrator wires the memory agent / CRUD tools only for an authenticated staff session; a visitor's agent simply lacks them.

- **v1 mechanism**: **two equivalent triggers**, both opening the same password popup → `POST /staff/auth` validates → issues a **JWT (~30-day)** → stored in `localStorage` → sent on subsequent chat/session requests. (1) a magic URL param on the **direct widget URL** (not the embedded iframe — dodges third-party-storage / Safari-ITP limits already flagged in the embed notes); (2) a global console function **`swoop_login()`** exposed on the widget page — fallback recipe for the team: *right-click the agent (even the iframe) → Inspect → console → type `swoop_login`*. The console trigger is an easy recipe to remember, survives the URL param failing for any reason, and is freely **re-triggerable** (useful for testing / re-auth). Both triggers converge on the one popup + the one `StaffAuthenticator`. The orchestrator validates the JWT at session bootstrap to set the staff flag; the connector **re-validates on every memory mutate** (dual backstop, same posture as handoff consent E.4). A client-side flag is never the boundary.
- **Encapsulation for later swap (sm-7, theme 4)**: the credential check sits behind a `StaffAuthenticator` interface (`verify(credential) → {ok, staffName}` / `issue`/`validate` token). v1 is `SharedPasswordAuthenticator` (one staff password + name-capture-once for attribution). A later `GoogleOidcAuthenticator` (or similar) drops in with no change to callers — mirrors the `HandoffStore` interim→durable pattern (E.1/E.12).
- **Abuse**: `/staff/auth` is a public password endpoint → it gets a basic rate-limit / lockout. The one place rate-limiting is *not* deferred (the project otherwise defers it, top-level §7).
- **PII (sm-8)**: there is no customer in a staff session, so the capture-time PII concern is moot. Residue is content-hygiene only — a memory must not *describe* a specific past customer, because its text later loads into public conversations. The memory-mode wrapper carries that guard; it is editorial, not a live-data risk.

### 2.4 The memory store — versioned, attributed, timestamped (decision sm-5)

Postgres, in the connector's single store (C.18; the B.t13 session tables already live there). Two tables — the standard *current-state + append-only history* shape:

```
sales_memory            -- one row per memory (the current truth; what the agent loads)
  id            uuid pk
  content       text                       -- current text
  status        text   not null            -- 'active' | 'retired'
  version       int    not null            -- current version number
  created_by    text   not null            -- author of v1 (staff name)
  created_at    timestamptz not null
  updated_by    text   not null            -- author of the latest version
  updated_at    timestamptz not null       -- ← surfaced in-prompt for staleness (sm-6)

sales_memory_version    -- append-only history; one row per change
  id            uuid pk
  memory_id     uuid not null references sales_memory(id)
  version       int  not null
  content       text not null
  change_kind   text not null              -- 'create' | 'edit' | 'retire' | 'restore'
  author        text not null
  created_at    timestamptz not null
  unique (memory_id, version)
```

- Every write inserts a `…_version` row **and** updates `sales_memory`, in one transaction.
- "An array of attributed versions" (Alastair's mental model) *is* the set of `sales_memory_version` rows for a `memory_id`, each attributed by `author` + `created_at`.
- **Soft-delete only** — delete = `status='retired'` + a `retire` version row. Never hard-delete (keeps the audit trail; matches the project's immutable-history instincts — C.31 forward-only migrations, the model-version-in-PK embedding cache). Rollback = copy an old version's content into a new version.
- The agent **loads only** `WHERE status='active'`.

### 2.5 Loading into every conversation — authoritative, timestamped, cache-safe (decision sm-6)

- The orchestrator's `InstructionProvider` (already resolved per-turn, `factory.ts:120`) reads the **active memory set on each turn** — one indexed query: `SELECT content, updated_at, updated_by FROM sales_memory WHERE status='active' ORDER BY id`. No app-level cache.
- **Shared by construction** — it's the DB, so every Cloud Run instance folds in a change on its next turn with zero invalidation logic. This is the fix for Alastair's "must work across instances" point; the earlier in-process-cache idea is dropped.
- **Prompt-cache-safe** — between writes the assembled text is byte-identical, so the Anthropic prompt cache (`cache_control: ephemeral`, `claude-llm.ts`) still hits; a write busts it once. (A shared version-marker row to *skip* the per-turn read is a future optimisation only — YAGNI at dozens-of-memories scale.)
- **Authoritative framing (vs `00_why.md`'s "source-from-tools" NB notes)** — the block carries a header marking it as current, authoritative team knowledge the agent MAY state as fact. Without that, the agent's existing illustrative-only discipline makes it hedge on the very facts we inject.
- **Each memory's timestamp is in the block** (sm-6) — e.g. `(noted 2026-06-16 by Luke)` — so the agent can weigh age against the dateline. The framing tells it how: *time-sensitive memories (seasonal, pricing) should be read relative to today's date; an old note about "this season" refers to the season current when it was written.*
- Memories load into **every** session — visitor and staff alike. Staff sessions additionally *write*; visitor sessions only *read* (they have no memory tools).

### 2.6 The memory-mode wrapper + the conversational staff addendum (content; G-style)

Two authored prose surfaces (Alastair's editorial domain per G.7 — Claude drafts, Al edits):

- **Memory-agent wrapper** — instructs the Opus agent on memory mode: explicit-trigger recognition, the confirm step, dedup/conflict-check against the current store, succinct phrasing, no-inference, the content-hygiene (no-customer-PII) guard, and the `finish_memory` handback rule.
- **Conversational-agent staff addendum** — present *only* in staff sessions: tells Sonnet to recognise an explicit memory instruction and signal the mode flip (rather than answering it as a visitor would). Absent from visitor sessions, so production behaviour is untouched.

---

## 3. Architectural invariants (carried into every T3)

1. **Faithful testing is sacred.** The conversational agent (Sonnet, public tools, prompt) is byte-identical for staff and visitor. Nothing about memory management may alter what a staff member is testing. (sm-1)
2. **Explicit-trigger-only, no inference.** The agent never decides on its own that something is worth remembering; the staff member always says so, and confirms. (sm-3)
3. **Server-side gating is the boundary.** No UI agent exists; the browser cannot see or call memory tools. Auth decides what the server wires + the connector hard-rejects unauth'd mutates. (sm-4)
4. **Shared state, never in-process.** Mode flag and memories live in Postgres; correctness must hold across N Cloud Run instances. (sm-2, sm-6)
5. **Authoritative-but-dated.** Loaded memories are stated as fact, each carrying its timestamp so the agent reasons about staleness against the dateline. (sm-6)
6. **Swap-out surfaces named.** Auth strategy is behind an interface (shared-password → OIDC later) with no caller change (theme 4). (sm-7)
7. **Immutable history.** Soft-delete + append-only versions; never destroy the audit trail. (sm-5)
8. **No second-agent in the visitor loop.** The Opus memory agent is admin-only; theme 6's single conversational agent stands. (sm-2)

---

## 4. T3 decomposition + sequencing

| T3 | Title | Workspaces | Notes |
|---|---|---|---|
| **T3-1** | Memory store + CRUD | `connector`, `@swoop/common`, migration | Two tables, CRUD primitives, MCP memory tools, connector-side auth enforcement on mutates, the read-active-set load query. |
| **T3-2** | Staff auth | `orchestrator`, `ui`, `@swoop/common` | `StaffAuthenticator` interface + `SharedPasswordAuthenticator`; `/staff/auth` + JWT + rate-limit; `ChatRequestSchema` extension to carry the token (same shape as B.t12's `clientTime` add); session staff-flag/mode; UI magic-URL → popup → localStorage → token-on-requests. |
| **T3-3** | Two-agent routing + Opus memory agent | `orchestrator` | **Spike first** (§7). Mode flag, per-turn routing, Opus agent build, `finish_memory` handback, conditional wiring (memory agent only in authed sessions). |
| **T3-4** | Memory loading into sessions | `orchestrator`, `cms` | Read active set per turn; authoritative + timestamped framing header; inject into `InstructionProvider`; stable order for cache. |
| **T3-5** | Prompt/content authoring | `cms` (Al editorial) | Memory-agent wrapper + conversational staff addendum + the authoritative-knowledge framing copy. |

**Sequencing**: **spike (T3-3 head)** → then T3-1 + T3-2 parallelise → finish T3-3 + T3-4 → T3-5 authored alongside (content; runs parallel). Per the worktree policy, build in worktrees; HITL on main.

---

## 5. Shared contracts

- `@swoop/common`: `ChatRequestSchema` gains an optional staff token field (precedent: B.t12 `clientTime`); new `SalesMemory` / `SalesMemoryPublic` Zod schemas; memory-tool I/O schemas; `StaffAuthenticator` interface type.
- Session state shape gains `mode` + `staff` fields (read by the orchestrator's router; persisted by the B.t13 store).
- Connector MCP surface gains the memory CRUD tools (registered connector-side; the orchestrator exposes them to the *memory* agent only).

---

## 6. Verification (woven into each T3)

- **Auth gate holds**: a visitor session can neither see nor invoke memory tools; an unauth'd `POST /staff/auth` is rate-limited; the connector rejects a mutate without a valid token.
- **Explicit-only**: a *test* utterance that resembles a memory instruction (e.g. "remember when I asked about X?") does **not** write; only an explicit confirmed instruction does.
- **Write→load loop**: a staff member writes a memory, then in the same session tests as a visitor and sees it reflected on the next turn.
- **Cross-instance**: a memory written via one process is reflected by another (simulate two orchestrator instances against one DB).
- **Version history**: edit/retire produce attributed version rows; the agent loads only active.
- **Faithful testing**: the conversational agent's behaviour/model/tools are provably unchanged for staff vs visitor (the memory machinery only adds, never alters).
- **Staleness**: a memory's timestamp appears in the loaded block; a dated seasonal memory is reasoned about relative to the dateline.
- Standing gate (discoveries.md): the two-agent routing gets a **real-Anthropic live smoke**, not just boot-logs — it's the first functional sub-agent in Puma.

---

## 7. Open sub-questions / the spike

1. **THE SPIKE (do first):** cleanest way to run the Opus memory agent with full conversation history — shared ADK session across two runners, vs a separate Opus loop seeded with the stored transcript. Decides T3-3's shape. ~½ day.
2. **Trigger recognition** — natural-language + confirm is settled; the only residual is how the staff addendum phrases the recognition so test-utterances don't misfire (the confirm step is the safety net regardless).
3. **Concurrent edits** — two staff editing one memory: optimistic concurrency via the `version` column (reject stale-version updates). Low likelihood (few staff); cheap to add.
4. **Token expiry mid-memory-mode** — handle gracefully (re-auth, preserve the in-flight draft). T3-2 detail.

---

## 8. Out of scope (YAGNI fence)

- **No embeddings / retrieval over memories.** A curated list loaded whole is correct at this scale; escalation ladder (section → graduate a heavy section to a skill → only then embeddings) is documented in the session that produced this plan, not built.
- **No admin web UI.** Authoring is conversational; reviewing is conversational (`list`).
- **No per-visitor memory.** The no-cross-session-memory wall stands (`00_why.md` §10).
- **No behaviour/voice authoring here.** Those remain the Google-Doc → prompt-engineer loop (the workflow docs). This is the *knowledge* slice only.
- **No multi-language.** English, matching the agent.
- **No ADK multi-agent transfer.** Orchestrator-level routing only (sm-2).

---

## 9. Near-term, independent of this build

**Ship a static seasonal-knowledge fragment now.** Luke's actual feedback (seasonality) can be closed this week with a single always-on `product/cms/prompts/system/20_field-notes.md` (the loader already concatenates it — `prompt-loader.ts`), seeded with the refugio/shoulder-season facts currently *trapped* in conditionally-loaded skills (`arrived-with-ai-itinerary`, `engaging-a-planner`, `group-tour-surfacing-for-solos`, `pattern-budget-solo-traveller`) plus the Southern-Hemisphere season-inversion anchor drafted-but-never-shipped in [inbox.md](inbox.md) 2026-05-18. It needs the same *authoritative-framing* header §2.5 describes (so the agent states it as fact, not as a "source-from-tools" illustration), and Alastair's editorial pass (G.7). The Postgres memory store supersedes it later **without changing how the agent loads it** (both are just lines in the instruction). Authoring deferred to Alastair's go — it's content/voice, his domain.

---

## Provenance

Captured from the 2026-06-16 Cowork design session (Alastair + Claude), triggered by Luke's 16/06/26 feedback on seasonality/sales-knowledge. Design arc: rejected a static-file/Google-Doc-only answer (not self-serve) and a separate-external-authoring-agent (would need an MCP server + meta-cognition non-techies lack) → landed on **inline, same public agent for testing, a dedicated Opus memory agent reached by orchestrator routing in an authed staff session, writing to a versioned Postgres store loaded authoritatively + timestamped into every conversation.** Auth shared-password-behind-a-swappable-interface for v1. Full reasoning chain in the session transcript; key calls in [decisions.md](decisions.md) `sm-1`…`sm-8`.
