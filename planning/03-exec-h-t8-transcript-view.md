# 03-exec-h-t8-transcript-view.md — Human-readable transcript viewer for harness JSONL

**Status**: DRAFT — for HITL review (2026-05-18). Not yet executable.
**Pairs with**: [03-exec-h-t8.md](03-exec-h-t8.md), [03-exec-h-t8-streaming-fix.md](03-exec-h-t8-streaming-fix.md).
**Authored by**: Cowork planning session 2026-05-18, ahead of demo tomorrow.

---

## ★ Read this first

The streaming JSONL ([per the streaming-fix plan](03-exec-h-t8-streaming-fix.md)) is correct: every observable event appended the instant it happens, including ~14 SSE frames per agent turn. Correct for forensic inspection; **hard to read** when you just want to see the conversation. Alastair, on reviewing the first sample:

> *"that streaming is hard for me to read. It's correct to capture the events as they appear though. So, what I'd like is a script that neatly ingests and formats the transcript in a way that is easier for a human to read."*

This plan lands that viewer. On-demand, runnable by human or agent, no automation. The viewer **doesn't** discard data — it collates and formats, but the same JSONL stays the source of truth.

---

## Goal

A CLI that takes a per-scenario `.jsonl` path and writes a clean, narrative-shaped **HTML** transcript alongside it. Collates per-turn SSE text frames into the full agent response. Surfaces every other event kind (user-agent thinking, stop-judge decisions, tool calls, assertions, judge verdicts, errors, timeouts) in their rightful place in the flow — verbose detail tucked behind `<details>` collapsibles so the default view is the conversation, with everything reachable in one click.

After this lands:

```sh
npm run -w @swoop/harness view -- runs/sample-1-skeptic/scenarios/skeptic-ai-suspicious.jsonl
# → wrote: runs/sample-1-skeptic/scenarios/skeptic-ai-suspicious.html
```

…produces a self-contained HTML file (inline CSS, no external assets, no JS) you open in any browser. Re-run on the same JSONL to regenerate.

---

## Architecture

### Two files, no churn elsewhere

- **New**: `product/harness/src/view-transcript.ts` — pure function `viewTranscript(events: HarnessEvent[], opts?: ViewOpts): string`. No I/O; takes events in, returns markdown out. Unit-testable in isolation.
- **New**: `product/harness/src/cli-view.ts` — CLI entrypoint. Parses argv, reads the .jsonl file line-by-line, calls `viewTranscript`, prints to stdout.
- **Modified**: `product/harness/package.json` — adds a `"view"` npm script (`"view": "tsx src/cli-view.ts"`).

No changes to events.ts, FileEventSink, runner, cli.ts, or any existing test. Purely additive.

### Output format — self-contained HTML

Single `.html` file with inline `<style>` block. No external CSS, no JS, no fonts (system default). Uses native `<details>`/`<summary>` for collapsibles so it works in any browser without scripting.

Page structure (rendered shape):

```
┌─────────────────────────────────────────────────────────────┐
│ skeptic-ai-suspicious                          [FAILED]     │
│ File · Duration · Started · Completed                       │
├─────────────────────────────────────────────────────────────┤
│ ▸ Lifecycle (collapsed by default)                          │
│   session created · consent granted · scenario completed    │
├─────────────────────────────────────────────────────────────┤
│ CONVERSATION                                                │
│                                                             │
│   Turn 1 — 18:48:10Z                                        │
│   ┌─────────────────────────────────────────┐               │
│   │ Visitor: Is there a way to just speak…  │ ← user bubble │
│   └─────────────────────────────────────────┘               │
│   ▸ user-agent (sonnet-4-5, 3.2s)  [details collapsed]      │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ Agent: Absolutely — I get it. You can speak with…    │  │ ← agent bubble
│   └──────────────────────────────────────────────────────┘  │
│   ▸ stop-judge: NO (haiku-4-5, 0.5s)  [details collapsed]   │
│                                                             │
│   Turn 2 — 18:48:21Z                                        │
│   …                                                         │
│   ▸ Tool calls (2) — find_options, lookup  [details]        │
│   …                                                         │
├─────────────────────────────────────────────────────────────┤
│ ASSERTIONS                                                  │
│   ❌ tool_call — expected tool call to "find_someone_who"   │
│   ❌ triage_verdict — no final triage state captured        │
│   ✅ judge_rubric — judge passed: The agent confidently…    │
├─────────────────────────────────────────────────────────────┤
│ ▸ Raw events (N events)  [collapsed by default]             │
│   pre-formatted JSONL dump, one event per line              │
└─────────────────────────────────────────────────────────────┘
```

**What's collapsed by default** (per Alastair's direction):
- Lifecycle block (session-created / consent-granted / scenario-completed details)
- Per-turn user-agent invocation/response details (model + duration + raw Anthropic response → behind `<details>`)
- Per-turn stop-judge invocation/response details (same)
- Per-turn tool-call args full JSON (summary visible: `find_options × 2`; click to see args)
- Raw events block at the bottom (the full JSONL embedded as preformatted text inside `<details>`)

**Always visible by default**:
- Header with scenario name + status badge
- Conversation: Visitor / Agent bubbles in turn order
- Tool-call summary lines (names + count; expand for args)
- Errors / timeouts inline at their point (red block-quote)
- Assertions block with pass/fail icons + one-line reason

### Styling

Minimal but readable. System font stack. Visitor and Agent bubbles distinguished by background colour (no chat-app pretension — just clear contrast). Tool calls in `<code>` blocks. Assertions with ✅/❌ inline. Errors in a red-tinted block-quote. `<details>` rendered with a clear `▸/▾` triangle from native browser styling. Roughly 60ch content width centered on the page.

### Collation rules

| Event kind | How it renders |
|---|---|
| `scenario.started` | Header title + file path |
| `session.created` / `consent.granted` / `scenario.completed` | Inside the collapsed Lifecycle block |
| `user_agent.invoked` / `user_agent.responded` | Per-turn `<details>` with model + duration; expanded view shows the prompt + raw Anthropic response. Suppressed silently for scripted scenarios. |
| `user.message.sent` | Visitor bubble at the start of each turn |
| `agent.sse.frame` × N (text) | Agent bubble per turn — text concatenated in order |
| `agent.sse.frame` (`tool-call`) | Tool-calls `<details>` inside the turn. Summary line: `<tool> × N`; expanded shows arg JSON per call. |
| `agent.sse.frame` (`done`/`error`/other) | Suppressed in default view; included in Raw events at the bottom |
| `agent.response.aggregated` | Drives turn boundaries; not rendered directly |
| `stop_judge.invoked` / `stop_judge.responded` | Per-turn `<details>` (YES/NO + duration; expanded shows the Haiku transcript). Suppressed for scripted scenarios. |
| `assertion.evaluated` | Assertions block at the bottom with ✅/❌ + reason |
| `judge.invoked` / `judge.responded` | Folded into the matching `assertion.evaluated` rather than duplicated |
| `error` / `timeout` | Inline red block-quote at the position they happened |
| `scenario.completed` | Status badge in header + duration in Lifecycle |
| (all events) | Embedded verbatim in the collapsed Raw events block at the bottom — answers "what really happened" with one click |

### CLI shape

```
Usage: npm run -w @swoop/harness view -- <path-to-jsonl>

Args:
  <path>      Path to a per-scenario .jsonl file (or a scenarios/ dir; reads
              every .jsonl inside and writes a sibling .html for each).
  -h, --help  Show usage.

Output:
  Writes <path>.html (same basename, .html extension) next to the .jsonl.
  Prints the absolute output path to stdout for the operator to open.

Exit code: 0 on success; non-zero on parse/IO failure.
```

Scenario name + status + file + duration are all extracted from events inside the JSONL — no separate args needed. (Per Alastair's #2.)

### Collation rules (the "rationalised" bit)

| Event kind | How it renders |
|---|---|
| `scenario.started` | Title + file path + scenario shape |
| `session.created` / `consent.granted` | One line each in the Lifecycle section at the bottom |
| `user_agent.invoked` / `user_agent.responded` | One italicised line per turn — model + duration. Skipped silently if the scenario is scripted (no user-agent events). |
| `user.message.sent` | **Visitor:** line at the start of each turn |
| `agent.sse.frame` × N | **Agent:** single line per turn, text concatenated from all `text`-typed frames in turn order |
| `agent.sse.frame` (`tool-call`) | Tool calls block inside the turn, one line per call with name + arg JSON (truncated at 200 chars) |
| `agent.sse.frame` (`done`/`error`) | Suppressed in default view; surfaced in `--raw` |
| `agent.response.aggregated` | Used to drive turn boundaries; not rendered directly |
| `stop_judge.invoked` / `stop_judge.responded` | One italicised line per turn (YES/NO + duration). Skipped for scripted scenarios. |
| `assertion.evaluated` | Assertions block at the bottom, ✅/❌ per assertion + the reason |
| `judge.invoked` / `judge.responded` | Folded into the matching `assertion.evaluated` for that rubric (no duplicate lines) |
| `error` / `timeout` | Surfaced in-place where they happened, as a `> ⚠️` block-quote line |
| `scenario.completed` | Status badge in the header + duration in Lifecycle |

### CLI shape

```
Usage: npm run -w @swoop/harness view -- <path-to-jsonl> [--raw]

Args:
  <path>      Path to a per-scenario .jsonl file (or a scenarios/ dir; reads
              every .jsonl inside).
  --raw       Also append a raw event dump under the rationalised view.
  -h, --help  Show usage.

Exit code: 0 on success; non-zero on parse/IO failure (this is a viewer,
not a gate).
```

The "or a scenarios/ dir" extension is small and lets the operator do `npm run … view -- runs/<dir>/scenarios/` to read everything in a run. Defer if it complicates Task 2; ship single-file v1 if so.

---

## Tasks

Bite-sized per the [superpowers:writing-plans skill](../../.claude/skills/writing-plans). Estimated total: **30-45 min**.

### Task 1 — Fixture JSONL for tests

**Files:**
- New: `product/harness/src/__tests__/fixtures/sample-transcript.jsonl` — small hand-authored or sample-derived JSONL covering scenario.started + session.created + consent.granted + user_agent.invoked + user_agent.responded + user.message.sent + 3-4 agent.sse.frame (text + tool-call) + agent.response.aggregated + stop_judge.invoked + stop_judge.responded + assertion.evaluated (×2) + judge.invoked + judge.responded + scenario.completed.

Either hand-author for tight test control, or capture a real sample by running one scenario.

### Task 2 — Implement view-transcript.ts

**File:** `product/harness/src/view-transcript.ts` (new)

**Step 2.1**: Pure function signature:
```ts
export function viewTranscript(events: HarnessEvent[]): string;
```

No options (per Alastair's collapsibles-instead-of-flag direction). Returns a complete HTML document string.

**Step 2.2**: Implementation walks events in order, grouping by turn (event's `turnIndex`), then emits HTML per the collation rules above. Inline `<style>` block at the top of the document. Native `<details>`/`<summary>` for collapsibles.

**Step 2.3**: Tests in `__tests__/view-transcript.test.ts`:
- Empty events → minimal valid HTML doc with placeholder
- Scripted scenario (no user-agent / stop-judge events) renders without those sections
- Agent scenario renders full structure including user-agent + stop-judge `<details>` blocks
- Tool calls within a turn collated into one `<details>` block with arg JSON
- Multiple text-type SSE frames concatenated in order in the Agent bubble
- Raw events `<details>` always present at the bottom with all events JSON-line-by-line
- HTML escaping: `<`, `>`, `&` in event payloads escaped correctly (visitor messages, agent text, tool args)
- Native browser collapsible behaviour relied on (no JS to test)

### Task 3 — Implement cli-view.ts

**File:** `product/harness/src/cli-view.ts` (new)

Parses argv, validates the path argument, reads the JSONL file (readFileSync + line-split for v1), parses to HarnessEvent[], calls viewTranscript, writes the HTML to `<basename>.html` next to the .jsonl, prints the absolute output path to stdout.

If the path is a directory, lists all `.jsonl` files inside and processes each, printing one path per output file.

Malformed lines: skip + warn to stderr (don't fail the whole file). Tolerance is the right posture — the JSONL might have been mid-write when the operator killed a run.

### Task 4 — Wire npm script

**File:** `product/harness/package.json`

Add: `"view": "tsx src/cli-view.ts"` next to the existing `"eval"` script.

### Task 5 — Smoke against the sample-1-skeptic JSONL

Run: `npm run -w @swoop/harness view -- runs/sample-1-skeptic/scenarios/skeptic-ai-suspicious.jsonl`

Eyeball the output. Refine if anything reads badly. Iterate until it's a clean read for Alastair tomorrow.

### Task 6 — Update discoveries.md

One paragraph: "Per-scenario JSONL has a sibling human-readable view at `npm run -w @swoop/harness view -- <path>`. Use it when you want to read a transcript end-to-end; use the raw JSONL when you want to grep for specific event kinds or debug the streaming itself."

---

## Verification

```sh
rm -rf product/node_modules && npm install
npm run typecheck --workspace=@swoop/harness
npm test --workspace=@swoop/harness
npm run -w @swoop/harness view -- product/harness/runs/sample-1-skeptic/scenarios/skeptic-ai-suspicious.jsonl
```

**Acceptance**:
1. All existing harness tests still pass.
2. New view-transcript tests pass.
3. The smoke output reads cleanly to a human (subjective; Alastair confirms).

---

## Open questions for HITL — RATIFIED 2026-05-18

Per Alastair's directives (incorporated above):

1. ✅ **HTML output, not markdown.** Self-contained file, inline CSS, no JS, no external assets. Open in any browser.
2. ✅ **Path to JSONL is the only arg.** Scenario name + status + file + duration are extracted from events inside the JSONL.
3. ✅ **No `--raw` / `--terse` flag.** Detail is always present, tucked behind native `<details>` collapsibles. Default-collapsed: lifecycle, user-agent details, stop-judge details, tool-call args, raw events.
4. ✅ **Tool-call args: collapsed by default.** Summary line shows `<tool> × N`; click expands to full arg JSON. Same pattern for the raw events dump.
5. ✅ **Diff-two-runs: out of scope for v1.** Single-transcript viewer only.

**One new question** I'd flag for your call:

6. ✅ **HTML lands in a `views/` subdir at run-dir level**, sibling to `scenarios/`. So `runs/sample-1-skeptic/scenarios/skeptic-ai-suspicious.jsonl` → `runs/sample-1-skeptic/views/skeptic-ai-suspicious.html`. For ad-hoc JSONL paths that don't follow the standard layout, the CLI writes to `<parent-of-parent>/views/<basename>.html` (creating dirs if needed).

7. ✅ **`--open` flag**, off by default. When passed, the CLI execs `open <path>` after writing (macOS-only for v1; help text notes this). Operators scripting batch runs leave it off; ad-hoc reviewers pass `--open`.

---

## What this plan deliberately does NOT do

- Doesn't change the streaming-fix output. Same JSONL on disk; same per-scenario JSON summary; same rollup.
- Doesn't add a web UI. Stdout-only.
- Doesn't auto-run after `npm run eval`. On-demand only — operator/agent invokes when wanted.
- Doesn't capture event-derived statistics (latency histograms, frame-rate, etc). Just renders the conversation.

---

## HITL ratification appendix

**Status**: RATIFIED 2026-05-18 (Cowork session with Alastair).

**Directives**:
- HTML output, not markdown.
- Path-to-JSONL the only arg; scenario name + status + file + duration extracted from events inside.
- Collapsibles instead of flags; default view = conversation, detail is one click away.
- Tool-call args collapsed by default; summary line visible.
- Diff-mode out of scope for v1.
- HTML lands in `views/` subdir at run-dir level (sibling to `scenarios/`).
- `--open` flag, off by default; macOS-only for v1.

**Go-ahead**: ✅ — execute sequentially in this session.

---

## 2026-05-18 Execution log

> *Executing session fills in.*

(empty until execution starts)

---

## 2026-05-18 Addendum — render markdown in Visitor + Agent bubbles

**Status**: DRAFT — for HITL review.
**Trigger**: Alastair on reviewing the first HTML: *"good. html should honour/convert markdown in the chats though."*

### The gap

The current view escapes ALL text in bubbles via `escapeHtml()`. Agent responses freely use markdown (`**bold**`, `*italic*`, `- list items`, `# headers`, `\`code\``). All of that currently renders as literal asterisks + raw newlines in the HTML. Hurts readability + misrepresents what a visitor would actually see in the chat UI.

### Goal

Render markdown to HTML inside Visitor + Agent bubbles. Everything else (tool args, persona, raw event dumps, error blockquotes, etc.) stays as plain escaped text — those are data surfaces, not conversational.

### Scope

- **In**: Visitor bubble text + Agent bubble text. The text rendered inside `.bubble-text` divs.
- **Out**: User-agent persona + goal (data); tool call args (JSON); raw Anthropic responses (JSON); errors + timeouts (technical); assertion reasons (technical-ish); raw events block.

### Architecture

- Add `marked` (~30KB, MIT, widely used) as a harness dependency.
- New helper `renderMarkdown(text: string): string` in `view-transcript.ts` — wraps `marked.parse()` with safe defaults:
  - `gfm: true` (GitHub-flavoured: tables, fenced code, etc.)
  - `breaks: true` (single `\n` → `<br>`, matching chat semantics where line breaks are intentional)
  - Sanitisation: post-process with `sanitize-html` to strip raw HTML / script tags / event handlers / dangerous attrs. Defaults to allow-list of safe inline + block tags.
  - Or: configure `marked` to escape HTML before parsing. Simpler if `marked` exposes that flag in current version.

**Picking the safer of the two**: `sanitize-html` post-process. `marked` historically had a `sanitize` flag but it was deprecated 2024+ as too coarse. The sanitize-html post-pass is the recommended path.

Two deps add: `marked` + `sanitize-html`. Both stable, small, dependency-light.

### Tasks

**Task A1**: Add `marked` + `sanitize-html` (+ `@types/sanitize-html`) as harness dependencies.
```sh
npm install --save --workspace=@swoop/harness marked sanitize-html
npm install --save-dev --workspace=@swoop/harness @types/sanitize-html
```

**Task A2**: Add `renderMarkdown(text)` helper to `view-transcript.ts`. Configure marked with `gfm: true, breaks: true`. Run sanitize-html on the output with an explicit allow-list: `['p','br','strong','em','code','pre','ul','ol','li','h1','h2','h3','h4','h5','h6','blockquote','a','hr']` + safe attr allow-list (`{a: ['href','title']}`). Disallow event handlers, javascript: hrefs, etc.

**Task A3**: Swap the two `escapeHtml(text)` calls inside `renderTurn` (visitor + agent bubbles) for `renderMarkdown(text)`. Leave every other `escapeHtml` call untouched.

**Task A4**: Add tests in `view-transcript.test.ts`:
- Bold/italic/code render as `<strong>`/`<em>`/`<code>`.
- Bullet list renders as `<ul><li>…</li></ul>`.
- Newlines become `<br>` (with `breaks: true`).
- Raw `<script>` / `<img onerror=…>` / `javascript:` href injected via markdown is stripped or escaped.
- HTML escaping of non-markdown surfaces (tool args, persona, etc.) UNAFFECTED.

**Task A5**: Re-smoke against sample-1-skeptic. Confirm markdown renders. Eyeball the output for any layout issues (e.g., `<p>` margins inside bubbles).

### Open questions

1. **Should persona + goal in user-agent details also render markdown?** Recommended: **NO for v1.** Personas are technical-ish prose; treating them as code surfaces them as authored. Add later if Alastair wants.
2. **`breaks: true` (single `\n` → `<br>`) vs `false` (paragraph-only)?** Recommended: **true.** Agent responses have intentional line breaks in lists + paragraphs; preserving them matches the chat UI.
3. **Linkify URLs that aren't markdown-linked?** Recommended: **NO for v1.** Agent's URLs are typically markdown-formatted already; adding auto-linkify risks turning incidental URL-like strings into links.

### Estimated effort

15–20 minutes including tests + re-smoke.

### HITL ratification

**Status**: RATIFIED 2026-05-18. All three open-question recommendations accepted (persona/goal stay escaped; `breaks: true`; no auto-linkify). Proceed with sequential execution in this session.
