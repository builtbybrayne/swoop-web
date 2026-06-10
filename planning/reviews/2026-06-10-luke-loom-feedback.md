# 2026-06-10 — Luke Loom feedback: triage & master ledger

**Type**: Client-feedback triage (review-convention shape — this file is the master ledger; every item forward-links to its Tier-3 home).
**Source**: Luke's Loom walkthrough, 10 Jun 2026. Raw transcript at [planning/meetings/luke_loom_feedback_100626.md](../meetings/luke_loom_feedback_100626.md) (⚠ uncommitted in the main working tree as of authoring — commit it alongside this ledger at merge). Alastair's structured capture + stances arrived in the 2026-06-10 Cowork session (worktree `magical-poincare-53e479`).
**Context**: second round of Luke feedback. Round 1 (Google Doc "Conversational AI Jun26 Feedback", 1 Jun) produced the visual sidebar ([02-impl-visual-sidebar.md — Tier 2, widget relocation](../02-impl-visual-sidebar.md)) and the prompt pass in commit `c93262a` ("Apply Luke's feedback to system prompt: response shape, repetition, sales-team framing"). This round is feedback **on** that build.

---

## How to read this

Each item: Luke's ask → our stance → disposition → where the work lives. Dispositions: **PLANNED** (Tier-3 plan authored this session, DRAFT pending HITL ratification), **CONTENT** (lands in the chunk-G content plan), **EXTERNAL** (needs Swoop input — tracked in [questions.md](../../questions.md)), **PARKED** (deliberately not now — reasoning recorded).

The eight Tier-3 plans authored from this ledger:

| Plan | Covers |
|---|---|
| [03-exec-crosscut-magical-poincare-handoff-form.md](../03-exec-crosscut-magical-poincare-handoff-form.md) | L1, U1, U2, U3, U4 — form position, copy, fields, ordering |
| [03-exec-crosscut-magical-poincare-retrieval-provenance.md](../03-exec-crosscut-magical-poincare-retrieval-provenance.md) | L2 (titles), D1 (dates) — schema + compose + tool-description layer |
| [03-exec-content-t6-luke-loom.md](../03-exec-content-t6-luke-loom.md) | L3, D1/D2 (prompt side), P1, P2, P3 — the chunk-G content pass |
| [03-exec-agent-runtime-t12.md](../03-exec-agent-runtime-t12.md) | A1 — browser timestamp → agent context (B.t12) |
| [03-exec-crosscut-magical-poincare-visual-channel.md](../03-exec-crosscut-magical-poincare-visual-channel.md) | D3, D4 — single image, hidden annotations, one-page emphasis |
| [03-exec-crosscut-magical-poincare-terminology-card.md](../03-exec-crosscut-magical-poincare-terminology-card.md) | P1 (card) — "About Swoop Planning Specialists" sidebar card |
| [03-exec-crosscut-magical-poincare-demo-stability.md](../03-exec-crosscut-magical-poincare-demo-stability.md) | B1 — refresh/history-loss investigation + demo hardening + durable-sessions recommendation |
| *(B.t13 durable sessions — stub inside the demo-stability plan; promote to its own `03-exec-agent-runtime-t13.md` on ratification)* | B1 structural fix |

---

## Layout & presentation

### L1 — Handoff form renders before the agent's written response → should come after

**Luke**: once he said "yes, contact me with a specialist", the response text should come before, not after, the form.
**What's actually happening**: the booking-limit rule in [00_why.md §9](../../product/cms/prompts/system/00_why.md) ("the next action MUST be a `handoff` tool call in the same turn") makes Sonnet fire the tool first and write its framing prose in the post-tool continuation. assistant-ui mounts the widget at the tool-call part's stream position — so the form lands above the prose.
**Stance**: agree. Fix UI-side, not prompt-side — a presentation-ordering rule is deterministic where a prompt nudge is probabilistic, and the prompt's fire-first discipline is load-bearing (don't weaken it).
**Disposition**: PLANNED → [handoff-form plan §2.1](../03-exec-crosscut-magical-poincare-handoff-form.md).

### L2 — "Read more on swoop-patagonia.com" links should use the page title

**Luke**: link text should be the page title; "Find out more about {page title}" is acceptable.
**What's actually happening**: anchor text is hard-coded in three widgets ([lookup.tsx:138](../../product/ui/src/widgets/lookup.tsx) "Read the full guide on swoop-patagonia.com →", [find-inspiring.tsx:142](../../product/ui/src/widgets/find-inspiring.tsx) "Read more on swoop-patagonia.com →", [find-proof.tsx:133](../../product/ui/src/widgets/find-proof.tsx) "Read more →"). The blocker is structural: the `*Public` schemas carry `canonicalUrl` but **no source-page title** — `InspirePassagePublicSchema`, `InformChunkPublicSchema`, `TrustProofPublicSchema`, `CustomerStoryPublicSchema` ([derived.ts](../../product/ts-common/src/derived.ts)) all drop the title at compose time even though `page.title` and `blog_post.title` exist in the domain tables. (lookup's `SourceLink` already renders a small title-ish `hint` above the link — derived, not canonical.)
**Stance**: agree. Title belongs in the data contract anyway (the agent benefits too — it can name the guide it's pointing at).
**Disposition**: PLANNED → [retrieval-provenance plan](../03-exec-crosscut-magical-poincare-retrieval-provenance.md) (schema + compose), widget copy changes included there.

### L3 — Underusing bold / font variation; every response should have *some* formatting

**Luke**: regions/places italic; key phrases ("world class trails and glaciers", "two week guided trip") bold; key actions ("start the conversation now") and specialist references bold; at least some formatting per response. Examples are illustrative, not exhaustive.
**What's actually happening**: [00_why.md §4 "Shape of a reply"](../../product/cms/prompts/system/00_why.md) currently says "**Bold sparingly** … a word or two, never whole sentences" — authored in the **round-1** pass (`c93262a`, 1 Jun). The pendulum has swung: round 1 calibrated bold down, round 2 says we're under-formatted.
**Stance**: agree, with calibration care. Rewrite the formatting guidance from Luke's concrete examples (a positive spec: italics for place/region names; 1–3 bold key phrases per reply; bold key actions and the specialist brand term) while keeping the florid-guard ("never whole sentences", bold-to-guide-not-shout) so we don't overshoot into AI-slop formatting and trigger a round 3 in the other direction.
**Disposition**: CONTENT → [content plan §2.1](../03-exec-content-t6-luke-loom.md).

---

## Data accuracy & relevance

### D1 — Stale data points (2011 blog prices); agent must know data age; prices MUST be contemporary

**Luke**: "$300–350/day" came from a January 2011 blog post he wrote. Pricing is sensitive; if no contemporary source exists, the agent must not fall back to old ones. Is retrieved data timestamped?
**What's actually happening**: **no — dates never reach the agent.** `blog_post.published_at` and `customer_tip.source_created_at` (2016–2025!) exist in the domain tables, but the derived tables ([003_derived_tables.sql](../../product/connector/migrations/003_derived_tables.sql)) carry only `source_provenance`, and the `*Public` schemas the agent sees carry no date at all. The agent literally cannot distinguish a 2011 cost guide from a 2026 one. Caveat discovered during triage: for page/contentblock-derived content, the puma-side `page.created_at/modified_at` default to ETL-load time — whether *source* CMS dates survive the dump needs verifying at execution; blog and tip content is reliably datable.
**Stance**: agree — this is the highest-stakes item in the round. Two-layer fix: (1) **plumbing** — `source_published_at` on derived tables, composed from the domain sources, exposed in the `*Public` schemas and taught in the tool descriptions; (2) **policy** — prompt rules: price/cost statements MUST come from dated-and-recent or canonical sources; undated/stale retrieval content is usable for colour but not for figures; keep ranges broad (D2). The existing §5 rule ("MAY speak in published cost bands") gets the contemporaneity condition bolted on.
**Disposition**: PLANNED → [retrieval-provenance plan](../03-exec-crosscut-magical-poincare-retrieval-provenance.md) (plumbing) + [content plan §2.4](../03-exec-content-t6-luke-loom.md) (policy).

### D2 — Price ranges broad; pricing guidance should come from the Product Library (not ingested today)

**Luke / Alastair**: narrow ranges induce sticker shock; the Product Library is the right pricing source; ingesting it is a work item worth Swoop sign-off; we did partial exploration in the Phase-1 PoC so it's not from scratch.
**Stance**: agree on the broad-bands half — prompt policy, lands now, free. Product Library ingestion is deliberately **not planned this round** (Alastair, 2026-06-10): it's a non-trivial scope addition that needs a priorities conversation with Luke first. Alastair is proposing to Luke by email that we **prioritise production**, and return to data-layer investments like this if and when there's evidence they're suppressing **marketing conversion rates** — conversion being the project's real aim. Until that gate opens, the standing answer is the in-fence mitigation set: provenance dates + broad-band/contemporaneity policy.
**Disposition**: CONTENT (broad bands) → [content plan §2.4](../03-exec-content-t6-luke-loom.md). PARKED (production-first; gate = conversion-rate evidence) + EXTERNAL (Luke's agreement, via Alastair's email) → [questions.md](../../questions.md) "Production-first prioritisation". Commercial framing in [inbox.md](../../inbox.md) 2026-06-10.

### D3 — Image annotations weak ("immense landscape" isn't); 3-image block → single large image; don't display annotations

**Luke**: annotations are sometimes off or depressing ("tourist"); don't show them; alt text fine; single image suits the sidebar.
**Stance**: agree with the pragmatic path Luke himself offered: stop *displaying* annotations (they remain retrieval substrate + alt text), and render one strong image rather than a strip. Annotation *quality* itself: the known [vision-client reminder bug](../03-exec-c-t4.md) (in-message reminder lags the v2 six-output prompt; all tag arrays empty) + a full re-annotation batch run (~£14) is the existing parked fix — surfacing this feedback raises its priority but it stays gated on a cost go-ahead, and *display removal makes it non-blocking for Luke's complaint*.
**Disposition**: PLANNED → [visual-channel plan](../03-exec-crosscut-magical-poincare-visual-channel.md). Re-annotation run: PARKED (existing item, gate: Alastair cost go-ahead).

### D4 — "What's the one most relevant page" — one pic, one page excerpt

**Luke**: likes the page references; wants the single most relevant one, not a list.
**Stance**: agree as a display-layer rule: the lookup widget emphasises the **single most-relevant source page** (title as anchor per L2); the agent still receives the full chunk set for prose. Pairs with D3's single image — together they make the sidebar "one pic, one page, cards" per moment.
**Disposition**: PLANNED → [visual-channel plan](../03-exec-crosscut-magical-poincare-visual-channel.md).

### D5 — Trip cards misaligned with conversational focus (cost-conscious query → most expensive property; Aysén property when conversation was elsewhere)

**Luke**: concept good; relevance hard. Alastair: this is data-quality-in/data-quality-out plus a vector-search ceiling; a proper fix needs agentic data pipelines + richer search — a data-engineer engagement (recommendation available), not a cost-effective blocker to trialling in production; Product Library integration likely improves it de facto.
**Stance**: agree with the park — with two cheap wins first: (1) **`budgetBand` audit** — the filter exists end-to-end ([find_options.ts](../../product/connector/src/tools/find_options.ts) → `BUDGET_CEILING` in every card query incl. hotels) but the Explorer-on-a-budget-query symptom says either the agent isn't passing it or hotel price data is NULL (filter no-ops). Probe + prompt-nudge are hours, not days. (2) Region coherence: the blend's `ORDER BY RANDOM()` variety is by design, but a region-filtered conversation shouldn't surface off-region properties — verify region filters apply on the blend path.
**Disposition**: cheap wins → [retrieval-provenance plan §5 verification probes](../03-exec-crosscut-magical-poincare-retrieval-provenance.md) + [content plan §2.4 budgetBand nudge](../03-exec-content-t6-luke-loom.md). Strategic fix → PARKED on the same production-first basis as D2 (Alastair's email to Luke): better data + more sophisticated search methodologies are non-trivial builds that only earn priority on conversion-rate evidence. The data-engineer recommendation stays on file for when/if that gate opens; no planning happens now.

---

## Persuasion

### P1 — "Swoop Planning Specialists": consistent, bold, introduced on first mention, terminology card

**Luke**: specialists are a brand identity, near-trademark. Consistent naming ("Swoop's Planning Specialists" / "Swoop Planning Specialists"), always bold, introduced with context; a right-hand "About Swoop Planning Specialists" card on first mention, once per conversation.
**What's actually happening**: prompts and UI say lowercase "specialist(s)" everywhere — [00_why.md §9](../../product/cms/prompts/system/00_why.md) sells "our Patagonia specialists", the form intro says "A Swoop specialist…" ([lead-capture.tsx:55](../../product/ui/src/widgets/lead-capture.tsx)).
**Stance**: agree. Three surfaces: (a) prompt sweep — canonical term + always-bold + first-mention-introduction directive; (b) UI copy sweep (form intro/confirmation/consent line); (c) the terminology card — client-side keyword trigger on first assistant-text occurrence, once per conversation, content from `cms/`. ⚠ Luke said he'd email the exact wording — we proceed with **"Swoop Planning Specialists"** as the working canonical term, centralised so a rename is one edit. Tracked in [questions.md](../../questions.md).
**Disposition**: CONTENT (prompt) → [content plan §2.2](../03-exec-content-t6-luke-loom.md); PLANNED (UI copy) → [handoff-form plan](../03-exec-crosscut-magical-poincare-handoff-form.md); PLANNED (card) → [terminology-card plan](../03-exec-crosscut-magical-poincare-terminology-card.md); EXTERNAL (exact wording + card copy review) → questions.md.

### P2 — Complexity of choice as a reason to talk to a specialist

**Luke**: the paradox of choice (other regions beyond Torres del Paine / El Chaltén) is itself a persuasion lever — good that regions get mentioned; use the overwhelm as a handoff reason.
**Stance**: agree — it's a natural extension of the existing handoff-trigger set in §9 and the `pattern-overwhelmed-researcher` skill already names the visitor shape. Add the *persuasion framing* (breadth → "this is exactly what a Planning Specialist untangles") to §9's "How" repertoire + the relevant skills.
**Disposition**: CONTENT → [content plan §2.3](../03-exec-content-t6-luke-loom.md).

### P3 — Swoop Group Tours under-surfaced; price-consciousness should trigger them

**Luke**: only 4 Swoop Group Tours exist (listed on the Swoop Group Tours page); his price-conscious test conversation never mentioned them; price sensitivity is a tour signal.
**What's actually happening**: the tour lean exists ([00_why.md §6](../../product/cms/prompts/system/00_why.md) + [group-tour-surfacing-for-solos skill](../../product/cms/prompts/skills/group-tour-surfacing-for-solos/SKILL.md) + Tours-upsell in [find_options description](../../product/cms/prompts/tools/find_options/description.md)) but keys off **solo-traveller** signals, not **price-consciousness**. Data side: `tour_card` holds 11 tours from the CMS dump — which 4 are the current "Swoop Group Tours" (and whether the other 7 should surface at all) is a Swoop question.
**Stance**: agree. Add price-consciousness (and value-seeking generally) as an explicit tour-surfacing signal in §6 + the skill. Separately get the 4-tour identification from Swoop — until then the agent leans on whatever `find_options(preferredType:'tour')` returns.
**Disposition**: CONTENT → [content plan §2.3](../03-exec-content-t6-luke-loom.md). EXTERNAL (which 4 tours + page URL + CMS discriminator) → [questions.md](../../questions.md).

---

## Accuracy

### A1 — Agent doesn't know today's date (thought ~Feb 2025); pass the browser's timestamp on every request

**Luke**: "February 2027" was treated as two years out. **Confirmed**: nothing injects the current date — the model's training-period prior leaks through. Alastair: browser timestamp (not server), every request.
**Stance**: agree, including browser-not-server (the visitor's "today"/timezone is what matters for trip-timing talk; also correct under future multi-region serving). `ChatRequestSchema` is `{sessionId, message}` `.strict()` ([routes.ts:33](../../product/ts-common/src/routes.ts)) — add optional `clientTime {iso, tz}`; orchestrator injects a current-date line into the per-turn instruction (the `InstructionProvider` already re-evaluates per turn).
**Disposition**: PLANNED → [B.t12 — browser time plan](../03-exec-agent-runtime-t12.md).

---

## UI tweaks (handoff form)

### U1 — Replace the form intro copy

**Luke (transcript)**: "One of Swoop's expert teams will answer your questions and pick up where we left off. Please share your details." Alastair: use Planning Specialist terminology.
**Stance**: adopt, merged with P1: **"One of Swoop's Planning Specialists will answer your questions and pick up where we left off. Please share your details."** (qualified verdict; sibling verdicts re-voiced to match register).
**Disposition**: PLANNED → [handoff-form plan §2.2](../03-exec-crosscut-magical-poincare-handoff-form.md).

### U2 — Remove the preferred-contact-method control

**Luke**: drop it ("we've tried this before"). Ambiguity: he didn't say which channel wins. Alastair's read: remove the *option*, keep *gathering* both.
**Stance**: adopt Alastair's read — email required, phone optional, no selector. The wire field `contact.preferredMethod` is already `.optional()` ([handoff.ts:189](../../product/ts-common/src/handoff.ts)) so the UI simply stops sending it; the specialist email renders it conditionally. No schema break, no migration.
**Disposition**: PLANNED → [handoff-form plan §2.3](../03-exec-crosscut-magical-poincare-handoff-form.md).

### U3 — Swap "Review what you've told us" and "Anything else the specialist should know"

**Stance**: adopt — precis (review) moves above the notes textarea. Reads better: *here's what we got* → *add what's missing* → consent → send.
**Disposition**: PLANNED → [handoff-form plan §2.4](../03-exec-crosscut-magical-poincare-handoff-form.md).

### U4 — Open vs collapsed states

**Luke**: tempted to open the review box; maybe collapse the notes. **Alastair**: the notes input stays open — an open free-text field invites the visitor to express personal ownership of the handoff; no benefit to collapsing it.
**Stance**: both open — review `<details open>` (still collapsible), notes remains a plain open textarea. Honours Luke's instinct on the review box and Alastair's on the notes field.
**Disposition**: PLANNED → [handoff-form plan §2.4](../03-exec-crosscut-magical-poincare-handoff-form.md).

---

## Bugs

### B1 — Page refresh losing conversation history

**Luke (direct to Alastair, not in transcript)**: pages "just refreshing" and losing the conversation. Possibly Tailscale; worth a debug pass in case a timeout kills chats.
**Hypothesis (strong, evidence-based)**: the Mini serves the **Vite dev server** through Tailscale Funnel ([funnel.sh](../../product/scripts/funnel.sh) → `127.0.0.1:5173`). Vite's HMR websocket through a Funnel proxy is drop-prone, and Vite's client **force-reloads the page** when it detects a server restart on WS reconnect — that's the spontaneous refresh. History loss then follows from the second defect: sessions are **in-memory** (known gotcha — orchestrator restart kills all sessions; [dev.sh](../../product/scripts/dev.sh) runs everything under `concurrently` watch modes with `--kill-others-on-fail`), so any orchestrator restart → rehydrate `GET /session/:id/history` 404 → `onExpired` → fresh thread. `SESSION_TTL_IDLE_HOURS=24` makes mid-demo TTL expiry unlikely; restarts are the prime suspect.
**Stance**: investigate-then-harden, in three steps: (1) instrument + reproduce on the Mini (the `session.expired{gate}` events already discriminate the causes); (2) demo hardening — serve a **built** UI (no HMR, no dev-reload class) + run services non-watch under a supervisor; (3) the structural fix — **Postgres-backed ADK session service** (B.2's deferred swap; single-VM Postgres makes it the natural shape now) so orchestrator restarts stop destroying conversations. Step 3 is the one genuine scope-add on the code side this round.
**Disposition**: PLANNED → [demo-stability plan](../03-exec-crosscut-magical-poincare-demo-stability.md) (steps 1–2 + B.t13 stub for step 3).

---

## Checklist (tick at merge of each item's work)

- [ ] L1 form-after-text — [handoff-form plan](../03-exec-crosscut-magical-poincare-handoff-form.md)
- [ ] L2 page-title links — [retrieval-provenance plan](../03-exec-crosscut-magical-poincare-retrieval-provenance.md)
- [ ] L3 formatting calibration — [content plan](../03-exec-content-t6-luke-loom.md)
- [ ] D1 provenance dates (plumbing) — [retrieval-provenance plan](../03-exec-crosscut-magical-poincare-retrieval-provenance.md)
- [ ] D1/D2 pricing policy (prompt) — [content plan](../03-exec-content-t6-luke-loom.md)
- [ ] D2/D5 production-first deferral — Luke aligned via Alastair's email (no planning until conversion-rate evidence)
- [ ] D3 single image + hidden annotations — [visual-channel plan](../03-exec-crosscut-magical-poincare-visual-channel.md)
- [ ] D4 one-page emphasis — [visual-channel plan](../03-exec-crosscut-magical-poincare-visual-channel.md)
- [ ] D5 budgetBand audit probes — [retrieval-provenance plan §5](../03-exec-crosscut-magical-poincare-retrieval-provenance.md)
- [ ] P1 specialist terminology (prompt + UI) — [content plan](../03-exec-content-t6-luke-loom.md) + [handoff-form plan](../03-exec-crosscut-magical-poincare-handoff-form.md)
- [ ] P1 terminology card — [terminology-card plan](../03-exec-crosscut-magical-poincare-terminology-card.md)
- [ ] P2 complexity-of-choice — [content plan](../03-exec-content-t6-luke-loom.md)
- [ ] P3 group-tours price signal — [content plan](../03-exec-content-t6-luke-loom.md); 4-tour identification — questions.md
- [ ] A1 browser timestamp — [B.t12 plan](../03-exec-agent-runtime-t12.md)
- [ ] U1–U4 form tweaks — [handoff-form plan](../03-exec-crosscut-magical-poincare-handoff-form.md)
- [ ] B1 investigation + demo hardening — [demo-stability plan](../03-exec-crosscut-magical-poincare-demo-stability.md)
- [ ] B1 durable sessions (B.t13) — ratify + promote stub

**Sequencing note**: the content plan and the provenance plan both inform the agent about dates/pricing — the provenance plan owns *tool descriptions* (`cms/prompts/tools/*/description.md`), the content plan owns *system prompt* (`cms/prompts/system/*`). No file overlap; safe to parallelise. The handoff-form, visual-channel, terminology-card, B.t12 and demo-stability plans are mutually independent. All eight are DRAFT pending Alastair's HITL ratification.
