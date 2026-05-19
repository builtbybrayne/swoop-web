# 03 — Crosscut: handoff lead-capture form polish (frosty-leavitt worktree)

**Status**: DRAFT 2026-05-19 — authored ahead of execution, this session.
**Worktree**: `claude/frosty-leavitt-113411`.
**Pairs with**: existing handoff Tier-3 spine — [03-exec-handoff-t1.md](03-exec-handoff-t1.md), [03-exec-handoff-t2-t3.md](03-exec-handoff-t2-t3.md), [03-exec-chat-surface-t3.md](03-exec-chat-surface-t3.md) (D.t3 lead-capture port), [03-exec-e-t1-wire-tightening.md](03-exec-e-t1-wire-tightening.md). Closes the [inbox.md 2026-05-14 entry](../inbox.md) calling for a Tier-3 plan on the "Anything else?" textarea before execution.

**Filename suffix `-frosty-leavitt-`** stamps worktree provenance per the 2026-05-13 brave-pare convention. Topic: handoff lead-capture form polish — a five-item brief landed live ahead of the 2026-05-20 demo.

---

## ★ Read this first — the brief from Alastair

Verbatim, 2026-05-19 mid-morning:

1. Today's widget is a two-step form (summary preview → contact form). **We don't want the first step at all.** Straight to the form.
2. The summary still goes to the specialist — but should be **formatted and broken down into headed sections** for easier reading by a human.
3. The form **can carry a short precis** of the main decision points in an expandable section — a way of reassuring the visitor their preferences have been captured. **This precis must only capture the logistical / practical / choices / decisions / constraints from the user; nothing like the archetypes or any "profiling" of the user.** The precis is **not** sent to the specialist.
4. Add a textarea: **"Anything else the specialist should know?"** Free text, optional. Sent to the specialist.
5. Consent copy edit: *"I agree Swoop can share my conversation summary..."* → *"I agree my conversation summary can be shared with..."*

The work is multi-workspace — UI, `@swoop/common` schemas, connector payload, orchestrator route, CMS email templates, CMS tool description, WHY system prompt §9, plus tests across `@swoop/ui` + `@swoop/common` + `@swoop/orchestrator`.

---

## Why this plan now

Demo tomorrow (2026-05-20) with Luke. Handoff started firing today after the manual skills-prompt injection landed (commit `e5acaa1`); first end-to-end run surfaced the two-step UX as friction-heavy for visitors and the email body as field-row-list rather than narrative. The five-item brief above is the polish that gets the lead-capture surface to demo bar.

---

## Schema split — the load-bearing design call

Today's `HandoffInputSchema` (in [product/ts-common/src/tools.ts](../product/ts-common/src/tools.ts)) carries one summary field:

```ts
const HandoffInputCommonFields = {
  conversationSummary: z.string(),
  motivationAnchor: z.string(),
} as const;
```

`conversationSummary` is the same blob today's widget renders in step 1 AND becomes `reason.text` in the durable record + email. After this change, the visitor and the specialist see different summaries — so the agent produces both, and the wire shape grows to match.

**Rename + split**:

| Today | After this change | Audience | Substrate |
|---|---|---|---|
| `conversationSummary` | **`specialistSummary`** (renamed, same field index) | Specialist only | Rich, sectioned, includes archetype reads + motivation texture + signal-pattern reads + direct quotes |
| — | **`visitorPrecis`** (new, optional on the agent side, required on qualified / referred_out widget render) | Visitor only | Short, logistical / practical / decisions / preferences. **MUST NOT** carry archetype reads, relational-mode reads, motivation interpretations, or any profile-of-the-visitor content. |
| — | **`additionalNotes`** (new, **wire-only** — not produced by the agent) | Specialist only | Free-text from the visitor's "Anything else?" textarea. Optional. |

Rename is a clean break. The rationale: keeping `conversationSummary` and quietly repurposing its meaning via the tool description is more confusing for future readers than renaming. Decision is **rename** per the 2026-05-19 conversation.

Length caps mirror the existing pattern: `specialistSummary` keeps the 500-char limit at the wire (`HandoffSubmitRequestSchema.reasonText`), `additionalNotes` matches at 2000 (close to `motivationAnchor`'s cap), `visitorPrecis` at 500.

Both `additionalNotes` and `visitorPrecis` are persisted to the durable record for audit. The email template renders `additionalNotes` only — `visitorPrecis` is for the visitor's eyes alone but lives in the JSON record for future analytics on what was shown.

---

## File-by-file change list

### 1. `product/ts-common/src/tools.ts`

`HandoffInputCommonFields` becomes:

```ts
const HandoffInputCommonFields = {
  specialistSummary: z.string(),
  visitorPrecis: z.string().optional(),
  motivationAnchor: z.string(),
} as const;
```

All four `HandoffInput<Verdict>Schema` variants pick up both new fields. `visitorPrecis` is optional on the schema — `disqualified` / `inconclusive` don't render the widget, so the agent is free to omit it on those; on `qualified` / `referred_out` the tool description steers it to be present.

### 2. `product/ts-common/src/handoff.ts`

- `HandoffPayloadCommon` gains:
  ```ts
  visitorPrecis: z.string().max(500).optional(),
  additionalNotes: z.string().max(2_000).optional(),
  ```
- `HandoffSubmitRequestCommonFields` gains:
  ```ts
  visitorPrecis: z.string().max(500).optional(),
  additionalNotes: z.string().max(2_000).optional(),
  ```
- `reasonText` field stays as the wire name for `specialistSummary` (the widget assembles `reasonText: args.specialistSummary` — same indirection that exists today for `conversationSummary`).

### 3. `product/ts-common/src/fixtures/handoff.sample.ts`

Update the sample payload + sample submit request to carry plausible `visitorPrecis` + `additionalNotes` strings.

### 4. `product/ui/src/widgets/lead-capture.tsx`

- Drop `Step` state + the `"summary"` branch entirely. Drop the "Back" button.
- Drop the visible `motivationAnchor` block.
- Keep `VERDICT_INTRO` at the top — it's a per-verdict signpost, not a step.
- New `<details>` block, default-collapsed, labelled *"Show what we'll share with the specialist"* — renders `args.visitorPrecis` (with a graceful fallback paragraph if absent: *"A summary of what you've told us will be shared."*).
- New `<textarea>` rows={3}, optional, labelled *"Anything else the specialist should know? (optional)"*. State variable `additionalNotes`. Trimmed and sent only if non-empty.
- Consent label updated to: *"I agree my conversation summary can be shared with a Swoop specialist so they can follow up."*
- Submit body assembly: `specialistSummary: args.specialistSummary` (was `conversationSummary`); add `visitorPrecis: args.visitorPrecis || undefined`; add `additionalNotes: additionalNotes.trim() || undefined`.
- `reasonText: args.specialistSummary` (the wire field name stays).

### 5. `product/ui/src/widgets/__tests__/lead-capture.test.tsx`

- Remove every `step="summary"` / "Continue" assertion.
- Add: initial render goes straight to the form; precis disclosure renders when `visitorPrecis` is present; textarea submits with `additionalNotes`; consent copy text matches new string.
- Add: missing `visitorPrecis` falls back to the generic paragraph and still allows submit.

### 6. `product/cms/templates/handoff/qualified.md`

Restructure to narrative sections (replaces the all-caps banner + field-row format):

```
## New lead — {{contact.name}} ({{reason.code}})

### Conversation summary
{{reason.text}}

### Why this trip, why now
{{motivationAnchor}}

### What they shared
- Independence: {{visitorIndependence}}
- Budget band: {{visitorBudgetBand}}
- Activities: {{visitorActivities}}
- Regions: {{visitorRegions}}

### Wishlist
{{wishlistFormatted}}

### Anything else they wanted you to know
{{additionalNotesOrNone}}

### Contact
- Name: {{contact.name}}
- Email: {{contact.email}}
- Phone: {{contactPhoneOrDash}}
- Prefers: {{contactPreferredMethod}}
- Time-zone hint: {{contactTimeZoneOrDash}}

### References
- Handoff ID: {{handoffId}}
- Session ID: {{session.sessionId}}
- Turn count: {{session.turnCount}}
- Started: {{session.conversationStartedAt}}
- Submitted: {{session.handoffSubmittedAt}}
- Conversation ref: {{session.rawConversationRef}}
- Entry URL: {{sessionEntryUrlOrDash}}

### Consent
- Conversation: granted at {{consent.conversationTimestamp}} (copy v{{consentCopyVersionOrDash}})
- Handoff: granted at {{consent.handoffTimestamp}}
- Marketing: {{marketingConsentLabel}}

---
Sent automatically by the Swoop Patagonia discovery agent. The visitor has explicitly consented to this contact (tier-2 consent at handoff time).
```

`additionalNotesOrNone` is a new template-renderer field that returns the trimmed text or the literal `"—"` when absent.

### 7. `product/cms/templates/handoff/referred-out.md`

Same restructure pattern, lighter "Referral" framing in the header (`## Referral — {{contact.name}} ({{reason.code}})`). Same new `Anything else they wanted you to know` block.

### 8. `product/connector/src/handoff/template-renderer.ts` (or wherever the substitution lives)

- Add `additionalNotesOrNone` substituter: returns `payload.additionalNotes?.trim() || "—"`.
- No change to `visitorPrecis` rendering — never appears in the email.

### 9. `product/orchestrator/src/server/handoff-submit.ts`

- Accept `visitorPrecis` + `additionalNotes` on the wire (already covered by the schema change in step 2).
- Enrich into `HandoffPayload` before persistence — pass-through, no derivation.

### 10. `product/cms/prompts/tools/handoff/description.md`

Add a "Two summaries: who sees what" paragraph at the end of the existing description:

> Produce both `specialistSummary` and `visitorPrecis` on every `qualified` / `referred_out` call.
>
> - **`specialistSummary`** is for the Swoop specialist who will pick up the conversation. Rich, sectioned-friendly prose. Include archetype reads, relational-mode reads, the motivation arc, direct quotes from the visitor, and the texture of what moved them. The visitor never sees this.
>
> - **`visitorPrecis`** is shown to the visitor (collapsed by default) as reassurance their choices have been captured. **MUST** contain only logistical / practical content: destinations, travel windows, duration, budget band if shared, activity preferences, accommodation style, party composition. **MUST NOT** carry archetype reads, relational-mode reads, motivation interpretations, or any profiling of the visitor. Use the visitor's own phrasings; keep it under ~300 chars.

On `disqualified` / `inconclusive` the widget doesn't render, so `visitorPrecis` is optional in those cases — `specialistSummary` still feeds the durable record.

### 11. `product/cms/prompts/system/00_why.md` §9 "What you capture"

After the existing **MUST capture** / **SHOULD include** lists, add a short paragraph naming the two-summary distinction with the same rule as the tool description (logistical-only for the visitor; archetype-rich for the specialist). The detailed lists already in §9 apply to `specialistSummary`.

### 12. Other touch-points to sweep

- `product/orchestrator/src/server/__tests__/handoff-submit.test.ts` — extend round-trip tests for the two new fields.
- `product/ts-common/src/__tests__/handoff-schema.test.ts` + `fixtures.test.ts` — extend for the new fields + the rename.
- `product/connector/src/handoff/__tests__/` — extend for the template-renderer's new `additionalNotesOrNone` mapping.
- `product/harness/scenarios/*.yaml` — none should reference `conversationSummary` directly today (the wire field stays `reasonText`); double-check.
- WHY prompt §9 is the only system-prompt change.

---

## Order of execution

Single agent, sequential to keep the rename atomic across schemas + consumers:

1. **Schemas first** — rename `conversationSummary` → `specialistSummary` in `tools.ts`; add the two new fields in `handoff.ts`; update fixtures. **Run typecheck** — failures surface every consumer that needs the rename.
2. **UI widget rewrite** — single-step render + textarea + precis disclosure + consent copy + new submit body. Update tests.
3. **Connector + template-renderer** — `additionalNotesOrNone` substituter; pass-through enrichment for the two new fields.
4. **Email templates** — restructure both `qualified.md` + `referred-out.md`.
5. **Orchestrator route** — wire shape update + tests.
6. **CMS content** — tool description appendix + WHY §9 paragraph.
7. **Verification** — typecheck + tests across all touched workspaces.

---

## Verification

Per the [fresh-install lesson](../discoveries.md):

```sh
cd product
npm run typecheck --workspaces --if-present
npm test --workspace=@swoop/common
npm test --workspace=@swoop/ui
npm test --workspace=@swoop/connector
npm test --workspace=@swoop/orchestrator
```

**Acceptance**:

1. Typecheck clean across every workspace.
2. `lead-capture.test.tsx` renders the form directly on first render — no `step="summary"` element in the tree.
3. The textarea is present, optional, and the form submits without it filled in.
4. The consent label reads *"I agree my conversation summary can be shared with..."* verbatim.
5. The precis `<details>` block renders `visitorPrecis` when present and the fallback text when absent.
6. A round-trip through `POST /handoff/submit` with both new fields populated produces a durable record carrying both fields and an email body containing `additionalNotes` under the new "Anything else they wanted you to know" section.
7. The email body's "Conversation summary" section renders `specialistSummary` content (via `reason.text`), NOT `visitorPrecis`.
8. `visitorPrecis` appears in the durable record JSON, but never in any rendered email body.

---

## What this plan deliberately does NOT do

- **No mailer flip-on.** `HANDOFF_EMAIL_ENABLED` stays off by default; the durable record + dev-time stdout log of the rendered email body are the demo-visible artefacts.
- **No legal copy review.** Consent copy edit is a one-string change; the broader legal-counsel sign-off (E.t9) still gates M5.
- **No evalset growth.** The validator scenarios at `product/harness/scenarios/agent-*.yaml` may want updating to assert on the new field shapes; deferred to a follow-up cleanup pass alongside the [2026-05-18 inbox entry](../inbox.md) about assertion-authoring quality.
- **No additional consent tiers.** Tier-1 (conversation) stays at the opening screen; tier-2 (handoff) stays at the form's existing tickbox, just with refined copy.
- **No precis-derivation server-side.** The agent produces `visitorPrecis` directly; no derivation from `specialistSummary`. The agent is responsible for honouring the logistical-only rule per the tool description.

---

## Decision IDs

To be assigned at merge. Likely range: **E.16–E.19**.

- E.16 — Single-step lead-capture form (drops the summary-preview step).
- E.17 — Two-summary split in agent tool args (`specialistSummary` + `visitorPrecis`).
- E.18 — Free-text `additionalNotes` field from the visitor's "Anything else?" textarea.
- E.19 — Email template restructure into narrative sections (`qualified.md` + `referred-out.md`).

---

## Provenance

- Brief verbatim from Alastair, 2026-05-19 mid-morning conversation.
- Builds on [inbox.md 2026-05-14 entry](../inbox.md) calling for the textarea Tier-3 plan.
- Multi-workspace touch list confirmed via Cowork-session exploration of `lead-capture.tsx`, `tools.ts`, `handoff.ts`, both email templates, `tools/handoff/description.md`, and `00_why.md` §9.
