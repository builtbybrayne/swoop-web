# 03 — Execution: D.t9 — chat-surface widget rewrite (five conversational tools)

**Status**: Tier 3 execution plan. Draft, 2026-05-12.
**Chunk**: D (chat surface).
**Task**: t9 — rebuild the per-tool widget layer for the five intent-named conversational tools (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`) on top of the `*PublicSchema` shapes settled in C.t2 and now live in `@swoop/common`.
**Implements**: [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §10 D.t9 (Tier 2 task brief), §2.2 (tool-call widget rendering), §9 verification item 3.
**Depends on**:
- **B.t3a closed 2026-05-02** — orchestrator now talks to the real connector at `:3002`; the deprecated `Search*` / `GetDetail*` schemas + `SearchResultsWidget` / `ItemDetailWidget` have been deleted from `product/ui/src/widgets/`. The chat surface currently registers only `illustrate` and `handoff`; the five conversational tools' structured outputs reach the agent but have no UI renderers — Sonnet weaves them inline as prose. (See `discoveries.md` 2026-05-02 entry on tool-description loading; `progress.md` "D.t9 is downstream of chunk-C closure".)
- C.t2 (eight intent-named Zod schemas + five `*PublicSchema` projections + 10 ts-common fixtures + production tool descriptions).
- C.t4 (eight handlers wired over data primitives in `product/connector/src/tools/`).
- D.t3 (the surviving widget registration pattern — `toolWidgetComponents` map mounted on `MessagePrimitive.Parts.tools.by_name` via `product/ui/src/parts/index.ts`).
- D.t5 (the `widget-shell.tsx` lifecycle gate + `safeParse` + `{ok, value}` envelope unwrap pattern; the malformed/loading placeholders).
- D.t8 (CSS-tokens + `data-swoop-part="widget"` + `data-swoop-widget="<name>"` attribute hooks).
- C.t5 (`@swoop/common/image.ts` — the shared imgix URL utility + page-as-hub resolver).
**Pairs with**: nothing currently in flight. The C.t3a enrich run (operational, not code) is orthogonal — until it runs, the connector handlers return empty arrays; D.t9 verification leans on ts-common fixtures + a deterministic stub injection path (see §"Verification — fixture strategy" below).
**Produces** (file plan in §"File plan"):
- Up to four new widget files under `product/ui/src/widgets/` (count justified per-tool below; one tool likely ships without a widget).
- `product/ui/src/widgets/index.ts` extended — new tools registered in `toolWidgetComponents`.
- `product/ui/src/widgets/__tests__/` — one fixture-driven render test per widget shipped, matching the shape of `inspiration.test.tsx`.
- `product/ui/src/shared/` — at most one new primitive (a thin `Citation`/`SourceLink` component if no existing primitive covers it); `AttributeTable.tsx` either gets one consumer (trip cards) or is retired (decision below).
- No changes to `@swoop/common` (D.t9 is a pure consumer; C.t2's contract is the source of truth — if a field is needed that the schema doesn't expose, that's a `ts-common` PR, not a D.t9 inline fix per D.t3 §"Handoff notes").
- No changes to `product/connector/`, `product/orchestrator/`, `product/cms/`, or any chunk-C migration.
- Decision-log entries appended to `planning/decisions.md` for any per-widget visual call that earns its place.
**Estimate**: 1–2 days of focused work for one execution agent. Mostly mechanical once the per-tool conversational-moment is held in mind. The hardest call is *whether* each tool earns a widget — answered top-down below.

---

## ★ Read this first — the design discipline of D.t9

> **Before you touch a TSX file, re-read the §"Read this first" anchor in [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) and theme 11 in [`01-top-level.md`](01-top-level.md) §3.0 + 3.11. Then re-read the five `cms/prompts/tools/<tool>/description.md` files for the conversational moments they encode.**

D.t9 is the second-most likely chunk-D task to slip into the bottom-up trap that this project has now caught three times in chunk C. The trap looks like:

- *"The tool returns shape Y. Here's a renderer for Y."* — Bottom-up. Wrong.
- *"`find_options` returns trip cards. Build a card grid."* — Bottom-up. Wrong even though the answer ends up resembling that.

The right reasoning, always:

1. **What conversational moment does this widget render into?** What's the visitor's emotional/cognitive state at the moment the agent calls this tool?
2. **What does the visitor see?** A visual sketch before any data field gets named.
3. **What does the visitor do next?** Read? Click? Skim past? Linger?
4. **Only now**: which fields of the `*PublicSchema` shape support that visitor moment? Which are noise?
5. **Only now**: file path, props, registration.
6. **Only now**: verification.

If you find yourself ordering 4 before 1, stop. Re-read the tool's `description.md` and the journey arc. The description files were authored by C.t2's executor with the conversational moment as the load-bearing element; they're the calibration text.

**The corollary that's most likely to bite**: not every tool earns a widget. Sonnet weaves prose for a living. A well-placed citation in `<utter>` text often beats a card that fights the conversation's rhythm. D.t9 must justify each widget on what it adds *visually* to the conversational moment, not on what fields the schema exposes. If the prose weave is better, say so — and **the tool ships with no widget**. Decision logged either way.

---

## Outcome

**Visitor-facing**: when Sonnet reaches for the right conversational tool, the chat surface lifts in the way the moment asks for. Vivid prose alongside a picture when the visitor's curiosity is open. A specialist concretely matched when a persona signal lands. Quiet evidence under a hesitation. A practical answer with a deep-link when a question wants a fact. A small set of trip options when the conversation is ready to compare. Each renders or doesn't render on grounds the conversational journey can defend — never on grounds the schema makes available.

**Technical**: the chat surface registers a widget renderer for every tool that earns one, hydrating from the connector's `*PublicSchema` outputs via the existing `widget-shell.tsx` lifecycle gate + `safeParse` + envelope-unwrap path. Sonnet continues to weave prose around the widget for everything else. All widget code is brand-extensible via D.t8's `data-swoop-part="widget"` + `data-swoop-widget="<name>"` attribute pattern. Six workspaces stay green after the rebuild.

---

## Target functionalities (one bullet per per-tool decision)

The per-tool sections below name the conversational moment and the widget-or-no-widget call. The summary first, so the executor knows the shape:

- **`find_inspiring`** — Inspire job. Visitor in Awareness/Interest, curiosity open. **Ships a widget**: a small "inspiration passages" panel — one to three passage cards, each with the passage prose, the paired image (when present), region tag, and a deep-link to the canonical page. Visually lower-density than `find_options` (cards), higher-density than a citation (prose). The Inspire moment is where imagery + prose together do the lifting; a citation alone is insufficient.
- **`find_someone_who`** — Mirror job. Visitor revealed a persona signal. **Ships a widget**: a "story vignette" — one to three customer-story cards each carrying the customer's story prose, an italicised persona summary that makes the match legible, optional region tag, optional image, deep-link to the source when present. Slightly different visual register from `find_inspiring`'s panel — the persona summary is the load-bearing affordance that makes Mirror feel like Mirror, not like Inspire.
- **`find_proof`** — Reassure job. A hesitation has surfaced. **No widget**. Sonnet weaves the proof inline as `<utter>` prose with a deep-link. Justification in the per-tool section: a proof card risks turning warmth into legal disclosure; a sentence carrying the claim + the source link is the warmer affordance. Decision flagged for HITL ratification.
- **`lookup`** — Inform job. Visitor wants a fact. **No widget**. Sonnet weaves the answer inline with at most one canonical-URL link offered when the source page is genuinely a "you'd benefit from reading the full page" affordance. Justification below: a chunk-list widget would look like a search-engine result page; the agent is supposed to be a knowledgeable friend, not a librarian. Decision flagged for HITL ratification.
- **`find_options`** — Propose options job. Visitor ready to compare concrete trips. **Ships a widget**: a "trip card set" — two to four trip cards each with image, headline, vibe-line, region, headline price (e.g. "from £2,150"), duration, optional accommodation-style + activity tags, deep-link to the trip page. This is the only widget where structured comparison genuinely earns its place; trip cards are the canonical visual moment of the Propose-options job.

**Net**: three widgets (Inspire panel, Mirror vignette, Trip card set), two non-widget tools (Reassure, Inform). Sonnet's prose carries Reassure and Inform; the three widgets carry the moments where visual scaffolding outperforms prose.

The "no widget for Reassure / Inform" calls are the two genuinely top-down questions Al should ratify before execution; they're surfaced again in §"Open HITL questions" so they're hard to miss.

---

## Architectural principles applied here

- **Theme 11 — top-down from sales journey, never bottom-up from data.** Every widget proposed below is justified on the conversational moment it serves. The two "no widget" calls are the same discipline turned the other way — *the moment doesn't ask for a card; prose is the warmer answer*.
- **`*PublicSchema` is the contract; `safeParse` is the boundary.** Every widget validates the connector's structured output at the render boundary using the public projection schema from `@swoop/common`. The shell unwraps the `{ok, value}` envelope transparently per the 2026-04-24 discovery entry. Schema drift falls back to `WidgetMalformedPlaceholder`, never crashes the chat.
- **assistant-ui tool-call registry is the registration mechanism.** New tools register in `toolWidgetComponents` (`product/ui/src/widgets/index.ts`). `parts/index.ts` mounts the map under `tools.by_name`. No imperative registration inside React trees.
- **Lifecycle gate is shared.** Every widget threads `props` through `renderLifecycleGate` first; the gate covers `running`/`complete`/`incomplete`/`isError` states uniformly. No widget reinvents the loading or malformed-placeholder UI.
- **Shared image utility.** Image URLs from the connector come pre-resolved via `@swoop/common/image.ts` (C.t5) — widgets render `<ImageBlock src={img.canonicalUrl} alt={img.altText} />` and don't construct URLs themselves. The `DerivedImagePublicSchema` shape (id, canonicalUrl, altText, description, subjectTags, moodTags, regionTags) is what arrives nested under `image` on `InspirePassagePublic`, `CustomerStoryPublic`, `TripCardPublic`.
- **Brand-extension surface is preserved.** Every widget root element carries `data-swoop-part="widget"` + `data-swoop-widget="<tool-name>"` per D.t8. New widgets that introduce a primary CTA earn an additional `data-swoop-part="<tool>-cta"` only if that CTA is the brand-critical affordance (per D.22 discriminator).
- **Content-as-data for any rendered prose.** Widget labels, empty-state copy, and the "go see this page" link text live with the widget (they're labels, not prose), but any genuinely-prose-shaped string (e.g. a verdict intro) loads from `product/cms/` — same convention `lead-capture.tsx`'s `VERDICT_INTRO` map has set the bar for. D.t9 doesn't introduce significant new prose; the only candidates are the empty-state strings, which are short labels not prose.
- **No animation, no carousel-with-momentum, no "design language" introductions.** D.t9 extends what's there. The shape is one of: a stack, a horizontally-scrolling strip (already in `inspiration.tsx`), or a responsive grid. Pick whichever lets the conversational moment land cleanly.
- **No new state-management library, no Storybook, no visual-regression infra.** Per hard constraints from the task brief.

---

## Per-tool sections

Each section answers the five-step discipline in order. The journey-position label uses the Awareness / Interest / Strong Consideration arc from theme 11.

### `find_inspiring` (Inspire) — **ships a widget**

**Conversational moment.** Awareness → Interest hinge. The visitor has named Patagonia, or a region, or a feeling. Energy is open, exploratory — not "tell me a fact", not "show me the trip". `description.md` calls out: *"the visitor's energy is open and exploratory… the moment before the moment they're ready to narrow"*. Sonnet's job is to make the conversation *come alive*: vivid, sensory, evocative.

**What the visitor sees.** A small visual lift in the conversation. Below Sonnet's prose, one to three passage cards. Each card carries a passage of real Patagonia prose, an image when the passage has one, and a small region tag. The card itself is quiet — it's the prose + image together that lift the moment. The card is a clickable affordance leading to the canonical page; it does not visually dominate Sonnet's text.

**What the visitor does next.** Most visitors read and continue the conversation. A small minority click through to the canonical page (new tab; chat persists in the iframe). The widget design favours the reading path — clicking is a secondary affordance, not the primary signal.

**Schema fields used.** `InspirePassagePublicSchema` carries `id`, `text`, `canonicalUrl`, `region?`, `mood?`, `image?` (`DerivedImageSchema`: `id`, `canonicalUrl`, `altText`, `description?`, `subjectTags`, `moodTags`, `regionTags`). The widget renders `text` (primary), `image.canonicalUrl + image.altText` (secondary), `region` (small tag), `canonicalUrl` (clickable affordance covering the card). It ignores `mood`, `subjectTags`, `moodTags`, `regionTags`, `description` — those are Sonnet-side metadata for query construction, not visitor-facing. The output wraps `passages: InspirePassagePublic[]` + `count: number`.

**Component + props + file path.**
- `product/ui/src/widgets/find-inspiring.tsx` exports `FindInspiringWidget(props: ToolCallMessagePartProps<unknown, unknown>)`.
- Threads through `renderLifecycleGate` first.
- `safeParse(FindInspiringOutputSchema, props.result)` at the render boundary.
- Empty array (`count === 0`) → empty-state card with a short label ("No passages to surface right now.") — mirrors the `inspiration-empty` pattern.
- Otherwise: a vertically-stacked list of `PassageCard` sub-components. Each is a `<Card>` (from `shared/Card.tsx`) wrapping an `<ImageBlock>` (if `image` present) + the passage text + the region tag pill + a "Read more on swoop-patagonia.com" link affordance (open in new tab, `target="_blank" rel="noopener noreferrer"` — consistent with D.t3 §"Deep-link handling").

**Visual register.** Vertical stack at default density; `<Card>` is the existing primitive. Region tag pill uses the same compact-tag treatment `inspiration.tsx` uses for mood tags. Image (when present) sits above the text, full-width within the card. No carousel; the panel is `2–4` cards by default so vertical stacking is fine.

**Attribute hooks (D.t8).** `data-swoop-part="widget"` + `data-swoop-widget="find-inspiring"` on the root. Each `<Card>` carries `data-swoop-part="find-inspiring-passage"` (single attribute; brand team can target the card style without targeting every internal element).

**Fixture.** `SampleFindInspiringOutput` from `@swoop/common/fixtures` (already exists). Test renders against it; assertions: card count matches `passages.length`, passage text visible, image rendered when present, region tag visible, deep-link present + `target="_blank"`.

**Decision recorded**: ships a widget — Inspire is image-plus-prose by nature; a citation alone underweights the moment.

---

### `find_someone_who` (Mirror) — **ships a widget**

**Conversational moment.** Interest → Strong Consideration. The visitor has revealed something about themselves: solo, post-divorce, photographer, retiring, first big trip. The Mirror tool answers *"yes, and people like you have done this"*. `description.md`: *"the right answer is rarely a brochure. It's a story about someone with a similar shape who did this trip and loved it."*

**What the visitor sees.** Below Sonnet's framing prose, one to three story vignettes. Each vignette carries the customer's story prose (the load-bearing text) and an italicised persona summary that makes the *match* legible — *why* this person is being shown to this visitor. Optional image when present, optional region tag, optional deep-link to the source. Visually distinct from the Inspire panel: the persona summary is the affordance that signals "Mirror, not Inspire".

**What the visitor does next.** Reads. Maybe quotes back to the agent ("the W-trail solo one sounds like me"). Some click through to the source if the story is blog-derived. The persona summary is the legibility affordance — it makes the visitor feel *seen*, not just shown a generic testimonial.

**Schema fields used.** `CustomerStoryPublicSchema` carries `id`, `text` (the prose the agent shows), `personaSummary` (load-bearing), `canonicalUrl?`, `region?`, `image?`. The widget renders all five visible fields. The output wraps `stories: CustomerStoryPublic[]` + `count: number`.

**Component + props + file path.**
- `product/ui/src/widgets/find-someone-who.tsx` exports `FindSomeoneWhoWidget(props)`.
- Lifecycle gate + `safeParse(FindSomeoneWhoOutputSchema, props.result)` at the boundary.
- Empty array → empty-state card ("No matching stories surfaced.").
- Otherwise: a vertical stack of `StoryVignette` sub-components. Each is a `<Card>` with: image (when present) above; the persona summary in a small italicised line — labelled visually with "Someone like…" or rendered as italic text without a header, decision noted; the story prose as the main body; region tag if present; "Read the full story" deep-link if `canonicalUrl` present.

**Visual register decision (per-widget).** The persona summary is the affordance that differentiates Mirror from Inspire. The plan recommends rendering it as a small italic block above the story prose with a quiet "Someone like…" preface. Alternative: italic, no preface. **Decision flagged for HITL** — this is a copywriting call as much as a visual one (see §"Open HITL questions").

**Attribute hooks.** `data-swoop-part="widget"` + `data-swoop-widget="find-someone-who"` on the root. Each vignette carries `data-swoop-part="find-someone-who-vignette"`.

**Fixture.** `SampleFindSomeoneWhoOutput` (exists). Test asserts persona summary visible, story prose visible, deep-link present, italic styling applied (via class assertion).

**Decision recorded**: ships a widget — the persona-summary affordance carries load that prose can't (it makes the *match* visible). Without that visibility the Mirror moment collapses into "here's a testimonial", which is the librarian shape this project keeps catching itself in.

---

### `find_proof` (Reassure) — **no widget** (HITL ratification candidate)

**Conversational moment.** Interest → Strong Consideration, sometimes Strong Consideration → handoff. A hesitation has surfaced — *"are you guys actually any good at this?"*, *"what about the environmental side?"*. `description.md`: *"the visitor isn't asking for a sales pitch; they're asking for evidence."*

**What the visitor sees.** A short Sonnet response that names the concern, weaves the proof into one or two sentences with the source link offered as a quiet inline affordance. The proof is named in Sonnet's voice — calmly, warmly, not defensively.

**What the visitor does next.** Reads, accepts, returns to whatever was on top of the conversation. The reassurance is meant to *land and dissolve*, not occupy visual space. A minority click through to the source page to verify.

**Why no widget.** A proof card visually escalates a defensive moment. Imagine the visitor asks *"is Swoop actually B-Corp?"* and the chat surface throws up a card with "CLAIM: Swoop is a certified B Corporation. EVIDENCE: …" — the visual register is legal disclosure, not friendly reassurance. The warmer answer is Sonnet's prose: *"Yes — we've been B Corp certified since 2021, recertified 2024. Here's the impact report if you'd like to read it: \[link\]."*

The `find_proof` tool's `TrustProofPublicSchema` fields (`topic`, `claim`, `evidence`, `canonicalUrl`) are already prose-shaped — Sonnet can quote `evidence` verbatim where the wording is strong, paraphrase where the rhythm wants it, and offer `canonicalUrl` as an inline link. No new visual scaffolding earns its place.

**Schema flow.** The connector returns `FindProofOutputSchema` shape unchanged; Sonnet receives the structured output in its tool-call result and weaves the response as `<utter>`. No registration in `toolWidgetComponents`. **Important**: without a registered renderer, assistant-ui's default behaviour is to render the tool-call as a small "called tool: find_proof" affordance — that's not what we want either. The widget map must register a **deliberate empty renderer** for `find_proof` (a `null`-returning component) so the tool call doesn't show in the chat at all, only Sonnet's `<utter>` response. Same pattern is needed for `lookup` (next section).

**Component + props + file path (for the empty renderer).**
- A single shared file `product/ui/src/widgets/invisible-renderer.tsx` exports `InvisibleToolRenderer(props)` that returns `null` — but **only** after `props.status?.type === "complete"` (otherwise the loading state still wants visible feedback). The loading state shows the existing `WidgetLoadingPlaceholder` so the visitor sees *something happened* while the tool runs.
- `toolWidgetComponents` registers `find_proof: InvisibleToolRenderer` and `lookup: InvisibleToolRenderer` (next section).
- Edge case to handle: `incomplete` / `isError`. The shared shell's `renderLifecycleGate` already handles these via `WidgetMalformedPlaceholder` — but for an invisible-by-design renderer, showing a malformed card on tool error is the right behaviour (the visitor should know something went wrong). The `InvisibleToolRenderer` defers to the lifecycle gate and only returns `null` on `complete + result-available`.

**Attribute hooks.** None — there's no rendered element.

**Fixture.** No widget body test required; the renderer's only visible state is "loading" (covered by the shell's existing tests) and "error" (ditto). A small contract test asserts that `find_proof` is registered in `toolWidgetComponents`, points at `InvisibleToolRenderer`, and that the renderer returns `null` on `complete` with valid output.

**Decision recorded**: no widget — visual escalation of a defensive moment is the wrong affordance; Sonnet's prose with an inline source link is warmer. **Flagged for HITL** — this is a top-down design call, not a technical one (see §"Open HITL questions").

---

### `lookup` (Inform) — **no widget** (HITL ratification candidate)

**Conversational moment.** Any point in the arc, but characteristically Interest. The visitor wants a specific answer to a specific question — *"how long is the W trek?"*, *"is December crowded?"*, *"do I need a visa?"*. `description.md`: *"the workhorse questions… the agent's job here is to be useful and specific, not to weave atmosphere."*

**What the visitor sees.** Sonnet's response with a direct answer, often a single sentence, sometimes two paragraphs for procedural questions (visa rules, transport logistics). Where the source page genuinely rewards a deeper read, Sonnet offers the canonical URL as an inline affordance — *"the full visa guide is on the practical page if you want the detail: \[link\]."*

**What the visitor does next.** Mostly: receives the answer, continues. A minority click through for procedural depth.

**Why no widget.** A chunk-list widget — a stack of cards each carrying a prose chunk + URL — looks like a Google search-result page. The agent's mandate is to be a knowledgeable friend, not a librarian; visually rendering the lookup outputs as result cards undoes that positioning. The bottom-up reasoning ("`lookup` returns chunks, build a chunk-list widget") is exactly the trap theme 11 was authored against.

The Inform job's value lives in Sonnet's synthesis: weave the answer, quote when the source is precise, paraphrase when the source is verbose, offer the link when the visitor would benefit from the full page. The structured `InformChunkPublicSchema` output (`question?`, `text`, `canonicalUrl?`, `topicTags`) gives Sonnet exactly what it needs to do that synthesis.

**Schema flow.** Same as `find_proof`: connector returns structured output, Sonnet weaves prose, widget map registers `lookup: InvisibleToolRenderer`. No new code beyond the registration line.

**Attribute hooks.** None.

**Fixture.** Contract test as above (`lookup` registered, `InvisibleToolRenderer` returns null on complete).

**Decision recorded**: no widget — librarian-shaped result cards undo the "knowledgeable friend" positioning theme 11 is built around. **Flagged for HITL** — same shape as `find_proof`'s call (see §"Open HITL questions").

---

### `find_options` (Propose options) — **ships a widget**

**Conversational moment.** Strong Consideration. The conversation has earned the move from *"tell me about Patagonia"* to *"what would I actually do?"*. `description.md`: *"the closest the agent gets to recommending; use it when the conversation has earned that move."*

**What the visitor sees.** Below Sonnet's framing prose, a set of two to four trip cards. Each card carries a hero image, the trip headline, a one-line vibe pitch, the region, headline price (always "from £X"), duration, optional accommodation-style + activity tags, and a deep-link to the trip page on swoop-patagonia.com. Cards are visually denser than the Inspire panel — they're meant to be comparison affordances, not reading affordances. The visitor's eye should travel laterally across the set.

**What the visitor does next.** Compares. Asks Sonnet about one specifically ("the self-guided W-trail one — what does that include?"). Clicks through to read the full trip page in a new tab. Sometimes flips back into the agent's chat and progresses toward handoff. The card set is the conversational moment most likely to trigger handoff downstream, because comparing is what visitors do just before they want to talk to a specialist.

**Schema fields used.** `TripCardPublicSchema` carries `id`, `slug?`, `headline`, `vibeLine?`, `region?`, `durationDays?`, `fromPrice?`, `currencyCode?`, `accommodationStyle?`, `activityTags`, `canonicalUrl`, `image?`. The widget renders all of these.

**Pricing rendering rule.** Always render as "from £X" (or "from $X", "from €X" per `currencyCode`) — never as a flat number, never as a range. This matches decision C.14 (no departures / headline pricing only). If `fromPrice` is null, the price line is omitted from the card; no placeholder.

**Component + props + file path.**
- `product/ui/src/widgets/find-options.tsx` exports `FindOptionsWidget(props)`.
- Lifecycle gate + `safeParse(FindOptionsOutputSchema, props.result)`.
- Empty array → empty-state card ("No options to surface right now — try sharpening the filter, or share more about what you're after.").
- Otherwise: a `<ul>` of `TripCard` sub-components. Layout: responsive — single column at narrow viewports (≤480px), two-column grid at wider viewports. **No horizontal scroll**; trip cards are meant to be compared side-by-side, not swiped.
- Each `TripCard` is a `<Card>` containing: `<ImageBlock>` at top; headline as `<h3>`; vibe-line below; an attributes line below the vibe-line — and this is where `AttributeTable` earns its consumer (see "AttributeTable disposition" below). The attribute rows: Region / Duration / From price / Accommodation style. `activityTags` render as a small tag pill row above the deep-link CTA.

**Attribute hooks.** `data-swoop-part="widget"` + `data-swoop-widget="find-options"` on the root. Each card carries `data-swoop-part="find-options-card"`. The deep-link CTA carries `data-swoop-part="find-options-card-cta"` — this is the only sub-attribute that earns a hook per D.22's discriminator (it's the affordance most likely to be brand-restyled). The card's price element does *not* get a hook; price typography rides on tokens.

**Fixture.** `SampleFindOptionsOutput` (exists). Test asserts card count matches `cards.length`, headline + vibe-line rendered, "from £" rendering for price, deep-link href + target, attribute rows visible.

**Decision recorded**: ships a widget — the Propose-options job is canonically a structured-comparison moment; trip cards are how that moment lands. This is the one widget where structured visual scaffolding genuinely outperforms prose.

---

## AttributeTable disposition

`product/ui/src/shared/AttributeTable.tsx` is currently consumer-less. The header comment on the file already notes: *"Currently has no consumers (B.t3a 2026-05-02 retired item-detail); kept as a generic primitive likely needed by the D.t9 per-tool widget rewrite (e.g. trip cards in `find_options`)."*

**D.t9 consumes it in `find-options.tsx`.** The trip card's attribute section (Region / Duration / From price / Accommodation style) is exactly the key-value grid `AttributeTable` was authored to render. Reusing it (a) honours the "prefer existing primitives" discipline; (b) keeps the visual treatment of trip-card attributes consistent if Swoop's brand team later wants to restyle attribute layouts globally; (c) avoids re-inventing the same grid in `find-options.tsx`.

No refactor needed — the existing API (`rows: AttributeRow[]`) fits. The widget composes `AttributeRow` objects from the schema fields; the table's `isEmpty()` filter handles missing optionals (`durationDays`, `accommodationStyle` etc.) cleanly.

`AttributeTable` is **not** consumed by `find-inspiring.tsx` or `find-someone-who.tsx`. The Inspire passage card and Mirror story vignette don't have a key-value structure — they're prose-led; the region tag is a single chip, not a row in an attribute grid. Forcing those widgets through `AttributeTable` would be premature primitive-reuse.

**Net disposition**: consume in `find-options.tsx`; leave the file unchanged; update the header comment to name the now-real consumer.

---

## File plan (the executor's checklist, in order)

1. `product/ui/src/widgets/find-inspiring.tsx` — new. The Inspire panel.
2. `product/ui/src/widgets/find-someone-who.tsx` — new. The Mirror vignette stack.
3. `product/ui/src/widgets/find-options.tsx` — new. The trip-card set.
4. `product/ui/src/widgets/invisible-renderer.tsx` — new. Shared `null`-returning renderer for `find_proof` + `lookup`. Defers loading + error states to the existing lifecycle gate; returns `null` only on `complete + result-available`.
5. `product/ui/src/widgets/index.ts` — edited. Add five new entries to `toolWidgetComponents`: `find_inspiring`, `find_someone_who`, `find_options` → the three new widgets; `find_proof`, `lookup` → `InvisibleToolRenderer`. Header comment updated to reflect the per-tool decisions taken and reference this plan.
6. `product/ui/src/widgets/__tests__/find-inspiring.test.tsx` — new. Mirrors the shape of `inspiration.test.tsx`. Three cases: happy path against fixture, empty state, malformed output → placeholder.
7. `product/ui/src/widgets/__tests__/find-someone-who.test.tsx` — new. Same three-case shape, plus an extra assertion that the persona summary renders distinctly from the story text.
8. `product/ui/src/widgets/__tests__/find-options.test.tsx` — new. Same three-case shape, plus an assertion that price renders as `from £…` and that the deep-link `target="_blank"`.
9. `product/ui/src/widgets/__tests__/invisible-renderer.test.tsx` — new. Two cases: `complete + result` returns null (assert nothing rendered); `running` returns the loading placeholder (assert `widget-loading` testid present).
10. `product/ui/src/shared/AttributeTable.tsx` — minor edit. Header comment updated to name `find-options.tsx` as the now-real consumer. No code change.
11. `planning/decisions.md` — append D.t9 decision entries (one per per-tool widget-or-no-widget call; one for the `InvisibleToolRenderer` pattern; one for `AttributeTable` consumption).

**Not edited**: `App.tsx` (`parts/index.ts` already mounts `toolWidgetComponents` and picks up new entries automatically); any chunk-C / `ts-common` / `cms` file; `progress.md` / `next-steps.md` (HITL-ratification step, not authoring step).

---

## Sub-step ordering (within this task)

1. Read this plan + the five `cms/prompts/tools/<tool>/description.md` files in full. Internalise the conversational moment for each tool before opening a TSX file.
2. Build `invisible-renderer.tsx` first — smallest unit, sets the pattern for the lifecycle-gate delegation.
3. Build `find-inspiring.tsx`. It's the simplest content widget — a vertical stack of cards, no AttributeTable consumption.
4. Build `find-someone-who.tsx`. Same shape, plus the persona-summary affordance.
5. Build `find-options.tsx`. The most structured — uses `AttributeTable`, has the price-rendering rule, has the responsive grid.
6. Wire all five into `toolWidgetComponents` in `widgets/index.ts`.
7. Author the four test files. Run `npm test --workspace @swoop/ui` after each — incremental green is easier to debug than a single end-of-task red.
8. Run `npm run typecheck`, `npm run lint`, `npm test` workspace-wide. Six workspaces stay green.
9. Run `npm run dev -w @swoop/orchestrator` + `npm run dev -w @swoop/connector` + `npm run dev -w @swoop/ui` against `puma_dev`. Manual browser smoke: ask the agent in turn for an Inspire moment, a Mirror moment, an Options moment, a Proof moment, an Inform moment. Verify the three widgets render and the two invisible tools render only prose.
10. Append D.t9 decision-log entries.
11. Append an "Execution log" section to this plan summarising what landed, what was deferred, what surfaced for downstream tasks.

---

## Open HITL questions

These three need Al's ratification before the executor commits to them. Two are top-down design calls; one is a copywriting affordance.

1. **`find_proof` ships no widget.** The plan's stance: Sonnet's prose + an inline source link is warmer than a "claim/evidence" card. Counter-position to weigh: an explicit Reassure card gives the visitor a stable, scannable affordance for high-stakes hesitations (e.g. environmental impact, safety), and the visual constancy of "every proof looks the same shape" may build more trust than freeform prose. Ratify yes/no on shipping without a widget. (If yes, no new code; if no, the executor builds a fourth widget `find-proof.tsx` along the lines of the `find-inspiring` shape, swapping passage prose for the claim/evidence pair.)

2. **`lookup` ships no widget.** The plan's stance: librarian-shaped result cards undo the knowledgeable-friend positioning. Counter-position: for procedural questions (visa rules, transport logistics), an explicit chunk-list with deep-links is arguably the *friendlier* affordance — it gives the visitor the path to the source page they'll want to bookmark. Ratify yes/no. (If no, the executor builds a fifth widget `lookup.tsx` rendering one to three chunk cards with question + answer + canonical URL.)

3. **Persona-summary rendering in `find_someone_who`.** The plan recommends an italic block above the story prose, prefaced quietly with "Someone like…". Alternative: italic without preface (cleaner, less talkative). Alternative B: a small label-style header "Why this story?" above the persona summary in caps-tracked treatment (more legible but more chrome). Ratify which of the three lands the warmth + legibility balance. (This is a copywriting call as much as a visual one.)

Additionally noted, not strictly HITL but worth Al's awareness:

- The `InvisibleToolRenderer` pattern is a UI-level decision the plan settles itself (it's the technical consequence of the "no widget" calls in 1 + 2); if Al ratifies widgets for `find_proof` and/or `lookup`, the renderer either ships with one consumer or retires entirely.
- All three widgets share the existing D.t8 attribute pattern; no new tokens or attribute conventions are introduced. If the brand-extension surface needs new tokens for trip-card density (likely), that's a follow-up cross-cut against D.t8, not D.t9 scope.

---

## Verification

### Test strategy

- **Unit tests per widget**, mirroring `inspiration.test.tsx` and `lead-capture.test.tsx`. Each new widget gets a three-case test: happy path against the existing fixture, empty state, malformed output. The Mirror widget gets a fourth case asserting the persona summary renders distinctly. The Options widget gets a fourth case asserting "from £" pricing + new-tab deep link.
- **Contract test for `InvisibleToolRenderer`** asserts: returns `null` on `complete + result`; returns loading placeholder on `running`; returns malformed placeholder on `incomplete` / `isError`.
- **Contract test for widget registration**: asserts `toolWidgetComponents` contains the five expected new keys plus the two surviving keys (`illustrate`, `handoff`); asserts each conversational-tool key points to either a real widget component or `InvisibleToolRenderer`. This single test catches future drift (someone adds a tool but forgets to register).
- **No new integration tests required**: the existing orchestrator + connector integration tests already exercise the tool-call → SSE → widget pipeline; D.t9 doesn't change that pipeline, only the renderers at the leaf.

### Fixture strategy

- Use the existing `SampleFindInspiringOutput`, `SampleFindSomeoneWhoOutput`, `SampleFindOptionsOutput` from `@swoop/common/fixtures` — they round-trip clean against the `*OutputSchema`s and reflect realistic content shapes.
- For the empty-state case, construct `{ passages: [], count: 0 }` / `{ stories: [], count: 0 }` / `{ cards: [], count: 0 }` inline in the test — no fixture file needed.
- For the malformed case, pass an obviously-wrong object (e.g. `{ passages: "not-an-array", count: 0 }`) — `safeParse` falls through to `WidgetMalformedPlaceholder`, which the test asserts via `data-testid="widget-malformed"`.

### Browser-smoke procedure

After unit tests pass, run a manual five-tool walkthrough in the `mcp__Claude_Preview__preview_*` tools (the agent's preview surface that the project uses for live UI verification):

1. `npm run dev -w @swoop/connector` (real connector at `:3002` against `puma_dev`).
2. `npm run dev -w @swoop/orchestrator` (orchestrator at `:8080`).
3. `npm run dev -w @swoop/ui` (UI at `:5173`).
4. Open the preview tool against `http://localhost:5173`.
5. Walk five conversational prompts, one per tool. For each, capture a screenshot and verify the rendered output matches the per-tool expectation:
   - *"Tell me about Torres del Paine — what's it actually like there?"* — expect Sonnet prose + `find_inspiring` widget (passage cards visible).
   - *"I'm going solo, post-divorce, in my mid-40s — would I be okay on a group trip?"* — expect Sonnet prose + `find_someone_who` widget (story vignette + persona summary visible).
   - *"Are you guys actually B-Corp certified?"* — expect Sonnet prose with inline source link; NO widget rendered (only the loading placeholder briefly, then nothing).
   - *"How long is the W trek?"* — expect Sonnet prose with concrete answer; NO widget rendered.
   - *"Show me some trip options for the W trail, around a week long, mid-budget."* — expect Sonnet prose + `find_options` widget (2–4 trip cards with from-price visible).
6. Verify error states for each renders the malformed placeholder (force a connector failure for one tool; chat continues running for the others — no chat-level collapse).
7. Verify each rendered widget passes the D.t8 attribute-hook check: DevTools inspection shows `data-swoop-part="widget"` + `data-swoop-widget="<tool-name>"` on every root.

### Fresh-install gate

Per the user's memory note on swarm-merged work, before considering D.t9 closed:

```bash
cd product
rm -rf node_modules
npm install
npm run typecheck    # all 6 workspaces green
npm run lint         # green (or only pre-existing main-branch noise)
npm test             # all 6 workspaces green
npm run dev -w @swoop/connector &  # real connector at :3002
npm run dev -w @swoop/orchestrator &
npm run dev -w @swoop/ui &
# repeat the five-tool browser walkthrough above against the fresh install
```

If any workspace fails on fresh install but passes on cached `node_modules`, the cause is almost certainly stale dependencies — investigate before declaring green.

### What "done" looks like

D.t9 is done when:

1. The three new widget files exist, each registered in `toolWidgetComponents`.
2. `find_proof` and `lookup` are registered against `InvisibleToolRenderer`.
3. All four new test files pass; the existing `inspiration.test.tsx` + `lead-capture.test.tsx` + `widget-shell` tests still pass.
4. `npm run typecheck` + `npm run lint` + `npm test` are green across all six workspaces, on a fresh `rm -rf node_modules && npm install` install.
5. The five-tool browser walkthrough in `mcp__Claude_Preview__preview_*` produces the expected widget / no-widget rendering for each of the five conversational tools.
6. `AttributeTable.tsx`'s header comment names `find-options.tsx` as its consumer.
7. `planning/decisions.md` has new entries logging the per-tool widget-or-no-widget calls + the `InvisibleToolRenderer` pattern + the `AttributeTable` consumption decision.
8. An "Execution log" section is appended to this plan with the date, files landed, deviations from the plan (with justifications), and any items surfaced for downstream tasks.

---

## Coordination

- **No upstream coordination needed** with chunk B / C — both surfaces (connector tool outputs + orchestrator → SSE → assistant-ui pipeline) are settled. D.t9 is a pure consumer of the existing contract.
- **Pairs with no other in-flight task**. The C.t3a enrich operational run can land before, during, or after D.t9 lands — D.t9's verification uses ts-common fixtures, not live data. Once the enrich run lands, the browser walkthrough exercises live data without any code change.
- **Downstream**: the `next-steps.md` post-D.t9 state should call out that **all five intent-named tools now have a settled UI treatment** — the chat surface is feature-complete against the chunk-C tool surface. The only remaining UI-side work is whatever surfaces from real-conversation observation post-G.t0 / G.t1 / G.t5 content authoring.
- **No `progress.md` / `next-steps.md` update during plan authoring** — those land at HITL ratification time per the task brief.

---

## Out-of-scope reminders (don't drift)

- **No new state-management library.** The widgets are pure renderers; transient state (e.g. the lightbox expansion in `inspiration.tsx`) lives in local `useState` per the existing pattern.
- **No Storybook, no visual-regression infra.** Per D.t8 §"Scope fences"; per the hard constraints in the task brief.
- **No new shared primitives beyond what's strictly needed.** The widgets compose `Card`, `ImageBlock`, `CtaButton`, `AttributeTable` from `shared/`. A new `Citation` or `SourceLink` primitive is *not* required — the `<a target="_blank">` pattern from `inspiration.tsx` is sufficient.
- **No design-system extraction.** Trip-card density may suggest new D.t8 tokens later; that's a follow-up against D.t8's surface, not D.t9 scope.
- **No animation beyond CSS transitions.** Hover / focus states only; no entrance animations on widget mount.
- **No changes to `@swoop/common`.** If a field is needed that the public schemas don't expose, raise a `ts-common` change before continuing — don't invent local fields in the widget.
- **No changes to `cms/prompts/tools/<tool>/description.md`.** Voice refinement of those files is G.t5's scope; D.t9 reads them as calibration but does not edit them.
- **No carousel implementation for the trip-card set.** The plan's call is a responsive grid; if real conversations later show 6+ trip cards being a common output, revisit then — but the existing schema-side `limit: max(6).default(4)` caps it.
- **No persistence of widget state across `restart`** (the D.t5 "New conversation" button + the D.t14 resetKey pattern already clear thread state; D.t9 inherits this behaviour transparently).

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*
