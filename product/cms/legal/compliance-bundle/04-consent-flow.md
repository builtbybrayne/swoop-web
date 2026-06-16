# 04 — Consent Flow

> **Status: 🔴 BLOCKED / PLACEHOLDER**
>
> **Blocked on**: E.t5 (legal copy authoring) — real copy required for non-misleading screenshots. Once E.t5 lands, screenshots can be captured against the real copy.
>
> **What lands here when E.t5 closes**: screenshot files in `screenshots/`, inline-referenced from each step below; copy excerpts replaced with the real copy from §03.

---

## Step-by-step consent journey

The textual walkthrough below is **fillable now** — it describes the flow, mechanics, and decisions independent of the specific words. The screenshots and quoted copy are the blocked elements.

### Step 1 — Tier-1 disclosure + consent screen

**When**: Visitor's first visit to the chat surface (or after clearing cookies / new browser).

**What the visitor sees**:
- Full-screen modal or in-iframe screen, no other chat affordances visible.
- AI disclosure (EU AI Act Art. 50): "You're talking to an AI assistant, not a human."
- Conversation-data consent (GDPR primary): notice that messages are processed to answer, and that the chat is retained for a while — anonymised before any internal analysis — to check the assistant is working well.
- Privacy-info link.
- Two buttons: **Continue** | **No thanks**.

**What happens on Continue**:
- Tier-1 consent record written to session state: `consent.conversation = true`, timestamp, copy version id.
- Conversation surface renders. First message can be sent.

**What happens on No thanks**:
- No session state written.
- Chat closes cleanly. Optional: a courtesy message + a link to Swoop's regular contact form.

**Backstop**: orchestrator's `/chat` endpoint rejects any request from a session without `consent.conversation === true`.

**Screenshot slot**: `screenshots/01-tier1-disclosure.png` (PLACEHOLDER).

### Step 2 — Persistent chrome tag

**When**: Throughout the conversation, every turn.

**What the visitor sees**:
- Small persistent banner / tag at the top of the chat surface: "AI assistant · [info link]" or equivalent.
- Always visible — cannot be dismissed or scrolled past.

**Why**: EU AI Act Art. 50 requires the AI nature to remain disclosed throughout the interaction, not just at the start. Chrome tag is the persistent surface.

**Screenshot slot**: `screenshots/02-chrome-tag.png` (PLACEHOLDER).

### Step 3 — Conversation proceeds

**When**: Steps 1-2 complete; visitor is talking to the agent.

**What the visitor sees**: standard chat UX (visitor messages right-aligned, agent responses left-aligned, tool-call widgets render inline).

**No new consent prompts** at this stage. The agent's tool calls (search, get-detail, illustrate) do not produce new consent moments — they're internal mechanics.

### Step 4 — Agent triggers handoff (lead-capture widget)

**When**: The agent's reasoning + the triage classifier converge on a handoff verdict (`qualified` or `referred_out`).

**What the visitor sees**:
- The lead-capture widget renders inline in the chat surface as a tool-call widget.
- Form fields: Name + Email (required), Phone (optional), an "Anything else?" free-text note (optional), and a collapsible "what you've told us" précis.
- **Inline consent notice** by the Send button ("Clicking 'Send my details' shares your conversation summary with a Swoop Planning Specialist…") — **submission is the tier-2 consent**; no tickbox. Marketing opt-in removed 2026-06-16.
- **Send** button (enabled once Name + Email are valid).
- **Cancel** affordance (returns to conversation without submitting).

**Decision reference**: E.4 (two-tier consent). Tier-2 consent is now the affirmative act of submitting the form after the inline notice — no separate tickbox.

**Screenshot slot**: `screenshots/03-handoff-widget.png` (PLACEHOLDER).

### Step 5 — Visitor submits

**Visitor action**: clicks Send.

**Client-side**:
- Tier-2 consent timestamp captured at click moment via `new Date().toISOString()` (decision **E.15**).
- POST to `/handoff/submit` with: name + email (+ optional phone + note) + tier-2 consent flag (granted by the act of submitting) + timestamp + copy version + agent-args bundle + session id.

**Server-side**:
- Orchestrator validates against `HandoffSubmitRequestSchema` (`.strict()`).
- Looks up session by id. Verifies tier-1 consent. Enriches payload from session state (handoff id, tier-1 timestamp, conversation start, turn count, wishlist, entry URL).
- Backstop: rejects if `consent.conversation !== true || consent.handoff !== true`.
- Calls `submitHandoff()` from connector.

**`submitHandoff()`**:
- Writes durable record to handoff store (`FsHandoffStore` today; `PostgresHandoffStore` post-IAM).
- If email enabled: sends verdict-aware email via SMTP.
- Emits `handoff.submitted` structured event to Cloud Logging.

### Step 6 — Confirmation + return to conversation

**What the visitor sees**:
- Confirmation card replaces the widget: "Thanks — a Swoop specialist will be in touch."
- Conversation can continue (agent thanks the visitor, may suggest preparation tips, etc.).

**Failure mode**: if submit fails (network, validation, server error), inline error in the widget with retry affordance — no agent retry logic, no SSE bouncing.

**Screenshot slot**: `screenshots/04-confirmation.png` (PLACEHOLDER).

---

## Tier-1 declined path (Step 1 → No thanks)

- No session state.
- No further interaction with Puma.
- Visitor remains on Swoop's marketing site; standard contact channels available.

**Screenshot slot**: `screenshots/05-tier1-declined.png` (PLACEHOLDER) — optional, may not need a separate screenshot if the close is non-visual.

---

## Withdrawal of consent (post-acceptance)

### Tier-1 withdrawal during conversation

**Mechanism**: dedicated control in the chat UI — "End conversation" or similar. **Confirm with counsel whether this control needs more prominence.**

**On withdrawal**:
- Session state immediately deleted.
- Chat closes.
- No further processing.

### Tier-2 withdrawal post-handoff

**Mechanism**: visitor emails Swoop's privacy contact (per [08-data-subject-rights.md](08-data-subject-rights.md)).

**On withdrawal**:
- Erasure runbook executed (E.t7, currently parked).
- Handoff record deleted from store.
- Confirmation sent to visitor.

---

## Backstops summary

Every personal-data write to the durable store is gated by **two enforced backstops**:

1. **Orchestrator route** (`/handoff/submit`) rejects 4xx if `consent.conversation !== true` OR `consent.handoff !== true`.
2. **Connector `submitHandoff()`** rejects via `HandoffSubmitConsentGate` runtime check before any store/mailer side-effect.

Both layers exist deliberately (belt-and-braces). Either layer alone would prevent unauthorised processing; the duplication protects against future refactors that might inadvertently bypass one layer.

---

## When this section unblocks

- E.t5 lands → real copy in `cms/legal/`.
- Screenshots captured in dev preview against real copy.
- Files dropped in `screenshots/` per the naming convention above.
- Section status updates ✅ FILLED in [README](README.md) document map.

---

## Screenshot naming convention (forward-defined)

| Filename | Captures | Status |
|---|---|---|
| `screenshots/01-tier1-disclosure.png` | Step 1 modal | 🔴 Pending |
| `screenshots/02-chrome-tag.png` | Persistent chrome during conversation | 🔴 Pending |
| `screenshots/03-handoff-widget.png` | Lead-capture widget with the inline consent notice | 🔴 Pending |
| `screenshots/04-confirmation.png` | Post-submit confirmation | 🔴 Pending |
| `screenshots/05-tier1-declined.png` | Tier-1 declined close screen (if visual) | 🔴 Pending — optional |

PNG, 2x retina if practical. Annotations welcome but not required.
