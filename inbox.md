# Inbox

Append-only capture for ad-hoc ideas, questions, and nudges that don't have a long-term home yet. Triage periodically into: planning docs (`planning/`), commercials (archive), or deletion.

**Entry format**: `## YYYY-MM-DD — short title` then body. One- or two-line entries are fine.

---

## 2026-04-22 — `<fyi>` as a tool call (post-M1 refactor candidate)

Al's observation: the `<fyi>` side-notification mechanism currently implemented as a state-machine parser (B.t4) + custom `data-fyi` AI SDK part (chunk D) could more cleanly be a **tool call**. The orchestrator would register a thin `fyi` / `announce_status` tool; model emits `tool-call` parts which assistant-ui's tool-call registry renders as ephemeral status affordances via the same `makeAssistantToolUI` path as every other widget.

**Pros**: native across ADK + AI SDK + assistant-ui; no custom parser; no custom part type; models are more reliable at tool-call structured output than at tag-parsed free text.

**Cons**: small semantic stretch — "tools *do* things" — but solvable with a better name (`announce_status`, `signal_progress`).

**Swap cost post-M1**: small. Retire `block-parser.ts` (~200 lines), retire `data-fyi` part type, add a tool + one assistant-ui renderer registration. Parser is test-covered so behaviour check on retirement is cheap.

Where it lands: post-M1 cleanup pass, or whenever we're next doing a round of prompt engineering with real conversation data.

---

## 2026-04-22 — Scraping vs API trade-off: URL generation for in-page deep links

If we scrape the website, we get real page URLs for each product / region / story as a side-benefit. The chat agent could then offer "go see this page" links that drop the visitor directly onto the relevant Swoop page.

Implication: if the visitor clicks through, the chat disappears (new page load). For that to be useful, the chat needs to survive navigation — stateful, picks up where it left off on the next page. Cross-page chat persistence has UX and technical implications (localStorage session id + rehydrate on mount; or iframe host-page coordination; or deferred until the user returns to a "home" surface).

Alternative: if we get data via API (Friday hackathon), we may still be able to reconstruct URLs given known type + id patterns — worth confirming in the hackathon.

Where this lands: Puma's chat-surface implementation plan (Tier 2 chunk D) needs to either commit to cross-page persistence or explicitly defer it. Handle in Tier 2 when chunk D is planned.

---

## 2026-04-24 — Disclosure + consent + assistant-info copy needs a pass

The current opening-screen copy ("Before we start… This is an AI assistant. It helps you explore trip ideas by chatting with you and suggesting options from our library…") is serviceable placeholder but not Patagonia-voiced and not calibrated against what legal actually needs for EU AI Act Art. 50 + GDPR. Same goes for the persistent chrome badge wording, the privacy-info modal, and wherever the agent introduces itself in-conversation.

Where this lands:
- Content pass: chunk G (content) — belongs in the HITL conversational-flow mapping session with Al + Luke + Lane's sales doc (~May 4).
- Legal copy: chunk E (handoff & compliance) — `product/cms/legal/*` authoring + counsel review before M5.
- Files to touch when we do this: `product/cms/legal/` (doesn't exist yet) + the disclosure components in `product/ui/src/disclosure/`.

Noticed while building the mock-host harness and seeing the consent screen through "new eyes" as a visitor.
