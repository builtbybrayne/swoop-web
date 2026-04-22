# Questions for Swoop

Open questions that need Swoop-side input before they can be closed. Periodically asked of the right person (Luke / Julie / Thomas / Richard / Martin / Lane / legal) depending on the topic.

**Entry format**: `## Topic — who to ask` then a short body stating the question, the context, and why it matters.

Mark `✅ Answered: ...` inline once resolved, then move to the closed section at the bottom during periodic triage.

---

## Open

### Analytics platform preference — Julie / Thomas

Where would Swoop want ad-hoc analysis of chat event logs to land? The default GCP path is BigQuery (simple sink from Cloud Logging, cheap, queryable), but they may already have a preferred BI / warehouse / analytics tool — Looker, Metabase, something else — that we should integrate with instead. Also: do they want the event schema to match conventions their analysts already use?

Why it matters: Puma ships with structured event logging. The schema we author now is what enables (or constrains) later analysis. Getting this wrong costs rework.

Where it lands: Tier 2 chunk F (observability & analytics).

### Media library location + access — Thomas / Richard / Martin (Friday hackathon scope)

Where do Swoop's product / region / activity images actually live, and what access path does Puma need? The 21 Apr meeting referenced "a media library somewhere" but didn't pin it. Options might be: Cloudinary, S3/GCS bucket, a CMS attachment store, direct-from-CDN URLs with no auth.

Why it matters: chunk C's `illustrate`-equivalent tool needs a resolution path. Image set is also bigger than the PoC's bundled JSON — likely needs its own retrieval strategy.

Where it lands: Tier 2 chunk C (retrieval & data).

### URL reconstruction from type + id — Thomas / Richard (Friday hackathon scope)

If the Friday hackathon lands on API-direct data access (vs scraping), can we still deterministically reconstruct the public page URL for any product / region / story given its type and id? This preserves the deep-link UX benefit that the scraping path gets for free.

Why it matters: if yes, API wins uncontested. If no, we need to weigh scraping's URL-generation benefit against its maintenance cost.

Where it lands: Tier 2 chunk C. See inbox entry 2026-04-22.

### Cross-page chat persistence expectation — Luke / Julie

Do they expect / want the chat to survive navigation between Swoop website pages? If deep-linking is in Puma, a visitor could click through to a page the agent recommended — and then the chat disappears unless we persist state across navigation.

Why it matters: cross-page persistence has real UX and technical cost. Default stance in the top-level plan is **no** until asked for. Worth checking before chunk D Tier 2 locks.

Where it lands: Tier 2 chunk D (chat surface).

### Meta-tag-embedded IDs on product pages — Thomas

Thomas proposed (21 Apr) adding a meta tag with the internal product ID on each public page. This would let a scraper (or any downstream consumer) carry the real internal ID on extracted records, not just slugs. Is Thomas's team willing to ship this change? It's small on their side, material for us.

Why it matters: affects whether scraping can cleanly bridge back to the internal record. If API-direct wins Friday, this becomes moot.

Where it lands: Tier 2 chunk C.

### Claude account Enterprise tier status — Julie / Tom

Is Swoop's recently-extended Claude account Enterprise-tier? Julie agreed to check with Tom on 20 Apr. Affects where ETL (scraper / API-extraction) Claude usage runs — on Swoop's account ("pure data munching" per Luke) vs Al's WhaleyBear account.

Why it matters: cost routing, not architecture.

### Sales inbox address + SMTP — Julie

What email address does the handoff delivery go to? What SMTP (or transactional email provider) should Puma send through? The PoC used personal Gmail — Puma needs something real. Also: does Swoop want a human to receive the raw AI handoff email, or does it need to thread into an existing CRM / helpdesk?

Why it matters: blocks M3 (triage + handoff end-to-end).

Where it lands: Tier 2 chunk E (handoff & compliance).

### Patagonia sales-thinking doc status — Luke / Lane

Luke + Lane committed (20 Apr) to producing the Patagonia equivalent of Emma's Antarctica sales document within 1–2 weeks. Target arrival ~May 4. Is that on track?

Why it matters: chunk G (content) depends on this for the Patagonia-voiced system prompt. If it slips, the content draft goes in on Antarctica-voiced placeholders and gets rewritten later.

### Legal counsel engagement model — Luke / Julie

What's the review loop with Swoop's legal counsel for the EU AI Act + GDPR surfaces? Who sends what to whom, and what's the turnaround? The 30 Mar proposal framed it as "I handle this simply; available to work with your legal team if you want to go further" — need to confirm Swoop's posture.

Why it matters: M5 ships only after legal sign-off. SLA uncertainty is the biggest schedule risk.

Where it lands: Tier 2 chunk E.

---

## Closed

(Move resolved questions here with date + who answered + the resolution. Empty for now.)
