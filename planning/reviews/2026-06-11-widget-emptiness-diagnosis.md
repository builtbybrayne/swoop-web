# 2026-06-11 — Widget emptiness: diagnosis, live verification, fix ledger

**Type**: Diagnosis review + live-verification record. Written by the solutions session that followed the [2026-06-11 retrieval-emptiness audit](2026-06-11-retrieval-emptiness-audit.md) (which remains deliberately uncommitted pending Alastair's review — this doc back-references it; committing this doc was explicitly authorized by Alastair on 2026-06-11).
**Symptom under diagnosis**: "Tool-based widgets are not showing — not even on the dev server" (Alastair, 2026-06-11). The audit had scoped itself to region-anchored conversations + the Mini; nobody had established a working post-wave baseline on dev.
**Headline**: the widgets were never one broken thing. Four independent mechanisms compose the perceived "no widgets", and **none of them is data damage**. All four are now evidenced; two are fixed/working, two carry gated fix candidates below.
**Companions**: [03-exec-c-t4.md § 2026-06-11 filter-sparsity hot patch](../03-exec-c-t4.md) · [2026-06-10-luke-loom-feedback.md](2026-06-10-luke-loom-feedback.md) · [discoveries.md 2026-05-18 + 2026-06-11 entries](../../discoveries.md)

---

## ⛔ Standing rules (unchanged, binding)

1. Never `git push`. 2. Never commit without explicit per-instance go-ahead (this doc's commit: authorized 2026-06-11). 3. Nothing DB-touching without a named per-operation go; pre/post manifests; restores rename-never-drop. 4. MariaDB `swoop_patagonia` read-only, always. 5. Diagnosis separated from change-making.

---

## 1. Why the audit's theory didn't satisfy

The audit's hypothesis set (H1–H6) was entirely **data-layer** (dump/restore, wrong DB, seen-set drain, filter sparsity, re-compose damage, lost population). The 10 Jun wave's largest footprint was **code** — 8 merged plans touching widgets, schemas, the chat envelope, and the session backend — and a 1 Jun session had already **relocated all display widgets to a desktop sidebar** (`03847e1`). Filter sparsity (H4) was real but explained only one tool's emptiness; it could not explain "no widgets at all".

## 2. Evidence base

All evidence reproducible. Primary instrument: the **durable ADK transcript** in `puma_session_event` (migration 016) — every tool call, its args, and its full result, per session. Extraction query (reusable):

```sql
SELECT seq,
  COALESCE(p->'functionCall'->>'name', p->'functionResponse'->>'name') AS tool,
  CASE WHEN p ? 'functionCall' THEN (p->'functionCall'->'args')::text END AS args,
  CASE WHEN p ? 'functionResponse' THEN left((p->'functionResponse'->'response')::text, 200) END AS result
FROM puma_session_event, jsonb_array_elements(event->'content'->'parts') p
WHERE session_id = '<id>' AND (p ? 'functionCall' OR p ? 'functionResponse') ORDER BY seq;
```

Plus: read-only SQL coverage probes, DOM probes via the preview browser (`[data-swoop-widget]` visibility + sidebar membership), browser console, and a live six-ask smoke on a freshly restarted stack at main tip `1701728`.

## 3. The four mechanisms

### M1 — Zero-trap filters emptied `find_options` (primary for cards; partly fixed)

Alastair's own 16:48 session (pre-patch by two minutes): `find_options({preferredType:'hotel', region:'Torres del Paine', accommodationStyle:'luxury lodge'})` → `{cards: [], count: 0}` — `accommodationStyle` ILIKE'd `hotel.description` (0/44 populated). **Live re-run post-patch (17:52, session `1063b6d1…`): the identical ask returned hotel cards, first card = Explora Torres del Paine Conservation Reserve.** Patch `1701728` works.

**Three sibling traps remain live** (found by sweeping all nine tools' filter params against column coverage — completing the audit's §7.3):

| Filter | Column | Coverage | SQL proof (read-only, 2026-06-11) |
|---|---|---|---|
| find_options→trip `accommodationStyle` | `trip_card.accommodation_style` | 0/649 | TdP trips with `accommodation_style ILIKE '%lodge%'` → **0**; without → **151** |
| find_options→tour `accommodationStyle` | `tour_card.accommodation_style` | 0/11 | structurally identical |
| find_options→tour `activity` | `tour_card.activity_tags` | 0/11 | `'kayaking' = ANY(activity_tags)` → **0** of 11 |

Observed live consequence (session `4a1b498b…` ask "lodge-based trip… day hikes"): the model left `preferredType` unset → blend path → **trip and tour branches silently zeroed; only hotel + region_base cards returned**. The traps don't always zero the whole result — in blends they silently delete the product's core object (trips) from the deck. With explicit `preferredType:'trip'` + style they zero completely.

Safe-by-design (verified): `budgetBand` everywhere is NULL-tolerant (`from_price IS NULL OR …`; hotels via `MIN(hp.price) IS NULL OR …` over the empty `hotel_pricing`); `find_tips.region` is soft (`= $r OR region IS NULL`) — returned tips live with region supplied. Viable hard filters (coverage probed): customer_story.region 840/953, trust_proof.topic 39/39, trip_card.region 517/649, trip_card.activity_tags 466/649, hotel region via location.name 42/44, region_base via area 16/16.

### M2 — `lookup`'s widget URL-gates its entire render over an 18/924-populated column (never visible; predates the wave)

`lookup` worked in every observed session (5 chunks per call). Its widget renders **nothing** unless a chunk carries `canonicalUrl` — and `inform_chunk.canonical_url` is populated on 18/924 rows (the 18 `swoop_practical`; all 906 FAQ-sourced chunks have none, because `faqitem` carries no page linkage — only `faqset_id`). The widget's comment calls URL-less chunks an "edge case"; they are 98% of the corpus. Both the pre-wave (12 May D.t9) and post-wave (one-link-card) versions gate identically — **the lookup widget has effectively never rendered on FAQ answers**. Dev-mode note observed live: `lookup rendered silently — no canonical URLs {chunks: 5, urls: 0}`.

This is the fourth instance of the unprobed-population class ([discoveries.md 2026-05-18](../../discoveries.md)) — first time in a UI render gate rather than a SQL clause.

**T3 derivability (read-only MariaDB)**: the missing `faqset` table is not needed — `faqitem.faqset_id ↔ contentblock.faqset_id → contentblock.page_id → page`. Coverage: **892/928 live faqitems reach a page**. Ambiguity small: 123 faqsets map to one page; 24 to 2–8 pages (heuristic needed, e.g. lowest page id / most-specific pagetype).

### M3 — Widgets moved inline → desktop sidebar on 1 Jun; inline copies render hidden

Commit `03847e1` (2026-06-01 18:37, "Relocate display widgets to a desktop visual sidebar") + resizable split (`645c468`, `e3792f0` golden-ratio default). DOM-verified live: every widget renders **twice** — the in-thread copy `visible: false`, the sidebar copy `visible: true`. The thread shows prose only (plus DEV traces when dev affordances are on). Anyone looking for inline cards — the pre-1-Jun shape — sees "no widgets" even when the sidebar is fully populated. The 10 Jun visual-channel work built on this base (one hero image, title anchors).

### M4 — Conversation shape: Explora asks don't trigger `find_inspiring`

In both the 16:48 session and the live re-run, the model chose lookup/illustrate/find_options for Explora cost-and-duration asks — correct tool selection; `find_inspiring` simply wasn't part of the moment. Its absence from the sidebar wasn't a defect. On a dreamer ask it fired immediately (4 passages) and rendered.

## 4. Live verification record (2026-06-11 evening, stack restarted at `1701728`)

Six asks across two fresh sessions (`1063b6d1…`, `4a1b498b…`):

| Tool | Called | Returned | Widget rendered (sidebar) |
|---|---|---|---|
| `find_options` (hotel, Explora ask) | ✓ | **cards incl. Explora Conservation Reserve, Río Serrano, The Singular** | ✓ visible, 3 hotel cards |
| `find_inspiring` (dreamer ask) | ✓ | 4 passages | ✓ visible, images + prose + provenance anchor |
| `illustrate` (×4 across asks) | ✓ | 1 image each time | ✓ visible hero each time |
| `lookup` (×4) | ✓ | 4–5 chunks each | ✗ silent — no canonical URLs (M2) |
| `find_options` (lodge-trip blend) | ✓ | hotel + region_base only | ✓ rendered, but **trips/tours silently absent (M1 residue)** |
| `find_someone_who` | ✓ | 3 stories | ✓ visible |
| `find_tips` (×2, once with region) | ✓ | tips returned | n/a — no widget registered (deliberate: tips are quoted in prose per its description.md) |

Boot state verified: connector 9 tools; orchestrator "8 exposed to model", `agent: puma_orchestrator (tools: 9)`, `session backend: postgres`, 14 skills.

**Conclusion**: on patched main, the system works. The residual user-facing defects are M1's three sibling traps, M2's lookup invisibility, and the Mini being behind the patch.

## 5. What is healthy (do not re-litigate)

- `puma_dev` data: all derived tables fully embedded; `embedding_cache` 3,298 rows; the 10–11 Jun re-compose recovered 95% byte-identical (H5 falsified, twice over).
- MariaDB `swoop_patagonia` + raw dumps at `data/*.sql`: untouched.
- AntiRepetition: NOT the cause of any observed emptiness — only 2 sessions exist in `puma_session`; seen-sets ≤15 items. (The B.t13 exhaustion design question remains open as a *future* concern, not a current cause.)
- Audit corrections for the record: the blog raw fetch is **not** empty (`data/blog/raw/20260428T231414Z/posts.ndjson`, 102 posts — the missing component is a **loader** into `blog_post`/`blog_chunk`, never built); the vision-client reminder fix is **already in code** (six-output ask; only the re-annotation run is outstanding); the area taxonomy is 16 rows, not 21.

## 6. Fix candidates (each gated on Alastair's explicit go — none executed at time of writing)

| # | Fix | Shape | Size |
|---|---|---|---|
| F1 | Extend `1701728` to the three sibling traps (trip/tour `accommodation_style`, tour `activity_tags` → accepted-but-ignored + tests) | code-only, mirrors the hot patch | ~30 min |
| F2 | lookup visibility: derive `inform_chunk.canonical_url` for FAQ chunks at compose time via `faqset_id → contentblock → page` (892/928 coverage; multi-page heuristic for 24 faqsets) + re-compose (embedding_cache ⇒ ~£0); **or** widget renders a URL-less fallback | data fix (preferred per T3) or UI fix | ½ day incl. tests |
| F3 | `inspiration.tsx` rules-of-hooks violation: `useState`/`useEffect` sit after conditional early-returns (lifecycle gate, parse fail) → floods console with React "Expected static flag was missing" internal errors. Hoist hooks above returns | code-only | small |
| F4 | `find_inspiring/description.md` says passages come "with a region tag" — region is null on all 665. Align description with reality (or populate per the wider decision set) | content | tiny |
| F5 | Mini refresh: `git pull` + `npm install` + rebuild + restart per [cms/ops/demo-server.md](../../product/cms/ops/demo-server.md) — until then the demo still zeroes on the 16:48-shaped ask | operator step | 10 min |

## 7. Still-open wider decisions (deferred from this diagnosis; inputs in the audit §7)

Inspire region/mood populate-vs-retire (ratified mechanism exists on paper; mood never had one) · image re-annotation ~£14 (53% of image corpus — 6,894/13,012 — has no annotation/embedding and is invisible to illustrate) · blog loader build + ingest (102 posts waiting; unlocks date provenance) · AntiRepetition exhaustion design for durable sessions · production DB-build recipe with coverage-manifest verification + baseline discipline (the original goal of this session; resumes after widget fixes land).

## 8. Rules minted / reinforced

- **The 2026-05-18 coverage rule extends to UI affordance gates**: any render gate keyed on a data field (URL present, image present, title present) needs the same population probe as a SQL filter. A widget that gates its whole render on a sparse field is a silent-invisibility trap.
- **Diagnose with the durable transcript first**: `puma_session_event` carries args + full results per session — most of this diagnosis needed no service boot and no spend. The §2 query is the kit.
- **Blends mask branch-level zeroes**: a polymorphic tool returning *some* cards can still be silently dropping a whole variant class. Per-branch verification, not just non-empty results.
