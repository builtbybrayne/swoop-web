# 03 — Execution: D.t3 — PoC widget port

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: D (chat surface).
**Task**: t3 — port the four PoC widget families to assistant-ui's tool-call registry.
**Implements**: `planning/02-impl-chat-surface.md` §2.2.
**Depends on**: D.t1 (scaffold), D.t2 (part rendering), A.t2 (tool I/O schemas).
**Produces**: Four widget renderers wired to the `search`, `get_detail`, `illustrate`, `handoff` tool calls. Uses PoC widgets as wireframes/IA reference, not as drop-in components.
**Unblocks**: D.t4 (disclosure + consent UX — lead-capture widget is the substrate).
**Estimate**: 4–5 hours.

---

## Purpose

When the orchestrator's tool call arrives as a `tool-call` message part, render a React widget. Four widgets cover the Puma tool set. Each widget is a **rebuild** — not a copy — of the equivalent PoC widget, rebuilt in clean React + Tailwind with vanilla styling so Swoop's in-house team can apply brand identity on top.

---

## Deliverables

### `product/ui/src/widgets/`

| File | Tool | What it renders |
|---|---|---|
| `widgets/search-results.tsx` | `search` | List of Trip / Tour / Region cards. Summary + thumbnail + "learn more" CTA per card. Responsive grid or stack. |
| `widgets/item-detail.tsx` | `get_detail` | Single-item focused view. Hero image, title, summary, attributes table (duration, regions, activities, budget band), gallery strip. Links to `search` follow-ons. |
| `widgets/inspiration.tsx` | `illustrate` | Image carousel with mood tags. Curated set of images matching the agent's mood/keyword query. Tap-to-expand. |
| `widgets/lead-capture.tsx` | `handoff` / `handoff_submit` | Two-step. Step 1: pre-filled conversation summary + verdict-aware intro. Step 2: contact form (name, email, preferred contact method) + secondary consent tickbox + marketing opt-in. Submits via `handoff_submit`. |

### Widget registration

`product/ui/src/widgets/index.ts` — registers each widget with assistant-ui's tool-call registry (`makeAssistantToolUI({ toolName, render })` or equivalent current API).

Imported by `App.tsx` from D.t1.

### Shared primitives

`product/ui/src/shared/` — minimal shared components used across widgets:
- `Card.tsx` — generic card wrapper.
- `ImageBlock.tsx` — handles image loading + fallback.
- `AttributeTable.tsx` — key-value grid.
- `CtaButton.tsx` — clickable affordance.

No `SwoopBranding.tsx` yet — Swoop's team adds branding post-M5. D.t8 documents the extension surface.

### Deep-link handling

`search-results` and `item-detail` cards include a "go see this page" link if the tool response carries a `publicUrl` field (chunk C's deep-link output). Link opens in a new tab by default (per D.2 — no cross-page persistence in Puma).

### Tests

`widgets/__tests__/*.test.tsx` — one focused test per widget:
- Renders with fixture data from `@swoop/common/fixtures`.
- Exercises the CTA / interaction path.
- `lead-capture.tsx`: form validation, consent tickbox required, submit calls the handler.

---

## Key implementation notes

### 1. PoC as wireframe, not source

Open `chatgpt_poc/product/ui-react/src/widgets/` to understand information architecture — what fields each widget needs, how data is arranged. **Don't copy the TSX.** Rebuild in vanilla React + Tailwind. The PoC's styling is ChatGPT-aligned; we want neutral.

### 2. Tool response shape

Each widget receives `structuredContent` matching the tool's Zod output schema (`@swoop/common/src/tools.ts`). Validate at render boundary — if schema drift causes a malformed response, the widget renders a "this content couldn't be displayed" placeholder rather than crashing.

### 3. Lead-capture's two steps

Step 1 is the handoff preview — summary, motivation anchor, verdict badge. Step 2 is the form. A single component manages the state machine; two views conditionally rendered.

### 4. Lead-capture's consent tickbox

The **secondary** (tier-2) consent lives here (per chunk E §2.3). Submit is disabled until the tickbox is checked. Marketing opt-in is separate, unticked by default, doesn't gate submit.

### 5. No disclosure UX in lead-capture

Tier-1 (primary) consent happens at conversation start (D.t4), not here. This widget only captures the tier-2 handoff-specific consent.

### 6. Image loading

Use `loading="lazy"` for below-fold images. Graceful fallback for missing/broken URLs. Don't build a full CDN abstraction — Swoop's imgix or equivalent CDN handles URL transformations; the widget just renders `<img src={url} />`.

### 7. Tool-call lifecycle states

Tool-call parts have three lifecycle states. Widgets render:
- `input-streaming` — nothing or a subtle loading placeholder.
- `input-available` — still nothing; the tool hasn't responded yet.
- `output-available` — render the widget proper.

assistant-ui's tool-call registry API may express this differently; adapt to current docs.

---

## References

- `chatgpt_poc/product/ui-react/src/widgets/` — IA reference only.
- `@assistant-ui/react` tool-call UI docs.
- `planning/02-impl-chat-surface.md` §2.2 table.
- `@swoop/common/src/tools.ts` — tool I/O schemas.
- `@swoop/common/src/fixtures/` — sample data.

---

## Verification

1. Orchestrator triggers `search` with a stub connector response → `search-results` widget renders cards, images visible, CTAs clickable.
2. `get_detail` → `item-detail` widget renders focused view.
3. `illustrate` → `inspiration` carousel renders images with mood tags.
4. `handoff` → `lead-capture` widget renders step 1 (summary). Continue → step 2 (form).
5. In lead-capture: submit disabled without consent tickbox; enabled with it. Submit calls `handoff_submit`.
6. Deep-link CTA opens in new tab when tool response includes `publicUrl`.
7. Mobile viewport (375px) — widgets reflow, no horizontal scroll.
8. Keyboard navigation: Tab moves through widget interactive elements in logical order.
9. Widget tests all pass.
10. `grep -rn "SwoopBranding" product/ui/src/` — zero matches (no branding in D.t3).

---

## Handoff notes

- Don't port PoC widget styling. Fight the temptation.
- Don't inline brand content — widget copy comes from content/config, not hardcoded strings.
- Don't add animations beyond transitions — widget-level animation is out of scope.
- If a widget needs a field the tool I/O schema doesn't expose, raise a `ts-common` PR — don't invent local fields.
- Post-D.t3, Swoop's in-house team's hook into brand styling is documented in D.t8.
