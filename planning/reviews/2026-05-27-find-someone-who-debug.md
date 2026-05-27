# find_someone_who (Mirror) — debug trace 2026-05-27

Tracer run against the observation that `find_someone_who` never surfaces customer stories in live conversation.

---

## Trace Report

### Observation

`find_someone_who` (Mirror tool) is never invoked during visitor conversations despite ~953 `customer_story` rows existing in `puma_dev`. The corpus is populated; the connector handler exists and is schema-correct; visitors never see persona stories woven into responses.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | **H6: System prompt under-instructs Mirror** | High | Moderate (word-count + structural analysis of 00_why.md) | `handoff` is named 35 times; `find_someone_who` only 5 — never in a MUST/SHOULD imperative; all 5 occurrences are inside tool-list enumerations or parenthetical NB notes, not behavioural rules |
| 2 | **H5: Tool description trigger language is too passive** | High | Moderate (direct text comparison against sibling descriptions) | Description uses conditional advisory prose with no SHOULD/MUST markers; sibling descriptions (`find_inspiring`, `find_proof`) use the same structural shape — but the H6 system-prompt gap means the model never develops a strong prior to reach for this tool at all |
| 3 | **H1: Sonnet not selecting find_someone_who** | High | Weak (no run logs; inferred from H5+H6) | No harness run logs exist (`runs/.gitkeep` only); the structural prompt/description analysis strongly predicts under-selection; H1 is the observed symptom, H5+H6 are the causal mechanism |
| 4 | **H3: Persona summaries semantically thin** | Medium | Moderate (ETL prompt quality + discoveries.md 80/20 finding) | ETL prompt is well-specified; aggregate-by-reviewer approach produces real signal per discoveries.md 2026-04-30; BUT thin single-review personas ("A pragmatic traveller who books ahead") may not match visitor signals confidently enough even when the tool IS called |
| 5 | **H2: Handler returns empty — over-tight SQL filter** | Low | Moderate (direct code read) | Filter is `persona_embedding IS NOT NULL` — correct, not over-tight; region filter is additive; the only structural failure mode is if `persona_embedding` is null for most rows (possible if embedding ETL didn't complete — unverifiable without live DB) |
| 6 | **H4: Results land but orchestrator ignores them** | Low | Weak (no run transcript exists) | Factory fix (B.t9, 2026-05-18) explicitly restored connector tools as top-level LlmAgent siblings; `find_someone_who` is `exposedToModel: true`; no structural reason the response would be discarded if the tool were called |

### Evidence For

**H6 (system prompt under-instructs):**
- `handoff`: 35 mentions in 00_why.md; has its own dedicated section (§9, ~1,200 words) with MUST imperatives, cardinality rules, trigger conditions.
- `find_someone_who`: 5 mentions, all in tool-list enumerations (§§3, 4, 7, 9 NB notes) or within a parenthetical. No dedicated section. No MUST/SHOULD. No "when you see X, call this" rule.
- The word "Mirror" appears exactly once (§4 visual-channel discussion, parenthetical). The five-jobs framework is named in `discoveries.md` and `tools.ts` comments but never given a behavioural rule in 00_why.md.
- Compare: `illustrate` gets an explicit SHOULD rule in §4 ("SHOULD render eagerly… the trigger is the concept entering the conversation") covering three sub-scenarios with concrete examples. Mirror has no equivalent imperative.
- The closest instruction to a trigger is: *"same logic for `find_someone_who` story vignettes — the card sits in the surface; you may or may not name it in your reply"* (§4 line 140) — which is a permissive non-rule about how to use results, not a rule to call the tool at all.

**H5 (tool description passive):**
- `find_someone_who/description.md` (6 lines) uses: "Use this when…", "*When to pick this:*" — advisory, not imperative.
- `find_inspiring/description.md` and `find_proof/description.md` use identical structural shape. Since all three descriptions are equally advisory, H5 alone doesn't discriminate. The gap is the system-prompt instruction weight, not the description quality in isolation.
- The description's trigger examples are good (*"I'm going alone." "We're retiring next year."*) but live entirely in the tool description, not amplified by 00_why.md.

**H1 (under-selection — predicted):**
- Harness `runs/` directory contains only `.gitkeep` — zero live run transcripts. No direct invocation-count evidence either way.
- Only one harness scenario (agent-121-skeptic-ai-suspicious) asserts `find_someone_who`. The scenario most likely to trigger Mirror (agent-101-dreamer-post-life-event — a character who discloses "just turned 50, kids about to leave, first trip for herself") asserts only `find_options` and `judge_rubric`. No Mirror assertion there despite the persona signals being textbook Mirror triggers.

**H3 (thin personas):**
- discoveries.md 2026-04-30: "80% of reviews are short snippets". Single-review aggregation produces low-signal personas (ETL prompt example: *"A pragmatic traveller who books ahead and values practical planning advice"*).
- However: the aggregate-by-reviewer approach was explicitly designed to counter this — multiple reviews per reviewer produce richer signals. Whether aggregation ran correctly against all 953 rows is unverifiable without live DB access.

**H2 (handler correctness):**
- SQL: `WHERE persona_embedding IS NOT NULL ORDER BY persona_embedding <=> $1::vector LIMIT $2`. Region filter additive only. No over-tight constraint.
- embed-query.ts: Gemini `gemini-embedding-001` / 3072d — matches corpus `halfvec(3072)` post-migration 009. The C.t9 Voyage holdover (surfaced as live smoke errors) is fixed. connector/.env has `; VOYAGE_API_KEY=...` (semicolon-commented, not active).

### Evidence Against / Gaps

**Against H6 as sole cause:**
- The system prompt does mention `find_someone_who` in the tool-list NB notes at §§3/7 — *"You're a capable agent with tools (`find_inspiring`, `find_someone_who`, …) and structured data"*. A sufficiently attentive model reading the tool description could self-direct. The issue is the signal-to-noise ratio is low relative to other tools.

**Against H2:**
- Cannot confirm `persona_embedding IS NOT NULL` coverage without live DB access. If the embedding ETL ran incompletely, the effective corpus could be near-zero rows, which would make H2 more serious than currently ranked.
- The connector `.env` has `GEMINI_API_KEY` present and active — embedding should work if the service is running.

**H4 gap:**
- The B.t9 factory bug (connector tools hidden in `SkillToolset.additionalTools`) was real and was fixed 2026-05-18. The fix is confirmed in the current `factory.ts` source (`tools: [skillToolset, ...tools]`). But no live transcript exists to confirm whether any `find_someone_who` call has ever succeeded end-to-end since the fix.

### Rebuttal Round

**Strongest challenge to H6 as primary cause:**
H5 and H6 produce the same observable symptom. The real question is whether the tool description alone is *sufficient* to drive invocation — in which case H6 (system-prompt imbalance) is a secondary contributor, not the primary. The counterargument: several of the harness scenarios contain strong Mirror triggers (dreamer-post-life-event: "just turned 50", "first trip for herself"; puma-photographer: solo specialist traveller) and neither scenario asserts `find_someone_who`. If the tool description were sufficient, the harness authors would have included Mirror assertions in those scenarios. Their absence suggests the same authors who wrote the tool description also expected the tool to be under-selected — which is itself evidence the trigger language doesn't fire reliably.

**Why H6 still leads:**
The structural asymmetry is the smoking gun. `illustrate` has an explicit SHOULD rule with sub-scenarios; `handoff` has a 1,200-word section with MUST imperatives; `find_someone_who` has zero imperative coverage in the system prompt. In a long-context system prompt where Sonnet must decide which tool fires, instruction weight drives prior probability. The tool description only reaches the model if the system prompt has already established a prior to look for the trigger. Without a system-prompt SHOULD, the tool is opt-in from a blank prior.

### Convergence / Separation Notes

H5 and H6 do not converge to the same root cause. H5 is about the tool-description trigger language (fixable with a prompt edit to the 6-line description file). H6 is about the system prompt never establishing Mirror as a behavioural rule (fixable with a SHOULD instruction added to 00_why.md §4 or a new §). The two are additive. Both should be addressed, but H6 is the load-bearing gap.

H3 is a separate data-quality axis that affects Mirror's *output quality* if it were called, not its *selection rate*. It is the right frame for Alastair's reframe ("surface a few good relevant examples rather than aggregated personas").

### Current Best Explanation

**Primary cause (H6):** Mirror is structurally under-instructed in 00_why.md. Every other tool with reliable invocation (illustrate, handoff, find_options) has explicit SHOULD/MUST rules naming trigger conditions. `find_someone_who` has none — it appears only in tool-list enumerations as one of several tools the model "has available." Without a system-prompt prior, the tool description is the only signal, and that signal is too weak to compete with the instruction weight of better-specified tools in a 5,700-word brief.

**Contributing cause (H5):** The tool description's trigger language is advisory, not imperative — consistent with the system-prompt gap. A 6-line description without SHOULD markers is unlikely to drive reliable selection even in isolation.

**Provisional (H3):** Even if H6+H5 are fixed, the aggregated-persona data shape may produce poor matches for specific visitor signals. The corpus was built for a "persona echo" retrieval model; Alastair's reframe ("a few good relevant examples") implies individual-review retrieval may be a better fit for the Mirror job. This is a data-layer design question, not a plumbing bug.

This explanation is explicit-provisional on H2: `persona_embedding` coverage in the live corpus is unverified (DB not running in this environment).

### Critical Unknown

Whether `persona_embedding IS NOT NULL` is true for a meaningful fraction of the 953 `customer_story` rows. If the embedding ETL ran incompletely (e.g. Voyage/Gemini transition left rows un-embedded), the handler silently returns 0 results even if the tool were called — which would make H2 a co-primary cause, not a low-ranked one.

### Discriminating Probe

Run this query against `puma_dev`:

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(persona_embedding) AS has_embedding,
  COUNT(*) - COUNT(persona_embedding) AS missing_embedding,
  ROUND(100.0 * COUNT(persona_embedding) / NULLIF(COUNT(*), 0), 1) AS pct_embedded,
  AVG(LENGTH(persona_summary)) AS avg_summary_chars
FROM customer_story;
```

This collapses H2 (is embedding coverage actually good?) and H3 (are summaries substantive?) in a single 200ms query. If `pct_embedded` is below ~60%, H2 rises to co-primary. If `avg_summary_chars` is below ~80, H3's thin-persona concern is confirmed.

### Uncertainty Notes

- No live run transcripts: H1 is inferred, not directly measured. The harness `runs/` directory is empty. Invocation counts for `find_someone_who` vs sibling tools cannot be computed without either a live run or session logs.
- DB not reachable from this worktree environment: H2 and H3 SQL evidence is unavailable. All conclusions about the corpus are based on the ETL code, the prompt, and the discoveries.md narrative — not direct data inspection.
- B.t9 fix: the factory source confirms the fix is in place; no live evidence that it has been exercised with `find_someone_who` specifically.

---

## Recommended Fix Scope

**Big fix required — but H6 + H5 are separately addressable as a medium fix first.**

The immediate fix (medium, ~30 min) is to add an explicit Mirror SHOULD rule to 00_why.md §4 (the visual-channel section), mirroring the `illustrate` SHOULD pattern. Example shape: *"SHOULD call `find_someone_who` when the visitor reveals a persona signal — solo female, post-retirement, photographer, life-transition occasion. The trigger is the self-disclosure landing, not a question being asked. Pair it with a prose move that doesn't announce the tool; let the story card sit on the surface while the reply addresses the disclosure in its own register."* Optionally pair with a minor description sharpening (change "Use this when…" to "SHOULD reach for this when…").

The bigger fix (big, data-layer redesign) is Alastair's reframe: drop aggregated-persona retrieval in favour of individual-review retrieval so Mirror surfaces "a few good relevant examples" rather than matched persona blobs. This is the right long-term direction but is a chunk-C data work item — it affects the ETL, the schema, and the retrieval primitive — and should not block the medium prompt fix.

**Recommended sequence:** ship the prompt fix (medium) to verify that Mirror fires at all and check output quality; use that signal to decide whether the big data-layer reframe is urgent or can follow in the next chunk.

---

## Open Questions for HITL

1. **Corpus embedding coverage**: run the discriminating probe SQL above. If `pct_embedded < 60%`, the embedding ETL needs a re-run before the prompt fix will show results.

2. **Alastair's reframe scope**: does "surface a few good relevant examples" mean: (a) return individual `customerreview` rows directly (skipping persona aggregation), (b) keep `customer_story` but change the retrieval signal from `persona_embedding` to full-text hybrid, or (c) redesign the table to hold individual review rows rather than aggregated personas? The current `find-customer-stories.ts` primitive is clean enough to swap the retrieval strategy without a handler rewrite — the question is what the new row shape looks like.

3. **Harness Mirror scenario gap**: no scenario asserts `find_someone_who` in a textbook Mirror context (dreamer-post-life-event is the obvious candidate). Adding a Mirror assertion to agent-101 or a new agent-102-style scenario would give the first direct invocation-rate signal for this tool.

4. **Side observation — no Mirror assertion in dreamer-post-life-event**: the agent-101 scenario (visitor discloses "just turned 50, kids leaving, first trip for herself") asserts `find_options` but not `find_someone_who`. This is a harness coverage gap independent of the root cause — flagged here, not fixing it in this session.
