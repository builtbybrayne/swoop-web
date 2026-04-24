# 01 — Side-Quest: Cross-Page Chat Persistence + Mock Host Site

**Status**: Tier 1-altitude side-quest plan. Draft, 2026-04-24.
**Scope relative to canonical Tier 1**: flips [`01-top-level.md`](01-top-level.md) §9 decision #3 ("cross-page chat persistence") from **default no** to **yes, partial**. Extends §4D (chat surface) scope with one new behaviour (rehydrate-on-iframe-remount) and adds a new micro-chunk (mock host site) for testing purposes.
**Closes inbox entry**: [`../inbox.md`](../inbox.md) 2026-04-22 "Scraping vs API trade-off: URL generation for in-page deep links" — the chat-survives-navigation concern that note raised.
**Does not affect**: milestones M2–M5, Friday hackathon, chunk C data strategy, or any Swoop-dependency timeline.

**Sequencing update (2026-04-24, post-conversation)**: Al's preference is to **build the mock host harness (W3) first and only W3**, then observe what actually breaks when the chat is embedded in a realistic multi-page site. W1 (server history endpoint), W2 (client rehydration on mount), and W4 (storage-medium reconfirm) are **parked pending observation** — we will decide on persistence mechanics from evidence, not speculation. Tier 2 for W3 lives at [`02-impl-side-quest-host-harness.md`](02-impl-side-quest-host-harness.md). The W1/W2/W4 scope in §5 below remains written up so we know where we'd go if the harness confirms the current design direction, but nothing in those workstreams is committed work yet.

---

## 1. Why this exists

Puma ships as an iframe embedded in Swoop's Patagonia pages via a nav-button trigger. Today if a visitor:
1. Opens the chat
2. Types a few messages
3. Clicks a link in the surrounding Swoop page (or a deep-link the agent offered)

…the parent page navigates, the iframe is torn down and re-created fresh on the new page, React state is gone, the chat appears empty. The visitor has to start over. That breaks the core JTBD — "build enough confidence to speak with a specialist" — because confidence accumulates across turns and the tool throws that accumulation away on a click.

The canonical Tier 1 plan defaulted this out of scope (§9 #3, §7). We flagged it in the inbox on 2026-04-22 as a consequence of the scrape-path deep-link idea but deferred the decision to Tier 2 chunk D, which then closed D.2 as "Not in Puma". **That was the wrong call for Puma's production bar.** Real users clicking real links is the happy path, not an edge case; the chat must survive it.

This is a side-quest rather than a reopen of the main Puma critical path because:
- It doesn't depend on the Friday hackathon, the sales-thinking doc, GCP provisioning, or legal review.
- The technical surface is small and well-contained (one endpoint + one UI path + one test harness).
- A subagent is carrying the hackathon workstream; this one can run parallel without contention.

---

## 2. Integration with canonical Tier 1

Changes this side-quest implies to [`01-top-level.md`](01-top-level.md) when the plan is accepted:

| Location | Current state | New state |
|---|---|---|
| §6 "In scope for Puma" | Silent on persistence | Add: "Cross-iframe-reload chat rehydration within the visitor's browser session." |
| §7 "Out of scope for Puma" | Lists "Cross-page-navigation chat persistence (default no; revisit in Tier 2 chunk D if deep-linking is decided)" | Remove. Replaced by scope in §6 above. **Still out of scope**: cross-session persistence (visitor returns next day and resumes) — that's `localStorage`-or-beyond territory and falls under the standing "cross-session memory" exclusion, which we keep. |
| §9 decision #3 "Cross-page chat persistence" | "Default: no" | "Yes — session-scoped rehydration on iframe remount. Cross-session still deferred." |
| §4D chunk D description | "Open: whether chat state persists across visitor page navigations (enabled by deep-linking from chunk C's scrape path)." | "Chat state rehydrates on iframe remount within the same browser session, independent of chunk C's data-access choice." |
| Milestones | M1 (vertical slice) done; M2 (real data) next | Insert **M1.5 — Persistence + host harness**: chat survives navigation; mock multi-page site demonstrates the behaviour. Non-blocking for M2. |

These edits are **proposed, not applied** — deferred until this plan is accepted.

Chunk D's Tier 2 plan ([`02-impl-chat-surface.md`](02-impl-chat-surface.md)) also cascades:
- §2.6 "Cross-page chat persistence — open" → decided yes, references this doc.
- D.2 and D.8 update: sessionStorage retained for the session id; new server-side history endpoint + client-side rehydration on mount.
- Adds two new Tier 3 tasks (see §7 below).

No changes needed to chunks A, C, E, F, G, H at Tier 2. Chunk B gets one small surface (history endpoint) — see §5.

---

## 3. Jobs-to-be-Done

Subset of the canonical §2 JTBDs that this side-quest serves. Each links back to the master list so we don't invent new JTBDs quietly.

### End user (§2.1)
- **Keep momentum across navigation.** If the visitor clicks a link the agent suggested — or any link on the surrounding Swoop page — the conversation picks up where it left off when they arrive at the next page. No "sorry, start again."
- **Trust the tool.** A chat that loses your words when you click anywhere erodes the "knowledgeable friend" posture Swoop wants. Persistence is a trust signal.

### Swoop sales team (§2.2)
- **Richer handoff context.** Visitors today can't explore Swoop's site in parallel without losing the discovery conversation; they either browse OR talk. Persistence lets them do both, producing a longer, better-warmed conversation by the time they reach the lead-capture step.

### Build team (§2.4)
- **Testable iframe behaviour before ship.** Puma's production surface is an iframe inside Swoop's site, but today we develop against a bare `:5173` with no host. We can't reproduce the "click a link → lose chat" behaviour locally because there's no surrounding site. A lightweight mock host is the smallest thing that makes this testable end-to-end.
- **Demo surface for Julie + Luke.** An iframe in a realistic-looking page beats a naked dev server for showing non-technical stakeholders what Puma will actually feel like.

### Swoop as a business (§2.3)
- No new JTBD; this improves delivery on existing ones (discovery confidence, group-tour surfacing) by removing the navigation-loss failure mode.

---

## 4. Themes (invariants)

Extends the canonical §3 themes. Nothing contradicts them; two are especially load-bearing here:

- **Theme 2 — Content-as-data, extended to state.** Conversation state lives server-side (ADK session), not in the browser. The client persists a **reference** (session id), not the data. This keeps the single source of truth on the server — good for later observability, good for consent compliance (deletion hits one place), good for the eventual Firestore migration.
- **Theme 7 — Production quality on minimum surface.** Persistence is one of those things that has to work *reliably or not at all* — a half-working rehydration is worse than none. So the bar here is the same as streaming: polished.
- **Theme 9 — Legal compliance built-in.** Persistence does not weaken consent: the session-id reference is scoped to sessionStorage (tab lifetime), which matches the lawful-basis scope already established at consent. No new consent surface needed.
- **New invariant for this side-quest**: **rehydration is a read-only projection of server state.** The client never reconstructs history from its own memory; it always asks the server. If the server forgets (session expired, orchestrator restart pre-Firestore), the UI shows the "this conversation has expired — start a new one?" state already scoped in D.t5 — not a stale client-side ghost.

---

## 5. Workstreams (Tier 1 altitude)

Four separable workstreams. Can run mostly in parallel; one shared contract point.

### W1 — Server-side history projection endpoint (chunk B extension)
The orchestrator gains a `GET /session/:id/history` (or equivalent — Tier 2 pins) that returns the full UI-facing message-part stream for a given session. It runs the existing translator (B.t4) over the ADK session's stored events, strips reasoning parts (same invariant as the live SSE), and serialises to the same `MessagePart` shape the UI already consumes. If the session id is unknown, returns 404 and the UI goes to "expired" state.

Shared contract: the **`MessagePart[]` response shape** must match the live SSE stream's part shape 1:1. Same translator, same filters. No new `ts-common` types needed if we reuse what's there.

### W2 — Client-side rehydration on mount (chunk D extension)
On app mount, if `sessionStorage` has a session id:
1. Fetch history from W1's endpoint.
2. If 200: replay parts into the assistant-ui thread so the visitor sees the full prior conversation.
3. If 404: clear the stale session id, show the opening consent screen as a fresh visit.
4. If 5xx / network error: show a retry surface (reuses D.t5 error patterns).

Consent state: `useConsent()` already reads sessionStorage; since the session id and consent are both in sessionStorage, they remain in sync on remount. No change needed to the consent flow.

### W3 — Mock multi-page host site (new micro-chunk)
A very small Vite/React (or even plain HTML) app running on its own port that:
- Has 3–5 pages (Home, a Patagonia region overview, a trip detail, an About). Content is placeholder — just enough to be recognisable as a Swoop-ish site.
- Has realistic-ish navigation (top nav links + in-page links between pages).
- Embeds the Puma chat via iframe, triggered by a nav-bar button (matching the production trigger pattern from the 30 Mar quote).
- Lives in `product/mock-host/` or similar. **Not a production artefact.** Clearly labelled as dev/QA only.

This site's only job is to make "click a link → chat persists" observable and testable. It also doubles as a demo harness for Julie / Luke before Swoop embeds the real thing.

### W4 — Storage medium reconfirmation
Explicit revisit of D.8. Current: sessionStorage for session id. Alternatives considered:
- **sessionStorage** — tab lifetime. Survives iframe remount on same-tab navigation. ✅ matches the JTBD scope exactly.
- **localStorage** — survives tab close. Would enable "visitor returns tomorrow, resume conversation" but that's cross-session persistence, which is explicitly deferred (canonical §7) and has consent/retention implications this side-quest doesn't take on.
- **Parent-page `postMessage` coordination** — the Swoop site's parent page could hold the session id in its own storage and post it to the iframe on load. More resilient if the iframe origin changes, but adds a contract with Swoop's in-house team that we don't need.

**Recommendation: stay on sessionStorage.** It already solves the actual user-visible problem (within-session navigation). Going to localStorage crosses a scope line we'd then have to unpick for consent + retention reasons. Revisit after real-user signal, same posture as every other "should we add persistence tier N" question in Puma.

---

## 6. In scope / out of scope (side-quest level)

### In scope
- Server-side session-history projection endpoint.
- Client-side rehydration on iframe mount, including the 404/expired/error cases.
- Mock multi-page host site for local testing and stakeholder demos.
- Reconfirmation (or adjustment) of D.8 storage medium — one Tier 2 decision node.
- Verification: a scripted manual test (preview_click across the mock host's nav) that proves the chat survives navigation end-to-end.

### Out of scope
- **Cross-session persistence.** Visitor returns next day → new conversation. Same rationale as canonical §7.
- **Cross-device persistence.** Auth-gated resume from another device is post-Puma.
- **Cross-browser persistence.** Different browsers → different sessions.
- **Persistence of the iframe-minimised state** (e.g. "chat was collapsed, re-appear collapsed"). Nice to have, not required for the core JTBD. Tier 3 Swoop-side integration concern.
- **Optimistic client-side caching of messages** so rehydration feels instant. Defer to post-real-user-signal.
- **A production-quality mock host site.** The mock host is for testing; final iframe embed on Swoop's actual site is Swoop's in-house team's responsibility (canonical M5).
- **Brand-styling the mock host.** Minimal visual identity only — enough to look like a plausible adventure-travel site, nothing more.
- **Widget content in the mock host.** Placeholder text and stock imagery; no real Patagonia content authoring.

---

## 7. Cascade to Tier 2 / Tier 3

### Tier 2 edits needed when plan accepted
- [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.6 "Cross-page chat persistence — open" → closed, references this doc. D.2 and D.8 updated. New Tier 3 tasks:
  - **D.t9 — Rehydration on mount** (W2 above).
  - **D.t10 — Mock host site scaffold** (W3 above). Could equally be its own micro-chunk; keeping it under D is cheaper organisationally.
- [`02-impl-agent-runtime.md`](02-impl-agent-runtime.md) gets a new task:
  - **B.t11 — Session history projection endpoint** (W1 above).

### Tier 3 execution plans (just-in-time)
Produce when we're ready to pick up the work — three plans, each small:
- `03-exec-agent-runtime-t11.md` — history endpoint shape, translator reuse, error codes, tests.
- `03-exec-chat-surface-t9.md` — mount-time fetch, assistant-ui thread replay, 404/error flows.
- `03-exec-chat-surface-t10.md` — mock host site structure, embed pattern, nav + links.

### Decisions to close in Tier 2
| # | Decision | Default / leaning |
|---|---|---|
| SQ.1 | Storage medium for session id | `sessionStorage` (D.8 stands) |
| SQ.2 | History endpoint verb + shape | `GET /session/:id/history` returning `{ parts: MessagePart[] }` |
| SQ.3 | Rehydration UX during fetch | Skeleton/spinner in the thread area for ≤500ms then show the rehydrated thread; no opening-screen flash |
| SQ.4 | Mock host tech stack | Plain Vite + React (match `product/ui/`) or zero-build static HTML — pick in Tier 3. Vite + React preferred for iframe-parent integration realism. |
| SQ.5 | Mock host deploy surface | Local only. Never Vercel/Cloud Run. Prevents confusion with the real Swoop site. |
| SQ.6 | Rehydration behaviour on session 404 | Clear sessionStorage, go to opening consent screen as if fresh visitor. Do not attempt resurrection. |

### Decisions **not** closed here (intentionally)
- Whether the iframe on real Swoop pages should "re-appear" as a badge vs a panel vs minimised-by-default — that's a Swoop integration decision, not a Puma engineering one. Our side delivers the "chat is still there" guarantee; the host decides the trigger UX.

---

## 8. Sizing + sequencing

Rough at Tier 1; Tier 3 will tighten.

- **W1 history endpoint** — ~0.5 day. Reuses translator + session service.
- **W2 mount-time rehydration** — ~0.5 day. Reuses assistant-ui thread APIs.
- **W3 mock host site** — ~0.5 day. Five pages, iframe embed, nav links.
- **W4 storage medium** — already done if we confirm sessionStorage. ~0 day beyond writing it down.
- **Verification pass** — ~0.25 day. preview_click through the mock host and back, confirm chat state.

**Total**: ~1.5–2 days of focused work. Fits cleanly inside the existing 16-day engagement; does not consume contingency.

**Sequencing**:
- W1 and W3 can run in parallel (no shared state; no shared contract beyond what exists).
- W2 serialises after W1 (needs the endpoint to hit).
- Verification after W2 + W3.

Earliest start: any time after M1 polish lands (it has). No blockers.
Earliest finish: ~2 working days after start.

---

## 9. Risks

- **ADK session service translator edge cases.** The translator (B.t4) was built for the live event stream. Running it over stored events might expose ordering / idempotency differences. Mitigation: Tier 3 plan for B.t11 includes a round-trip test (live stream events → recorded → replayed → compared).
- **assistant-ui thread replay API.** assistant-ui is pre-1.0 and its "replay" / "hydrate thread with historical parts" surface may not be first-class. If it isn't, fallback is to replay parts via the same transport the live stream uses — just emitting them all up front before opening the SSE stream. Low cost either way.
- **In-memory session loss during dev.** Per [`gotchas.md`](../gotchas.md#session-state-is-in-memory--orchestrator-restart-kills-all-active-sessions), orchestrator restart kills sessions. Rehydration will cleanly hit 404 and reset — correct behaviour, but worth documenting in the mock-host README so testers aren't confused.
- **Mock host misunderstood as production.** Clear labelling + `product/mock-host/` location + never-deployed constraint + README banner. Low risk if enforced.

---

## 10. Provenance

Draws on:
- [`01-top-level.md`](01-top-level.md) — canonical Tier 1 plan; §4D, §6, §7, §9 are the integration points.
- [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.6 — where this was deferred in the Tier 2 pass.
- [`../inbox.md`](../inbox.md) 2026-04-22 — original capture of the "chat dies on navigation" concern.
- [`../gotchas.md`](../gotchas.md) — in-memory session caveat that shapes the 404 path.
- Al's 2026-04-24 prompt — the direct trigger; this side-quest is in response.
