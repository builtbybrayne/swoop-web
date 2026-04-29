# Decision log — Puma

Running record of Tier 2 / Tier 3 decisions for the Swoop Web Discovery project (release: **Puma**).

**Format**: one entry per decision, reverse-chronological (newest at top). Each entry names the decision, the date it was closed, the owner, the rationale, and the swap cost (what would break if we changed our mind later).

**House rule**: any Tier 2 or Tier 3 decision gets an entry here. If it isn't logged, it isn't real. When a chunk closes, the executing agent adds the entries for decisions it closed. Future readers asking "why did we do this?" should find the answer here.

---

## H.20 — Living-evalset ritual ownership documented as a role, not a name

**Decided**: 2026-04-29
**Owner**: H.t7 living-evalset runbook
**Rationale**: The runbook needs to name an owner so the weekly ritual doesn't become orphaned. Two shapes considered: (a) name a person ("Al" or "Thomas"), (b) name a role ("the harness owner — currently Thomas / Richard at handover; until then, Al"). Picked (b). Names rot — the moment the named person changes role, the runbook either misleads or gets edited under pressure; either way the ritual loses time. A role-with-current-incumbent stays accurate as long as the parenthetical is updated on handover sign-off, and the operator reading the doc knows to update it because they ARE the new incumbent.

**Swap cost**: Trivial. One sentence in `product/cms/ops/evalset-growth.md` § "Cadence + ownership" gets updated whenever ownership changes.

## H.19 — Transcript source for evalset growth: handoff records + Cloud Logging by session id, transcript-text logging deferred

**Decided**: 2026-04-29
**Owner**: H.t7 living-evalset runbook
**Rationale**: The weekly ritual needs the operator to read what visitors actually said, then re-author the messages into a scenario. Today, two stable sources cover most cases: (a) handoff records under `var/handoffs/<id>.json` carry verdict + visitor profile + wishlist + reason text — enough context for any conversation that ended in a handoff (the dominant case worth testing, by definition); (b) Cloud Logging events by session id carry the **shape** of the conversation (turn count, tool calls, latency) but not the message text — events log lengths + SHA256 hashes, per chunk F's privacy posture. The gap: "no-handoff" conversations in production have no recoverable transcript. Three options considered: (i) widen event logging to include `<utter>` text behind a privacy gate, (ii) build a separate transcript-write path on session end, (iii) accept the gap and prescribe operator workarounds. Picked (iii) for Puma launch. Rationale: (i)/(ii) both want a deliberate privacy + retention review and a schema change that ripples through F; deferring keeps Puma's launch surface honest and small. The ritual still works for the conversation classes that matter most (those that produced a handoff). Operators flag interesting "no-handoff" sessions during dev and capture transcripts from stdout at the time. The runbook records this as an open item for Al.

**Swap cost**: Medium. If launch experience shows the no-handoff blind-spot is hurting evalset growth, the fix is a schema-change to log final `<utter>` text (with PII redaction policy) — touches `ts-common/src/events.ts`, the orchestrator turn-end emit site, and the runbook's Step 1b. The runbook structure (sections + sanitisation procedure) doesn't change; only the source-of-truth pointer in Step 1 does.

## H.18 — PII sanitisation: manual checklist + committed `grep` smoke test, no scripted sanitiser at launch

**Decided**: 2026-04-29
**Owner**: H.t7 living-evalset runbook
**Rationale**: When converting real conversations into scenarios, visitor PII (names, emails, phones, freeform `reason.text`) must not commit to the scenario file. Two mechanisms considered: (a) a scripted sanitiser that takes a transcript + emits a redacted seed, (b) a manual rewrite procedure backed by a `grep`-based smoke test the operator runs before staging. Picked (b). Rationale: at Puma's expected scenario growth rate (5–10/week), manual rewrite is ~5 minutes per scenario and forces the operator to actually read what they're committing — the meta-control of being responsible for every line shipped is exactly what PII review needs. A scripted sanitiser at this volume would either over-redact (replacing every `[A-Z][a-z]+` token, mangling place names) or under-redact (missing context like "I work at Acme Corp"). The grep smoke test catches the most common leaks (email-shaped strings, phone-shaped strings, identity-disclosure phrases) without claiming completeness. Verified: all three patterns return clean against the H.t1 scaffold scenarios (000–019).

**Swap cost**: Low–Medium. If the suite passes ~50 scenarios or a leak slips through, build a scripted sanitiser as a Tier 3 task. The runbook structure stays the same; "Step 4" gets a scripted alternative path. The grep smoke test stays as a defence-in-depth check either way.

## H.17 — Living-evalset cadence: weekly, Friday afternoon by default, movable

**Decided**: 2026-04-29
**Owner**: H.t7 living-evalset runbook
**Rationale**: Tier 2 §2.7 commits to a weekly ritual; H.t7 fixes the slot so the ritual has a default landing place on the operator's calendar. Friday afternoon is a low-stakes slot — most engineering activity for the week has settled, so Saturday-Sunday won't pull a half-finished PR into review. The runbook documents the slot as movable: the cadence (weekly) is load-bearing, the day is not. Skipping a week is the failure mode to prevent; a weekly ritual that drifts to "every other Wednesday" is fine.

**Swap cost**: Trivial. One paragraph in the runbook updates when the operator's preferred slot changes.

## H.16 — `triage_verdict` derives final state from captured `triage.decided` events; future `/session/:id` endpoint will tighten

**Decided**: 2026-04-28
**Owner**: H.t3 assertion-catalogue session
**Rationale**: The `triage_verdict` assertion needs to know the session's final triage state at end-of-run. There is no orchestrator endpoint exposing it today (no `/session/:id` introspection route). Three options considered: (a) build a thin GET endpoint right now, (b) sniff state from the assistant's response text via regex/judge, (c) reduce captured `triage.decided` events to "the most recent one wins" and stand on that. Picked (c). Rationale: the F-a event schema already carries verdict + reasonCode in a structured form, the orchestrator already emits one per turn the classifier runs, and the `EventCapture` plumbing this task already adds is the right surface. Option (a) is correct long-term but expands the H.t3 scope to a B-side route addition; option (b) is fragile and double-counts the LLM. The `triage_verdict` handler treats `null` (no `triage.decided` events captured) as a failure with a clear message, so scenarios authored against this kind fail loudly until either (1) `EventCapture` is wired to a real source (decision H.14) or (2) a `/session/:id` route lands and the runner pulls state directly. Either upgrade keeps the assertion shape unchanged.

**Swap cost**: Low. The `deriveFinalTriage(events)` helper in `runner.ts` is the only consumer of this convention. Replacing it with a `client.getSession(id)` call once the route exists is a single-function swap; the `RunContext.finalTriage` field stays the same.

## H.15 — Schema-level cross-variant validation via `superRefine`, not per-variant `refine`

**Decided**: 2026-04-28
**Owner**: H.t3 assertion-catalogue session
**Rationale**: The `response_format` assertion needs at least one of `hasUtter` / `hasReasoning` / `fyiCount` set; a `fyiCount` bound needs at least one of `min` / `max`. Native Zod expression of these constraints is `.refine` on each variant — but `z.discriminatedUnion` rejects `ZodEffects` members (refine-wrapped objects), so per-variant refinement breaks the discriminator. Two viable shapes: (a) drop the constraints (silent permissive bug-class — an empty `response_format` would silently pass, hiding author error), (b) build the discriminated union from raw objects, then `.superRefine` the union itself for cross-variant rules. Picked (b). Rationale: keeps the discriminator clean for TypeScript narrowing, keeps authoring-time error visibility (Zod still surfaces a clear path-and-message), and consolidates cross-variant rules in one place where future kinds can join. The downside is `superRefine` runs after the per-variant parse, so it's slightly less precise on error attribution — acceptable for human-authored YAML where the surface is small.

**Swap cost**: Low. If Zod adds first-class refined-discriminator support (proposals exist), migration is mechanical: lift each constraint back into the variant.

## H.14 — Event capture: pluggable interface defaulting to `NullEventCapture`; orchestrator-stdout streaming wired by an outer wrapper, not the harness CLI

**Decided**: 2026-04-28
**Owner**: H.t3 assertion-catalogue session
**Rationale**: H.t3's `handoff_event` / `disclosure_event` assertions need access to events emitted by the orchestrator's `emitEvent` (F-a / F-b). The H.t3 brief suggested capturing the orchestrator's stdout (the default sink writes one JSON line per event), under the premise that the harness in CI starts the orchestrator as a child process. On inspection that's not the scaffold's posture: the harness CLI does NOT spawn the orchestrator (locally OR in CI per `.github/workflows/harness.yml`) — both modes assume a separately-started `:8080`. Three viable shapes for getting events back to the harness:

  (a) **Harness owns the orchestrator child process**: harness CLI spawns + supervises orchestrator, captures its stdout, parses event JSON inline. Cleanest for scenarios that need events; bigger architectural shift than H.t3 warrants — touches CI workflow, the local dev story, and the harness's "speak HTTP, assert results" focus (Tier 3 H.t1 plan §"Orchestrator invocation").
  (b) **Side-channel header + in-memory event collector** on the orchestrator: harness sends `X-Swoop-Eval-Run-Id`, the orchestrator's emit-event sink stashes events keyed by run-id, harness queries `/eval/events/<run-id>` after the run. Adds an eval-only route to the orchestrator, which means more producer-side code under test.
  (c) **`EventCapture` interface with three implementations**: `NullEventCapture` (CLI default — events-based assertions cleanly fail with "no event captured"), `MemoryEventCapture` (test workhorse — push events directly), `StreamingEventCapture` (wraps a Node `Readable` of newline-delimited JSON; an outer wrapper script — `eval-with-orchestrator.sh` or a future `cli-with-orchestrator.ts` — wires the orchestrator child's stdout to it). The harness CLI today wires `NullEventCapture`. The interface lives at `product/harness/src/event-capture.ts`.

Picked (c). Rationale: (i) the interface seam is ~50 LOC and lets H.t3 land its handlers fully tested without forcing a CI architectural shift, (ii) the streaming impl is ready for a future outer wrapper without that wrapper having to exist today, (iii) the test surface is honest — `MemoryEventCapture` exercises every event-based assertion handler, and the unit tests prove the wire-format consumer works. The cost is that authored scenarios using `handoff_event` / `disclosure_event` / `triage_verdict` will fail until either an outer wrapper plumbs `StreamingEventCapture` or future tasks adopt option (a) / (b). Failure mode is a clear assertion message ("no event captured"), not a crash.

**Swap cost**: Low. (a) is one new file (`cli-with-orchestrator.ts`) that imports the existing `StreamingEventCapture`, spawns the orchestrator child, and runs `cli.ts`'s body with the streaming capture instead of null. (b) is a moderate orchestrator-side change but doesn't disturb the harness — it would be a fourth `EventCapture` implementation (`HttpEventCapture` polling the eval-only route).

## E.15 — Tier-2 consent timestamp is captured client-side at submit, not server-side

**Decided**: 2026-04-28
**Owner**: E.t3 wiring session
**Rationale**: The lead-capture widget produces `consent.handoffTimestamp` from `new Date().toISOString()` at the moment the user clicks Send, before the POST. The server takes the value verbatim into the durable record. Alternative considered: server stamps `now()` at request-handler entry. Chose client-side for two reasons: (i) the timestamp encodes the visitor's *intent* (the click), and the round-trip latency could be material on a flaky connection — server-stamping would mis-attribute the lawful-basis moment; (ii) GDPR audit posture is "what time did the visitor consent" not "what time did the server hear about it". The server still snapshots `handoffSubmittedAt` (different field) into `session.handoffSubmittedAt` from its own clock — that's the processing-time signal, complementary to the consent-time signal.

**Swap cost**: Low. If a future audit requires a single authoritative clock source, swap to server-stamping in the route handler — the schema field stays the same. The field name disambiguates the meaning either way.

## E.14 — Server-side payload enrichment from session state, not client-side bundling

**Decided**: 2026-04-28
**Owner**: E.t3 wiring session
**Rationale**: The widget could in principle bundle the entire `HandoffPayload` (handoffId, session metadata, wishlist, visitor profile) before POSTing. Rejected. The widget receives the agent's tool-call args (`verdict`, `reasonCode`, `reasonText`, `motivationAnchor`) and the form's contact + tier-2 consent — that's it. Everything else (handoffId, conversationStartedAt, turnCount, entryUrl, tier-1 consent timestamp, wishlist accumulator) is server-state and the orchestrator is the source of truth. Sending it through the client would create three failure modes: (a) widget tampering yielding a falsified record, (b) staleness if session state evolved after the agent triggered the widget, (c) duplication of trust paths. The server-side enrichment in `enrichPayload()` (see `product/orchestrator/src/server/handoff-submit.ts`) keeps a single source of truth and makes the client surface tiny.

**Swap cost**: Low. The wire shape (`HandoffSubmitRequestSchema` in `@swoop/common/handoff`) is what's externally visible; if a future client wants to send pre-enriched fields they get ignored — the schema is `.strict()` and the enrichment function builds the canonical payload regardless.

## E.13 — Widget submit path: discrete `POST /handoff/submit` HTTP endpoint, not an MCP tool call

**Decided**: 2026-04-28
**Owner**: E.t3 wiring session
**Rationale**: Three viable patterns for "widget form submission triggers backend persistence + email":
  (a) The widget calls `props.addResult(payload)`; assistant-ui forwards it as the `handoff` tool's result; the agent decides on the next turn to call `handoff_submit` as another MCP tool; the connector's `handoff_submit` runs the side-effects. (Original PoC pattern.)
  (b) The orchestrator intercepts the addResult inside the chat SSE flow, runs the side-effects, replaces the tool result before the agent sees it.
  (c) The widget POSTs to a discrete `/handoff/submit` HTTP endpoint on the orchestrator, which validates + enriches + calls the connector's `submitHandoff` in-process, returns a typed `HandoffSubmitResponse` to the widget. The widget then resolves the assistant-ui tool call locally.

Chose (c). Rationale: (i) form submission is a discrete user action, not part of the conversation flow — it has its own HTTP semantics, its own success/failure shape, its own loading state, and the visitor expects a synchronous outcome (confirmation card or error toast). Threading it through SSE conflates two different lifecycles. (ii) Re-entry into the agent loop just to perform a side-effect wastes an LLM call and adds latency; (b) avoids that but at the cost of a stateful interceptor in the chat handler. (iii) Pattern (c) lets the widget render an inline "couldn't send — try again" affordance directly off the response code, with no agent retry logic. (iv) The endpoint contract is fully tested in isolation — `handoff-submit.test.ts` covers happy path + 404 / 403 / 422 / 500 failure modes without spinning up the runner. (v) `addResult` still fires (with `HandoffSubmitOutput { status: 'accepted', handoffId }`) so assistant-ui's tool-call lifecycle resolves cleanly and the agent gets a tidy result for the next turn.

**Swap cost**: Low. The `submitHandoff()` function in `@swoop/connector` is the single side-effect surface. A future MCP `handoff_submit` tool simply imports + delegates to it. The HTTP endpoint can stay (and the MCP tool can be added alongside if Swoop ever wants third-party clients to drive handoffs).

## E.12 — Durable handoff store: file-backed `FsHandoffStore` is the interim; Firestore swap is the E.t2 target

**Decided**: 2026-04-28
**Owner**: E.t3 wiring session
**Rationale**: E.1 (2026-04-22) named Firestore as the durable backend. Firestore in-process needs GCP credentials + a project + IAM (blocked on Thomas / "AI Pat Chat") and the chunk-E work was unblocked first. Rather than wait, we shipped a tiny `FsHandoffStore` implementation behind the same `HandoffStore` interface that the eventual `FirestoreHandoffStore` will satisfy. Properties:

- One JSON file per handoff at `<connector-or-orchestrator-package-root>/var/handoffs/<handoffId>.json`, atomically written via tmp-file-rename.
- Filename safety: handoffId checked against `^[a-zA-Z0-9_-]+$` before any fs op (path-traversal guard).
- Schema-validated round-trip: `get` parses each file against `HandoffPayloadSchema` and returns null on mismatch, so a corrupted record can't bleed into runtime code.
- Disabled in `.gitignore` (`product/orchestrator/var/`, `product/connector/var/`) so visitor PII never leaks into git.

The E.t2 task in the planning doc described "Firestore default + a `ts-common` interface so the backend can swap". We have the interface (in `@swoop/connector/src/handoff/store.ts`); we have a working impl (file-backed); the Firestore swap is one new class implementing the same interface, behind one config flip in `index.ts`. The E.t1 contract (`HandoffSubmitConsentGate`) is honoured by `submitHandoff()` regardless of backend.

**Swap cost**: Low. Defined explicitly: when GCP credentials land, write a `FirestoreHandoffStore implements HandoffStore`, instantiate it conditionally in `index.ts` (e.g. on `HANDOFF_STORE_BACKEND=firestore`), let the `FsHandoffStore` carry the dev-mode default. Caller code (`submitHandoff`, the route, the tests) sees no change.

## E.11 — Handoff side-effects live in `@swoop/connector`, not the orchestrator

**Decided**: 2026-04-28
**Owner**: E.t3 wiring session
**Rationale**: The mailer + durable store + `submitHandoff()` orchestration first landed in `product/orchestrator/src/handoff/` because the connector workspace was empty. They were relocated to `product/connector/src/handoff/` once we accepted that's their architecturally-correct home. Rationale stands per the chunk-C/chunk-E split: connector owns data + side-effects, orchestrator owns the agent loop. The orchestrator imports `submitHandoff`, `FsHandoffStore`, and `MailerConfig` from `@swoop/connector` as a workspace dep; `nodemailer` is now a connector-package dep (removed from orchestrator). The `POST /handoff/submit` route handler stays in the orchestrator because the route is part of the orchestrator's HTTP surface — it just delegates the side-effect work to the connector via in-process import. When MCP-fication eventually happens (the connector grows a `handoff_submit` tool exposed over MCP-HTTP), the route handler swaps in-process import for an MCP client call. Same `submitHandoff` function on the connector side; minimal disturbance.

**Swap cost**: Low. The `@swoop/connector` workspace dep on the orchestrator is the only surface that would change at MCP-fication.
## C.30 — `customer_story` persona shape: natural-language summary + embedding, no structured columns

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: The `customer_story` table (Mirror job, conditional on C.26) needs a way to remember *who* each story is about so the visitor's persona signal can be matched to similar customers. Two shapes were considered: structured columns (`travel_style`, `age_band`, `motivation_tags`, …) vs JSONB blob. Both lock the persona taxonomy to schema time, before we've actually read enough customer reviews to know what dimensions matter.

The chosen shape: **`persona_summary TEXT` + `persona_embedding vector(1536)`**. At ETL time, the Haiku classifier writes a 1–3 sentence natural-language description per row (e.g. *"Sarah, mid-40s, solo traveller, post-divorce reset trip. Intermediate hiker, drawn to wildlife photography and accessible glaciers. Wanted quiet trails over W-trail crowds."*). That text gets embedded. At query time the Mirror tool embeds the visitor's signal and finds matching customers via cosine similarity on the embedding.

Why this is right for Puma:
- We already run Haiku at ETL (per C.24's "cheap LLM at ETL, embeddings + Sonnet at runtime"). Adding one more classifier prompt is near-zero cost.
- Persona taxonomy is genuinely unsettled — we'll discover what matters by reading actual reviews. Natural language captures whatever the classifier picks up; we're not pre-committing to a vocabulary.
- The Mirror tool's job is "find a similar customer", which is fundamentally a similarity query, not a faceted filter. Cosine search delivers that natively.
- Debuggability is fine — `persona_summary` is human-readable; QA can read the row to see what the classifier inferred.
- Filtering by region (the one persona-adjacent dimension we're confident about) stays in the structured `region TEXT` column for the cases where geography matters.

**Trade-off accepted**: faceted persona filtering is impossible without a content embedding. If a future use case wants "show me only solo travellers in their 40s", we'd need to either add structured columns at that point (cheap migration) or run a second classifier pass to extract specific fields. For now, the embedding-driven retrieval is the only matching mechanism.

**Swap cost**: Low. Adding structured persona columns later is a `ALTER TABLE ADD COLUMN` + a Haiku-classifier re-run that extracts fields from existing `persona_summary` text. The decision is reversible.

## C.29 — Page prose is the dominant content supply for Inspire/Reassure/Inform

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: Surfaced by the 2026-04-29 data review against the loaded SQL dump. 482 content-relevant pages (excluding accommodation/ship/itinerary/trip-anchored types and Profile staff bios per C.27 + test pages per C.28) carry **~2 MB page-level prose** (intro_text + summary) plus **~2 MB contentblock prose**. By comparison, the blog corpus is ~6.3 MB but more sprawling/editorial; pages are tighter, on-message, and properly sectioned by `subheading`. Top contributing pagetypes by block-prose volume: Guidebook (87 pages, 523K chars), Swoop (43 pages, 415K chars — the sustainability/B-Corp/About-Swoop slice is the canonical TrustProof source), City (23, 226K), Activity (25, 147K), Region-Activity (26, 127K), Profile *(excluded)*, National Park (16, 112K), Region (16, 102K). The earlier plan focused on the blog as the primary content surface; the pages eclipse it. ETL capacity tilts page-first, with the blog as a parallel narrative-rich complement.

The pagetype → job mapping is documented in [planning/02-impl-retrieval-and-data.md](02-impl-retrieval-and-data.md) §2.5.

**Swap cost**: Low. The four job-shaped derived tables (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`) ingest from both pages and blog with the same chunking/embedding contract — adjusting the source-mix is a matter of which `pagetype_id` filters land where in the export SQL.

## C.28 — Test pages filtered at ETL boundary

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: Some pages in the dump are obvious dev/staging artefacts (e.g. "Megs Test Page", "Test (Zoe) - Los Glaciares National Park", "Test meggg"). Mechanical hygiene: filter at the ETL boundary with a heuristic — `WHERE alias NOT LIKE '%test%' AND title NOT LIKE '%Test %'`. No architectural significance; just keeping the derived store clean.

**Swap cost**: None. If the heuristic over- or under-filters in practice, adjust the WHERE clause and re-run.

## C.27 — Profile pagetype excluded from ETL

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: 40 pages of Swoop's specialist team bios (Agustín, Alicia, Ben, Carola, Cecilia, ...) under `pagetype_id=20` (Profile). Per Al's stance — "we don't care about authors / strip" — excluded from ETL. They don't fit any of the five conversational jobs: visitors aren't being mirrored against staff, and Puma's handoff is to a sales-team inbox, not to a specific specialist. May reappear if a future release adds a "speak to specialist X" affordance; not in Puma scope.

**Swap cost**: Trivial. One `WHERE pagetype_id != 20` clause in the export. Reversed in the same one-line edit.

## C.26 — Customer-review supply is dangling in the dump; `find_someone_who` is conditional

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: The 2026-04-28 chunk-C plan committed to feeding the Mirror tool (`recall_someone_who` then, `find_someone_who` now per C.25) from `contentblock_customerreview` (2,390 rows) + `contentblock_customertip` (119) + relevant blog posts. The 2026-04-29 dump inspection revealed those `contentblock_*` tables are **pure junctions** — they hold FK references to `customerreview` / `customertip` source tables that don't exist in the dump. PII redaction at export time is the most likely cause. Same for `contentblock_pressreview` (0 rows alive but the source `pressreview` table is also missing).

Net: **2,390 dangling FK references with no prose attached.** The Mirror tool's intended supply is reduced to ~15 first-person blog posts.

Action: Al asks Swoop for a separate redacted export of `customerreview` + `customertip` tables (names stripped, PII removed). If granted, `find_someone_who` ships with the original supply level; the persona-signal extraction pass at ETL (per C.t3a) handles structuring. If not granted, **`find_someone_who` is dropped from Puma's tool surface**, and the Mirror job is filled inadequately by the blog alone — a known gap to revisit post-launch (potentially via Trustpilot scrape or a Swoop-curated story library). Swoop ask captured in `questions.md`.

**Swap cost**: Low if granted (one new ETL source table, mechanical). If dropped: removing one tool from the eight-tool surface, the corresponding Zod schemas, and the matching widget — ~half a day total. The architecture supports re-adding the tool when supply improves.

## C.25 — Five-jobs / eight-tools intent-named surface (replaces C.19)

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: The 2026-04-28 plan named ten tools (five PoC + five sales-shaped composer tools per C.19/C.22). The 2026-04-29 review ran first-principles top-down from the sales journey: at every conversational moment the data does one of four jobs (Inspire / Mirror / Reassure / Inform), plus a fifth structural-output job (Propose-options). Five jobs → five jobs-shaped tools; plus the carried-forward `illustrate` + `handoff` + `handoff_submit` utility set = **eight tools**.

Tools (intent-named):
- `find_inspiring(theme | region | mood)` — Inspire
- `find_someone_who(visitor_signal)` — Mirror *(conditional on C.26)*
- `find_proof(concern | topic)` — Reassure
- `lookup(question)` — Inform
- `find_options(filters)` — Propose options
- `illustrate(scope)` — visual companion
- `handoff(reason, summary)` — open lead-capture
- `handoff_submit(payload)` — submit lead

The PoC tools `search` and `get_detail` are deprecated alongside C.19 — their surface absorbs into `lookup` (free-form factual) and `find_options` (structured trip filter). The composer tool names (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`) never shipped and don't appear anywhere outside the now-superseded planning text.

Mapping the five tools to four+1 jobs follows the framing arrived at in the 2026-04-29 thinking session: Inspire turns vague interest into vivid anticipation; Mirror lets visitors see themselves in someone who's done it; Reassure converts curiosity into confidence to talk to a human; Inform answers concrete questions; Propose-options is the closest the agent gets to recommending. Tool descriptions encode the conversational moment Sonnet uses to pick.

**Swap cost**: Medium. Backing out to the previous ten-tool / composer surface means restoring the deprecated schemas, the composer code, and re-augmenting B.t3a / D.t9 instead of replacing. Adding a sixth job (e.g. a dedicated FAQ tool separate from `lookup`) is additive and cheap.

## C.24 — No composer layer; cheap LLM moves to ETL (replaces C.22)

**Decided**: 2026-04-29
**Owner**: Al

**Rationale**: The C.22 composer pattern was justified when tool outputs were *vague* (`stoke_imagination` returns "evocative content" — what shape exactly?). Once the eight intent-named tools (C.25) are designed with concrete row-shaped outputs, an internal Haiku-driven composer between handler and data primitives adds no value: tool descriptions encode intent for selection, and Sonnet's native skill is weaving structured material into conversational prose. One LLM call per turn (Sonnet only) — lower latency, lower cost, fewer failure modes than the C.22 three-layer architecture.

The composer pattern stays in the toolbox for any future tool that genuinely needs multi-step retrieval Sonnet can't plan reliably from a description alone — none of Puma's eight meet that bar. Adding one later is additive: a single new file `src/composers/<tool>.ts` between handler and data primitives. The data-primitive layer is unchanged; nothing about the architecture forecloses composer addition.

**Where Haiku does earn its keep — at ETL/ingest, not query**:
- Classifying each blog post into one (or more) of the four content jobs (Inspire / Mirror / Reassure / Inform).
- Extracting persona signals from each first-person customer story (and customer reviews if C.26 unblocks them) — solo / family / age band / motivation tag — stored as structured columns the `find_someone_who` tool can match on.
- Generating image annotations + tags for the `image` table (per C.10).
- Normalising blog tags against the `ntag` taxonomy (per C.17).

These are batch, persisted-once jobs running off Cloud Run Jobs. Done at ETL time, not on the conversational path.

**Swap cost**: Low both ways. Removing composers is a code deletion (no data migration). Adding a composer back for a single tool is one new file. The data-primitive layer is invariant.

## C.23 — Firestore dropped project-wide

**Decided**: 2026-04-28
**Owner**: Al

**Rationale**: Earlier defaults pointed at Firestore for the handoff store (E.1) and as one of the candidate post-M4 session backends (B.2). With C.18 committing to Cloud SQL Postgres for retrieval, the operational case for a single Postgres instance covering retrieval + handoff + (post-M4) sessions wins decisively over running a separate Firestore service. Single backup, single IAM scope, single monitoring surface, SQL across all derived data. Firestore is dumped completely from active plans — no longer a candidate for any storage role.

**Code follow-up scope** (captured in [inbox.md](../inbox.md) as a deferred cleanup task): Tier 3 plans + shipped code still mention Firestore in a few places, and these get cleaned up alongside the post-M4 session-backend implementation work, not now: (a) `planning/03-exec-agent-runtime-t2.md` references `session/firestore.ts` and the `SESSION_BACKEND="firestore"` enum value — the file gets renamed to `postgres.ts` and the enum value to `"postgres"`. (b) `planning/03-exec-agent-runtime-t6.md` documents the same enum. (c) `planning/03-exec-observability-b.md` describes a future contract for `createHandoffSubmitHandler` writing to Firestore — that contract becomes "writes to the Postgres `handoff` table". (d) `planning/01-side-quest-persistence.md` lines 77, 80 reference "the eventual Firestore migration" — superseded text in a partially-superseded doc; flagged for archive review.

**Swap cost**: None (Firestore was never wired). The follow-up code cleanup is mechanical: rename one file, update one enum, update one docstring. ~30 minutes of work bundled into the post-M4 session-backend task.

## C.22 — ~~Composer pattern: per-tool Haiku sub-agent inside the connector~~ — **SUPERSEDED by C.24 (2026-04-29)**

**Decided**: 2026-04-28 — **Superseded 2026-04-29 by C.24**
**Owner**: Al

**Status**: No composer layer in Puma. Cheap LLM (Haiku) moves to ETL (blog-post classification, persona-signal extraction, image annotation, tag normalisation). See C.24 for the rationale and C.25 for the eight-tool intent-named surface that replaces the ten-tool composer surface.

**Original rationale (preserved for context)**: 5 of the 10 external tools (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`) are fronted by a **composer** — a Haiku 4.5 sub-agent inside the connector that decomposes the sales-shaped request into calls against pure-SQL data primitives, runs them, and synthesises a coherent sales-shaped response. The other 5 tools (`search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`) are pass-through (no LLM). The composer pattern keeps the orchestrator's tool surface clean — Sonnet sees sales-stage tools, no retrieval-plumbing leaks — and isolates retrieval composition from the orchestrator. Important for downstream changes (different orchestrator LLM, different vendor, additional non-retrieval workload — keeping retrieval composition inside the connector means changes there don't leak into orchestrator tooling). Cost shape: per-conversation cost approximately flat as Sonnet-side composition reduction balances Haiku-side composition addition.

**Swap cost**: Medium. Removing the composer layer means each external tool becomes a single SQL primitive call (which loses synthesis quality but works); promoting Haiku → Sonnet in composers is a config change. Adding a new composer is one new file `src/composers/<tool-name>.ts`.

## C.21 — Source pipeline: SQL dump → transform → Cloud SQL Postgres

**Decided**: 2026-04-28 — **summary reframed 2026-04-29** to drop the no-longer-canonical MariaDB step.
**Owner**: Al

**Rationale**: Supersedes the 2026-04-22 plan's scrape-vs-API question. The 2026-04-27 SQL dump is upstream-of-truth (per Julie call: "dump is canonical"). Pipeline shape: drop dump at `data/<dump>.sql` → run a declarative transform that whitelists/flattens/denormalises/computes derived columns → stream into Cloud SQL Postgres (prod) or local Docker Postgres (dev). The transform reads the MariaDB-format dump file directly; tooling pick (e.g. `pgloader` + a SQL transform layer, or a Node CLI translator) lands at C.t3 design time. Cadence assumed weekly during M1–M5; steady state TBC with Swoop ops (could become an API, CDC, or scheduled feed). Disposable — when Swoop's source schema changes, the transform gets rewritten; nothing downstream needs to change.

**Note on the C.t0 dev-time MariaDB step**: during the design phase (2026-04-27 → 2026-04-29) we loaded the dump into a local MariaDB to SQL-poke the data while shaping the entity model. That was a tactical inspection step for human design work — **closed and not part of the canonical pipeline**. The original 2026-04-28 framing of this decision included MariaDB as a pipeline step; the 2026-04-29 reframe drops it.

**Swap cost**: Medium. Source change means rewriting the transform; destination change means swapping Postgres for an alternative engine (bounded by C.18's swap cost).

## C.20 — Blog ingest as separate stream via WP REST API; 5y fetch-time-filtered window

**Decided**: 2026-04-28
**Owner**: Al

**Rationale**: Swoop's blog (~465 posts spanning 15+ years on `swoop-patagonia.com/blog/wp-json/wp/v2/posts`) is fetched independently of the SQL-dump ETL. 5y rolling window applied at fetch time via `?after=<5y-ago>` — older content is genuinely stale (defunct hotels, changed routes, dated voice) and not retrieved. ~108 posts in the current window, ~2–5 MB raw NDJSON. Snapshots stored at `data/blog/raw/<utc-stamp>/`; resume floor in the latest manifest. Independent of the SQL-dump ETL — runs on its own cadence. Plan: [03-exec-blog-ingest.md](03-exec-blog-ingest.md).

**Swap cost**: Low. WP REST API → alternative source (SQL dump, alternative API) is a one-script swap.

## C.19 — ~~Sales-shaped tool surface, woven with existing PoC tools~~ — **SUPERSEDED by C.25 (2026-04-29)**

**Decided**: 2026-04-28 — **Superseded 2026-04-29 by C.25**
**Owner**: Al

**Status**: Eight intent-named tools (Inspire / Mirror / Reassure / Inform / Propose-options + carried-forward illustrate + handoff pair) replace the ten-tool sales-shaped surface. The composer-driven tool names (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`) never shipped. PoC's `search` and `get_detail` are deprecated alongside (their surface absorbs into `lookup` / `find_options`); `illustrate`, `handoff`, `handoff_submit` carry forward intact. See C.25 for the canonical surface.

**Original rationale (preserved for context)**: The agent's external tool surface combines the 5 PoC-derived tools (`search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`) with 5 new sales-shaped composer tools (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`). **10 tools total** — within Claude's working-memory budget. The PoC tools carry forward intact (three are already sales-shaped: `illustrate`, `handoff*`; the two data-shaped ones — `search`, `get_detail` — are kept as escape hatches for direct visitor queries that don't need narrative framing). The 5 new tools are composer-driven (per C.22) for sales-stage moments. Sales discipline lives in tool-description prose + the system prompt, not in the tool-list shape — `search` / `get_detail` descriptions tilt the agent away from them when sales-shaped tools fit. This is "weave" rather than "replace": existing schemas, adapters, and widgets carry forward; new ones added alongside.

**Swap cost**: Medium. Backing out to a smaller (sales-only) or larger (full data API) surface means rewriting tool descriptions, regenerating widgets, and regenerating Zod schemas. Tool-description authoring is the dominant cost (5 new prose blocks under `cms/prompts/tools/<tool>/description.md` per G.11).

## B.22 — Session backend strategy: ADK in-built first, custom Postgres `SessionService` post-M4 if budget

**Decided**: 2026-04-28
**Owner**: Al

**Rationale**: Refines B.2 (which left the post-M4 backend choice open between Vertex AI Session Service / Firestore / Cloud SQL). Phase 1 sticks with ADK's in-built in-memory `SessionService` — the simplest in-built option that demonstrably works for the vertical slice. Post-M4, the upgrade is a **custom Postgres `SessionService` implementation** writing to the same Cloud SQL instance that holds the retrieval and handoff stores (single-store philosophy per C.18). Vertex AI Session Service is out of scope (cost, lock-in, separate ops surface for marginal benefit). Firestore is out per C.23. The custom implementation is a thin wrapper — days of work — and consolidates all our owned durable state into one DB. Sequencing: ship ADK-in-built first, validate it works under real load, then promote to Postgres if/when budget supports the implementation work.

**Swap cost**: Medium. The `SessionStore` interface is stable; swapping ADK-in-built for the Postgres impl is ~one file. Backing out from Postgres back to a managed alternative (e.g. if scale demands) is another impl behind the same interface.

## E.10 — Handoff store on Cloud SQL Postgres (Firestore dropped)

**Decided**: 2026-04-28
**Owner**: Al

**Rationale**: Refines E.1 (which committed to Firestore as default). With C.18 putting Cloud SQL Postgres in the stack for retrieval, the operational case for using the same Postgres instance for the handoff store is decisive: one DB to back up, monitor, and IAM-scope; SQL queries for ad-hoc handoff analytics; same retention enforcement pattern (`DELETE … WHERE scheduled_deletion_at < NOW()`) as everything else; aligns with the "single store for everything we own derived-side" framing. The `HandoffStore` interface stays in `ts-common` for swap-out optionality, but no other backend is currently in scope. Firestore dropped per C.23.

**Swap cost**: Low. The interface is stable; swapping the Postgres impl for an alternative is one file. Postgres handles the write volume trivially (handoffs are write-heavy but very low rate; thousands per year).

## C.18 — Storage engine: Postgres 16 + pgvector + tsvector + pg_trgm; no Vertex AI Search

**Decided**: 2026-04-28
**Owner**: Al (after Swoop confirmed Postgres acceptability post-Julie call)

**Rationale**: Earlier in the engagement we'd hesitated on Postgres because optically it looks "like another MariaDB" to the Swoop ops team. That objection is now resolved — Swoop are explicitly happy for us to proceed with Postgres. With that constraint gone, the choice between **Postgres alone** and **Postgres-plus-Vertex AI Search** comes down to scope and operational reality.

We pick **Postgres alone** because at Puma's actual size — hundreds of trips, ~108 blog posts in the rolling 5y window, ~10K CMS chunks — every Vertex strength either doesn't apply or is dwarfed by what `pgvector` + `tsvector` + `pg_trgm` give us in one engine:

- Semantic similarity → `pgvector` HNSW indexes (sub-ms at our scale)
- Lexical / keyword → `tsvector` + `tsquery` + GIN, Porter-stemmed and weighted
- Typo-tolerant fuzzy → `pg_trgm` (perfect for "Torres del Pain" → "Torres del Paine")
- Hybrid retrieval → reciprocal rank fusion in a single SQL query with CTEs + window functions
- Filters / facets / aggregates → standard SQL

Adding Vertex on top would actively cost us:
1. **Local-dev parity** — Postgres + Docker Compose locally is identical to Cloud SQL prod. Vertex has no local mode; the alternative is stubbing or remote-querying from a laptop.
2. **Two-store sync** — every Postgres write would need to propagate to a Vertex index with minutes-to-hours latency. Subtle freshness bugs hide in that gap.
3. **Cost predictability** — Cloud SQL Postgres ~£25–40/mo flat; Vertex per-query + storage scales with agent traffic, easily £100+/mo at modest usage for marginal-or-imaginary gain at our scale.
4. **Schema iteration speed** — `ALTER TABLE` in Postgres vs re-indexing in Vertex during dev iteration.
5. **Debuggability** — `EXPLAIN ANALYZE` vs vendor black box.
6. **Lock-in** — Postgres data and queries are portable; Vertex-indexed structures aren't.

Vertex genuinely wins for million-doc corpora, multimodal search, or out-of-the-box generated answers. None apply to Puma. The agent already produces answers via Claude in the agent-with-tools loop (decision D.11 territory); generated-answer-as-a-service is a duplicate capability for us, not a new one.

**Stack pinned by this decision:**
- **Postgres 16** — current stable, supports modern `pgvector` and FTS features.
- **`pgvector`** — HNSW indexes on embedding columns; cosine distance default.
- **`pg_trgm`** — trigram fuzzy matching extension.
- **Native FTS** (`tsvector`/`tsquery`/GIN) — built into Postgres core.
- **Cloud SQL for Postgres** in Swoop's "AI Pat Chat" GCP project for prod (small instance: `db-f1-micro` or `db-g1-small`).
- **Postgres 16 in Docker Compose** locally — same image, identical behaviour.
- **Schema migrations**: `node-pg-migrate` (plain-SQL, lean; Prisma rejected as too heavy for our shape — sub-decision worth flagging if it bites us).
- **Embedding model**: pending lock — leaning Voyage-3 per Anthropic's recommended pairing; swap cost is one column re-population.

**When we'd revisit Vertex** (named triggers, not vibes):
- Document corpus grows past ~100K (current trajectory says no, even with Antarctica + Arctic expansion — agent reasoning scales, not document count).
- Recall/precision issues we've shown can't be solved with better embeddings, chunking, or RRF tuning.
- Genuine multimodal need (e.g. search-by-image of a region) becomes a real product requirement.

The agent-with-tools architecture means Vertex would slot in later as **one new tool implementation** behind the existing tool surface, with no rearchitecting of the agent or other tools. So this is a low-regret decision — the cost of deferring Vertex is essentially zero.

**Swap cost**: Medium. Replacing Postgres with DuckDB or Vertex later means rewriting the dump-to-store transform pipeline and the connector's storage layer behind the tool surface. The agent tool surface itself, the entity model, the retrieval semantics, and the RRF approach all carry across unchanged — they're the abstraction. So "swap" is real engineering work but bounded to one layer and shouldn't bleed into agent or product behaviour.

## C.17 — `ntag` is the live tagging system; `tag` + `adventurousness` deprecated

**Decided**: 2026-04-27 (Julie call)
**Owner**: Al + Julie

**Rationale**: Inverts the first-pass ontology assumption. Per Julie call: the `tag` table (2,374 rows) is dead — ignore entirely. The `ntag` (79 entries) + `ntags_lookup` (157,537 entries) system is the live tagging surface; use `ntag` for all tag-related queries and embeds. Separately: the `adventurousness` table (11 rows) is deprecated/ancient; difficulty (1–5) and wilderness (0–5) are surfaced as raw integers without a user-facing legend.

**Swap cost**: Low. ETL queries reference `ntag*` instead of `tag*`. If Swoop ever revives `tag`, the ETL queries change; one file.

## C.16 — Page-as-hub pattern for cross-entity widget rendering

**Decided**: 2026-04-27 (Julie call)
**Owner**: Al

**Rationale**: Records that don't carry images directly (e.g. `hotel`) reach images via their `page_id` join. Same rule applies for any record-with-page_id pattern. The `page` row is the presentation hub, holding both the canonical URL (per C.15) and the linked image set. This gives the agent a uniform widget-rendering rule across hotel/location/trip/etc., and avoids per-entity image lookup logic.

**Swap cost**: Low. One resolver utility (`resolveImagesViaPage` in `ts-common`) encapsulates the rule. If a new entity needs different image-resolution logic, that entity's data primitive overrides.

## C.15 — URL + image construction rules

**Decided**: 2026-04-27 (Julie call)
**Owner**: Al

**Rationale**: SQL dump stores image filenames only and page records with `override_url` + `alias` columns. Rules: (a) Image URLs constructed as `https://swoop-patagonia.imgix.net/<filename>?<imgix-params>` with parameterised render variants (small thumbs for inline mentions, larger crops for widget hero images, originals for detail views). (b) Page URLs derived as `override_url || alias`. (c) Records with `page_id` (e.g. `hotel`) traverse to their `page` row to get URLs and the image set — see C.16 (page-as-hub).

**Swap cost**: Low. Two `ts-common` utilities (`buildImgixUrl`, `resolveImagesViaPage`) encapsulate the rules. If the imgix domain changes or page-URL conventions shift, one file changes.

## C.14 — No departures, no swoopers, headline pricing only

**Decided**: 2026-04-27 (Julie call)
**Owner**: Al + Julie

**Rationale**: Three product pruning rules baked in by Julie call after first-pass dump inspection:
1. **No departures** — Patagonia is largely demand-driven, departure data shifts daily, and the bot stating availability risks misrepresentation; the dump has no `departure` table anyway. The bot answers "departures run throughout the season — let's talk to a specialist about your preferred dates" rather than ever quoting bookable dates.
2. **No swoopers** — `swooper_*` fields in the source data are *customer* PII (Swoop's term for their customers, not their staff). Off-limits in the derived store. Specialist hand-off goes to a generic "Patagonia specialist" rather than assigning a named advisor pre-call.
3. **Headline pricing only** — surface `trip.base_price` from the SQL dump as-is. No calculated ranges, no tier × season grids, no occupancy-specific quotes. Dated/specific pricing routes to specialist. `raw_price` and `window_price` are website-runtime calculations and not surfaced.

**Swap cost**: Low. Each rule maps to a tool-description constraint + an ETL whitelist exclusion. Loosening any rule is a content + schema decision, not architecture.

## C.13 — Sales-funnel "golden thread" principle

**Decided**: 2026-04-27 (Julie call)
**Owner**: Al + Julie

**Rationale**: The bot's organising principle: move visitors **Awareness → Interest → Strong Consideration**. Default lean: imagination + consideration content. Engages on specifics (including pricing ranges and trip details) when the visitor pushes, refuses only when the answer would build a *shadow itinerary* — specific bookable dates, definitive package quotes, fake-feeling commitments that misrepresent what's actually available. Specialist hand-off is the natural close of the funnel, not a failure mode. This is the project's organising principle for tool descriptions, system prompts, content authoring, and refusal boundaries. Phrased as a "golden thread" rather than a strict rule — the gradient matters: the bot can engage with specifics when a visitor persists, as long as the answer doesn't construct a shadow itinerary. (Al: "without the fascism".)

**Swap cost**: Conceptual; not architectural. Reframing the project would require rewriting tool descriptions + system prompt + parts of `cms/`. Not a code-shape decision.
## G.11 — CMS folder structure: `cms/prompts/{system,skills,tools}/`; system prompt is concatenation of `system/`

**Decided**: 2026-04-27
**Owner**: G chunk + B.t1a follow-up (raised by Al during a planning session after observing the G.10 wiring gap in live testing)
**Rationale**: G.10 (2026-04-24) split style guidance into `why.md` + `style-avoid.md` but left the wiring undefined — "referenced from the WHY prompt" with no mechanism. Live testing on 2026-04-27 surfaced the gap: `style-avoid.md` existed on disk but no code loaded it. The agent never saw the rules. Resolved by giving `cms/prompts/` a deliberate sub-structure with one well-defined load contract per concern:

- `cms/prompts/system/` — system-prompt fragments. Files matching `^\d{2}_[a-z0-9-]+\.md$` are concatenated in lexicographic order at load time, separated by `\n\n---\n\n`. The agent's `instruction` is the joined string. Files not matching the pattern (drafts, `README.md`, `.notes.md`) are ignored. Two-digit numeric prefixes guarantee deterministic ordering past 9; sparse numbering (00, 10, 20…) leaves gaps for inserts without renumbering.
- `cms/prompts/skills/` — ADK-loaded modular guidance, on-demand per the model's skill triggers. **One folder per skill**, matching ADK 1.0's `loadAllSkillsInDir` contract: each skill is a directory containing `SKILL.md` (YAML frontmatter `name` + `description` + body) plus optional `references/`, `assets/`, `scripts/` subdirs. Skill names are snake_case or kebab-case per ADK's `SNAKE_OR_KEBAB_NAME_PATTERN`. (B.t9 wires the loader; G.t3 authors content.)
- `cms/prompts/tools/` — fragments consumed by individual MCP tools, organised one sub-folder per tool name (`tools/handoff/`, `tools/illustrate/`, etc.). Tool code reads from its own folder explicitly; no auto-loading. Used for tool descriptions, structured-content templates, post-handoff guidance, and similar tool-scoped copy.

The system-prompt concatenation contract is the simplest viable composition mechanism: deterministic, debuggable (you can `cat cms/prompts/system/*.md` and see what the agent sees), no metadata, no interpolation, no per-turn assembly. It's the file system as content management. Per-turn dynamic fragment composition stays explicitly out of scope per `02-impl-agent-runtime.md` §2.5a — the always-on companion-content case is a different problem.

The structure also resolves the G.10 coupling: positive-voice authoring (Al, taste-driven) and avoidance-list authoring (pattern-driven, living doc) iterate independently because they're separate files in `system/`, both loaded automatically, neither needing to reference the other.

**Swap cost**: Low. (a) If concatenation order needs to be explicit (e.g. config-driven manifest rather than filename-driven), the loader takes a manifest argument; existing files keep working. (b) If the system prompt grows large enough that concat-on-every-load becomes expensive, prod already caches; dev can grow file-mtime invalidation. (c) ADK's skill loader already expects directories, so the structure is forward-compatible without rewrite. (d) If we move to a real CMS post-Puma, the directory structure maps to a CMS taxonomy with no semantic loss.

## D.25 — HANDOVER.md is not versioned; next release supersedes or appends

**Decided**: 2026-04-24
**Owner**: D.t8 executing agent
**Rationale**: Handover doc describes a live extension surface. Version numbers on a single-surface doc invite drift. Next material surface change lands as an appended v2 section or a replacement file; Puma ships one HANDOVER per release. If multi-version support becomes necessary (unlikely pre-V2), split at that point.

**Swap cost**: Zero. Start versioning when needed.

## D.24 — HANDOVER.md lives at `product/ui/HANDOVER.md`

**Decided**: 2026-04-24
**Owner**: D.t8 executing agent
**Rationale**: Co-located with the package being handed over. Not in `docs/` or repo root — Swoop's team opens the `ui/` folder on day one; the doc should be at eye-level there. No separate docs site needed for one file.

**Swap cost**: Low. File move + link update.

## D.23 — Iframe trigger design is Swoop's call; Puma documents minimum dimensions + CSP + CORS

**Decided**: 2026-04-24
**Owner**: D.t8 executing agent
**Rationale**: Swoop's in-house team owns the trigger button (placement, copy, animation, badge-vs-panel). Puma documents the technical contract the iframe needs: minimum 320×520, required `frame-ancestors` CSP directive, CORS allow-list for `/chat` + `/session` + `/session/:id/ping`. Mock-host sidebar pattern is reference, not contract — Swoop may diverge. Avoids us committing to a UX we don't own.

**Swap cost**: Low. The contract items (dimensions, CSP, CORS) are technical minimums. If Swoop's integration testing surfaces new requirements, document them.

## D.22 — `data-swoop-part="<name>"` attribute hooks on 10 component points; rejected React slot props / render-prop overrides / theme-context injection

**Decided**: 2026-04-24
**Owner**: D.t8 executing agent
**Rationale**: Ten additive `data-swoop-part="<name>"` attributes across seven primitive files cover ThreadSurface header, ChromeBadge, Composer root + send, ErrorBanner, OpeningScreen dialog + primary/secondary buttons, widget shell with per-widget discriminator, lead-capture summary + submit-wrapper. Rejected three alternatives: (a) React slot props — Swoop consumes Puma as a running iframe, not as a library, so slot props add surface we can't exercise; (b) render-prop overrides — same reason; (c) theme-context injection — crosses the iframe boundary awkwardly, and CSS custom-properties already cover the theming axis. Attributes are inspectable in DevTools by Swoop's team and survive Tailwind-class refactors on our side because they're not coupled to class names. `data-swoop-part` is the override-selector convention; `data-swoop-widget` discriminates widget-type; `data-swoop-widget-state` discriminates lifecycle state.

**Swap cost**: Low-ish. If we ever expose a React-component API (e.g. Swoop wants to embed Puma's components directly rather than via iframe), `data-swoop-part` attributes remain valid — they just become the thing Swoop styles alongside React slot props. If we remove an attribute, Swoop's CSS targeting it breaks; add deprecation notice one release ahead.

## D.21 — 12-token CSS custom-properties surface across colour / radius / type / density, scoped to `[data-swoop-root]`

**Decided**: 2026-04-24
**Owner**: D.t8 executing agent
**Rationale**: Twelve tokens on four axes: colour (6), radius (2), type (2), density (2). Consumed via Tailwind `theme.extend` plus a density-scaled padding utility set. Rejected: fewer tokens (Swoop forks because they can't hit their brand); more tokens (public API we can't break without reshipping); `:root` scope (leaks into ChatGPT apps embedding Puma's artefacts later); shadow and hover tokens (derived from colour tokens plus Tailwind's own shadow scale, not worth promoting). Tokens scoped to `[data-swoop-root]` means Swoop sets them on the chat-root element only; Puma's own dev surfaces stay on defaults.

**Swap cost**: Medium. The token set becomes a public API the moment HANDOVER.md ships to Swoop. Adding tokens is safe; removing or renaming is a break. Deprecate via comment in CSS + HANDOVER.md ahead of any shrink.

## B.21 — Warm-pool sweep interval capped at 5 minutes regardless of TTL

**Decided**: 2026-04-24
**Owner**: B.t10 executing agent
**Rationale**: Sweep interval default is `ttlMs / 4` clamped to `[1s, 30s]` originally, but a 5-min cap in all cases ensures stale entries don't linger when TTL is configured high. Prevents a pathological case where `WARM_POOL_TTL_MINUTES=60` makes sweeping fire every 15 min — long enough for a cluster restart to be invisible and for pool entries to survive longer than their TTL. Explicit 5-min cap is a ceiling; shorter intervals still honoured for shorter TTLs.

**Swap cost**: Low. One constant.

## B.20 — Warm-pool pre-warm is eager async at startup, not lazy on first request

**Decided**: 2026-04-24
**Owner**: B.t10 executing agent
**Rationale**: Eager pre-warm fires at orchestrator startup — while the process is settling, the pool fills in the background. First `POST /session` arrives to a ready pool on the happy path. If pre-warm is still in flight, first request falls through to cold cleanly (no queueing). Lazy (on-first-request) pre-warm would defeat the point — the first visitor pays the full cold-path cost. Eager has a memory cost that's well-understood (`targetSize` sessions at most); lazy has a latency cost that's the whole thing we're trying to remove.

**Swap cost**: Low. Flip the `preWarmOnStart` bool if eager ever causes startup problems.

## B.19 — Two warm-pool event kinds only: `warm_pool.hit` and `warm_pool.miss`; no `prewarm` or `evict`

**Decided**: 2026-04-24
**Owner**: B.t10 executing agent
**Rationale**: F-a reserved two event-kind slots for warm-pool observability. B.t10 declines to add more. Pre-warm activity is already observable via the `poolSizeAtClaim` field on every hit/miss plus a startup log line; `prewarm.completed` or `prewarm.failed` events would duplicate information already carried by `error.raised` for failures and by the size field for successes. Eviction is the same story — deriving eviction rate from `(miss count) × (rate of claims)` is cheaper than emitting a dedicated event. Keeps the event stream lean; F-a's schema stays at 20 kinds not 22.

**Swap cost**: Low. If operational experience shows derivable signals aren't visible enough in the analytics backend, add the kinds in a future minor — they're additive to the discriminated union.

## B.18 — Warm-pool events emitted inline by B.t10, not via F-b retrofit

**Decided**: 2026-04-24
**Owner**: B.t10 executing agent (with planner-fb's agreement)
**Rationale**: The pool's emission points live inside B.t10-owned files (`warm-pool.ts`, `warm-pool-bootstrap.ts`). F-b's retrofit pass deals with legacy `console.log` sites; warm-pool had no legacy to retrofit. B.t10 imports `emitEvent` from `@swoop/common` and calls it directly at hit/miss points. F-b gets a reviewer spot-check role only — no code-path ownership of warm-pool observability.

**Swap cost**: Zero. Pattern matches D.12 (adapter error emitter) and F-a's module-level sink convention. If emission shape changes, both call sites + the schema update together in the same patch.

## B.17 — Warm pool pre-allocates both Puma `SessionState` and ADK `sessionService.createSession`, not just Puma side

**Decided**: 2026-04-24
**Owner**: B.t10 executing agent
**Rationale**: The two-session-store coordination rule from B.14 (one Puma session + one ADK session per sessionId) means pre-allocating only Puma's side leaves the ADK session creation on the critical path — and post-M4 that becomes a network call to Vertex AI Session Service, which is the latency we're actually trying to remove. Pool pre-allocates both; claim hands back a sessionId for which both halves are ready. Cost is double the memory per pool entry, which is still small (state blob + an empty ADK session log) and capped by `WARM_POOL_SIZE`.

**Swap cost**: Low. Pool internals; pool interface doesn't change whether one or both halves are pre-allocated. If the two-store coordination changes (e.g. ADK sessions become implicit), drop the second allocation.

## B.16 — Warm pool is a LIFO stack, not a FIFO queue

**Decided**: 2026-04-24
**Owner**: B.t10 executing agent
**Rationale**: Freshest-first serving. Entries at the top of the stack are the most recently pre-warmed, so their TTL is further from expiry — fewer stale-entry rejections at claim time. FIFO would hand out the oldest entry first, which has the least remaining TTL and the highest chance of being invalidated by the sweep before handoff completes. LIFO is cheap to implement (`Array.push` + `Array.pop`) and makes the TTL story simpler: the sweep deletes from the bottom, the claim takes from the top, both sides of the stack converge cleanly.

**Swap cost**: Low. `push`/`pop` → `push`/`shift` is two lines. If ordering ever matters for observability (e.g. "oldest entries fill up first"), revisit.

---

## G.10 — Style control authoring: paired positive-example paragraphs + explicit avoidance list

**Decided**: 2026-04-24
**Owner**: Al (raised during wave-1 reconvene after observing em-dash-heavy cringe-AI output in live testing)
**Rationale**: The existing §2.1 of `02-impl-content.md` positioned the WHY prompt's voice guidance as "a couple of illustrative paragraphs, not a style guide. Show, don't tell." Real output during D.t5 verification exposed the limit of that stance — Claude honours stylistic examples but regresses toward defaults under load (long conversations, tool orchestration, strong lean on the visitor's own phrasing). Defaults include em-dash-heavy rhythm, corporate hedges ("it's worth noting"), AI-signature verbs ("delve", "unpack", "dive into"), empty-affirmation openers ("Great question!"), and trailing offers ("Let me know if…"). None of these read like "knowledgeable friend who's been to Patagonia". Splitting voice control into two artefacts: (a) positive-example paragraphs in `cms/prompts/why.md` (anchors "good"), (b) explicit avoidance list at `cms/prompts/style-avoid.md` referenced from the WHY prompt (suppresses specific defaults). The avoidance list is a living doc — as real conversations surface new tells, they get added. F's event log is the long-term source for regression-pattern capture.

**Swap cost**: Low. If a third layer is needed (e.g. runtime style-linting of assistant output before it hits the wire), add a `postprocess/style-lint.ts` hook inside the orchestrator translator — doesn't touch the content files. Collapsing the two files back into one is a text merge; splitting was specifically to decouple the taste-driven positive pass (Al authors once) from the pattern-driven avoidance list (updates whenever new offenders appear).

## H.13 — CI gating: non-gating (`continue-on-error: true`) at Puma launch

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Realises the commitment already made at Tier 2 chunk H §H.4. Rationale stands: the harness doesn't yet have a calibrated judge (H.t5) or a real scenario set (H.t4 via G.t0), so gating on it would block PRs on arbitrary failures. Non-gating means the markdown report attaches as a PR comment via `actions/github-script`, exit code stays 0, and reviewers see regression signal without automation enforcing it. Promotes to gating post-H.t5 calibration once confidence is warranted.

**Swap cost**: Low. One line (`continue-on-error: true` → `false`) in `.github/workflows/harness.yml` when it's time to gate. No code changes.

## H.12 — Harness does not import `@swoop/common/events` in scaffold

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent (per offer from planner-e1f during wave-1 planning negotiation)
**Rationale**: planner-e1f (F-a) offered live import of the event schema so harness scenarios could assert on emitted events. Harness scaffold declined. Reason: scaffold's only assertion kinds are `contains` / `not_contains` on final utterance text; it doesn't inspect events at all yet. Event-log assertions land in H.t3 alongside the real assertion catalogue; by then F-a's schema has had time to settle and any churn in kinds doesn't ripple through the harness twice. Keeping the import surface loose in scaffold also means harness can run against a ts-common version without `events.ts` present (defensive against branch-order mismatches in early build-up).

**Swap cost**: Zero. Adding the import in H.t3 is a one-liner per assertion file; no structural change.

## H.11 — Orchestrator invocation: local HTTP against a running `:8080`, not in-process import

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Two paths. (a) Start the orchestrator in-process inside the harness (import `createApp` directly, run against it via supertest or a fetch polyfill). (b) Assume a running `:8080` orchestrator (started by the CI job as a separate step, or locally by the developer) and hit it with `fetch`. We chose (b). Rationale: (i) matches production topology — the harness exercises the HTTP + SSE surface exactly as the UI does, not a simulated one; (ii) in-process import would require refactoring the orchestrator's Express app to expose `createApp` as a factory separate from its top-level bootstrap, which is non-trivial for a scaffold and bleeds harness scope into chunk B; (iii) the cost is one extra CI step (`orchestrator &`) which is cheap; (iv) developers running locally already have the orchestrator up for the UI anyway — no new setup burden. Swap cost is also low if this becomes painful later.

**Swap cost**: Medium. Moving to in-process import requires (1) refactoring orchestrator entrypoint to expose a factory function, (2) rewiring `orchestrator-client.ts` to call it directly, (3) handling module-scoped state the orchestrator currently initialises at top-level. Revisit if CI wall-time becomes a concern (current expectation: seconds, not minutes).

## H.10 — Scenario file format: YAML, one scenario per file, under `product/harness/scenarios/`

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Three candidates: (a) JSON, (b) TypeScript, (c) YAML. Chose (c). Rationale: (i) scenarios contain multi-line prompts + multi-line expected phrases; JSON's `\n`-escaping makes these ugly in PR diffs; (ii) TypeScript would be most type-safe but turns content authoring into a code-review exercise — G.t0's HITL output needs to land as authorable files, not `.ts` modules; (iii) YAML gives clean multi-line strings, one-file-per-scenario keeps diffs scoped, and `yaml` + `zod` together give runtime-validated typed loading. One file per scenario — NOT one file listing all scenarios — so PR diffs are per-scenario and naming is the numbering scheme. Suffix `.yaml`, not `.yml`, matching the broader Node ecosystem.

**Swap cost**: Low. If YAML ergonomics fail (e.g. scenarios grow features that want richer validation), migration to TS-as-content is a one-file-per-scenario rewrite with the Zod schema already in place — same types, different loader.

## H.9 — Test runner: bespoke Node CLI, not vitest

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Counter-intuitive choice — vitest is the de-facto runner elsewhere in the repo (UI + orchestrator + ts-common). Picked bespoke CLI for three reasons. (i) **Output format**: vitest's reporter shape is test-runner-shaped (pass/fail/error with stack); the harness wants an evaluation-report shape (verdicts, judge commentary, scenario-level narrative). Fighting vitest's reporter to produce the latter is more code than writing a small dedicated reporter. (ii) **Exit-code semantics**: vitest exits non-zero on assertion failure; the harness needs to exit 0 during Puma pre-launch (non-gating) regardless of pass/fail — fightable in vitest but a natural default in a bespoke CLI. (iii) **Content-as-data boundary**: scenarios are content authored by non-engineers eventually. Piping them through a test-runner frames them as tests; piping them through an evaluation CLI frames them as evaluations. The latter is correct. Vitest stays in for the harness's own unit tests (assertion helpers, scenario loader) — those ARE tests.

**Swap cost**: Low. If vitest later grows reporter plugins / exit-code overrides that close both gaps, the CLI is ~200 LOC that could be replaced with a vitest custom reporter. The scenario format, assertions, and judge interface are reporter-independent.

---

## D.20 — Preflight scope: post-consent only

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Preflight fires only when `hasConsented === true`. Pre-consent there is no server-side session id to probe — the consent gate is the natural boundary between "no orchestrator state exists yet" and "orchestrator owns a session on this visitor's behalf". The hook takes `enabled: hasConsented` from `useConsent`; flipping it false (on reset / decline) tears down listeners cleanly via the effect cleanup. Also means the OpeningScreen surface is completely insulated from preflight logic — the new `session/` module has zero pre-consent footprint.

**Swap cost**: Low. If a future surface needs a "can the orchestrator even be reached?" health probe pre-consent, add a separate hook; do not widen `usePreflight`'s scope. The two concerns (session liveness vs. service reachability) are distinct even if they share a probe endpoint.

## D.19 — Preflight failure path: `[session_not_found]` via the shared adapter emitter; probe network errors stay silent

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: The Tier 3 plan needed to decide how a preflight-detected expiry should reach the UI. Two options: (a) invent a new channel (a dedicated `onExpired` prop or a second emitter) that the banner subscribes to in parallel with the existing `subscribeAdapterErrors`; (b) reuse the D.12 module-level emitter and encode expiry with the same `[session_not_found]` marker convention `/chat` 404s already use. We chose (b). Rationale: (i) D.12's invariant is "one wire for comms failures" — fracturing that wire into two parallel channels defeats the design; (ii) the classifier's marker matching (`errors/classify.ts`) already routes `[session_not_found]` to `session_expired` without any code change; (iii) the banner's "Start a new conversation" button already chains through `handleFreshChat → refreshSession`, which is exactly the action we want on preflight-detected expiry too; (iv) copy, classification, and UX are identical to the reactive path, so the visitor experience is consistent regardless of which channel detected the expiry. A strict corollary: probe-side `"network_error"` results are NOT emitted. A probe that can't reach the server is evidence of probe unreliability (flaky network, CORS hiccup) not evidence of expiry — emitting would cry-wolf. `/chat` is the authoritative failure channel for "server unreachable" via D.t5's `unreachable` surface; if the probe is blocked but the server is alive, the next user message detects it honestly.

**Swap cost**: Low. Adding a second emitter later (e.g. for preflight-specific telemetry in chunk F) is additive; the current wire-to-the-banner arrangement stays. If the classifier's marker convention ever changes (`[session_not_found]` → something else), update both the adapter and this hook in the same patch — they share the contract by design.

## D.18 — Long-idle preflight threshold: 15 minutes (module constant `IDLE_PREFLIGHT_MS`)

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Two anchoring numbers set the window. Lower bound: the orchestrator's in-memory `idleTtlMs` default is 24 hours (B.t2 `in-memory.ts`), so any threshold well below that catches expiry before the sweeper runs. Upper bound: natural pauses in a discovery conversation (reading a widget, grabbing coffee, checking email) are typically under 10 minutes. 15 min sits unambiguously past "coming right back" without chattering during normal reading pauses. Exposed as a module-level constant in `session/preflight.ts` rather than an env var or CMS-backed config — Puma has no second tuning to justify the plumbing, and promotion is a one-liner when it's needed. The `visibilitychange` trigger is the more frequent check in practice; the idle interval is belt-and-braces for the "tab visible but untouched" case (paused mid-scroll) that `visibilitychange` doesn't cover.

**Swap cost**: Low. Changing the number is one-line in `preflight.ts`. Promoting to an env var adds an entry to `config/schema.ts` on the orchestrator side + a Vite env variable on the UI side — trivial when a second production tuning genuinely needs it.

## D.17 — Preflight triggers: mount + visibilitychange(visible) + long-idle interval, debounced 2s with in-flight guard

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Three triggers, each earning its place. **Mount**: fires once when the hook first sees `enabled && sessionId`. Catches the "reloaded after the orchestrator restarted" case before the visitor types. **visibilitychange → visible**: fires when the tab returns to focus. Catches the "alt-tabbed, came back minutes later, session archived in the meantime" case — the single most common expiry flavour in practice. **Long-idle interval**: fires every `IDLE_PREFLIGHT_MS` (see D.18). Belt-and-braces for the "tab visible but untouched" case that `visibilitychange` misses. Concurrency rules: (i) in-flight guard — at most one probe outstanding at any time; a second trigger while one is pending no-ops cleanly. (ii) 2s debounce across all trigger sources — absorbs React 18 strict-mode double-invokes AND rapid focus/blur storms that some OS notifications cause. Not adding `mousemove`/`keydown`-based activity trackers; they'd be the natural "super-precise idle" signal but introduce listener churn, Puma's stream-drop rate is expected low, and the plan's simpler triggers are sufficient for the expected expiry-detection coverage. Revisit if F's telemetry shows the visitors missing expiry detection in practice.

**Swap cost**: Low. Adding a fourth trigger (e.g. after successful tool-call completion) is an additive change inside `use-preflight.ts`; the debounce + in-flight guard absorb new callers without other edits. Tightening the debounce from 2s → shorter if genuinely needed is one constant bump.

## D.16 — Preflight endpoint shape: `GET /session/:id/ping` always 200, verdict in body

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Two shapes were viable. (a) Reuse HTTP semantics: `GET /session/:id/ping` returns 200 for known sessions, 404 for unknown. (b) Body-carries-verdict: always 200 with `{ok, expired, serverTime}`. We chose (b). Rationale: (i) the probe fires repeatedly per visit (mount + tab-focus + idle ticks); a 404 from an otherwise-healthy origin trips a subset of corporate proxies / CORS implementations into treating the origin itself as flaky, which would cry-wolf into the UI's `unreachable` path and defeat the entire purpose of the preflight; (ii) keeping discriminator logic body-side means the handler can be extended later (surface "archived" vs. "live" vs. "unknown" separately) without revising the status-code contract; (iii) treating the probe as an always-200 routine keeps its CORS preflight trivial — the existing global `GET,POST,PATCH,DELETE,OPTIONS` allow-methods header covers it with no per-route overrides. Archived sessions are conflated with live ones for Puma (plan §Key notes option c): `SessionStore.get` returns non-null for archived entries too, and an archived session already fails `/chat`'s consent gate and looks identical to "live-but-non-accepting" from the visitor's POV — no UX distinction to preserve. Shape `{ok: boolean, expired: boolean, serverTime: string}` reserved with planner-e1f for `@swoop/common`'s `SessionPingResponse`; if e1f's chosen field names differ, the rename is a single-import-line change in both `session/preflight.ts` and `server/session-ping.ts`.

**Swap cost**: Low. Adding a status field (`status: 'active'|'archived'|'unknown'`) for a richer UX later is additive. Moving to HTTP-semantic statuses (404 for unknown) is purely a handler-side change — the UI still reads `ok` and `expired` — but doing so regresses on the CORS / proxy concern, so we'd need a concrete reason.

## D.15 — SSE reconnection policy: client-driven manual retry only (status quo)

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: D.t6 had to close the open question from `planning/02-impl-chat-surface.md §2.7` on whether the UI should attempt automatic SSE resumption after a dropped `/chat` stream. Three options: (a) status quo — adapter `reconnectToStream` returns `null`, dropped streams surface as `[stream]` → D.t5's `stream_drop` banner with a Retry button that resubmits the last user-text; (b) client-driven polling retry — adapter attempts a fresh `/chat` POST with the same message after a backoff; (c) server-driven stream resumption — orchestrator persists stream state across connections keyed on a token, supports `Last-Event-ID`-style replay. (c) is the "correct" stateful answer and is how mature chat products handle dropped streams, but requires: a server-side stream ledger (chunk B doesn't have one), an assistant-ui thread-state coordination layer so resumption doesn't double-render, and considerable test surface for replay correctness. Out of scope for Puma. (b) risks silent double-submission (visitor thinks they sent one message, orchestrator gets two) and is worse than manual retry from an audit-trail POV. (a) is the honest answer: Puma's operational profile (low-latency single-turn requests, request-scoped streams) doesn't demand stateful resumption, and the D.t5 manual-retry path is already implemented and understood. D.t6 does NOT extend the reconnection path — it adds a proactive *expiry* probe, which is orthogonal to stream continuity.

**Swap cost**: Medium. Moving to (c) later requires: a chunk-B session-ledger rework for stream state, an `Last-Event-ID` handshake added to the orchestrator SSE, and a non-trivial assistant-ui integration to prevent duplicate part rendering on resume. Probably revisited post-M1 if F-chunk telemetry shows `stream_drop` occurrences biting real visitors.

## D.14 — "New conversation" button uses `refreshSession()` (in-place re-bootstrap), not `reset()` (return to OpeningScreen)

**Decided**: 2026-04-24
**Owner**: D.t5 executing agent (responding to Al's mid-task ask)
**Rationale**: Al asked for an always-visible "New conversation" button (initially "Fresh chat"; renamed after user feedback) that starts a clean chat when clicked. Two viable paths: (a) route through `useConsent.reset()` — clear sessionStorage + flip status back to `pending` → OpeningScreen re-appears → visitor re-consents → fresh session; or (b) a new `useConsent.refreshSession()` — POST `/session` + PATCH consent (re-using the stored `copyVersion`) + overwrite sessionStorage, keeping the visitor on the thread surface the whole time. Path (a) is the safer consent posture (each session = one consent act) but forces two clicks per restart. Path (b) rebinds the already-given consent to a new session id; the same copy version is re-recorded server-side (E.4 audit trail remains intact). We chose (b) as the default for the button: friction-light, consistent with the "knowledgeable friend" voice, and the copy-version re-record keeps the audit story honest. The UI is cleared via a `resetKey` state bumped on each restart, included in the transport `useMemo` deps and used as `key={resetKey}` on `<AssistantRuntimeProvider>` so the assistant-ui thread state remounts empty (see D.12 for why a re-key beats thread-state inspection). `reset()` stays on the hook as a nuclear option for the case where `refreshSession()` itself keeps failing (e.g. orchestrator truly down), but no UI surface wires to it by default — the ErrorBanner's "Start over" routes through `refreshSession` via the unified `handleFreshChat` callback. Error handling: `refreshSession()` emits via the shared adapter error emitter (D.12) and re-throws, so failures surface in the banner via the same path as any other comms failure.

**Swap cost**: Low. If compliance review later requires re-consent on each restart, wire the button to `consent.reset()` instead — a one-line change in `App.tsx`'s `handleFreshChat`. If `resetKey` key-remount proves too blunt (rare edge case where preserving some thread state is desirable), bump only the transport memo key and remove the provider `key` prop; assistant-ui will churn its transport-derived state without a full tree remount.

## D.13 — Error copy as JSON under `cms/errors/` with typed Vite import, no runtime schema validation

**Decided**: 2026-04-24
**Owner**: D.t5 executing agent
**Rationale**: D.t5 added five user-facing error surfaces (unreachable / stream_drop / session_expired / rate_limited / unknown) plus a tool-error inline placeholder. Copy had to land somewhere that satisfied theme 2 (content-as-data, theme 9 legal-compliance-built-in) without a heavyweight runtime validation layer for what's effectively six static strings. Three options considered: (a) TypeScript constants in `ui/src/errors/` — violates the `cms/` charter ("content is data, not code; authored by non-engineers eventually"); (b) JSON under `cms/errors/en.json` with Zod validation on import — correct but overkill for a frozen file we change with a code-review PR, not a CMS editor; (c) JSON under `cms/errors/en.json` with Vite-native JSON import + typed cast in `ui/src/errors/error-banner.tsx`. We chose (c). `cms/` stays markdown-and-JSON-only per its README; widgets/banner reference typed constants at the call site; localisation adds a sibling `cms/errors/<locale>.ts` + a resolver when it's actually needed (post-Puma). Same pattern should carry over if future `cms/` content lands with similar "static, authored-by-PR" ergonomics — don't reach for Zod until the file is actually a data feed.

**Swap cost**: Low. If content moves to a real CMS later, swap the import for a fetch + Zod parse behind the existing `getToolErrorCopy()` helper; the call sites stay unchanged. If localisation arrives, add the resolver at the import boundary.

## D.12 — Adapter error propagation via module-level emitter, not assistant-ui thread-state inspection

**Decided**: 2026-04-24
**Owner**: D.t5 executing agent
**Rationale**: D.t5 needed a reliable signal for "something failed in orchestrator comms". Two paths: (a) subscribe to assistant-ui's thread state via `useThread((s) => s.messages)` and look for the latest assistant message with `status.type === "incomplete"` + `reason === "error"`; (b) a module-level event emitter inside `runtime/orchestrator-adapter.ts` that the transport pokes at the exact moment it throws / enqueues an error chunk. We chose (b). Rationale: (i) assistant-ui is pre-1.0 and both `useThread` and `useThreadRuntime` are formally deprecated in favour of an `aui.*` API still being rolled out — wiring D.t5 to the deprecated surface buys us future upgrade tax; (ii) pre-stream failures (`sendMessages` throws before any message exists) don't have a corresponding thread-state entry to inspect, so path (a) would need a second channel for those anyway; (iii) the emitter pattern gives us one wire that carries transport failures, mid-stream drops, AND unrelated-but-adjacent consent-refresh failures (see D.14) without any of them having to invent their own route to the banner. One module, one emitter, one subscriber (`useRuntimeErrors`). Classification happens pure-function-side in `errors/classify.ts` against a `[<code>]` marker convention embedded in the thrown-error message — documented in the adapter + classifier + cms JSON schema-notes so future changes don't drift.

**Swap cost**: Low. If assistant-ui's eventual `aui.*` API exposes a clean "subscribe to thread-level error" signal, `useRuntimeErrors` swaps its `subscribeAdapterErrors` subscription for that source and the emitter is retired — all other D.t5 surfaces (classifier, banner, copy) are unaffected. If we ever move the transport off the custom `ChatTransport` implementation, the emitter move to the new transport's error hook.

---

## B.15 — B.t7's functional agent is the pre-turn triage classifier (layer-2 proof); it runs on a direct `ClaudeLlm.generateContentAsync` call, not through a `Runner`

**Decided**: 2026-04-22
**Owner**: B.t7 executing agent
**Rationale**: B.t7 needed one minimum-viable functional agent to prove the two-layer agent model (planning/02-impl-agent-runtime.md §2.1). The Tier 3 plan proposed two candidates: (a) a search-side classifier that runs inside a tool call to pick filter dimensions, or (b) a pre-turn triage classifier that sits inside the orchestrator and tags `session.triage` before each turn. We picked (b). Why: (i) it sits purely inside the orchestrator, so the integration test can stub one seam (the classifier's `ClaudeLlmLike`) without standing up a second MCP round-trip; (ii) its output lands in `SessionState.triage` — a shape that already exists in `@swoop/common`, so no schema work was needed; (iii) the G.t0 HITL flow-mapping session will replace this placeholder with real Puma triage logic, giving the scaffolding a clear future owner; (iv) it demonstrates "different model per agent" visibly: Haiku runs on one turn, Sonnet on the next, and both appear distinctly in logs. The classifier is an ADK `LlmAgent` (same primitive as the orchestrator) configured from `getModelFor(config, 'classifier')`, but we invoke it via a direct `ClaudeLlm.generateContentAsync` call rather than through `Runner.runAsync`. Why skip the Runner: classification is one-shot with no tools, no multi-turn history inside the classifier itself, and no SSE to drive — running through a full `InMemoryRunner` would force us to maintain a parallel ADK session keyed on `(appName, userId, sessionId)` for every user turn solely to discard it after a single model call. `BaseLlm.generateContentAsync` is the ADK contract for "one model turn"; calling it directly is still ADK execution, just without the Runner loop sugar we don't need. The `LlmAgent` shell is kept so the classifier has the same shape as the orchestrator agent and so a future upgrade (e.g. giving the classifier its own tool for a richer classifier) reuses the same object without a type change. Invariants enforced: advisory-only (orchestrator's prompt can read the verdict but makes its own call), non-fatal (classifier errors / unparseable JSON fall back to `verdict: "none"` and log a warning — classification never blocks the user's turn), and auditable (every write carries `reasonCode: "triage_classifier_placeholder"` so G.t0's real classifier can distinguish its own verdicts from scaffolding residue).

**Swap cost**: Low. (a) If G.t0 lands a proper classifier with multi-step reasoning or its own tool calls, promote the classifier from "direct BaseLlm call" to "full Runner loop" inside the same file — the `ClaudeLlmLike` seam accommodates either. (b) If we later want parallel classifiers (e.g. a separate psych-profile agent) each gets its own role in `src/config/models.ts` and its own file under `src/functional-agents/`. (c) If the search-side classifier case (b-alt above) becomes useful later, it sits alongside the triage classifier with no shared state. (d) The `PLACEHOLDER_REASON_CODE` constant marks every placeholder write, so G.t0 can safely overwrite scaffolding verdicts without ambiguity.

## B.14 — `/chat` runs the ADK `InMemoryRunner` with ADK sessions pre-created at Puma session bootstrap

**Decided**: 2026-04-22
**Owner**: B.t5 executing agent
**Rationale**: B.t5 needed a concrete way to drive an agent turn from an HTTP request. ADK 1.0.0 exposes two routes: (a) `Runner.runEphemeral({userId, newMessage})` which creates and discards an ADK session per turn, (b) `Runner.runAsync({userId, sessionId, newMessage})` which expects a persistent ADK session. Puma keeps conversation history in its own `SessionStore` (B.12), so option (a) looked appealing — except `runEphemeral` takes a single `newMessage: Content`, with no way to seed prior-turn history, meaning multi-turn conversations would forget everything each turn. Option (b) requires coordinating two session stores (ours + ADK's). We chose (b) with a simple coordination rule: on `POST /session`, `src/index.ts` creates both a Puma session (via `SessionStore.create`) AND a matching ADK session (`runner.sessionService.createSession` under a fixed `appName: 'puma-orchestrator'` and `userId: 'anonymous'`). The two share the same `sessionId`. This lets the Runner own the model's conversation context (genai `Content[]`) while the Puma store owns typed state (triage, consent, wishlist, reasoning for audit) — each store handles exactly what its shape is designed for, and the one-to-one keying means no lookup table is needed.

**Swap cost**: Low. The coordination is one `onSessionCreated` hook in `src/index.ts`. When Vertex AI Session Service lands (post-M4), the same hook pattern re-targets to a different ADK `BaseSessionService`. If ADK later gains a history-seeded `runEphemeral` variant we can simplify to option (a) with no API surface change outside `src/index.ts` + `server/chat.ts`'s `runAgentTurn`.

## B.13 — Response format (B.9 resolved): ADK natives for three of four block types; state-machine parser scoped to `<fyi>` only

**Decided**: 2026-04-22
**Owner**: B.t4 executing agent
**Rationale**: B.9 from planning/02-impl-agent-runtime.md §5 left the response-format plumbing open pending a Phase 1 spike on whether ADK + AI SDK natives cover the four `<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>` block types cleanly. Spike was fixture-based (real Anthropic wiring lands in B.t5 so a live-model spike isn't available yet — planning/03-exec-agent-runtime-t4.md explicitly sanctions this fallback). Spike outcome: **scenario 2 — partial coverage**. Evidence from `@google/adk@1.0.0` source (`dist/types/events/event.d.ts`, `dist/types/models/llm_response.d.ts`, and `@google/genai` `Part` shape):

- `Part.thought: boolean` + `Part.text` → clean native mapping for `<reasoning>`. `toStructuredEvents()` classifies these as `THOUGHT`.
- `Part.text` (thought !== true) → clean native mapping for `<utter>`. `toStructuredEvents()` classifies these as `CONTENT`.
- `Part.functionCall` / `Part.functionResponse` → clean native mapping for `<adjunct>` (widget hydration rides the tool-call lifecycle, matching chunk D's assistant-ui registry which already uses `input-streaming` / `input-available` / `output-available`).
- `<fyi>` has **no native analogue**. ADK's `ActivityEvent` (`kind: string; detail: Record<string, unknown>`) is for runtime/status signals emitted by agents & tools (e.g. a tool entered an auth flow), not model-authored side-channel notifications inline with `<utter>` content. The ADK's `Plugin` / callback model also doesn't fit — we want the model to *decide* when to emit a user-visible side-note mid-sentence, and that means the text stream is where those emissions live.

**Outcome**: The state-machine parser is built, but its scope is narrowed to **only `<fyi>`**. `<reasoning>`, `<utter>`, and `<adjunct>` ride native ADK channels end-to-end and never enter the parser's text stream, which is what makes the "inline tag mention" failure mode (flagged in planning/02-impl-agent-runtime.md §2.5a) a non-issue for this scoped parser — the only nested-tag case is an `<fyi>` string appearing inside another `<fyi>`, which the parser correctly treats as literal body text (flat, no depth counting). Chunk G's system prompt (to be authored later) will instruct Claude to (a) use thinking blocks for reasoning, (b) use tool calls for adjuncts/widgets, (c) emit `<fyi>...</fyi>` inline in text for ephemeral side-notifications, and (d) put everything else in plain text for `<utter>`. Reasoning filtering remains unconditional (see translator's `reasoning-filter.ts`) — whether reasoning arrives as `Part.thought`, an AI SDK `reasoning` part, or (hypothetically) `<reasoning>` in free text, it never reaches outbound SSE. B.t5's `ClaudeLlm.generateContentAsync` is responsible for mapping Anthropic thinking blocks to `Part.thought === true` on ingest.

**Swap cost**: Low. If the model starts emitting `<reasoning>` / `<utter>` / `<adjunct>` as free text against prompt instructions (prompt-engineering drift), extend `BlockParser` to handle those tags — the state machine generalises to multiple tag names cheaply. If Anthropic or ADK evolves a richer side-channel that subsumes `<fyi>`, the parser is one file to delete and a call site to remove. No `@swoop/common` schema change is implied either way: `DataFyiPart` remains the wire representation whether sourced from parsed text or a native event.

---

## B.12 — Session store: custom `SessionStore` interface over ADK, not ADK-native passthrough

**Decided**: 2026-04-22
**Owner**: B.t2 executing agent
**Rationale**: Tier 3 B.t2 posed the question: if ADK's native `SessionService` in-memory mode covers everything Puma needs, just use it. Inspected `@google/adk@1.0.0`: the public session surface is `getSessionServiceFromUri('memory://')` returning a `BaseSessionService` whose session shape is `{ id, appName, userId, state: Record<string, unknown>, events, lastUpdateTime }` — keyed on the `(appName, userId, sessionId)` triple with an opaque `state` blob and an append-only event log. Puma's `SessionState` (per `@swoop/common`) is typed: discriminated-union triage verdict, structured consent state with `copyVersion` tracking, wishlist items, conversation-history entries with block types. Two viable paths: (a) store the typed `SessionState` as an opaque value inside ADK's `state` blob and wrap ADK's service behind our own `SessionStore` interface; (b) define our own `SessionStore` interface and back it with a plain `Map<string, SessionState>` plus a lifecycle sweeper for Phase 1. We chose **both, behind the same interface**. `SessionStore` is the seam; the `in-memory` backend is a `Map`-backed adapter that owns the idle→archive→delete sweeper (24h idle, 7d archive — per chunk B §2.6a and chunk E §2.3); the `adk-native` backend wraps `getSessionServiceFromUri('memory://')` for slices that want ADK's event log / multi-user tenancy later. The custom in-memory adapter is not redundant — ADK's session service has no archive concept, no injectable clock for deterministic sweeper tests, and its triple-key API would require a sessionId→(appName,userId) side table if used alone. `vertex-ai.ts` and `firestore.ts` are interface-shaped stubs that throw "not implemented" at first use (startup stays clean); production selection is post-M4 per top-level B.2.
**Swap cost**: Zero between dev backends — flip `SESSION_BACKEND=in-memory|adk-native` in env. Low to graduate a stub: the interface is stable, so wiring Vertex AI Session Service or Firestore means filling in one file. If ADK ships a first-party archival + typed-state primitive in a future minor, the custom in-memory adapter can be retired with a one-backend swap.

## B.11 — Claude provider for ADK: local `BaseLlm` shim, not community adapter

**Decided**: 2026-04-22
**Owner**: B.t1 executing agent
**Rationale**: `@google/adk@1.0.0` (published 2026-04-21) ships Gemini and Apigee provider classes only — no first-party Anthropic/Claude wrapper. Three paths exist to run Claude under ADK: (a) community packages like `adk-llm-bridge` or `@auto-engineer/adk-claude-code-bridge`; (b) write our own `BaseLlm` subclass that calls `@anthropic-ai/sdk` directly; (c) wait for Google to ship Claude support upstream. We chose (b). ADK's `BaseLlm` contract is small and stable (two abstract methods: `generateContentAsync`, `connect`), keeping a local shim is one file, and it avoids a third community dep whose versioning/maintenance posture we don't yet trust. B.t1 lands the shim with stub implementations that throw a clear "not yet wired — B.t5" error; the real translation between ADK's `LlmRequest`/`LlmResponse` shapes and Anthropic's Messages API lands in B.t5 when the SSE endpoint first routes user turns to the model.
**Swap cost**: Low. If Google ships a first-party Anthropic provider later, swap `ClaudeLlm` for the upstream class in `src/agent/factory.ts` — zero callers outside the factory touch this type. If a community adapter becomes compelling, likewise. The shim is roughly 30 LOC; the real implementation lands in B.t5 inside the same file.

## B.1a — ADK JS version pin: `@google/adk ^1.0.0`

**Decided**: 2026-04-22
**Owner**: B.t1 executing agent
**Rationale**: `@google/adk@1.0.0` shipped 2026-04-21, one day before B.t1 execution. Pinning to `^1.0.0` accepts minor/patch upgrades under the 1.x stability contract Google has just adopted with the 1.0.0 release. We reject pinning `1.0.0` exactly — that denies ourselves bugfixes without protection against breakage we don't get anyway (TypeScript catches most API shape drift at our typecheck step). We reject `*` — that invites major-version surprises. This decision is the concrete realisation of the "ADK-version pinning" item flagged as deferred in planning/02-impl-agent-runtime.md §5.
**Swap cost**: Low for minor/patch bumps (npm update + retypecheck). Medium for a 2.x bump (may reshape `LlmAgent` or `BaseLlm`, both of which are load-bearing for us; cadence decided reactively per planning/02-impl-agent-runtime.md §5).

## B.1b — Orchestrator default Claude model: `claude-sonnet-4-5-20250929`

**Decided**: 2026-04-22
**Owner**: B.t1 executing agent
**Rationale**: Decision B.5 already committed to per-agent model selection with Claude Sonnet leaning for the orchestrator. B.t1's concrete pin picks `claude-sonnet-4-5-20250929`, the current Sonnet at implementation date. Default is set inside `src/config/index.ts`; `PRIMARY_MODEL` in env overrides. B.t6 lifts this into a proper config-file surface. Decision logged so the "why this model id?" question has an answer in the audit trail.
**Swap cost**: Zero. Override via the `PRIMARY_MODEL` env var. No code change required to move tiers within the Claude family; a move off Claude entirely would mean replacing `ClaudeLlm` in `src/agent/factory.ts` (see B.11 swap cost).

## A.9 — Workspace package scope: `@swoop/*`

**Decided**: 2026-04-22
**Owner**: Al (resolved during A.t5 by the executing agent)
**Rationale**: A.t1 scaffolded the workspace root `product/package.json` with the name `@swoop-web/product` and referenced `@swoop-web/common` inside `product/CLAUDE.md`. A.t2 then populated `ts-common/` as `@swoop/common` and A.t4 scaffolded downstream placeholders as `@swoop/{orchestrator,connector,ui,ingestion}`. The majority convention across planning docs (e.g. `planning/02-impl-foundations.md` §2.1, §9.8) is `@swoop/*`. Normalising on `@swoop/*` is the minimum-drift choice: it matches the PoC carry-forward convention, the current state of five out of six packages, and every planning-doc reference. The root workspace package renamed `@swoop-web/product` → `@swoop/product`. `product/CLAUDE.md` updated accordingly. `package-lock.json` will self-correct on the next `npm install`.
**Swap cost**: Low. Scope is a cosmetic namespace; re-scoping again costs a find-replace across `package.json` files + one `npm install` to regenerate the lockfile.

## A.8 — Local persistence during Phase 1 vertical slice

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: In-memory / file-backed adapters behind `ts-common` session / handoff store interfaces. Skips the Firebase Emulator setup pain entirely and keeps the deploy surface uniform. When real persistence genuinely matters (post-M4), connect to a real GCP dev Firestore (or whichever store gets picked in chunk B/E) — all integration happens against real GCP, not an emulator.
**Swap cost**: Low. Interface-first design means swapping the in-memory adapter for a real store changes one file per store and leaves consumers untouched.

## A.7 — Runtime target: Cloud Run for all deployables

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Services (orchestrator, connector) and any scheduled / batch jobs (scraper or API-ingest) all run on Cloud Run. Uniform deployment surface, avoids Firebase Functions scope creep and the Firebase Emulator yak-shave. Firebase Functions remains a future option if a concrete need appears that Cloud Run + Cloud Scheduler can't serve.
**Swap cost**: Medium. Cloud Run → Cloud Functions per-service is a deploy-pipeline rewrite and some code changes (handler signature + cold-start posture); no data-model implications.

## A.6 — Test runner at foundation level: Vitest, no tests authored yet

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: The real test surface for Puma is the Tier 2 chunk H validation harness, not per-package unit-test suites. Vitest gets scaffolded at the foundation level so future chunks (translator layer, classifier, any pure-function utility) can drop focused tests in when failure modes are narrow and fixtures are cheap. No tests are authored in chunk A beyond the single fixture round-trip check in `ts-common/`.
**Swap cost**: Low. Vitest → Jest (or whatever) is a devDependency swap plus minor API differences; no production code touches the runner.

## A.5 — CI provider: GitHub Actions, re-evaluate at M4

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Lowest friction to start; Al and the Swoop in-house team already know it. Cloud Build is more "native" for the GCP handover narrative and worth switching to if the deploy pipeline starts to want it. Revisit at M4 when deployment becomes real.
**Swap cost**: Medium. One workflow-file rewrite per job; secrets and cache get reconfigured but the test/lint/build commands carry across unchanged.

## A.4 — Node + TypeScript versions: Node 20 LTS, TypeScript 5.x

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Standard, boring, matches PoC de facto. Node 20 LTS pinned via `.nvmrc` at the repo root; TypeScript 5.x pinned in `product/package.json` devDependencies.
**Swap cost**: Low for a minor bump (change `.nvmrc` + `devDependencies`), medium for a Node major (Cloud Run runtime change + CI matrix + any transitive native deps).

## A.3 — Lint + format: ESLint + Prettier

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: PoC had neither. Julie's production bar justifies adding them; Swoop's in-house team is familiar. ESLint + Prettier is the conservative choice. Biome (faster, single tool) is the alternative if CI times later demand it. `eslint-config-prettier` disables stylistic ESLint rules that would fight Prettier — ESLint owns correctness, Prettier owns style.
**Swap cost**: Low. Biome is a drop-in replacement at the config layer; config files get rewritten once.

## A.2 — Branching strategy: trunk-based with per-stream `STREAM.md`

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Vertical-slice-first execution means a single agent on `main` until M1. Post-M1 fan-out to 2–4 parallel agents still doesn't warrant long-lived branches at this scale — each agent works on a named branch, PRs into `main`, CI catches interface drift within minutes. Per-package `STREAM.md` holds the agent's working context so they don't collide. Worktrees are the escape hatch if parallel agents start trampling each other.
**Swap cost**: Low. GitFlow / release-branch patterns can be layered on later with no code change.

## A.1 — Workspace tooling: npm workspaces

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Closest to the PoC (plain npm, no extra tooling); zero new vocabulary for Swoop's in-house team; no compelling Puma-scale reason to introduce pnpm / Turborepo / Nx. Revisit if build times become painful.
**Swap cost**: Low. Re-initialising with pnpm or a task-runner like Turborepo is a few hours' work; the schema of per-package `package.json` files survives unchanged.
