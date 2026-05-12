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
- **`find_proof`** — Reassure job. A hesitation has surfaced. **Ships a quiet "pulled-quote" widget** (revised 2026-05-12 HITL Q1): the `evidence` text in lightly-emphasised type, the `claim` as a small lead-in, the `canonicalUrl` as a quiet inline "Read more →" link. NOT a card with "CLAIM:" / "EVIDENCE:" labels. NOT a coloured-border alert box. Visually a moment of emphasis on prose, with a clickable source — warmer than a citation, quieter than a card.
- **`lookup`** — Inform job. Visitor wants a fact. **Ships a quiet "source-page" affordance** (revised 2026-05-12 HITL Q2): when one to two canonical URLs surface, render a small "Read the full guide on swoop-patagonia.com →" affordance beneath Sonnet's prose. When chunks have no canonical URLs (edge case), no widget. NOT a chunk-list, NOT search-results-cards — a single quiet link with a small page-title hint.
- **`find_options`** — Propose options job. Visitor ready to compare concrete trips, tours, or accommodation. **Ships a polymorphic widget** (revised 2026-05-12 HITL Q3): a discriminated `ProposalCard` set rendering one of four card types — `trip`, `tour`, `hotel`, `region_base` — each with its own visual register and distinguishing affordances. v1 implementation ships trips only (current schema); v2 adds tours (Luke priority — group-size badge + day-by-day affordance); v3 adds hotels + region-bases. **Contract extension is settled now even though backend tranches v2/v3 land later** — see [crosscut plan: find-options polymorphism](03-exec-crosscut-find-options-polymorphism.md).

**Net** (revised 2026-05-12 HITL): five widgets across all five conversational tools — Inspire panel, Mirror vignette, polymorphic Proposal cards (find_options), Reassure pulled-quote (find_proof), Inform source-page affordance (lookup). The three "richer" widgets (Inspire, Mirror, ProposalCards) carry the moments where structured visual scaffolding outperforms prose. The two "quiet" widgets (Reassure, Inform) are visually minimal — a citation + source link, nothing more — to complement Sonnet's prose without competing with it.

**Default posture** (per HITL ratification 2026-05-12): widgets render whenever their tool fires. No per-call hint-driven hiding for v1. If real-conversation testing surfaces "the UI feels overwhelming", revisit. The earlier draft proposed an `InvisibleToolRenderer` for find_proof + lookup — superseded; both now ship their own quiet widgets.

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

### `find_proof` (Reassure) — **ships a quiet "pulled-quote" widget** (revised 2026-05-12 HITL Q1)

**Conversational moment.** Interest → Strong Consideration, sometimes Strong Consideration → handoff. A hesitation has surfaced — *"are you guys actually any good at this?"*, *"what about the environmental side?"*. `description.md`: *"the visitor isn't asking for a sales pitch; they're asking for evidence."*

**What the visitor sees.** Sonnet's framing prose, then a quiet pulled-quote treatment: the `evidence` text in slightly larger or italicised type, the `claim` as a small lead-in or unobtrusive title, the `canonicalUrl` as a "Read more →" inline affordance below. Visually a moment of emphasis on prose — not a card, not a coloured-border alert box, not a "CLAIM/EVIDENCE/SOURCE" disclosure block. Warm, not legal.

One row per proof, stacked vertically if 2–3 returned.

**What the visitor does next.** Reads, accepts, returns to whatever was on top of the conversation. The reassurance lands and dissolves — but the widget exists so the visitor can also forward / verify / point a sceptical partner at the source.

**Why a widget (revised).** The original plan proposed no widget on the warmth-vs-disclosure argument. HITL ratification 2026-05-12: a small, visually-quiet widget can preserve warmth *and* offer the source affordance without becoming legal chrome. The visual register is the discriminator — a "claim card with evidence label" is legal; a "pulled-quote with read-more link" is friendly.

The `find_proof` tool's `TrustProofPublicSchema` fields (`topic`, `claim`, `evidence`, `canonicalUrl`) drive the rendering directly. Sonnet's prose can still quote `evidence` verbatim above; the widget is complementary — it adds a clickable affordance and a moment of visual emphasis, nothing more.

**Component + props + file path.**
- `product/ui/src/widgets/find-proof.tsx` exports `FindProofWidget(props: ToolCallMessagePartProps<unknown, unknown>)`.
- Threads through `renderLifecycleGate` first.
- `safeParse(FindProofOutputSchema, props.result)` at the render boundary.
- Empty array → no widget rendered at all (return `null` after lifecycle gate). Trust-proofs aren't a "we tried but found nothing" affordance — the absence of proof is itself the answer; Sonnet weaves whatever prose works.
- Otherwise: a vertical stack of `PulledQuote` sub-components. Each carries: optional `claim` as a small caps-tracked label or italic lead-in; the `evidence` prose in emphasised typography (slightly larger size, lower weight than body, possibly italic — visual treatment decision sized to the brand-extension surface, not pixel-prescribed here); a quiet "Read more →" link to `canonicalUrl` when present (open in new tab).

**Visual register.** Quiet. The visual emphasis is on the prose itself — a typographic moment, not a structural one. No coloured borders, no badges, no shields. The "Read more →" link is text-weight, not button-style. If the visitor's eye drifts away during reading, the widget shouldn't pull it back.

**Attribute hooks (D.t8).** `data-swoop-part="widget"` + `data-swoop-widget="find-proof"` on the root. Each pulled-quote carries `data-swoop-part="find-proof-pulled-quote"` so the brand team can target the typographic emphasis treatment without targeting every internal element.

**Fixture.** `SampleFindProofOutput` from `@swoop/common/fixtures` (exists, or add if not). Test renders against it; assertions: pulled-quote count matches `proofs.length`, evidence text visible, claim visible when present, "Read more →" link present + `target="_blank"`.

**Decision recorded**: ships a quiet widget — the warmth-vs-disclosure tension resolves at the visual register, not at the structural one. The widget is a typographic moment, not a card.

---

### `lookup` (Inform) — **ships a quiet "source-page" affordance** (revised 2026-05-12 HITL Q2)

**Conversational moment.** Any point in the arc, but characteristically Interest. The visitor wants a specific answer to a specific question — *"how long is the W trek?"*, *"is December crowded?"*, *"do I need a visa?"*. `description.md`: *"the workhorse questions… the agent's job here is to be useful and specific, not to weave atmosphere."*

**What the visitor sees.** Sonnet's response with a direct answer, then a small quiet affordance beneath: *"Read the full guide on swoop-patagonia.com →"* with a one-line page-title hint if available. Visually minimal — single inline-styled link, not a card, not a chunk-list, not a search-results layout. Where multiple source pages back the answer (rare; up to 2), render up to two such affordances stacked. Where chunks have no canonical URLs (edge case), no widget renders.

**What the visitor does next.** Mostly: receives the answer, continues. A minority click through for procedural depth (visa rules, transport logistics, packing lists).

**Why a widget (revised).** The original plan proposed no widget on the "librarian, not friend" argument. HITL ratification 2026-05-12: a *single source affordance* is friendlier than a chunk-list — it offers the path forward without imposing a search-results visual. The discriminator is "single quiet link" vs "stack of cards"; the former preserves the knowledgeable-friend positioning, the latter undoes it.

The Inform job's value still lives in Sonnet's synthesis (quote when the source is precise, paraphrase when verbose). The widget complements: it gives a clear next-step affordance for the procedural class of questions where the visitor will want to bookmark / forward / read in full.

**Component + props + file path.**
- `product/ui/src/widgets/lookup.tsx` exports `LookupWidget(props: ToolCallMessagePartProps<unknown, unknown>)`.
- Threads through `renderLifecycleGate` first.
- `safeParse(LookupOutputSchema, props.result)` at the render boundary.
- Empty array → no widget. Same as find_proof's empty case.
- Chunks all share the same `canonicalUrl` → render ONE affordance: *"Read the full guide on swoop-patagonia.com →"* (with `page-title hint` if surfaceable). This is the common case for procedural questions where one page authoritatively answers.
- Chunks span multiple `canonicalUrl`s → render up to 2 affordances, stacked, with page-title hints to distinguish.
- Chunks have no `canonicalUrl` → no widget. The structured tool output is then just synthesis-fuel for Sonnet; no visual moment.

**Visual register.** Quieter than `find_proof`. A single text-weight link with a small page-title hint above it. No box, no border, no background.

**Attribute hooks.** `data-swoop-part="widget"` + `data-swoop-widget="lookup"` on the root. Affordances inside carry `data-swoop-part="lookup-source-link"`.

**Fixture.** `SampleLookupOutput` (exists or add). Test cases: (a) all chunks share one URL → one affordance rendered; (b) chunks span two URLs → two affordances rendered; (c) no URLs → no widget body; (d) empty chunks → no widget body.

**Decision recorded**: ships a quiet widget — single source affordance preserves the knowledgeable-friend positioning where a chunk-list would have undone it. The widget IS the link, not the prose; Sonnet's synthesis carries the substance.

---

### `find_options` (Propose options) — **ships a polymorphic widget** (revised 2026-05-12 HITL Q3)

**Conversational moment.** Strong Consideration. The conversation has earned the move from *"tell me about Patagonia"* to *"what would I actually do?"*. `description.md`: *"the closest the agent gets to recommending; use it when the conversation has earned that move."*

**What the visitor sees.** Below Sonnet's framing prose, a set of two to four cards. Each card is one of four discriminated `ProposalCard` types — `trip`, `tour`, `hotel`, or `region_base` — and renders with its own visual register matched to the proposal's distinguishing characteristics. Same overall layout (responsive grid, comparable laterally) but the card *content* differs per type.

| Card type | Distinguishing affordances vs trip | Schema source |
|---|---|---|
| `trip` (v1) | Region / Duration / From price / Accommodation style | `trip` table |
| `tour` (v2 — Luke priority) | All trip affordances PLUS **group-size badge** (e.g. *"max 12 guests"*) + **"day-by-day itinerary"** affordance pulled from `tour_item.day_label` count | `tour` + `tour_item` |
| `hotel` (v3) | Location / Star rating / **"from £X/night"** pricing variant / Accommodation style | `hotel` |
| `region_base` (v3) | Region / Nearby trips count / "Use as a base, explore around" framing | derivable from `page` + `area` |

**Why a polymorphic widget (revised).** The original plan locked to TripCard-only. HITL ratification 2026-05-12 surfaces a real gap: the conversational moment "propose concrete options" doesn't always mean "propose trips". Luke specifically wants Tours upsold (group-guided fixed-itinerary products, structurally distinct from trips per the schema — see [crosscut plan](03-exec-crosscut-find-options-polymorphism.md) §"Tour vs Trip — schema-level distinction"). Hotels and region-bases are second-tier proposal shapes that emerge in some conversations.

**Important** (per HITL ratification 2026-05-12): the contract is settled NOW even though backend tranches v2/v3 land later. This avoids the "future agent locks in TripCard-only because the schema says so" failure mode. The discriminated union `ProposalCardPublicSchema` ships with all four variants from day one. v1 connector handler returns only `type: 'trip'` cards; widgets handle all four variants from day one. **See the crosscut plan for the contract definition + backend tranches + tool-description rewrite.**

**Pricing rendering rule (per-type).**
- `trip`, `tour`, `region_base`: *"from £X"* (per `currencyCode`) — total trip / total tour / no specific framing. Matches decision C.14.
- `hotel`: *"from £X / night"* — per-night framing; the discriminator from trip/tour total pricing.

If `fromPrice` is null, the price line is omitted; no placeholder.

**Component + props + file paths.**
- `product/ui/src/widgets/find-options.tsx` exports `FindOptionsWidget(props: ToolCallMessagePartProps<unknown, unknown>)` — the parent widget. Polymorphic-dispatches per card type.
- `product/ui/src/widgets/find-options/trip-card.tsx` — the `trip` variant renderer. v1 implementation; ships day-one.
- `product/ui/src/widgets/find-options/tour-card.tsx` — the `tour` variant renderer. Ships day-one (the renderer; backend lands later). Renders against the discriminated union's `tour` branch; behind a fixture for v1, populated against real data when the connector tranche lands.
- `product/ui/src/widgets/find-options/hotel-card.tsx` — the `hotel` variant renderer. Ships day-one (renderer); backend later.
- `product/ui/src/widgets/find-options/region-base-card.tsx` — the `region_base` variant renderer. Ships day-one (renderer); backend later.
- Parent widget: lifecycle gate + `safeParse(FindOptionsOutputSchema, props.result)`. Empty array → empty-state card. Otherwise iterates `cards`; per-card switch dispatches to the matching sub-renderer.

**Layout.** Responsive — single column at narrow viewports (≤480px), two-column grid at wider viewports. **No horizontal scroll**; cards are meant to be compared side-by-side. Polymorphism within the grid is fine — mixed proposal types in one set is visually coherent because the cards share width + image height + spacing, differing only in attribute rows and badges.

**Attribute hooks (D.t8).** `data-swoop-part="widget"` + `data-swoop-widget="find-options"` on the parent root. Each card carries:
- `data-swoop-part="find-options-card"` (common to all card types)
- `data-swoop-card-type="trip" | "tour" | "hotel" | "region_base"` (discriminator hook for brand-team CSS)
- The deep-link CTA carries `data-swoop-part="find-options-card-cta"`
- Tour cards' group-size badge: `data-swoop-part="find-options-tour-group-size"` (Luke salience hook — brand team will likely want to style this prominently)

**Fixture.** `SampleFindOptionsOutput` extends to include one card per type for widget-level coverage. Test cases: (a) all-trips set renders trip variant; (b) mixed set with one of each type renders four distinct variants; (c) tour card surfaces group-size + day-count affordances; (d) hotel card surfaces /night pricing; (e) region_base card surfaces base-and-explore framing; (f) empty → empty-state.

**Decision recorded**: ships a polymorphic widget — the Propose-options job's shape ranges across trip / tour / hotel / region-base, all served by the same conversational moment. Settling the discriminated-union contract day-one avoids future-agent backtracking. v1 trips-only is the implementation tranche; the contract carries all four shapes.

---

## AttributeTable disposition (revised 2026-05-12 for polymorphism)

`product/ui/src/shared/AttributeTable.tsx` is currently consumer-less. The header comment on the file already notes: *"Currently has no consumers (B.t3a 2026-05-02 retired item-detail); kept as a generic primitive likely needed by the D.t9 per-tool widget rewrite (e.g. trip cards in `find_options`)."*

**D.t9 consumes it across all four `find-options` card variants.** Each polymorphic card type composes its own attribute set:

- `trip-card.tsx` → Region / Duration / From price / Accommodation style
- `tour-card.tsx` → Region / Duration / Group size (badge-styled) / From price / Day-count
- `hotel-card.tsx` → Location / Star rating / From price (per-night) / Accommodation style
- `region-base-card.tsx` → Region / Nearby trips count / "Use as base" framing line

The existing `AttributeTable` API (`rows: AttributeRow[]`) fits all four. Each variant composes the rows it needs; `isEmpty()` handles missing optionals. No refactor needed; some new `AttributeRow` types may earn pill/badge styling (group-size for tours, star-rating for hotels) — that's a small visual extension, not a new primitive.

`AttributeTable` is **not** consumed by `find-inspiring.tsx`, `find-someone-who.tsx`, `find-proof.tsx`, or `lookup.tsx`. The Inspire passage card, Mirror story vignette, Reassure pulled-quote, and Inform source-link don't have key-value structures — they're prose-led or single-affordance.

**Net disposition**: consume across all four find-options card variants; leave the file unchanged; update the header comment to name find-options as the consumer.

---

## File plan (the executor's checklist, in order)

**Prereq** (lives in the crosscut plan, not in this file): `@swoop/common` ships the `ProposalCardPublicSchema` discriminated union + the rewritten `cms/prompts/tools/find_options/description.md` BEFORE the UI work below begins. See [03-exec-crosscut-find-options-polymorphism.md](03-exec-crosscut-find-options-polymorphism.md). The crosscut plan + this plan can execute concurrently from independent agent worktrees — they touch non-overlapping files — but the UI plan's `find-options*.tsx` files import from `@swoop/common` and need the schema's discriminated union present at compile time.

D.t9 UI work:

1. `product/ui/src/widgets/find-inspiring.tsx` — new. The Inspire panel.
2. `product/ui/src/widgets/find-someone-who.tsx` — new. The Mirror vignette stack.
3. `product/ui/src/widgets/find-proof.tsx` — new. The Reassure pulled-quote widget.
4. `product/ui/src/widgets/lookup.tsx` — new. The Inform source-page affordance.
5. `product/ui/src/widgets/find-options.tsx` — new. The polymorphic Proposal-card set parent component.
6. `product/ui/src/widgets/find-options/trip-card.tsx` — new. `trip` variant renderer (v1 implementation; ships day one with backend).
7. `product/ui/src/widgets/find-options/tour-card.tsx` — new. `tour` variant renderer (ships day one against fixtures; live data arrives when crosscut plan's v2 backend tranche lands).
8. `product/ui/src/widgets/find-options/hotel-card.tsx` — new. `hotel` variant renderer (ships day one against fixtures; live data v3).
9. `product/ui/src/widgets/find-options/region-base-card.tsx` — new. `region_base` variant renderer (ships day one against fixtures; live data v3).
10. `product/ui/src/widgets/index.ts` — edited. Add five entries to `toolWidgetComponents`: `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options` → the five new widgets. Header comment updated to reflect the per-tool decisions taken and reference this plan.
11. `product/ui/src/widgets/__tests__/find-inspiring.test.tsx` — new. Mirrors `inspiration.test.tsx`. Three cases: happy path, empty state, malformed.
12. `product/ui/src/widgets/__tests__/find-someone-who.test.tsx` — new. Three cases + persona-summary-distinct-from-story-text assertion.
13. `product/ui/src/widgets/__tests__/find-proof.test.tsx` — new. Three cases + "Read more →" link + `target="_blank"` assertion.
14. `product/ui/src/widgets/__tests__/lookup.test.tsx` — new. Four cases: single-URL → one affordance; multi-URL → up-to-two affordances; no URLs → no widget; empty → no widget.
15. `product/ui/src/widgets/__tests__/find-options.test.tsx` — new. Six cases: all-trips set; mixed (one of each variant); tour-card group-size affordance visible; hotel-card /night pricing variant; region_base "base-and-explore" framing visible; empty → empty-state.
16. `product/ui/src/shared/AttributeTable.tsx` — minor edit. Header comment updated to name `find-options` as the consumer. No code change unless tour group-size badge or hotel star-rating row needs new `AttributeRow` variants — small extension if so, no API churn.
17. `planning/decisions.md` — append D.t9 decision entries: per-tool widget call (5 entries), polymorphism contract (1 entry), `AttributeTable` consumption (1 entry), default-render-widgets posture (1 entry — agent-driven hinting deferred per HITL).

**Not edited**: `App.tsx` (`parts/index.ts` already mounts `toolWidgetComponents` and picks up new entries automatically); chunk-C migrations (the crosscut plan's contract change touches `@swoop/common` schemas, not migrations); `progress.md` / `next-steps.md` (HITL-ratification step, not authoring step).

---

## Sub-step ordering (within this task)

0. **Verify the crosscut plan has landed.** Before opening any TSX file, confirm `@swoop/common` exports `ProposalCardPublicSchema` as a discriminated union with `trip | tour | hotel | region_base` variants. If not, halt and dispatch the crosscut executor first.
1. Read this plan + the five `cms/prompts/tools/<tool>/description.md` files in full. Internalise the conversational moment for each tool before opening a TSX file.
2. Build `find-inspiring.tsx` first — simplest content widget; a vertical stack of cards, no AttributeTable consumption. Sets the file shape.
3. Build `find-someone-who.tsx`. Same shape + persona-summary affordance.
4. Build `find-proof.tsx`. The quiet pulled-quote widget. New file shape — typographic emphasis, no card primitive consumption needed.
5. Build `lookup.tsx`. The quietest widget — single source-page affordance (or two stacked, or none).
6. Build `find-options.tsx` + its four card-variant sub-renderers (`find-options/trip-card.tsx`, `tour-card.tsx`, `hotel-card.tsx`, `region-base-card.tsx`). The parent does polymorphic-dispatch; each sub-renderer is self-contained against its discriminated variant.
7. Wire all five top-level widgets into `toolWidgetComponents` in `widgets/index.ts`.
8. Author the five test files. Run `npm test --workspace @swoop/ui` after each — incremental green is easier to debug than a single end-of-task red.
9. Run `npm run typecheck`, `npm run lint`, `npm test` workspace-wide. Six workspaces stay green.
10. Run `npm run dev -w @swoop/orchestrator` + `npm run dev -w @swoop/connector` + `npm run dev -w @swoop/ui` against `puma_dev`. Manual browser smoke: ask the agent in turn for an Inspire moment, a Mirror moment, a Reassure moment, an Inform moment, an Options moment (v1 trips). Verify all five widgets render and look right. Tour / hotel / region_base cards exercise against fixtures in unit tests; live-data smoke for those waits on crosscut tranches v2/v3.
11. Append D.t9 decision-log entries.
12. Append an "Execution log" section to this plan summarising what landed, what was deferred, what surfaced for downstream tasks.

---

## HITL ratification record (2026-05-12)

Three questions reviewed with Al on 2026-05-12. Two reversed from plan-recommended, one carried over for executor judgement.

1. **`find_proof` widget call.** Original plan: no widget. ✅ **Reversed (HITL Q1)**: ships a quiet "pulled-quote" widget — evidence text with light typographic emphasis, claim as a small lead-in, "Read more →" inline link. NOT a claim/evidence card; NOT a coloured-border alert box. Visually warm, not legal. See §"`find_proof` (Reassure)" above for the full specification.

2. **`lookup` widget call.** Original plan: no widget. ✅ **Reversed (HITL Q2)**: ships a quiet "source-page" affordance — a single "Read the full guide on swoop-patagonia.com →" link beneath Sonnet's prose, up to two stacked when chunks span multiple URLs, nothing when chunks lack canonical URLs. NOT a chunk-list; NOT a search-results layout. See §"`lookup` (Inform)" above.

3. **Persona-summary rendering in `find_someone_who`.** ⏳ **Still open — executor's call with escalation if uncertain.** The plan recommends an italic block above the story prose with a quiet "Someone like…" preface. Alternatives: italic without preface (cleaner), or "Why this story?" header in caps-tracked treatment (more legible but more chrome). Executor picks one; if the call feels stuck, escalate via inbox or questions.md for a focused 30-second ratification.

### New design moves landed on 2026-05-12 HITL

4. **`find_options` polymorphism (HITL Q3a — new policy).** Original plan: TripCard-only. ✅ **Replaced**: polymorphic `ProposalCard` discriminated union covering `trip | tour | hotel | region_base`. Luke specifically wants Tours upsold (group-guided products, structurally distinct from trips in the schema). Contract settled day-one; backend tranches v1 trips → v2 trips+tours → v3 +hotels+region_bases. Crosscut plan owns the contract change: [03-exec-crosscut-find-options-polymorphism.md](03-exec-crosscut-find-options-polymorphism.md). UI ships all four card-variant renderers day-one; the variants the connector doesn't populate yet are tested against fixtures.

5. **Agent-driven widget hinting** (`renderMode: 'rich' | 'subtle' | 'none'` proposed mid-conversation). ✅ **Deferred entirely.** Per HITL: widgets render by default whenever their tool fires; whether a tool's widget is "MUST display" vs "MAY display" is a static per-tool decision (the widget map entry), not a runtime per-call hint. If real-conversation testing surfaces overwhelm, revisit. For v1: every conversational tool has a widget, every widget renders.

### Awareness items (not HITL gates)

- All five widgets share the existing D.t8 attribute pattern; no new tokens or attribute conventions are introduced. Brand-extension surface tokens for trip-card density / tour group-size badges may want extension later — that's a D.t8 follow-up, not D.t9 scope.
- The previously-proposed `InvisibleToolRenderer` pattern is **retired** by the HITL Q1 + Q2 reversals — every conversational tool now has its own widget.

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

1. The five new top-level widget files exist (`find-inspiring`, `find-someone-who`, `find-proof`, `lookup`, `find-options`), each registered in `toolWidgetComponents`.
2. The four `find-options` card-variant renderers exist under `find-options/` (`trip-card`, `tour-card`, `hotel-card`, `region-base-card`). The parent dispatches polymorphically over the discriminated `ProposalCardPublicSchema` union.
3. All five new test files pass; the existing `inspiration.test.tsx` + `lead-capture.test.tsx` + `widget-shell` tests still pass.
4. `npm run typecheck` + `npm run lint` + `npm test` are green across all six workspaces, on a fresh `rm -rf node_modules && npm install` install.
5. The five-tool browser walkthrough in `mcp__Claude_Preview__preview_*` produces all five widgets rendering in their expected visual register (rich for Inspire / Mirror / Options; quiet pulled-quote for Reassure; quiet source-link for Inform).
6. `AttributeTable.tsx`'s header comment names `find-options` as its consumer.
7. `planning/decisions.md` has new entries logging the per-tool widget calls, the polymorphism contract, the `AttributeTable` consumption decision, and the default-render-widgets posture (agent-driven hinting deferred per HITL 2026-05-12).
8. An "Execution log" section is appended to this plan with the date, files landed, deviations from the plan (with justifications), and any items surfaced for downstream tasks.
9. The crosscut plan's v1 tranche has landed BEFORE this task closes — `@swoop/common` exports the discriminated union; the v1 backend (trips only) returns shape-correct `ProposalCard` arrays.

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
- **No changes to `@swoop/common` from THIS plan's executor.** The `ProposalCardPublicSchema` polymorphism contract change is owned by the crosscut plan ([03-exec-crosscut-find-options-polymorphism.md](03-exec-crosscut-find-options-polymorphism.md)), which lands first. If a field is needed beyond what the crosscut plan exposes, raise a follow-up to the crosscut — don't invent local fields in the widget.
- **No changes to `cms/prompts/tools/<tool>/description.md`.** Voice refinement of those files is G.t5's scope; D.t9 reads them as calibration but does not edit them.
- **No carousel implementation for the trip-card set.** The plan's call is a responsive grid; if real conversations later show 6+ trip cards being a common output, revisit then — but the existing schema-side `limit: max(6).default(4)` caps it.
- **No persistence of widget state across `restart`** (the D.t5 "New conversation" button + the D.t14 resetKey pattern already clear thread state; D.t9 inherits this behaviour transparently).

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*
