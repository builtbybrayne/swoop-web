# EU AI Act Article 50 — disclosure compliance

How Puma satisfies the Article 50 requirement that natural persons interacting with an AI system are informed they are doing so.

Article 50 becomes enforceable on **2 August 2026**. Puma launches before that date but must already comply on day one — Swoop's posture is that compliance is built-in from M5, not retrofitted.

---

## The requirement

Article 50(1):

> Providers shall ensure that AI systems intended to interact directly with natural persons are designed and developed in such a way that the natural persons concerned are informed that they are interacting with an AI system, unless this is obvious from the point of view of a natural person who is reasonably well-informed, observant and circumspect, taking into account the circumstances and the context of use.

In plain terms: tell the user they're talking to an AI, in a way they can't reasonably miss, unless it's already glaringly obvious.

The "unless obvious" carve-out is not a refuge Puma relies on. A conversational interface inside an adventure-travel website is not obviously AI to a typical visitor — it could just as plausibly be a live-chat operator. Puma discloses explicitly.

---

## How Puma complies

Two surfaces, both always visible, both authored as data (`product/cms/legal/disclosure-opening.md` and `disclosure-chrome.md`).

### 1. Opening disclosure (paired with tier-1 consent)

**When**: first iframe load, before any visitor message can be sent.

**What**: a single-screen message that names the AI assistant explicitly, explains what conversation data will be kept, and presents Continue / No thanks controls.

**Why this surface satisfies Art. 50**: the disclosure is the *only* path forward. A visitor cannot interact with the system without first seeing it. The pairing with tier-1 consent (GDPR) means the same screen serves both purposes — concise, no friction-multiplication.

Authoritative copy: `product/cms/legal/disclosure-opening.md` (E.t5 authors; counsel reviews).

### 2. Persistent chrome badge

**When**: visible at all times during the conversation, on every viewport. Not collapsible, not dismissible.

**What**: a small badge in the chat surface chrome carrying the text "AI assistant · [info link]". Clicking the info link opens the privacy-info modal (`privacy-info.md`).

**Why this surface satisfies Art. 50 even after the opening disclosure is past**: the requirement is a continuous one — a visitor who returns to the chat 20 minutes later, or who scrolls back through the conversation, must still be in no doubt. The chrome badge ensures that. Decision D.21 / D.22 (chunk D's brand-extension surface) reserves a `[data-swoop-part="chrome-disclosure"]` hook so Swoop's brand team cannot accidentally style it out of existence.

Authoritative copy: `product/cms/legal/disclosure-chrome.md` (E.t5 authors; counsel reviews).

---

## Why two surfaces, not one

A single-shot disclosure (just the opening screen) would technically meet the letter of Art. 50 but fail its spirit:

- A visitor returning to a chat after a break might not remember they were talking to an AI.
- A visitor sharing the chat URL with a colleague (unlikely but possible — Puma is iframe-embedded so URL-sharing isn't first-class, but the principle holds) would land mid-conversation without disclosure.
- The recital text accompanying Art. 50 emphasises continuous, accessible disclosure for general-purpose conversational systems.

Two surfaces — opening + persistent — close all three. The cost is a small footprint of permanent UI; the benefit is a posture that needs no defence under regulator scrutiny.

---

## What Puma does *not* claim under Art. 50

- **Puma is not a "deep fake" system** under Art. 50(4). No image / audio / video generation. Disclosure obligations under that paragraph do not apply.
- **Puma is not a high-risk AI system** under Annex III. Conversational discovery for travel inquiries is not a listed high-risk use. Compliance scope is Art. 50 + GDPR; Annex III obligations do not apply.
- **Puma does not generate or manipulate images, audio, or video** of identifiable persons. The image content surfaced in widgets is Swoop's existing media-library content, not generated.
- **Puma is not used in a workplace, education, or essential-services context** that would trigger additional Article 50 sub-paragraphs.

Counsel should confirm these characterisations are correct. If any change after counsel review, the disclosure scope expands accordingly.

---

## Implementation evidence

For counsel cross-referencing implementation against this stated posture:

- **Opening screen render**: `product/ui/src/disclosure/opening-screen.tsx`.
- **Chrome badge render**: `product/ui/src/disclosure/chrome-badge.tsx`.
- **Disclosure copy load**: `product/orchestrator/src/cms/legal-loader.ts` (post-M5 location; reads the markdown files at boot and serves the visitor the rendered copy).
- **Brand-extension override hook (Swoop's in-house team must not style this away)**: `[data-swoop-part="chrome-disclosure"]` selector documented in `product/ui/HANDOVER.md`.

Screenshots reserved in `screenshots/` (see `consent-flow.md`).

---

## Cross-reference

- Visitor-facing copy: `product/cms/legal/disclosure-opening.md`, `disclosure-chrome.md`, `privacy-info.md` (E.t5).
- Tier-2 consent + GDPR overlap: `consent-flow.md` (this bundle).
- GDPR articles addressed: `gdpr-art-summary.md` (this bundle).
- Top-level theme commitment: `planning/01-top-level.md` §3 theme 9 ("legal compliance built-in").
