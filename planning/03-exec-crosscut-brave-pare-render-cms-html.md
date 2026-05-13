# 03 — Crosscut: render Swoop-authored CMS HTML in proposal cards (brave-pare worktree, 2026-05-13)

**Status**: Tier 3 execution plan. Draft, 2026-05-13.
**Chunk**: Crosscut — small UI/data-trust change.
**Filename suffix `-brave-pare-`**: worktree-slug-stamped per the 2026-05-13 collision-avoidance discipline.
**Depends on**: nothing.
**Produces**: `RegionBaseCard.vibeLine` (and `baseFraming` where present) renders as HTML — `<strong>`, `<em>`, links, paragraphs, etc. all surface as the Swoop CMS authors intended.
**Estimate**: ~20 minutes.

---

## ★ Read this first — the WHY

Live smoke against the 2026-05-13 region_id backfill (commit `aa72202`) surfaced a cosmetic but visible issue: the RegionBaseCard for Santiago rendered with literal `<p>Chile's cosmopolitan capital…` text — the `<p>` tag visible to the visitor. Root cause: the field is `COALESCE(page.summary, page.intro_text)`, which is **WYSIWYG HTML stored in Swoop's CMS** (588 of 636 pages in `puma_dev` carry HTML this way — 92% — so this is systemic, not a Santiago oddity).

The original instinct was to strip the HTML to plain text on the connector boundary. Al's reframe overrode that: **Swoop's sales team authored this HTML in their CMS. They chose the bolds, italics, paragraphs, and links deliberately. The right behaviour is to render them, not to flatten.** Stripping discards content the editor intended; the literal-tag artefact is what happens when React's auto-escape meets HTML-as-text.

**Trust posture**: `page.summary` + `page.intro_text` (and `contentblock.text`) are authored by Swoop's internal team via the CMS. Treat as trusted; render as HTML via `dangerouslySetInnerHTML`. No XSS surface — the data does not come from website visitors. This trust boundary is the load-bearing assumption; a future agent must understand it before extending HTML rendering to any visitor-authored field (none currently exist in the agent surface, but `customerreview.content` would be an exception — that's customer-typed prose; query confirms 0 of 2,160 customer reviews carry HTML, so the schema is well-behaved by chance, not by sanitisation).

---

## Audit — where does CMS HTML reach the visitor?

Done live against `puma_dev` 2026-05-13:

| Surface | Source | Carries HTML? | Action |
|---|---|---|---|
| `RegionBaseCard.vibeLine` | `query-region-bases.ts` → `COALESCE(page.summary, page.intro_text)` → `vibeLineFromSource` truncator | **Yes** (92% of pages) | Render as HTML |
| `RegionBaseCard.baseFraming` | `RegionBaseProposalCardSchema` declares the field but `query-region-bases.ts` doesn't populate it today; reserved for future composer | Not in use; *potentially* HTML if a future composer pulls from `page.*` | Render as HTML (consistency; matches the trust posture for any CMS prose) |
| `RegionBaseCard.headline` | `area.name` | No (verified — short strings, no tags) | No change |
| `LookupWidget` chunk text | `inform_chunk.text` — composed via `compose/inform-chunk.ts` which imports `stripHtml` from `enrich/chunk.js` | **No** (0 rows with HTML; ETL strips) | No change |
| `InspirationWidget` (illustrate) | image metadata only — no prose body | No | No change |
| `FindSomeoneWhoWidget` story text | `customer_story.text` ← `customerreview.content` (customer-typed prose) | **No** (0 of 2,160 verified) | No change |
| `FindInspiringWidget` passages | `inspire_passage.text` — composed by Haiku via C.t3a's ETL classifier path | **No** (0 rows with HTML; LLM emits clean text) | No change |
| `FindProofWidget` snippets | `trust_proof` — Haiku-composed | **No** | No change |
| `TripCard` `vibeLine` / `subtitle` | `trip_card` — Haiku-composed (decision C.27, ETL passes) | **No** | No change |
| `HotelCard` description / location | `query-hotels.ts` — pulls `hotel.title` + page metadata; no prose body field rendered today | No | No change |

**Bottom line**: only `RegionBaseCard.vibeLine` actually leaks HTML today. `baseFraming` gets the same treatment for consistency + future-proofing. Everywhere else is already either (a) stripped at the ETL boundary or (b) sourced from prose that never had HTML.

---

## Deliverables

| File | Change |
|---|---|
| [product/ui/src/widgets/find-options/region-base-card.tsx](../product/ui/src/widgets/find-options/region-base-card.tsx) | Change `vibeLine` render from `<p>{card.vibeLine}</p>` to `<div className="…" dangerouslySetInnerHTML={{ __html: card.vibeLine }} />`. Same for `baseFraming` — `<p>` → `<div>` with `dangerouslySetInnerHTML`. The `<p>` → `<div>` switch is required because nesting block elements like `<p>` inside `<p>` (which the CMS content often contains) is invalid HTML; React would warn in dev and browsers handle it inconsistently. Add an inline comment naming the trust boundary so the next agent doesn't strip it. |
| Existing tests | No change — they assert via `textContent` which works the same against HTML or text rendering. |

---

## What does NOT change

- The connector / data primitives — `vibeLine` continues to pass through HTML as-is. No `stripHtmlAndCollapse` helper added (the previous draft proposed one; superseded by this plan's trust-render posture).
- The vibe-line truncation logic (`vibeLineFromSource` in `query-region-bases.ts`). It still truncates at the first sentence and 140 chars, which may now slice mid-tag (`<p>Chile's cosmopolitan capital is a great place…<p` — yes, ugly). **Open question for later**: should the truncator be HTML-aware? Pragmatic answer for v1: most CMS-authored intro text is one paragraph anyway, and the 140-char ceiling is rarely hit. Park as a follow-up if HITL reports broken tags in the UI.
- Other widget cards — already clean (see audit table). No fan-out work.
- ETL — content as-authored stays in `page.intro_text` / `page.summary`. Future analytics or post-Puma surfaces that want the raw HTML still get it.

---

## Step-by-step execution

1. Hash gate.
2. Edit `region-base-card.tsx` — both `vibeLine` and `baseFraming` renderings switch to `<div dangerouslySetInnerHTML>`. Add the inline trust-boundary comment.
3. Run `npm test -w @swoop/ui` — green; the existing test (asserting `framing.textContent.toContain('Use El Calafate as a base')`) still passes because `textContent` strips HTML automatically.
4. Live browser smoke — repeat the region_base query against the running stack; verify the Santiago card no longer shows literal `<p>` and instead renders the paragraph correctly.
5. Commit with the trust-posture rationale in the message body.
6. (Optional but worth) Add a discoveries.md note on the trust boundary so future agents reaching for `dangerouslySetInnerHTML` see precedent + reasoning.

---

## Decision marker (TBD)

**Decision-pending — CMS-authored prose from Swoop's internal team renders as HTML via `dangerouslySetInnerHTML`; the trust boundary is the source's authorship (internal CMS, not visitor input).** Number assigned at merge. Companion to the 2026-05-13 region_id backfill: that plan put real data behind the widget; this plan makes the widget show that data the way its authors meant.

---

## Open questions deferred

- **Truncation HTML-awareness**: if the first-sentence regex slices mid-`<p>`, the rendered output may have an unclosed tag (browsers auto-close, but it's not ideal). Park; revisit if HITL surfaces a real case.
- **Sanitisation for defence-in-depth**: even though the trust posture is "internal authors", a strict allowlist (`<p>`, `<strong>`, `<em>`, `<a href>`, `<br>`, `<ul>`, `<li>`) via `sanitize-html` or DOMPurify would belt-and-brace against a future MariaDB compromise / CMS misuse. Add to the pre-launch hardening list as a separate Tier 3 if Swoop's legal review wants it before M5.