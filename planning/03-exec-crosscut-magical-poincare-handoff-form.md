# 03 — Crosscut: handoff form round 2 (Luke Loom feedback, 2026-06-10)

**Status**: DRAFT — pending HITL ratification.
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) items L1, U1, U2, U3, U4 + P1 (UI copy half).
**Builds on**: [03-exec-crosscut-frosty-leavitt-handoff-form-polish.md — the 2026-05-19 single-step form rework](03-exec-crosscut-frosty-leavitt-handoff-form-polish.md). This is round 2 on the same surface.
**Workspaces touched**: `@swoop/ui` (primary), `@swoop/connector` (mailer template conditional), `@swoop/harness` (fixtures), `@swoop/common` (no schema change — see §2.3).

---

## ★ Read this first

The whole task lives around one component: [product/ui/src/widgets/lead-capture.tsx](../product/ui/src/widgets/lead-capture.tsx). Five changes, all small, all client-visible. The only subtlety is §2.1 (render position), which is a *parts-ordering* problem, not a form problem.

The canonical specialist term is **"Swoop Planning Specialists"** (working value — Luke owes us his exact preferred wording by email; see [questions.md](../questions.md) "Planning Specialists terminology"). Centralise the string so a rename is one edit.

## 1. Outcomes

1. The lead-capture form renders **after** the agent's written response within the turn, not before (L1).
2. Form intro copy (qualified verdict): **"One of Swoop's Planning Specialists will answer your questions and pick up where we left off. Please share your details."** Sibling verdict intros re-voiced to the same register and terminology (U1 + P1).
3. No "Preferred contact method" control. Email stays required; phone stays optional (U2).
4. "Review what you've told us so far" sits **above** the "Anything else…" textarea (U3) and is **open by default** (still a collapsible `<details open>`); the notes textarea remains a plain, always-open field (U4).
5. Confirmation + consent copy sweep to the Planning Specialists term ("A Swoop Planning Specialist will be in touch.", consent line likewise).

## 2. Component-level scope

### 2.1 Render position (L1)

Problem mechanics: the booking-limit rule ([00_why.md §9](../product/cms/prompts/system/00_why.md)) correctly makes the agent fire `handoff` before writing its framing prose, so the tool-call part precedes the text parts in the assistant message and assistant-ui mounts the widget first. **Do not weaken the prompt rule.**

Fix at the presentation layer: within an assistant message, the lead-capture widget displays after the message's text parts.

- Preferred mechanism: CSS `order` — the message-parts container is (or becomes) a flex column; the lead-capture wrapper gets a high `order` value so it lays out last regardless of DOM position. Zero data-model change, streaming-safe (text streamed after the tool call simply appears above the already-mounted form).
- Fallback if the parts container can't take flex ordering without layout regressions: a custom message-parts renderer that partitions `handoff` tool parts to the tail. More invasive — only if CSS ordering fails.
- Scope guard: applies to the `handoff` widget only. Display widgets are already relocated to the sidebar by [02-impl-visual-sidebar.md](02-impl-visual-sidebar.md); their inline (mobile) ordering is untouched.
- Check the confirmation state too: after submit, the synthetic "(Form submitted.)" visitor turn triggers a follow-up agent turn — confirm the confirmation card + follow-up prose read in a sane order on screen.

**Decision (proposed) D.poincare-1**: lead-capture renders after text parts via presentation-layer ordering; prompt fire-first discipline unchanged.

### 2.2 Intro copy (U1 + P1)

`VERDICT_INTRO` in [lead-capture.tsx:53-67](../product/ui/src/widgets/lead-capture.tsx):

- `qualified`: "One of Swoop's Planning Specialists will answer your questions and pick up where we left off. Please share your details."
- `referred_out` / `disqualified` / `inconclusive`: re-voice minimally to match register; keep their distinct verdict semantics. Draft in-plan at execution; Alastair editorial pass at review.
- Confirmation card ([line 148](../product/ui/src/widgets/lead-capture.tsx)): "A Swoop Planning Specialist will be in touch."
- Consent line ([line 402](../product/ui/src/widgets/lead-capture.tsx)): "…shared with a Swoop Planning Specialist so they can follow up."
- Notes label stays visitor-plain: "Anything else the Specialist should know?" — judgement call at execution whether the full brand term reads naturally here; don't force it where it's clunky.
- Centralise the term: a `SPECIALIST_TERM` const (or small copy module) in `@swoop/ui` so Luke's final wording is a one-line change. **Content-as-data note**: visitor-facing copy in this widget is inline TSX today (a known item — the broader externalisation to `cms/` is part of the parked visitor-copy review, [next-steps.md §5](../next-steps.md)); don't expand scope to that here.

### 2.3 Remove preferred contact method (U2)

- Delete the radio fieldset ([lines 334-350](../product/ui/src/widgets/lead-capture.tsx)) + `preferredMethod` state; stop sending `contact.preferredMethod` in the POST body.
- **No schema change**: `preferredMethod` is `.optional()` on both `HandoffSubmitRequestSchema` and the durable-record contact schema ([handoff.ts:189](../product/ts-common/src/handoff.ts)). Leaving it in the schema keeps old durable records + fixtures valid. Tier-3 executor: grep for consumers that *render* it — [mailer.ts:289](../product/connector/src/handoff/mailer.ts) formats it into the specialist email; make that line render only-when-present (`formatOptional` may already do this — verify, and verify the email template doesn't show an empty "Preferred contact:" row).
- Harness/fixtures: update any scenario fixtures asserting `preferredMethod` (e.g. [lead-capture.test.tsx:202](../product/ui/src/widgets/__tests__/lead-capture.test.tsx)).

**Decision (proposed) E.poincare-2**: drop the preference *control*, keep gathering both channels (email required, phone optional); wire field retained as optional for record compatibility.

### 2.4 Section order + disclosure states (U3 + U4)

- Move the precis `<details>` block ([lines 377-390](../product/ui/src/widgets/lead-capture.tsx)) above the notes field ([lines 352-369](../product/ui/src/widgets/lead-capture.tsx)).
- Precis: `<details open>` — visible by default, collapsible by the visitor.
- Notes textarea: unchanged — plain open field (Alastair's call: the open field invites personal ownership of the handoff; ledger U4).
- Resulting form order: intro → name → email → phone → **review-precis (open)** → **notes** → consent ticks → submit.

## 3. Out of scope

- Prompt changes (the §9 booking-limit + handoff guidance belong to the [content plan](03-exec-content-t6-luke-loom.md); no overlap).
- Externalising widget copy to `cms/` (parked visitor-copy review item).
- Any change to verdict semantics, payload shape, or the durable record.

## 4. Verification

1. Unit: lead-capture tests updated — intro copy, no preferred-method control, section order (DOM order assertion), precis `open` attribute, POST body lacks `preferredMethod`.
2. Render-position: a component/integration test that an assistant message with parts `[tool-call(handoff), text]` displays text above the form (assert computed order or partitioned render), and the mobile/inline layout is unaffected for other widgets.
3. Mailer: unit test that the specialist email omits the preferred-method row when absent.
4. Live smoke (preview): booking-signal conversation → form appears **below** the agent's framing prose; submit → confirmation + follow-up turn ordering sane; specialist email (mailer disabled log path is fine) carries name/email/phone without preference row.
5. Full fresh-install workspace test run green (per [the swarm-merge verification memory](../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_swarm_fresh_install_verify.md) if this runs in a wave).

## 5. Estimate

~0.5 day including tests. No migration, no data work.
