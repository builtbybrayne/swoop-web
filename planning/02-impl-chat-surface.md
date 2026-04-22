# 02 — Implementation: D. Chat Surface

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4D + theme 9 (legal compliance built-in).
**Depends on**: A (foundations — `ts-common` streaming event shape + content schemas), B (orchestrator SSE endpoint + response-format convention), C (tool response shape + deep-link URLs if scrape path).
**Coordinates with**: B (two-way contract on streaming events + `<fyi>` / `<adjunct>` / `<utter>` rendering), E (disclosure + consent UX + lead-capture widget), G (content rendered inline).

---

## Purpose

D owns the browser surface. A React + Tailwind chat app, built on **assistant-ui** (pinned at top level), consumed by visitors through an iframe that Swoop's in-house team integrates and styles. The app connects to B's SSE endpoint, parses the shared streaming event shape, renders tool-call widgets via assistant-ui's tool-call registry, renders the four response-format block types (`<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>`) appropriately, handles disclosure and consent UX for EU AI Act + GDPR, and carries visitors through to handoff.

The chunk's biggest efficiency is widget reuse from the PoC's four widget families. The biggest risk is the `message.parts` contract with B — get it wrong and the chat can't render anything.

---

## 1. Outcomes

When this chunk is done:

- A React + Tailwind chat app runs locally, connects to a local orchestrator, and a visitor can hold a conversation with streaming text, tool-triggered widgets, and handoff flow.
- assistant-ui is wired with an AI-SDK-compatible adapter consuming B's SSE stream.
- Tool-call types from C's Puma tool set map to assistant-ui registered renderers. The four PoC widget families (`component-detail`, `component-list`, `inspiration`, `lead-capture`) port across with rendering logic largely intact; only the hydration layer changes.
- Response-format block types render correctly: `<fyi>` as side-channel notifications (small, non-intrusive), `<reasoning>` **never rendered** (exists only in session history), `<adjunct>` triggers widget hydration, `<utter>` is the visible chat text.
- Disclosure ("you're interacting with an AI") is unmissable on first visit and persistent as chat chrome thereafter (EU AI Act Art. 50 compliance — details in chunk E).
- Consent capture (GDPR) is wired into the handoff flow before personal details get submitted.
- Mobile-responsive baseline — the app behaves sanely on phone-sized viewports; full brand-matched polish is Swoop's in-house team's job.
- Error states exist: orchestrator unreachable, tool call failed, SSE connection dropped, session not found.
- Session id handling: new session issued on first visit; resumes on reload in the same tab.
- Clean, minimally-styled baseline — "clean base styling" per the 30 Mar proposal — that Swoop's in-house team extends with their visual identity.

**Not outcomes**:
- Swoop brand styling (Swoop-owned post-delivery).
- Iframe embed on the live Swoop site (Swoop-owned).
- Cross-page chat persistence (defaulted out; revisit below).
- Accessibility audit (baseline care; formal WCAG audit out of Puma).
- Internationalisation (English-only per top-level).
- A/B testing of the trigger button (Swoop-owned).

---

## 2. Target functionalities

### 2.1 assistant-ui shell + AI SDK adapter

**What assistant-ui is and isn't.** Assistant-ui is a **React UI library**. Its "state management" and "tool calling" features refer to *client-side UI state* (thread rendering, message-parts lifecycle, tool-call UI registration, widget hydration) — not to agent orchestration, session persistence, or model control. The agent loop runs server-side in chunk B. assistant-ui consumes B's SSE stream via an AI SDK adapter.

**Why we keep the agent server-side** (and don't move it into assistant-ui / the browser):
- **API keys**: the browser can't hold model API keys securely. Server-side is mandatory for Claude / ADK / GCP credentials.
- **MCP exposure**: the server-side orchestrator + MCP connector architecture leaves the door open to exposing Swoop's discovery agent as an MCP provider that other clients (ChatGPT, Claude integrations, other third-party tools) can consume. A browser-only agent loses this.
- **Per-agent model selection** (chunk B §2.1 two-layer model): functional internal agents with their own ADK runners and their own model choices only exist server-side.
- **Warm pool, session persistence, observability**: all require server-side state.
- **Production controls**: rate limiting, cost ceilings, content governance — all live with the server-side agent.

assistant-ui remains a **renderer** — it consumes a stream, renders text + tool-call widgets + custom UI affordances. The orchestration lives upstream.

**Shape**: a single React SPA (Vite build) whose main component is an assistant-ui `Thread` (or equivalent primitive, depending on assistant-ui's current API). The adapter speaks AI SDK v5 `message.parts` and points at B's `POST /chat` SSE endpoint.

**Version pin**: a specific assistant-ui version is chosen during Tier 3. The library is pre-1.0 era — weekly releases, API churn — so the pin is tight and upgrade is deliberate, not automatic.

### 2.2 Tool-call widget rendering

Tool-call types map to React components via assistant-ui's tool-call registry (`makeAssistantToolUI({ toolName, render })` or equivalent). Widget concepts carry across from the PoC's `ui-react/src/widgets/`, but **not transparently** — the PoC widgets were built for ChatGPT's environment and styled to match ChatGPT's visual conventions.

| PoC widget | Puma tool | What carries | What changes |
|---|---|---|---|
| `component-list` | `search` | Layout / information architecture (card grid, summary fields, CTA placement) | Styling; hydration path |
| `component-detail` | `get_detail` | Layout and section structure (hero, attributes table, description, gallery) | Styling; hydration path |
| `inspiration` | `illustrate` | Image-carousel concept + mood-tag pattern | Styling; hydration path |
| `lead-capture` | `handoff` → `handoff_submit` | Two-step flow structure (summary preview + form submit), form-field list | Styling; hydration path; **consent UI added inline** (chunk E) |

**What doesn't carry**:
- **Styling** — the PoC widgets were visually aligned to ChatGPT's conventions (its colour tokens, typography, spacing). Puma wants a **vanilla, minimally-styled base** so Swoop's in-house team can apply brand identity cleanly. Treat PoC widget styling as reference, not starting point.
- **Hydration layer** — the ChatGPT-specific plumbing (`_meta.ui.resourceUri`, `useApp` hooks, ChatGPT's `structuredContent` mechanism, the iframe-in-iframe model) is replaced entirely by the tool-call registry pattern. The widget no longer self-hydrates via ChatGPT's runtime — it receives props from the tool-call event.
- **Shared primitives that were ChatGPT-dependent** — anything in `src/shared/` that references ChatGPT's runtime or visual system gets replaced.

**Practical approach**: treat the PoC widgets as wireframes / information-architecture specs. Extract the *what goes where* and *what fields matter*; rebuild rendering in clean React + Tailwind with vanilla styling, wire up via assistant-ui's tool-call registry, and let Swoop's team apply brand styling on top of the extension surface documented in D.t8.

### 2.3 Response-format rendering — assistant-ui natives first

**Default approach: use assistant-ui + AI SDK `message.parts` native primitives wherever they map to the conceptual block types.** The chunk B §2.5a `<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>` convention is the *conceptual* separation we need; the *wire shape* should reuse assistant-ui's and AI SDK's native part types whenever they cover the concept cleanly.

Candidate mapping (verify exact current API during Tier 3; assistant-ui is pre-1.0):

| Conceptual block | Native wire shape (candidate) | UI treatment |
|---|---|---|
| `<utter>` (user-facing) | `text` part | Standard assistant-ui text rendering, streamed token-by-token. |
| `<reasoning>` (agent-internal) | `reasoning` part — **kept server-side in session history, NOT sent to the UI at all**. The translator in chunk B §2.4 strips reasoning parts from the outbound SSE stream. | Not rendered. D never sees reasoning in the wire. |
| `<adjunct>` (UI affordance) | `tool-call` part | Routed to the tool-call registry; renders the widget registered for that tool name. |
| `<fyi>` (side-notification) | Custom `data` part (e.g. `data-status` or `data-fyi`) — AI SDK v5 supports typed custom data parts. | Subtle ephemeral affordance below the active response. Default: small text tag that updates on new `<fyi>`, auto-fades on `<utter>` arrival. |

**Custom parser (from chunk B §2.5a) is a fallback**, not the default. If the Phase 1 spike confirms ADK event types and assistant-ui `message.parts` cover the four concepts cleanly — the model emits them directly as structured parts, no XML-ish tag parsing needed — then no parser exists. If natives don't cover cleanly (most likely for `<fyi>` as a custom data part), the parser covers only that gap.

**Key invariant regardless of wire shape**: `<reasoning>` content never reaches D. If it does, that's a bug in the chunk B translator — D doesn't have a "hide reasoning" UI affordance; reasoning simply isn't in the stream D consumes.

Exact visual treatment for `<fyi>` is a Tier 3 UX call. Default: narrow, beneath the agent's active response, auto-fading after a few seconds or on `<utter>` arrival.

### 2.4 Disclosure + consent UX (EU AI Act + GDPR) — up front, together

**Disclosure and primary consent pair at conversation start.** Puma's session state begins accumulating the moment the visitor starts typing (conversation history is processed + stored immediately). Storing and processing conversation data — even anonymous — invokes GDPR. So the lawful basis for processing must exist *before* any user message hits session state, not just at the handoff point.

**Opening flow** (first visit):
1. Disclosure + primary consent screen, paired: "You're talking to an AI assistant, not a human. We'll keep a record of this conversation to help our specialists understand what you're looking for. [Privacy info link.] [Continue] [No thanks]."
2. "No thanks" closes the chat cleanly — no session state, no processing, no storage.
3. "Continue" sets a `conversation_consent` flag in session metadata + stores a timestamp. The conversation begins.

**Persistent chrome** (every subsequent state):
- Small "AI" badge visible at all times (EU AI Act Art. 50 persistent disclosure).
- Info link always accessible — takes the visitor to the privacy info page (authored in chunk E).

**Secondary handoff consent** (at `handoff` tool trigger):
- Inside the `lead-capture` widget, before `handoff_submit` fires.
- Specific to contact-detail submission + outreach: "I consent to Swoop contacting me about this enquiry and storing my details for that purpose."
- Separate optional marketing opt-in, unticked by default.
- Backstop in the connector: `handoff_submit` rejects any payload without the handoff consent flag.

**Route to a human**: the handoff flow is the primary route; a secondary "speak to a specialist now" chrome link may also exist (Tier 3 decides).

Copy authored in `product/cms/legal/` (chunk E). D renders; E authors; legal counsel reviews (blocks M5).

### 2.5 Session id handling

- First visit: the app posts `POST /session` (or equivalent — B decides the shape) and receives a session id.
- Session id stored in `sessionStorage` (tab-scoped — clears on close) unless cross-page persistence is wired (see §2.6).
- Reload in same tab: app re-attaches using the stored session id. Orchestrator rehydrates from session state.
- Warm-pool handout: the session id may come from B's warm pool (B §2.6a) — transparent to D.

### 2.6 Cross-page chat persistence — open

Top-level §9 decision #3 defaulted **no**. Revisit here:

- If scrape path lands (chunk C) and deep-links become a real affordance, users will click through to Swoop pages. Chat currently dies on navigation.
- Cross-page persistence would mean: session id persists via `localStorage` (domain-scoped); chat surface re-appears on every page the iframe is embedded on; state carries forward.
- Implementation cost: medium. Requires Swoop's in-house team to embed the iframe host wrapper on every page (not just one), plus agreement on how the chat "re-appears" (minimised badge vs full panel).

**Recommendation**: keep default "no" for Puma launch, ship the scrape-path deep-links anyway (they're still useful — they open a new tab or trigger chat dismissal), revisit as a V2 feature once real users tell us how they use deep-links.

### 2.7 Error states

Required surfaces:
- Orchestrator unreachable (connection refused / timeout). Message: "Having trouble connecting — please try again in a moment." Retry button.
- SSE stream drops mid-turn. Message: brief inline indicator + resume attempt; if resume fails, same as unreachable.
- Tool call returned an error. Inline message from the agent (the orchestrator handles the user-facing phrasing; D just renders).
- Session not found / expired. Message: "This conversation has expired. Start a new one?" Button.
- Rate limited (not in Puma, but interface-level placeholder). Same UX pattern.

### 2.8 Minimal styling baseline

Tailwind + a single `theme.css` from PoC. Colour / spacing / font choices default to assistant-ui's baseline. Layout clean, readable, production-acceptable. **Not** Swoop-branded — that's Swoop's in-house team's layer on top.

### 2.9 Mobile responsive baseline

Viewports: phone portrait, tablet, desktop. Breakpoints align with Tailwind defaults. No dedicated mobile pane; the chat just reflows. Tested manually before M1.

---

## 3. Architectural principles applied here

- **PoC-first**: widget React code and shared primitives port across; the integration layer is what changes.
- **Swap-out surfaces named**: assistant-ui (high swap cost — if it bites, fall back to Vercel AI Elements per `planning/archive/research/ui-deep-research.md`); AI SDK adapter (low — standard contract); session storage medium (low).
- **Legal compliance built-in** (theme 9): disclosure and consent are chat chrome, not a modal bolted on. They can't be disabled, styled-over, or forgotten.
- **Production quality on minimum surface** (theme 7): streaming, error states, disclosure are polished. Visual design is not — Swoop owns that.
- **Content-as-data**: disclosure copy, consent copy, error messages all loaded from `product/cms/legal/`. No hardcoded strings beyond widget labels.

---

## 4. PoC carry-forward pointers

- `chatgpt_poc/product/ui-react/src/widgets/component-detail/`, `component-list/`, `inspiration/`, `lead-capture/` — four widget families. Rendering code carries forward.
- `chatgpt_poc/product/ui-react/src/shared/SwoopBranding.tsx`, `hooks.ts`, `theme.css`, `types.ts` — shared primitives, port across with adjustments.
- `chatgpt_poc/product/ui-react/src/dev-harness.tsx` — development harness pattern (reference for Puma's dev harness).
- `chatgpt_poc/product/ui-react/vite.config.ts` — Vite config pattern (simplify — no more `vite-plugin-singlefile` or widget-per-env-flag builds; single SPA build).
- `planning/archive/research/ui-deep-research.md` — 2026 library-landscape research. Read for context on assistant-ui vs alternatives.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| D.1 | Chat component library | **assistant-ui** (top-level settled). | Tool-call registry matches our port of PoC widgets naturally. AI SDK adapter is first-class. Pre-1.0 risk mitigated by tight version pinning + fallback to Vercel AI Elements if it bites. |
| D.2 | Cross-page chat persistence | **Not in Puma.** Session scoped to tab via `sessionStorage`. Revisit as V2. | Implementation cost is medium; user demand unknown; deep-links work fine without it (new tab / dismiss behaviour). |
| D.3 | Tool-call registry pattern | **`makeAssistantToolUI` (or equivalent) per tool type.** One React component per Puma tool that renders a widget. | Standard assistant-ui pattern; aligns with the tool set in chunk C. |
| D.4 | Disclosure + primary consent placement | **Opening state (paired together) + persistent chrome badge.** | EU AI Act Art. 50 + GDPR lawful basis. Session state accumulates conversation data immediately; primary consent must precede processing, not wait for handoff. |
| D.5 | Secondary consent capture (handoff contact details) | **Inside `lead-capture` widget, before `handoff_submit` fires.** Separate from primary consent. | Specific consent for the specific act of contact collection + outreach. Backed up by connector-side backstop. |
| D.11 | Agent orchestration locus | **Server-side (chunk B). assistant-ui is a renderer, not an agent.** | API keys, MCP exposure, functional internal agents, warm pool, session persistence, per-agent model selection — all require server-side state. Moving the agent browser-side would lose all of these. |
| D.6 | Mobile responsive scope | **Baseline reflow at Tailwind breakpoints. No dedicated mobile layout.** | Swoop owns full brand-matched polish. |
| D.7 | Styling baseline | **Tailwind + minimal `theme.css`. Clean, unbranded.** | "Clean base styling" from the 30 Mar proposal. Swoop adds brand identity. |
| D.8 | Session storage medium | **`sessionStorage` for Puma.** (`localStorage` only if D.2 flips.) | Tab-scoped = natural session boundary. |
| D.9 | Rendering of `<reasoning>` blocks | **Never rendered.** Parser strips them from the UI-bound stream. | Agent-internal only. |
| D.10 | Rendering of `<fyi>` blocks | **Subtle ephemeral affordance below active response, auto-fading on `<utter>` arrival.** Specifics in Tier 3. | Non-intrusive status signals without cluttering the chat. |

Deferred:
- Full accessibility audit (WCAG AA) — Puma baselines (keyboard nav, semantic HTML, alt text on images) only.
- Analytics events on UI interactions — chunk F owns the event schema; D emits the events.
- Rich message reactions / emoji / markdown rendering beyond basic text — add reactively.

---

## 6. Shared contracts consumed

From `ts-common`:
- Streaming event shape (B produces, D consumes — the load-bearing contract of this chunk).
- Tool I/O schemas (widgets validate `structuredContent` against these before rendering).
- Content schemas (Trip, Tour, Region, Story, Image — widgets render instances).
- Handoff payload shape (the `lead-capture` widget produces an instance).

D doesn't author new contracts.

---

## 7. Open sub-questions for Tier 3

- Exact assistant-ui version pin and API specifics (library is moving).
- Shape of the `/session` bootstrap endpoint (B decides; D consumes).
- `<fyi>` visual treatment specifics — inline status line vs toast vs overlay.
- Deep-link behaviour: new tab vs same tab with chat dismiss vs chat minimise.
- Error-retry back-off policy.
- Session-id rotation on long conversations (security hardening — probably not for Puma, but doc anyway).
- SSE reconnection policy: server-driven vs client-driven vs hybrid.
- Build-time stripping of development-only content (dev harness).
- Storybook or equivalent for widget preview during development — nice-to-have.

---

## 8. Dependencies + coordination

- **Inbound**:
  - B's SSE endpoint + streaming event shape (Phase 0 contract).
  - C's tool responses (shape inside `structuredContent` via the streaming event shape).
  - G's disclosure + consent copy (lives in `product/cms/legal/`).
  - E's lead-capture widget content (pre-filled summary + consent UI copy).
- **Outbound**:
  - F consumes UI-emitted events (conversation started, widget rendered, handoff submitted).
- **Agent coordination**:
  - Phase 0 contract work: D's agent is one of the two parties on the streaming event shape (B is the other). They must agree before D can render anything. See top-level §5.
  - Tool response shape negotiated with C's agent — what does `search` return vs `get_detail`? Settled via `ts-common` tool I/O schemas.

---

## 9. Verification

Chunk D is done when:

1. `npm run dev` (inside `product/`) serves the chat app; browser loads it; disclosure opening state is visible before anything else.
2. A user message posts to the orchestrator and streams back as visible text.
3. Tool-triggered widgets render correctly for each Puma tool type, with data from the tool's `structuredContent`.
4. `<fyi>` side-notifications render as ephemeral affordances; **`reasoning` parts never arrive at D** — confirmed via network inspection of the SSE stream. If they appear, that's a chunk B translator bug.
5. A handoff flow end-to-ends: agent triggers `handoff` → widget shows pre-filled summary → user adds contact + consents (secondary) → `handoff_submit` fires.
5a. Primary consent: declining the opening disclosure+consent screen closes the chat cleanly with no session state written.
6. Reload in same tab resumes the conversation with full history visible.
7. Tab close + reopen starts a new conversation (session scoped to tab per D.8).
8. Each error state surfaces the correct message; retry behaves sensibly.
9. Mobile viewport at 375px wide renders without horizontal scroll, widgets reflow.
10. Zero conversation text, disclosure copy, or consent copy is hardcoded in D's source — all loaded from `product/cms/`.
11. Swoop's in-house team can apply their brand styling via a documented extension surface (CSS variables + component override slots).

---

## 10. Order of execution (Tier 3 hand-off)

- **D.t1 — Vite + assistant-ui scaffold**: React + Tailwind + assistant-ui wired; AI SDK adapter pointing at local orchestrator; dev harness.
- **D.t2 — Streaming consumption + parser integration**: reads B's SSE, respects the four block types, renders `<utter>` as text and routes `<adjunct>` to tool-call registry.
- **D.t3 — PoC widget port**: `component-list`, `component-detail`, `inspiration`, `lead-capture` registered via `makeAssistantToolUI`, integration layer swapped to assistant-ui hydration.
- **D.t4 — Disclosure + consent UX**: opening state, persistent chrome, consent inside lead-capture widget.
- **D.t5 — Error states**: all five surfaces from §2.7.
- **D.t6 — Session handling**: bootstrap, resume, expiry UX.
- **D.t7 — Mobile reflow pass**: breakpoint testing, widget layout checks.
- **D.t8 — Handover doc for Swoop**: brand extension surface (CSS vars, component overrides), embed instructions, staging / prod URL config.

D.t1–D.t3 are the Phase 1 vertical slice contribution. D.t4–D.t7 come in the Phase 2 fan-out. D.t8 is near-delivery.

Estimated: 4–5 days of focused work post-A (once `ts-common` streaming event shape is stable). One agent can drive this end-to-end; parallelising D vs B is a natural split once Phase 0 contracts land.
