# 03 — Crosscut: infer the visitor's location (don't assume Europe)

**Status**: ✅ **EXECUTED + merged to `main`** 2026-06-16 (HITL-ratified inline: "write up as a plan first, fold in the inbox item, then proceed with the edit" → "good to go … commit and merge to main"). Worktree-slug-stamped per the 2026-05-13 collision-avoidance discipline. Execution log at the bottom.
**Crosscut because**: spans **B** (the per-turn dateline in `chat.ts`), **G** (the WHY system prompt `00_why.md`), and **H** (a harness scenario). No single chunk owns it; it extends the B.t12 visitor-clock surface with a visitor-*location* read.
**Back-links**:
- Luke's 16 Jun 2026 feedback (verbatim below) — the trigger.
- [B.t12 — browser timestamp → agent context](03-exec-agent-runtime-t12.md) — built the `clientTime {iso, timeZone}` wire + the per-turn dateline this plan extends.
- [inbox.md 2026-05-18 — "Real WHY-prompt bugs … self-contradiction on Patagonia seasonality"](../inbox.md) — **folded in here** (the Southern-Hemisphere geographical-anchor line proposed there, never landed, lands now).

---

## ★ Read this first

**Luke (16 Jun 2026), verbatim:**
> if assuming users location then let's presume US
> Eg ("Patagonia's seasons run opposite to Europe's" came up in one thread)

**Alastair's interpretation (the brief for this work):** we should get the visitor's location *if at all possible*. We already pass the **timezone** to the agent on every turn (B.t12). Infer location from it — if not the exact country, then at least the hemisphere / broad region (Americas vs Europe vs Australasia). It may be as simple as telling the agent to infer from the timezone, and to **ask** if necessary as a fallback. Luke's "presume US" is the **default when we genuinely can't tell**, not the primary.

**The key finding from investigation (read-only, 2026-06-16):** we are **not missing the data**. The browser already sends the IANA timezone on every `/chat` request ([orchestrator-adapter.ts:430](../product/ui/src/runtime/orchestrator-adapter.ts)), it's validated on the wire ([ClientTimeSchema, routes.ts:44](../product/ts-common/src/routes.ts)), and it's already rendered into the per-turn dateline the agent reads ([buildDateline, chat.ts:471](../product/orchestrator/src/server/chat.ts)) — e.g. `… (Europe/London, 17:42 local)`. An IANA zone's prefix (`America/`, `Europe/`, `Australia/`, `Pacific/`, `Asia/`) encodes the region and the city usually pins the country; Sonnet maps that to a hemisphere trivially. **What's missing is the instruction to use it.** There is currently **zero** geographic-anchoring guidance anywhere in `00_why.md` or the 14 skills (grep-confirmed), which is exactly why the agent free-styled "opposite to Europe's" — it fell back to its own prior (and the whole surface is `en-GB`-formatted). The 2026-05-18 Southern-Hemisphere seasonality anchor was also never added — same gap, same fix.

**Why prompt-side, not a server-side region map:** a naïve `America/*` → Northern-Hemisphere lookup is *wrong* for exactly the Patagonia-adjacent cases (`America/Santiago`, `America/Argentina/*` are Southern). Sonnet handles that nuance better than a crude prefix map, so the inference belongs in the prompt where the model reasons over the raw zone — the dateline already carries it. Server-side mapping (deterministic/loggable) is the deferred alternative if we ever want the inference auditable.

**Privacy/legal:** no new surface. Timezone is already collected and in the [legal pack](swoop-legal-review-pack.md) data inventory as session metadata; inferring coarse region is reasoning over data we already hold, not new collection. A volunteered travel-origin answer (the ask fallback) is also fine. One-liner worth giving counsel since the pack is in review; doesn't reopen consent.

---

## 1. Outcomes

1. The agent **reads the timezone in the per-turn dateline as its best signal for where the visitor is**, and frames seasonal / relative-time talk from *their* hemisphere — not a hard-coded European default.
2. Patagonian seasonality is stated correctly and relative to the visitor: **Southern Hemisphere, Dec–Feb summer / Jun–Aug winter** (folds in the 2026-05-18 inbox anchor).
3. When the timezone is **absent or genuinely ambiguous**, the agent defaults to a **United States / Northern-Hemisphere** frame (Luke's "presume US"), not a European one.
4. When location genuinely changes the answer and can't be inferred, the agent **MAY ask one** short travel-origin question — same one-question discipline as the §9 verdict-disambiguation probe; never an interrogation.
5. A timezone is treated as a *hint*, held lightly — the agent does not assert the visitor's location back to them as fact unless they've said so.

**Not outcomes**: server-side region/hemisphere computation (deferred — model does it better from the raw zone); harness `clientTime` pinning (deferred at B.t12; scenario below tests the no-location default behaviourally instead); cross-session memory of location.

## 2. Components

### 2.1 Content — `00_why.md` (chunk G, the load-bearing change)

Add a new subsection to **§7 "Reading the visitor"** (a subsection, *not* a new top-level section — §-numbers are cross-referenced throughout the file; a new section would force a renumber sweep). Place it after "### Patterns and the move they call for", before the §7 NB note. Title: **"### Where the visitor is, and which way their seasons run"**. It states: the dateline names the visitor's timezone → read it for hemisphere/region; frame seasonal comparisons from *their* hemisphere; Patagonia is Southern Hemisphere (Dec–Feb summer / Jun–Aug winter, inverted vs the Northern Hemisphere); **MUST NOT** default to a European frame; **SHOULD** presume US / Northern Hemisphere when the zone is absent/ambiguous; **MUST** hold the read lightly (a zone is a hint, not an identity); **MAY** ask one travel-origin question when it matters and can't be inferred.

### 2.2 Code — the per-turn dateline (chunk B, `chat.ts` `buildDateline`)

Reinforce the static rule at the exact moment the signal is (or isn't) present — belt-and-braces; `00_why.md` stays the source of truth.
- **Present case** (has `clientTime`): append a short clause naming the timezone as the location signal — *"Treat the timezone as your best signal for where they are (hemisphere, region)."*
- **Fallback case** (no `clientTime` — "visitor clock unavailable"): append the US default — *"Visitor location unknown — assume a United States / Northern Hemisphere frame unless they say otherwise."*

### 2.3 Tests — `chat-dateline.test.ts` (chunk B)

Pure-function unit coverage (the project's "narrow failure mode, cheap fixture" case warrants a unit test). Add: present-case asserts the timezone-as-location-signal clause; null-case asserts the "United States" / "Northern Hemisphere" default clause. Existing assertions (`Reason about`, `how far out`, `server clock`, `UTC`, no `Invalid Date`/`undefined`) stay green.

### 2.4 Harness — new scenario `021-visitor-location-seasons.yaml` (chunk H, the acceptance gate)

`userAgent` scenario, sibling to `020-date-distance-reasoning.yaml`. A visitor asks a seasonality/timing question **without stating their location**; `judge_rubric` asserts: (a) Patagonian seasonality is correct (Southern Hemisphere; Dec–Feb is summer), and (b) the agent does **not** assume the visitor is European without basis (it frames neutrally, defaults to US/Northern-Hemisphere, asks, or uses the zone) — i.e. it must not free-style "opposite to *Europe's*" as Luke saw. **Not runnable in this worktree** (no `ANTHROPIC_API_KEY`); runs with the `luke-` family as part of the next judged pass. Note: deterministic timezone pinning needs the `UserAgentSpecSchema.clientTime` wiring deferred at B.t12 — the rubric targets the durable behavioural failure mode instead, so it's robust to wherever the harness runs.

## 3. Out of scope

- Server-side IANA → region/hemisphere computation (deferred; model reasons better from the raw zone — see ★).
- Harness `clientTime` injection wiring (deferred at B.t12).
- Any new data collection, consent change, or UI surface.

## 4. Verification

1. `npm run typecheck` clean across touched workspaces (`@swoop/orchestrator`, `@swoop/common` unaffected).
2. `npm run -w @swoop/orchestrator test -- chat-dateline` green (present-case + null-case new assertions pass; existing pass).
3. Content read-through: `00_why.md` §7 reads cleanly end-to-end; the new subsection is in-voice (MoSCoW tags, "We"/"You" register) and folds the SH anchor.
4. **Operator (needs API key)**: run `021-visitor-location-seasons` + a spot live smoke — a no-location seasonality ask should not assume Europe and should get SH seasons right; a US-timezone ask should frame from North America.

## 5. Estimate

~0.5 day. The content subsection is the load-bearing change; the dateline + test are small; the scenario is cheap YAML.

**Decision (ratified 2026-06-16) — `G.visitor-location-1`** (spans B): the visitor's timezone (already in the per-turn dateline) is the agent's location signal; the agent frames seasonal/relative talk from the inferred hemisphere, defaults to a US/Northern-Hemisphere frame when the zone is absent/ambiguous, holds the read lightly, and may ask one travel-origin question as a fallback. Folds in the 2026-05-18 Southern-Hemisphere seasonality anchor. Inference stays prompt-side (model over raw zone), not a server-side region map.

---

## 2026-06-16 execution log

**Executor**: claude-opus-4-8 — worktree `visitor-location-infer`, branch `worktree-visitor-location-infer` (fresh from `main`).

- **§2.1 content** — `00_why.md` §7 gained "Where the visitor is, and which way their seasons run": timezone→hemisphere read, SH seasonality (Dec–Feb summer / Jun–Aug winter), MUST-NOT-default-Europe, SHOULD-presume-US, hold-the-read-lightly, MAY-ask-one-origin-question. Folds in the 2026-05-18 inbox seasonality anchor.
- **§2.2 dateline** — `buildDateline`: present case names the timezone as the location signal; null fallback states the US / Northern-Hemisphere default.
- **§2.3 tests** — `chat-dateline.test.ts` +2 unit assertions (timezone-as-signal; US default).
- **§2.4 harness** — `021-visitor-location-seasons.yaml` authored (behavioural judge_rubric). Not run — no `ANTHROPIC_API_KEY` in the worktree; runs with the `luke-` family.
- **Docs** — decision G.visitor-location-1 logged in decisions.md; inbox 2026-05-18 item 2 marked addressed; progress.md + next-steps.md updated.
- **Verification** — `@swoop/orchestrator` typecheck clean; full suite **222 passed / 21 skipped**; `chat-dateline` 9/9.
- **Merge** — committed on the worktree branch, merged to `main` (see git log). No push, per standing rules.
