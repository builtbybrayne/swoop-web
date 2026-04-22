# 03 — Handoff Schema

**Status**: Draft, v1. Evolution of the Phase 1 PoC `handoff` / `handoff_submit` pair, re-shaped for Patagonia triage and Swoop's own surface.
**Purpose**: Shape of the warm handoff from agent to Swoop's sales team. Triage states, schema, delivery mechanism, email template, consent.
**Depends on**: `01-architecture.md` §1 (data connector), §2 (WHY/HOW/WHAT); `02-data-access.md` for trip IDs and provenance tags; `04-legal-compliance.md` for persona-data handling.

---

## 0. Where this doc sits relative to the PoC

The Phase 1 (Antarctica) prototype already shipped a working handoff. This doc is **not a from-scratch design**. It takes the PoC's two-tool pattern as the base and makes the changes needed for the Patagonia website build. Points of evolution are called out explicitly against the PoC baseline.

**PoC baseline** (see `chatgpt_poc/product/mcp-ts/src/tools/handoff.ts`, `handoff-submit.ts`, `lib/mailer.ts`, `ts-common/src/tools.ts`, `ts-common/src/widgets.ts`):

- Two tools. `handoff` opens a lead-capture widget with a preview of the agent-generated summary. `handoff_submit` is called by the widget (not the model) once the user has supplied contact details, logs the lead to console and sends an email via nodemailer.
- Three free-text fields carry the conversational substance: `conversationSummary`, `discoveredPreferences`, `motivationStatement`. Plus `name`, `email`, optional `phone` on the submit step.
- Email body is plain text with sections: CONTACT / CONVERSATION SUMMARY / DISCOVERED PREFERENCES / MOTIVATION. Sent to `LEAD_EMAIL_TO`, from `SMTP_USER`, subject `Swoop Lead: {name} ({email})`.
- No triage verdict carried in the payload. In the Antarctica PoC this was deliberate: the sales team wanted *all* inquiries.
- No explicit in-chat consent step beyond the widget itself — the two-step (tool → widget → submit) was the consent surface, under OpenAI's consent umbrella.

What's kept, what's changing, and what's new is tracked through the rest of this document.

---

## 1. What the handoff is for

The agent's primary output is not conversation — it's a **warm lead delivered to sales**, shaped so the specialist can pick up the thread without re-interviewing the customer.

Carrying across from PoC:
- **Self-contained** — the specialist doesn't need to replay the transcript.
- **Motivation-centred** — `motivationStatement` is the single most valuable field for the sales team (per the PoC guidance payload). Keep it.
- **Warm, not cold-drop** — framing is VIP treatment, not funnel exit.

New for the website build:
- **Triage-aware** — Patagonia needs segmentation the Antarctica PoC didn't. Sales verdict travels with the lead.
- **Provenance-honest** — separates what the user said from what the agent imagined. Load-bearing guardrail from the discovery-agent brief.
- **Consent-logged** — the user's explicit yes to handoff is captured, not implicit.

---

## 2. Triage states

**Status: Settled in principle** (20 Apr kickoff). Specific thresholds leaning, open where flagged.

Every handoff carries a `triageState`. Three paths — a change from the PoC, which submitted everything.

### 2.1 `qualified` — email sales

Fits Swoop's Patagonia target market. Submit and email the sales inbox.

Who this is (from 20 Apr call):
- **Group-tour candidates**, including solo travellers who'd fit group tours (Luke: solo travellers are a group-tour lead — early identification is meaningful).
- **Tailor-made seekers** wanting private trips with full support. Existing core of the business.
- **Torres del Paine–focused** travellers (>80% of bookings involve TdP). Hikers doing the W, trekkers on the O circuit, soft-adventurers on wildlife + scenic.
- **Profit-plausible**: conversation signal suggests the booking could clear Swoop's >$1k profit threshold. This is a judgement call from budget/duration/accommodation tier signals — not a hard income filter.
- **Luxury Dec–Feb candidates** flagged for priority handling (inventory constraint — 6–12 month lead-times).

### 2.2 `referred_out` — logged, not (necessarily) emailed

Not a fit for Swoop's specialist service, but the agent has gracefully surfaced alternatives. Emerging strategy (20 Apr call): Swoop is developing a referral model for these.

Who this is:
- **Backpackers** — use the site but don't typically book high-cost services.
- **<$1k profit bookings** — negative contribution territory. Luke: bookings that yield less than $1,000 in profit have negative contribution; we need to refer them out.
- **Low-value trips** where Swoop's service cost isn't justified by what the client is willing to spend.
- **Out-of-region** — asking for destinations Swoop doesn't cover.

Handoff is **logged** (for product learning and referral-model feedback) but **does not email the sales inbox** in V1. When the referral product firms up, this state routes to that destination.

**Open**: whether `referred_out` ever emails at low priority, or always routes elsewhere. Depends on the referral model.

### 2.3 `disqualified` — logged, silent

No fit, no graceful alternative. Rare path. Not emailed.

- Clear tyre-kicking / explicit testing of the bot.
- Abuse, trolling, explicitly hostile.
- Requests Swoop doesn't and won't ever serve.
- Safety refusals handled in the WHY layer.

Logged only, for pattern analysis.

### 2.4 The Patagonia-vs-Antarctica difference (explicit)

PoC (Antarctica) wanted every inquiry in front of sales. Patagonia sales team explicitly does not — Luke's framing on the 20 Apr call: *"the Patagonia team needs the AI to perform triage to identify desired versus undesired inquiries in the discovery phase."* This is the single biggest schema-shape change from the PoC.

---

## 3. Handoff schema

Evolution of the PoC's three-string payload (`conversationSummary`, `discoveredPreferences`, `motivationStatement`) into a structured object. The three original fields are preserved in spirit — `motivationStatement` keeps the same name; `discoveredPreferences` becomes the structured `wishlist`; `conversationSummary` moves into `conversation`.

```ts
interface Handoff {
  // Envelope
  handoffId: string;              // UUID
  sessionId: string;
  createdAt: string;              // ISO timestamp
  triageState: "qualified" | "referred_out" | "disqualified";
  priorityTag?: PriorityTag;      // at-a-glance signal for sales triage

  // Who they are (from the user)
  persona: Persona;

  // What they want (from the user + agent framing)
  wishlist: Wishlist;

  // The four dimensions (20 Apr) — a normalised read over wishlist
  dimensions: Dimensions;

  // Emotional core (carried from PoC — the most valuable field per PoC guidance)
  motivationStatement: string;

  // What the agent imagined vs what the user said (load-bearing)
  agentImaginings: AgentImaginings;

  // Conversation context
  conversation: ConversationSummary;

  // Operational
  consent: ConsentRecord;
  nextAction: NextAction;
  confidence: ConfidenceSignals;
}

type PriorityTag =
  | "group-tour-candidate"
  | "solo-to-group"
  | "luxury-dec-feb"
  | "high-value-tailor-made"
  | "tdp-focused"
  | "refer-out-sub-1k-profit"
  | "refer-out-backpacker"
  | "unspecified";

interface Persona {
  name?: string;                  // Only collected at lead-capture step
  email?: string;                 // Only collected at lead-capture step
  phone?: string;                 // Optional, lead-capture step
  partySize?: number;             // User-stated
  partyComposition?: string;      // "couple", "solo", "family", etc.
  priorExperience?: string;       // "First trip to Patagonia", "Been in 2019"
  travelStyleNotes?: string;      // User's own framing of how they travel
  accessibilityNeeds?: string;    // Only if volunteered
  languages?: string[];           // Only if relevant
}

// The four dimensions from the 20 Apr call — Luke's customer segmentation.
// These are the sales team's native way of reading a lead.
interface Dimensions {
  independence: "group" | "tailor-made" | "independent" | "flexible" | "unknown";
  region: RegionSignal;
  activities: "soft-adventure" | "hikers" | "trekkers" | "mixed" | "unknown";
  budget: BudgetSignal;
}

interface RegionSignal {
  focus: "tdp-only" | "tdp-plus-mainstream" | "off-the-beaten-track" | "unknown";
  specificPlaces?: string[];      // e.g. ["torres-del-paine", "el-chalten", "perito-moreno"]
}

interface BudgetSignal {
  statedRange?: { min: number; max: number; currency: string };  // User-stated only
  inferredTier: "backpacker" | "mid" | "premium" | "luxury" | "unknown";
  inferenceBasis?: string;        // Why the agent inferred what it did — cite signals
}

interface Wishlist {
  durationTarget?: { min?: number; max?: number };   // days, user-stated
  departureWindow?: { earliest?: string; latest?: string };  // ISO dates, user-stated
  accommodationTier?: "mid" | "premium" | "luxury" | "flexible" | "unknown";
  specificTripsShortlisted: TripRef[];  // Catalog items the agent surfaced and the user liked
  specificTripsDeclined: TripRef[];     // Catalog items surfaced and the user declined
  openConsiderations: string[];   // "Still deciding whether to add El Chaltén"
  openQuestions: string[];        // Customer's unanswered questions
}

interface TripRef {
  id: string;                     // catalog ID
  name: string;
  source: "catalog" | "scraped_web" | "sales_sop";  // provenance from retrieval
  reasonNoted?: string;           // why they liked / declined
}

// Load-bearing: separates agent speculation from user statements.
// From the discovery-agent-architecture brief.
interface AgentImaginings {
  // Possibilities the agent floated that the user did NOT explicitly confirm.
  // Flagged so the specialist doesn't mistake them for user preferences.
  speculativeInterests: string[];       // e.g. "likely to enjoy glacier trekking"
  speculativeFit: string[];             // e.g. "possibly a group-tour candidate"
  inferenceNotes?: string;              // Plain-English explanation of the agent's reasoning
}

interface ConversationSummary {
  // Preserves the PoC's free-text summary — specialists read prose fastest.
  narrativeSummary: string;             // 3–6 sentences, Swoop tone-of-voice
  openingContext: string;               // What they said when they arrived
  quotesToRemember: string[];           // Verbatim user quotes worth preserving
  concernsRaised: string[];             // With addressed/open status in prose
  durationSeconds: number;
  turnCount: number;
  transcriptRef: string;                // URL or ID to retrieve full log
}

interface ConsentRecord {
  // EU AI Act Art. 50 + GDPR — new since PoC, where OpenAI covered consent.
  handoffConsentGivenAt: string;        // ISO timestamp of in-chat yes
  handoffConsentPhrase: string;         // Verbatim user reply ("Yes", "Go for it", etc.)
  aiDisclosureShownAt: string;          // From session-start disclosure
  transcriptShareConsent: boolean;      // Did they agree to share transcript with sales?
}

interface NextAction {
  suggestedOwner: "group-sales" | "tailor-made-sales" | "senior-sales" | "referrals-queue";
  suggestedTiming: "same-day" | "within-48h" | "this-week" | "no-followup";
  talkingPoints: string[];              // 3–5 specific things to lead with
  warnings?: string[];                  // "Comparison-shopping", "Mentioned competitor X"
}

interface ConfidenceSignals {
  triageConfidence: "high" | "medium" | "low";
  personaConfidence: "high" | "medium" | "low";
  wishlistConfidence: "high" | "medium" | "low";
  qualityFlags: string[];               // "very short session", "abusive-adjacent", etc.
}
```

### 3.1 Field-level rationale (only where it isn't obvious)

- **`priorityTag`**. New vs PoC. Single-shot tag for sales triage at-a-glance — the subject-line signal. Values map to the strategic levers from the 20 Apr call.
- **`motivationStatement`** as a top-level string (not nested). Kept from PoC. The PoC guidance payload explicitly calls this out as *"the most valuable piece for the sales team"*. Don't lose it in restructuring.
- **`dimensions`**. New vs PoC. Mirrors Luke's four-axis segmentation so the schema speaks the sales team's language without translation.
- **`agentImaginings`** as a sibling of `wishlist`, not mixed in. Load-bearing. The specialist must see the boundary between what the user actually told us and what the agent floated.
- **`TripRef.source`**. Carries provenance (`catalog` / `scraped_web` / `sales_sop`) from retrieval. Matches the discovery-agent brief's rule: "preserve source tags on every retrieval result."
- **`consent`**. New vs PoC. Patagonia build is Swoop's own surface, not OpenAI's — EU AI Act Art. 50 transparency obligations apply (see `04-legal-compliance.md`). Explicit consent is required in-chat.

### 3.2 Provenance tagging — why it matters here

In the PoC, the agent returned free-text summaries. Sales read prose. That still holds — `ConversationSummary.narrativeSummary` is the specialist's first read. But where the schema cites *facts*, it should be possible to trace them back to the source that originated them. Trip references carry `source`. Inferred fields carry `inferenceBasis`. Agent speculation is quarantined in `agentImaginings`. Specialist can trust the handoff the way they'd trust a colleague's notes — they can see where each claim came from.

---

## 4. Submission flow

Evolution of the PoC's two-step `handoff` → (widget) → `handoff_submit`. Same shape; new steps folded in.

### 4.1 Step 1: agent proposes handoff

The agent calls a tool equivalent to the PoC's `handoff`. The call:
1. Produces the in-chat consent ask (see §8 for the pattern).
2. Opens the lead-capture widget, pre-filled with the agent's working summary (conversation, wishlist, motivation, triage verdict, priorityTag).
3. Widget shows the user what will be sent. Same "here's what we'll share" pattern as the PoC lead-capture widget.

**Settled**: two-step pattern preserved. User sees what's being handed off before it's submitted. This was good in the PoC and stays.

### 4.2 Step 2: user provides contact details + confirms

Widget collects `name`, `email`, optional `phone` (same three fields as PoC). User clicks submit. Widget calls a tool equivalent to the PoC's `handoff_submit`.

### 4.3 Step 3: data connector processes

Data connector service (`01-architecture.md` §1 — the second Cloud Run):
1. Validates schema (hard-logic backstop per §9).
2. Persists the full `Handoff` object to the handoff store.
3. Branches on `triageState`:
   - `qualified` → send email to sales inbox (§5).
   - `referred_out` → log; no email in V1. Future: referrals queue.
   - `disqualified` → log only.
4. Returns `{ handoffId, estimatedResponseWindow }` to the orchestrator.

### 4.4 Step 4: agent confirms to user

Agent then tells the customer something like:
> "Done — I've passed everything across to our Patagonia specialists. They'll be in touch at [email] within [window]. Anything else you'd like to explore while you're here?"

Carries the PoC's "keep the dream alive" post-handoff behaviour (from `guidance-payload.json`).

---

## 5. Delivery mechanism

### 5.1 V1: email to sales inbox

Evolution of the PoC's nodemailer setup. Same transport pattern (`smtp.gmail.com:465`, auth via env). Same failure mode (non-fatal — errors logged, widget still confirms to user).

- **Target inbox**: TBC with Swoop. The PoC used a single `LEAD_EMAIL_TO` env var. Same pattern here; address itself TBD.
- **Sender**: TBC. Service account on the new GCP project (`AI Pat Chat`, per 21 Apr technical call).
- **Subject pattern**: `[Swoop AI Lead] {priorityTag} — {dimensions.region.focus} — {partyComposition}`. Evolution of the PoC's `Swoop Lead: {name} ({email})` — the tag-first pattern helps sales triage from the inbox list.
- **Body**: HTML rendered from the markdown template in §6. PoC was plain text; upgrade for readability.
- **Transcript**: full transcript reference is a URL link, not an attachment. Default. Privacy-minded; `04-legal-compliance.md` constrains retention.

### 5.2 V2 and beyond (out of V1 scope)

- **CRM integration**. Swoop uses a CRM — **TBC which one** (not confirmed in any call to date). Don't assume HubSpot / Salesforce / etc. until Swoop confirms. Flag as open in §10.
- **Referrals queue routing** for `referred_out` leads once Swoop's referral model firms up.
- **SLA / response-time tracking**.
- **Feedback loop** from sales back to the handoff record ("lead was good / bad") — improves future triage.

Design V1 so the email sink is one of several possible sinks on the data connector. Swap-in cost for CRM push is low.

### 5.3 What NOT to build in V1

- **Slack integration**. The PoC didn't ship it; don't invent it here.
- **Dashboard view of handoff queue**. Not scoped.
- **Automated re-contact / nurture sequences**.

---

## 6. Email template

HTML rendered from this markdown template. Template lives in `cms/templates/handoff-email.md` so sales / product can edit without code changes (consistent with Swoop's Phase 1 pattern of keeping all structured sales content in `cms/`).

Tone follows `why-swoop-emails.md` and `tone-of-voicedecember-2025-for-presenting.md` — warm, specific, confident, shorn of jargon. Attenborough, not the encyclopedia. Internal comms, but written as though a colleague is briefing another colleague who'll pick up the relationship.

```markdown
# Swoop AI Lead — {priorityTag}

**Triage**: {triageState}  ·  **Confidence**: {triageConfidence}
**Suggested owner**: {suggestedOwner}  ·  **Timing**: {suggestedTiming}

---

## Who

- **Party**: {partyComposition}{partySize ? ` (${partySize})` : ""}
- **Contact**: {contactEmail} · {contactPhone ?? "no phone given"}
- **How they travel**: {travelStyleNotes ?? "not discussed"}
- **Prior experience**: {priorExperience ?? "not discussed"}

## What they want

- **Region focus**: {region.focus}{specificPlaces ? ` — ${specificPlaces.join(", ")}` : ""}
- **Independence**: {dimensions.independence}
- **Activities**: {dimensions.activities}
- **Budget signal**: {budget.inferredTier}{statedRange ? ` (stated ${statedRange.min}–${statedRange.max} ${currency})` : ""}
- **Accommodation**: {accommodationTier ?? "not discussed"}
- **When**: {departureWindowFormatted ?? "flexible"}
- **Duration**: {durationTargetFormatted ?? "flexible"}

## Shortlist

{specificTripsShortlisted.map(t => `- ${t.name} (${t.id})${t.reasonNoted ? ` — ${t.reasonNoted}` : ""}`).join("\n")}

## Previously considered, declined

{specificTripsDeclined.map(t => `- ${t.name} (${t.id})${t.reasonNoted ? ` — ${t.reasonNoted}` : ""}`).join("\n")}

## Open questions they have

{wishlist.openQuestions.map(q => `- ${q}`).join("\n")}

## Talking points for your call

{nextAction.talkingPoints.map(p => `- ${p}`).join("\n")}

{warnings.length ? `## Heads up\n\n${warnings.map(w => `- ${w}`).join("\n")}` : ""}

---

## What's driving them (motivation)

{motivationStatement}

## Conversation highlights

{conversation.narrativeSummary}

### Concerns raised

{conversation.concernsRaised.map(c => `- ${c}`).join("\n")}

## Quotes worth remembering

{conversation.quotesToRemember.map(q => `> ${q}`).join("\n\n")}

---

## Agent imaginings — treat as possibilities, not statements

These were floated by the AI, not confirmed by the customer. Useful for your own conversation but don't present them as things the customer already said.

- **Might enjoy**: {agentImaginings.speculativeInterests.join(", ")}
- **Might fit**: {agentImaginings.speculativeFit.join(", ")}
{agentImaginings.inferenceNotes ? `\n_${agentImaginings.inferenceNotes}_` : ""}

---

_Full transcript: {transcriptRef}_
_Handoff ID: {handoffId}_  ·  _Session: {sessionId}_  ·  _Submitted: {createdAt}_
_Consent: user said "{consent.handoffConsentPhrase}" at {consent.handoffConsentGivenAt}_
```

### 6.1 What changed from the PoC email body

| PoC section | V1 equivalent | Change |
|---|---|---|
| `CONTACT` | `## Who` | Adds composition, prior experience, style notes |
| `CONVERSATION SUMMARY` | `## Conversation highlights` + `## What's driving them` | Split: motivation gets its own headline slot (it's the most valuable field); narrative summary keeps the PoC's prose habit |
| `DISCOVERED PREFERENCES` | `## What they want` (structured) + `## Shortlist` + `## Previously considered, declined` | Structured around the four dimensions (20 Apr) |
| `MOTIVATION` | `## What's driving them` | Same field, promoted to a headline block |
| — | `## Talking points for your call` | New |
| — | `## Open questions they have` | New |
| — | `## Quotes worth remembering` | New |
| — | `## Agent imaginings` | New — load-bearing provenance surface |
| — | Triage banner / `priorityTag` in subject | New |

---

## 7. Priority tagging

`priorityTag` is the single at-a-glance signal for the sales team. Picked by the HOW-layer stance-classifier + WHY rules; written into the handoff once by the agent at submission time.

Values and meaning:

| Tag | Means | Strategic lever (20 Apr) |
|---|---|---|
| `group-tour-candidate` | Fits the new group-tour product directly. Family of 4 wanting TdP with some hand-holding; similar. | Group tours are priority product. |
| `solo-to-group` | Solo traveller who'd fit a group tour. Early identification Luke flagged as valuable. | Solos are a group-tour lead. |
| `luxury-dec-feb` | Wants premium inventory in Dec–Feb window; handle urgently due to 6–12 month lead-time constraint. | Inventory constraint; early action matters. |
| `high-value-tailor-made` | FIT-segment tailor-made with clear profit headroom. Existing core business. | Maintain FIT segment strength. |
| `tdp-focused` | Torres del Paine dominant; 80%+ of bookings involve TdP. Generic handling. | Default profile. |
| `refer-out-sub-1k-profit` | Projected profit <$1k; negative contribution. Do not email sales. | Refer-out model. |
| `refer-out-backpacker` | Clearly backpacker-tier. Do not email sales. | Refer-out model. |
| `unspecified` | Qualified but doesn't pattern-match a lever. Route to normal sales triage. | Fallback. |

---

## 8. Consent ask — in-chat pattern

**New vs PoC**. The PoC relied on OpenAI's consent umbrella plus the two-step widget. For Patagonia on Swoop's own surface, EU AI Act Art. 50 transparency kicks in from 2 Aug 2026 (see `04-legal-compliance.md`). Explicit handoff consent is required in-chat.

Two tiers of consent:
1. **AI disclosure at session start** — user knows they're talking to an AI. Lives in the chat container, not the agent logic.
2. **Handoff consent** — explicit in-chat yes before `handoff` is called. Captured in `ConsentRecord`.

Template for the consent ask (lives in WHY prompt, not as a tool parameter):

> *"It sounds like you're getting a clear picture. Shall I pass everything we've talked about across to one of our Patagonia specialists? They'll pick up right where we are — no commitment, just a conversation. I'd share the summary and what you've shortlisted so you won't have to repeat yourself."*

Three elements, carried from the PoC's `handoffTriggers` guidance:
1. **Reflect** where the conversation has got to.
2. **Offer**, not demand.
3. **Set expectations** — what's shared, what happens next.

On decline: the agent does not re-ask within the same session unless new positive signal emerges. Does not flip to transactional; carries on the discovery conversation warmly.

---

## 9. Never-submit cases (hard stops)

The agent must never submit a handoff when:

- User has explicitly declined.
- No contact email has been provided (what would sales do with it?).
- Conversation is fewer than ~3 meaningful exchanges (too little signal — PoC's implicit rule, made explicit here).
- User shows distress / crisis signals (refer to appropriate resources, do not lead-gen).
- User is a minor or signals as such.
- Content violates safety rubrics — abuse, illegal requests, testing the bot deliberately, attempting to extract system prompts.

These rules live in the WHY prompt (instruction-level). A **hard-logic backstop** in the `handoff_submit` server tool validates presence of minimum fields and rejects on missing email — carried across from the PoC's validation approach but made stricter.

---

## 10. Persona data inventory (for legal doc peer)

What the handoff collects about the user, for `04-legal-compliance.md` §3 to reference.

| Field | Source | Required? | Notes |
|---|---|---|---|
| `persona.name` | User (lead-capture) | Yes | Submit step only |
| `persona.email` | User (lead-capture) | Yes | Submit step only |
| `persona.phone` | User (lead-capture) | No | Optional |
| `persona.partySize` / `partyComposition` | User (in-chat) | No | Only if volunteered |
| `persona.priorExperience` | User (in-chat) | No | Only if volunteered |
| `persona.accessibilityNeeds` | User (in-chat) | No | Special-category risk if health-related — flag for legal |
| `consent.*` | User interaction events | Yes | Required record |
| `conversation.quotesToRemember` | User utterances | No | Verbatim — GDPR-scope personal data |
| `conversation.transcriptRef` | Generated | Yes | Links to full transcript store |
| IP address | Network layer | Yes | Handled at Cloud Run logging layer, not in handoff payload |

Retention of the handoff object itself is **TBC with legal** — see `04-legal-compliance.md`.

---

## 11. Triage logic placement

**Where the verdict happens**: the HOW-layer classifier continuously reads conversation signal (see `01-architecture.md` §2.2). At handoff time, the WHY-prompt rules convert the live classifier state into the `triageState` + `priorityTag` written into the submission.

**Soft triage** (steering inside the conversation — nudging toward group / tailor-made, flagging solos as group candidates) happens in the HOW-layer fragments continuously. Not a gate — it's shaping.

**Hard triage** (`disqualified`, and routing decisions for `referred_out`) happens only when WHY-layer rules fire. These aren't judgement calls the agent makes casually; they require explicit criteria in the WHY prompt.

**Group-tour bias** (Luke's strategic lever) surfaces in two places:
- `priorityTag` — `group-tour-candidate` / `solo-to-group` are first-class values.
- `nextAction.suggestedOwner` — routes to `group-sales` when the tag fires.

Solo travellers who'd fit group tours still get `triageState = qualified`; the tagging does the steering work.

---

## 12. Decision status

**Settled**:
- Two-step tool pattern (propose → widget → submit) carries over from the PoC.
- Free-text `motivationStatement` stays as a first-class field.
- Triage splits into `qualified` / `referred_out` / `disqualified` — a Patagonia-specific evolution.
- `agentImaginings` is a distinct top-level field, not mixed into `wishlist`.
- V1 delivery is email to sales inbox, HTML rendered from the CMS template.
- In-chat handoff consent required; recorded in `ConsentRecord`.

**Leaning**:
- `priorityTag` enum values as listed — validate against Lane/Luke's 1–2-week sales-doc turnaround.
- Email subject-line pattern `[Swoop AI Lead] {priorityTag} — {region} — {party}` — may be refined post-sales-input.
- `referred_out` is logged but not emailed in V1; to be re-routed once the referral model is defined.

**Open (TBC)**:

| # | Question | Owner |
|---|---|---|
| 1 | Sales inbox address | Swoop (Julie / Luke) |
| 2 | Sender domain for the lead email (GCP service account vs Swoop-domain mail-from) | Swoop |
| 3 | CRM vendor — not confirmed; don't assume | Swoop |
| 4 | Handoff-store retention policy | Swoop legal (see `04-legal-compliance.md`) |
| 5 | Transcript sharing default (link / redacted / opt-in) | Swoop + legal |
| 6 | SLA expectation — does sales pick up same day? Within 48h? | Swoop ops |
| 7 | Referral-model destination for `referred_out` leads | Swoop (strategic doc Luke is sharing) |
| 8 | Feedback loop from sales back to handoffs | Swoop + us |
| 9 | Profit-threshold inference — is $1k profit the right agent-visible signal, or too crude? | Luke / sales |
| 10 | Escalation path when a `disqualified` verdict is borderline | Swoop + us |
