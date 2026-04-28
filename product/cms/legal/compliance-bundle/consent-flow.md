# Consent flow

Puma's two-tier consent model + the optional marketing opt-in. Source: `planning/02-impl-handoff-and-compliance.md` §2.3 + decision E.4.

The model exists because session state begins accumulating conversation data the moment a visitor types. GDPR requires a lawful basis *before* processing, not at handoff. Deferring consent to handoff would mean processing personal data without a basis.

Puma's posture: explicit consent up front for the conversation layer (tier 1), then a more specific consent at handoff for contact-detail submission (tier 2), with marketing opt-in always separate and unticked.

---

## Tier 1 — Conversation-start consent

**Triggered**: on first iframe load, before any visitor message can be sent. Paired with the AI disclosure on the same opening screen.

**What the visitor sees** (rough — the authoritative copy lives in `product/cms/legal/disclosure-opening.md`):

> You're talking to an AI assistant, not a human. We'll keep a record of this conversation to help our specialists understand what you're looking for.
>
> [link: How we use your data]
>
> [Continue]   [No thanks]

**What's collected**: a single boolean — has the visitor clicked Continue?

**What's stored** (in session state on `Continue`):

```
session.consent.conversation = {
  granted: true,
  timestamp: <ISO8601>,
  copyVersion: <hash of disclosure-opening.md at the time>
}
```

If the visitor clicks **No thanks**: no session is created, no record is written, the iframe closes the chat surface cleanly. There is no "no thanks" record to retain.

**Lawful basis covered**: GDPR Art. 6(1)(a) explicit consent for storage + processing of conversation history. EU AI Act Art. 50 disclosure (see `disclosure-art50.md`) is satisfied on the same screen.

**Withdrawal**: visitor can refresh / close the iframe at any time → session expires under the 24h-idle TTL → archived → deleted under the 7-day archive TTL. Faster deletion is via the right-to-erasure runbook.

---

## Tier 2 — Handoff consent

**Triggered**: when the agent invokes the `handoff` tool and the lead-capture widget renders inside the chat surface. Visitor must complete this consent before `handoff_submit` will fire.

**What the visitor sees** (authoritative copy in `product/cms/legal/consent-handoff.md`):

> [ ] I consent to Swoop contacting me about this enquiry and storing my contact details for that purpose.

This tickbox is **required** — the submit button is disabled until it is ticked.

**What's collected**: visitor's name, email, optional phone, optional time-zone hint, consent boolean.

**What's stored**:

1. **In session state** (transient, until handoff submits):
   ```
   session.consent.handoff = {
     granted: true,
     timestamp: <ISO8601>,
     copyVersion: <hash of consent-handoff.md at the time>
   }
   ```

2. **In the durable handoff record** (snapshot at submission, persists per `retention-policy.md`):
   ```
   handoff.consent = {
     conversationGranted: true,
     conversationTimestamp: <from session.consent.conversation>,
     handoffGranted: true,
     handoffTimestamp: <as captured above>,
     marketingGranted?: <see below>,
     marketingTimestamp?: <as below>,
     consentCopyVersion: <combined hash>
   }
   ```

The schema lives at `product/ts-common/src/handoff.ts` (`HandoffConsentSchema`). The snapshot pattern means a future change to the consent copy doesn't retroactively change what we recorded a visitor agreed to.

**Lawful basis covered**: GDPR Art. 6(1)(a) explicit consent for the specific act of contact-detail submission + outreach.

**Withdrawal**: same as tier 1 — visitor can request erasure at any time via the runbook.

---

## Marketing opt-in (separate)

**Triggered**: alongside the tier-2 handoff consent, in the same lead-capture widget. **Unticked by default.**

**What the visitor sees** (authoritative copy in `product/cms/legal/consent-marketing.md`):

> [ ] I'm happy to receive occasional Swoop travel updates.

**Required?** No. The submit button works whether or not this is ticked.

**What's stored** (in the handoff record only — there's no analogue in session state because marketing opt-in has no in-session effect):

```
handoff.consent.marketingGranted = true | false
handoff.consent.marketingTimestamp = <ISO8601 if granted>
```

**Lawful basis**: GDPR Art. 6(1)(a) explicit consent for marketing communications. PECR Reg. 22 also applies for electronic marketing in the UK; consent must be specific, informed, and freely given. Granular separation from the tier-2 consent is what makes this compliant.

**Withdrawal**: any future Swoop marketing communication must include an unsubscribe mechanism. That is Swoop's marketing-platform responsibility, not Puma's. Puma's role ends at capture.

---

## Backstops

The flow has three layers of belt-and-braces protection:

1. **UI-side**: chunk D (`product/ui`) prevents the chat surface from sending messages until tier-1 consent is granted; prevents handoff submission until tier-2 consent is ticked.

2. **Orchestrator-side**: the `/chat` endpoint refuses to process messages on a session whose `session.consent.conversation !== true`. The `/handoff/submit` endpoint refuses payloads whose `consent.conversationGranted !== true` OR `consent.handoffGranted !== true`. Implemented via `HandoffSubmitConsentGate` from `ts-common`.

3. **Connector-side**: `submitHandoff()` re-validates the consent gate before writing to the durable store and before sending email. A bug above doesn't write a non-consented record.

The redundancy is deliberate. Each layer can be reasoned about independently. A regression in one layer doesn't expose a non-consented record.

---

## Audit / `copyVersion`

Every consent record includes a `copyVersion` — a hash (or rev-id) of the consent copy file as it stood at the moment consent was given. This means:

- A future change to `disclosure-opening.md` or `consent-handoff.md` does not retroactively re-write the record of what a specific visitor saw.
- For any historical handoff record we can answer: "exactly what text was this visitor presented with when they clicked Continue / ticked the box?".
- Counsel asking "did the consent copy meet GDPR Art. 7 information-conditions on date X?" can be answered by retrieving the corresponding copy version.

Implementation note: hashing is done at copy-load time inside the orchestrator (`product/orchestrator/src/cms/`) — not by the UI — so the version is server-authoritative.

---

## Screenshots

**Reserved.** Screenshots of the live disclosure / consent screens will be added to `screenshots/` before this bundle is sent to counsel. The intended set:

- `screenshots/01-disclosure-opening.png` — the paired AI-disclosure + tier-1 consent screen.
- `screenshots/02-chrome-badge.png` — the persistent chrome badge during conversation.
- `screenshots/03-lead-capture-widget.png` — the tier-2 consent + marketing opt-in inside the lead-capture widget.
- `screenshots/04-privacy-info-modal.png` — the privacy-info content visitors see when they click the link from the disclosure screen.

TODO: Al to capture screenshots when D.t4's lead-capture flow lands (or sooner against the current preview if the surfaces are stable).

---

## Cross-reference

- Visitor-facing copy: `product/cms/legal/disclosure-opening.md`, `consent-handoff.md`, `consent-marketing.md`, `privacy-info.md` (all authored by E.t5).
- Schema: `product/ts-common/src/handoff.ts` (`HandoffConsentSchema`, `HandoffSubmitConsentGate`).
- Implementation:
  - UI consent flow: `product/ui/src/disclosure/` (D.t4 / D.t5).
  - Orchestrator gate: `product/orchestrator/src/server/chat.ts` + `handoff.ts` (B + E.t4).
  - Lead-capture widget: chunk D §2.4 + E.t4.
- Decisions: E.4 in `planning/02-impl-handoff-and-compliance.md` §5.
- EU AI Act overlap: `disclosure-art50.md` (this bundle).
