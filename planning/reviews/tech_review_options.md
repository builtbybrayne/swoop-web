# Council‑of‑Experts Code Review with Claude Code — Tools, Skills, MCP Servers, and Workflows for Code‑on‑Its‑Merits Plus Plan‑vs‑Implementation Drift

## TL;DR
- **Build it as a hybrid**: a `/council-review` slash command that fans out parallel **read‑only subagents** (security, architecture, performance, testing, DX, product) for the merits review, plus a separate **drift‑auditor** subagent that walks the planning docs and produces a traceability matrix. Ground every reviewer in deterministic data — Serena MCP for symbol graphs, Repomix or Aider's repo‑map for ranked codebase context, and Semgrep/ast‑grep MCP for static facts. Synthesise into one report via the **Evaluator‑Optimizer** pattern from the Anthropic cookbook.
- **The single biggest leverage point is Serena MCP** (LSP‑backed, symbol‑level navigation, `find_symbol` / `find_referencing_symbols`) — it lets each expert reviewer reason about real call graphs and references rather than blindly grepping. Pair it with `cclsp` or `lsp-mcp` if you need richer language coverage. For repo‑level structural maps, Aider's tree‑sitter + PageRank algorithm is the technique to copy; `RepoMapper` exposes it as an MCP server today.
- **Drift detection is still mostly DIY** — there is no Anthropic‑official "compare code to plan" skill. The best public starting points are `obra/superpowers` (subagent‑driven development with explicit spec → plan → review gates), `JuliusBrussee/cavekit` (a literal `/check` drift‑report skill), `gotalab/cc-sdd` (Kiro‑style spec/design/tasks/impl with `kiro-validate-gap`), and `ksimback/tech-debt-skill` (whole‑repo audit with documentation‑drift dimension). All of these are templates to adapt — none of them ingest an arbitrary planning structure out of the box, so the drift workflow you build is going to be bespoke.

---

## Key Findings

1. **Anthropic itself ships a council‑of‑experts model** in two forms now: the GitHub‑integrated "Code Review" beta (multi‑agent, parallel, verified findings, deduped, posted as PR comments — Team/Enterprise) and the local `/ultrareview` command (Claude Code v2.1.86+, fleet of cloud agents with an explicit Find → Verify → Rank → Dedup pipeline, ~$5–20/run, 5–10 min). Both confirm the architecture you want: **parallel specialists + a verification stage + dedup/synthesis**. For an internal repo audit you can reproduce the same pattern locally with subagents and never leave your machine.

2. **Read‑only parallel subagents are the right primitive**, not agent teams. Each subagent gets its own context window, only its final message returns to the parent (so reviewer noise doesn't pollute synthesis), and `tools: Read, Grep, Glob, Bash` enforces non‑destructive review. The HAMY 9‑agent template and Anthropic's own subagent docs are the canonical references. Avoid forked subagents for this — Boris Cherny and others explicitly warn that fresh context is what gives an unbiased review; forks rubber‑stamp.

3. **For codebase ingestion, three techniques dominate** and they compose:
   - **Symbol‑level retrieval (Serena, cclsp, lsp‑mcp)** — reviewers query "where is `X` used?" rather than dump files.
   - **Ranked repo maps (Aider's tree‑sitter + PageRank, RepoMapper MCP, Repomix `--compress`)** — gives the orchestrator a token‑budgeted overview to plan the review and route subagents.
   - **Whole‑repo packing (Repomix, gitingest, code2prompt)** — only when the repo fits the 1M context; useful as a fallback for small services or focused modules.

4. **Static analysers as ground truth feeders work** and are the cheapest way to keep reviewers honest. Semgrep ships a first‑class Claude Code plugin (Code, Supply Chain, Secrets all behind one MCP) with a Skill + Hook bundle. ast‑grep has an MCP for structural search. Treat them as deterministic input that prefixes each reviewer's prompt — "here are 47 facts you can rely on without reading files".

5. **Plan‑vs‑implementation drift has no off‑the‑shelf Anthropic answer**. The realistic build is: (a) load the planning docs as `references/` inside a custom skill, (b) extract a numbered requirement list / ADR list / acceptance criteria list, (c) for each item ask a drift‑auditor subagent to find the implementing code (Serena `find_symbol` / Grep), (d) classify as Implemented / Partial / Missing / Drifted / Unverified, (e) require evidence (file:line, test name, command output) for every verdict — the wmedia.es **Evaluator‑Optimizer** skill pattern is the cleanest published precedent. Academic precedent is in TraceLLM and Graph‑RAG traceability work (arXiv 2412.08593, 2602.01253) — both confirm prompt‑engineered LLMs beat classical IR for this task but you still need rigorous evidence rules to control hallucination.

6. **The most useful single skill bundle to install today is `obra/superpowers`** — its `subagent-driven-development` skill literally implements two‑stage review (spec compliance → code quality), `requesting-code-review` blocks progress on critical findings, and the spec → plan → execute → review loop maps directly onto the use case. It's been formally accepted into Anthropic's marketplace (Jan 2026) and is at ~42k stars with frequent updates.

---

## Details

### 1. Council‑of‑experts patterns for code review

**Anthropic‑official**
- **Anthropic Code Review for GitHub** — Team/Enterprise PR review service. Multi‑agent fleet, parallel analysis, verification step that filters false positives, severity‑tagged inline comments. Increased substantive review rate at Anthropic from 16% to 54% of PRs. `code.claude.com/docs/en/code-review`. Tunable via `CLAUDE.md` or `REVIEW.md`.
- **`/ultrareview` (Claude Code v2.1.86+)** — local command, runs in cloud sandbox, 5 default agents (configurable up to 20), four‑stage pipeline (Setup → Find → Verify → Dedup), takes ~17 min on an 11k‑line PR, every finding independently reproduced. Pro/Max get 3 free runs through May 5 2026, then $5–20/run. CI mode via `claude ultrareview --json --timeout` (v2.1.120).
- **`/review` (built‑in skill)** — local single‑pass diff review, fast, free, runs in‑session. Use as the first cheap gate; reach for `/ultrareview` or a custom council before merge.
- **Anthropic Cookbook — Evaluator‑Optimizer** (`platform.claude.com/cookbook/patterns-agents-evaluator-optimizer`). The canonical generator/evaluator loop. Map this onto council review by treating each expert as an evaluator and the synthesiser as the optimiser.
- **`anthropics/claude-code-action`** (GitHub Marketplace, official). General‑purpose `@claude` action for PRs/issues — open‑source alternative to managed Code Review.

**Community subagent collections (worth installing)**
- **`obra/superpowers`** — the strongest single recommendation. Skills include `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `requesting-code-review`, `systematic-debugging`. Two‑stage review (spec compliance, then code quality) is built into the workflow. Accepted into Anthropic's official plugin marketplace Jan 2026. Install: `/plugin marketplace add obra/superpowers-marketplace && /plugin install superpowers@superpowers-marketplace`.
- **`VoltAgent/awesome-claude-code-subagents`** — 100+ subagents organised in 10 categories. The `04-quality-security/` dir contains production‑grade `architect-reviewer`, `security-auditor`, `qa-expert`, `code-reviewer`. Plugin marketplace: `claude plugin marketplace add VoltAgent/awesome-claude-code-subagents`.
- **`wshobson/agents`** — 184 agents, 16 multi‑agent workflow orchestrators, 150 skills, 78 plugins. The `comprehensive-review` plugin and `full-stack-orchestration:full-stack-feature` command are directly relevant: they sequence backend‑architect → database‑architect → frontend‑developer → test‑automator → security‑auditor → deployment‑engineer → observability‑engineer.
- **`hesreallyhim/awesome-claude-code`** — the canonical awesome‑list (~41k★). Use as the index; it cross‑references everything below.
- **`0xfurai/claude-code-subagents`** (100+), **`vijaythecoder/awesome-claude-agents`** (orchestrated dev team), **`lst97/claude-code-sub-agents`**, **`davepoon/claude-code-subagents-collection`**, **`navin4078/awesome-claude-code-agents`** — all worth a skim, but they overlap heavily. Pick one.
- **HAMY's 9‑parallel‑subagent `/code-review` command** (`hamy.xyz/blog/2026-02_code-reviews-claude-subagents`) — battle‑tested, paste‑in‑and‑go. Nine roles: Linter & Static Analysis, Code Reviewer, Security Reviewer, Quality & Style Reviewer plus five more. Drop into `.claude/commands/code-review.md`. The single most copyable artefact in the ecosystem for this use case.
- **`nishilbhave/codeprobe`** — 9 sub‑skills (security, SOLID, architecture, error handling, performance, testing, code style, …), one‑command install via `npx skills add nishilbhave/codeprobe`, read‑only by design, writes timestamped reports to `./codeprobe-reports/`. Good drop‑in if you want a maintained version of HAMY's pattern.

**Multi‑model "real council"**
- **Niraj Kumar's AI Advisory Council** (Medium write‑up) — uses Claude Opus + GPT‑5.3 + Gemini 3 Pro as genuinely different reviewers, with The Architect (Claude) updating its plan based on the other models' feedback. Genuinely different training data catches different bugs. Worth replicating if you have multi‑provider access.
- **`levnikolaevich/claude-code-skills`** — multi‑model AI review pipeline; Claude‑hosted runs delegate to Codex as advisor and vice versa. Bundles `hex-graph-mcp` (code knowledge graph) and `hex-line-mcp` (hash‑verified editing).

**Academic backing (caveat: results are mixed)**
- ICLR 2025 *Multi‑LLM‑Agents Debate* survey found MAD often **does not** beat single‑agent test‑time compute. NeurIPS 2025 *Debate or Vote* shows majority voting accounts for most of the gain typically attributed to debate.
- *CodeAgent: Autonomous Communicative Agents for Code Review* (arXiv 2402.02172) and *MARS: Multi‑Agent Review System* (arXiv 2509.20502) both show role‑based collaboration helps for code review specifically; MARS matches MAD accuracy at ~50% of token cost by avoiding reviewer‑to‑reviewer chatter.
- **Practical implication**: do parallel independent reviews + a single synthesiser. Don't make reviewers debate each other — it costs tokens and rarely improves outcomes.

### 2. Codebase graphing / structural understanding

**MCP servers (install these)**
- **`oraios/serena`** ⭐ — IDE‑grade semantic retrieval over LSP. 30+ languages. Tools: `find_symbol`, `find_referencing_symbols`, `insert_after_symbol`, `get_symbols_overview`, `list_dir`. Drops naive grep dependency for large codebases. *Install warning the project itself flags*: install from source, not via random marketplaces — `git clone` and `uvx --from <path> serena-mcp-server`. The single highest‑leverage MCP server for this use case.
- **`ktnyt/cclsp`** — Claude Code‑specific LSP MCP. Diagnostics, find_definition, find_references, restart_server. Lighter alternative to Serena when you only need diagnostics + nav.
- **`Tritlo/lsp-mcp`** — generic LSP→MCP bridge with hover/completions/code‑actions. Useful when you want completion semantics (rare for review).
- **`tjx666/vscode-mcp`** — exposes the live VSCode LSP state to the agent, including diagnostics — replaces slow `tsc`/`eslint` invocations.
- **`Oolab-labs/claude-ide-bridge`** — heavier, ~140 tools across LSP, debugger, terminals, Git, GitHub. Overkill for review‑only but useful if reviewers need to actually run things.
- **`pdavis68/RepoMapper`** — Aider's repo‑map algorithm exposed as an MCP server. Tree‑sitter + PageRank ranking. Best for giving the **orchestrator** a budgeted overview before dispatching reviewers.
- **`ast-grep/ast-grep-mcp`** — structural code search by AST pattern. Replace text greps with "find all async functions without try/catch". Reviewers can author targeted rules.
- **`semgrep/mcp`** (now bundled into the official Semgrep plugin) — `security_check`, `semgrep_scan`, `semgrep_scan_with_custom_rule`, `get_abstract_syntax_tree`, `semgrep_findings`, `semgrep_rule_schema`. Use both the local CLI and the platform via SEMGREP_APP_TOKEN.

**Repo packers (use as fallback / orchestrator brief)**
- **`yamadashy/repomix`** — packs a repo to Markdown/XML/JSON, has `--compress` (tree‑sitter‑based, ~70% token reduction), built‑in Secretlint scan, MCP server mode, GitHub Actions support. Most polished of the packers.
- **`gitingest`** — replace `hub` with `ingest` in any GitHub URL for an LLM‑ready dump. Zero setup, supports private repos with PAT.
- **`mufeedvh/code2prompt`** — CLI with prompt templating + token counting.
- **`llm-context`** — community alternative; less mature than Repomix.

**Aider's repo‑map technique (the gold standard)**
- Tree‑sitter parses every source file → extracts definition + reference tags via `tags.scm` queries → builds a directed graph (file → file via symbol references) → NetworkX PageRank with personalisation toward chat files → binary‑search format until the rendered tree fits the token budget. Code at `aider/repomap.py`. **This is the algorithm to copy for your orchestrator step**, either by calling Aider directly, by pointing at RepoMapper MCP, or by re‑implementing.

**Architecture diagram generators**
- **`dyatko/arkit`** — JS/TS/Vue auto‑diagrams (SVG/PNG/PlantUML). CI‑friendly.
- **`pahen/madge`** — JS module dependency graphs with circular‑dep detection.
- **`sverweij/dependency-cruiser`** — multi‑language with import‑boundary linting rules.
- **`antoinecoulon/skott`** — newer, faster than madge for large JS/TS monorepos; exposes graph API for further analysis.
- **`swark-io/swark`** — VS Code extension that uses Copilot's LLM to synthesise Mermaid architecture diagrams from code. Useful pattern to crib if you want a Claude Code skill that produces a C4‑ish Mermaid diagram of the repo for the review orchestrator.
- For Python/Go/etc., feed `pydeps`/`pyan`/`go-callvis` output into a context block.

**MCP server tracking**
- **`mcpservers.org`** and **`mcpmarket.com`** are the two best aggregators. Always cross‑check against the source GitHub repo and prefer first‑party install paths.

### 3. Plan‑vs‑implementation drift detection

**Direct‑use community projects**
- **`obra/superpowers`** — the `requesting-code-review` skill reviews implementation against the plan and original spec, blocking on critical findings. The `writing-plans`/`executing-plans` skills make plans the durable artefact across sessions.
- **`JuliusBrussee/cavekit` v4** — three commands (`/ck:spec`, `/ck:build`, `/ck:check`). `/ck:check` is literally a drift report comparing `SPEC.md` against the current code. The `backprop` skill turns every test failure into a `§B` entry in the spec so it accumulates invariants.
- **`gotalab/cc-sdd`** — Kiro‑style SDD harness. `kiro-validate-gap` is an explicit gap analyser between the design and implementation. 8 agents stable, 17 skills loaded on demand.
- **`Pimzino/claude-code-spec-workflow`** — Requirements → Design → Tasks → Implementation, with verification phase.
- **`OthmanAdi/planning-with-files`** — Manus‑style persistent markdown planning, validated via Anthropic's skill‑creator.
- **`gsd-build/get-shit-done`** — heavy spec‑driven framework; includes schema drift detection (flags ORM changes missing migrations) and scope reduction detection (catches when the planner silently drops requirements).
- **`ksimback/tech-debt-skill`** — produces a `TECH_DEBT_AUDIT.md` across nine dimensions including **documentation drift**. Subagent dispatch for repos >50k LOC. Repeat‑run mode marks resolved/stale/new findings — turn this into a habit and you get drift trend data over time.
- **`FlorianBruniaux/claude-code-ultimate-guide` `/audit`** — one prompt does an audit of a Claude Code setup; the technique (compare `~/.claude/plans/` vs `git diff --stat` for PRs that go beyond stated plan intent) is directly transferable.
- **wmedia.es Evaluator‑Optimizer skill** — `disable-model-invocation: true`, runs inline (sees the conversation), classifies every claim as Verified / Partially Verified / Unverified, requires file:line evidence for each verdict. The cleanest published *evidence‑based* drift pattern.

**Technique to copy (the actual workflow)**
1. **Extract** numbered requirements / acceptance criteria / ADRs from planning docs into a YAML or Markdown matrix (one row = one requirement). A small Claude pass with extended thinking does this well.
2. **For each requirement**, dispatch a drift‑auditor subagent (read‑only, has Serena/Semgrep) to find implementing code or evidence. Output: `{requirement_id, status, evidence: [{file, line, kind: code|test|doc|absent}], notes}`.
3. **Reverse pass**: dispatch a "code‑without‑plan" auditor to look for significant subsystems / public APIs / dependencies that have **no** corresponding planning entry — drift in the other direction.
4. **Synthesise** into a traceability matrix (Implemented / Partial / Missing / Drifted / Unjustified‑addition / Unverified). Keep the result in the repo as `AUDIT.md` so subsequent runs can diff against it.

**Academic grounding**
- *Leveraging Graph‑RAG and Prompt Engineering to Enhance LLM‑Based Automated Requirement Traceability* (arXiv 2412.08593) — graph indexing > vector indexing > keyword for class‑diagram‑level traceability.
- *TraceLLM* (arXiv 2602.01253) — systematic prompt design for reqs traceability across 8 LLMs and 4 datasets.
- Hassani et al. on DPA/GDPR compliance with LLMs — confirms LLMs handle compliance‑style "spec vs artefact" gap analysis better than classical IR.
- Combine these techniques with **test coverage as an adherence proxy**: every requirement should be linked to at least one test; uncovered requirements are a cheap drift signal.

### 4. General Claude Code review tooling — the static‑analysis stack

Treat these as **deterministic feeders** the council reviews trust without re‑deriving:
- **Semgrep plugin** (`semgrep.dev/docs/mcp`) — bundles MCP + Hooks + Skills, scans every agent‑generated file, regenerates code on findings. Single best security ground truth feeder.
- **CodeQL** — Trail of Bits' skill teaches Claude how to build a database, write queries, run security‑extended + ToB community packs. Good for deep audits.
- **ruff/eslint/typescript** via `cclsp` or `vscode-mcp` — fast diagnostics without `tsc` cold starts.
- **`trailofbits/skills`** — production‑grade collection. Standouts: `differential-review`, `variant-analysis`, `insecure-defaults`, `entry-point-analyzer`, `constant-time-analysis`, `firebase-apk-scanner`. Read their `CLAUDE.md` for skill‑authoring discipline (third‑person descriptions, behavioural guidance over reference dumps, regex‑over‑AST tradeoffs).
- **`getsentry/skills` `security-review`** — referenced by ToB as a standout routing + progressive‑disclosure example.
- **Snyk skill** and **`semgrep` skill** — bring SCA / dep scan / IaC scan into the agent loop.

**Anthropic official guidance**
- `code.claude.com/docs/en/best-practices` — codifies the writer/reviewer pattern, fresh‑context review, parallel subagents, slash commands, hooks.
- `claude.com/blog/subagents-in-claude-code` — when (and when not) to use subagents. The "fresh subagent reviewing your work" pattern is officially endorsed.
- `claude.com/blog/code-review` — the announcement of the multi‑agent PR review service.
- *How Anthropic teams use Claude Code* (PDF) — describes their internal patterns (CLAUDE.md, monorepos, screenshot‑driven iteration, commit‑often).

### 5. Practical orchestration for a council‑of‑experts run

**The recommended workflow (synthesised across HAMY, Superpowers, ToB, and Anthropic blogs)**

```
0. Pre-flight (deterministic, runs in main thread)
   - Generate a Repomix/Aider repo-map summary into .review/repo-map.md
   - Run Semgrep, CodeQL, ruff/eslint -> write to .review/static/*.json
   - Index project with Serena (uvx --from . serena-mcp-server)
   - Extract a requirements matrix from planning docs -> .review/requirements.yaml

1. Dispatch parallel reviewers (each is a read-only subagent)
   - security-reviewer       (tools: Read, Grep, Glob, Bash; reads .review/static)
   - architecture-reviewer   (uses Serena symbol graph)
   - performance-reviewer
   - testing-reviewer        (greps test/, computes coverage gaps vs requirements)
   - dx-reviewer             (CLAUDE.md adherence, naming, build ergonomics)
   - product-reviewer        (planning doc tone, UX copy, accessibility)
   - drift-auditor           (iterates requirements.yaml, classifies each)
   Each writes a structured Markdown file to .review/findings/<role>.md

2. Verification stage (mirrors /ultrareview)
   - Spawn a single verifier subagent per file in .review/findings/
   - For each finding: confirm reproducibility, attach file:line evidence,
     downgrade or drop unverifiable claims

3. Dedup + synthesise
   - Main thread (or one synthesiser subagent) merges findings, dedupes
     across roles, ranks by severity x confidence, produces a single
     COUNCIL_REVIEW.md with:
       - Executive verdict (Ready / Needs Attention / Needs Work)
       - Per-severity grouped findings
       - Plan-vs-implementation traceability matrix
       - Drift-in / Drift-out tables
       - Recommendations ordered by impact x effort
```

**Key tactical choices and why**
- **Parallel, not sequential, for the merits review.** Review axes are independent — security has no dependency on performance findings. Sequential is for refactor pipelines (architect → implementer → tester) and for the verification step.
- **Read‑only tools (`Read, Grep, Glob, Bash`)** — Anthropic's official subagent docs recommend this exactly for reviewers/auditors. Add specific MCP servers (Serena, Semgrep) per role.
- **Don't fork.** A forked subagent inherits your assumptions and rubber‑stamps. Boris Cherny and several Medium write‑ups (mejba.me) explicitly call this out.
- **Use `model: inherit` or split** — main thread on Opus for synthesis (longer reasoning, better dedup), subagents on Sonnet (cheaper, parallel). `CLAUDE_CODE_SUBAGENT_MODEL` env var controls this. ClaudeFast's "Sonnet for plan, Sonnet for code" guidance is the consensus.
- **Each subagent's prompt is a self‑contained briefing.** No "see above" — Anthropic explicitly warns subagents only see what you pass. State role, scope, output format, severity scheme, evidence rules.
- **Evidence‑based output is non‑negotiable.** Borrow the wmedia.es Evaluator‑Optimizer rule: every claim cites file:line, command output, or URL. "I think" → UNVERIFIED. This is what separates good multi‑agent review from elaborate hallucination.
- **Token budget for big repos**: the parallel‑exploration pattern (TeachMeIDEA write‑up) — three Explore subagents fan out for `apps/`, `packages/`, `tests/`, return ~500 tokens each, the main thread now has a 1.5k‑token mental map and dispatches actual reviewers against scoped paths.
- **Persist the artefact.** Write `COUNCIL_REVIEW.md` to disk every run, version it, diff against last run. ksimback's tech‑debt‑skill repeat‑run mode (RESOLVED / NEW / STALE tags) is the pattern.
- **Hooks for enforcement.** Joshua McDonald's spec‑gate `PreToolUse` hook (Apr 2026 Medium) — block writes that don't reference an approved spec. PostToolUse hooks for lint/format. SessionStart hooks to load planning docs.

### 6. Recent developments (2025–2026)

- **Claude Code Code Review (Team/Enterprise, beta)** — managed multi‑agent PR review, billed $15–25/PR, 20‑min average. (Anthropic blog: `claude.com/blog/code-review`).
- **`/ultrareview`** (v2.1.86, Apr 16 2026) and `claude ultrareview` CI subcommand (v2.1.120) — the local council‑of‑experts pattern, productised.
- **Skills as an open standard** (`agentskills.io`) — Skills now portable across Claude, Codex, Gemini CLI, Cursor, Aider, Windsurf, OpenCode, Augment, Antigravity. `npx skills add <author>/<skill>` is the canonical install pattern across most major repos.
- **Forked subagents** (v2.1.117, opt‑in via `CLAUDE_CODE_FORK_SUBAGENT=1`) — useful for design variation tasks, **avoid for code review**.
- **Native LSP support in Claude Code** (HN announcement, late 2025) — reduces but doesn't eliminate the case for Serena. Serena still wins on agent‑first tool design (high‑level abstractions vs raw LSP primitives).
- **`obra/superpowers` accepted into Anthropic's official marketplace** (Jan 15 2026) — material signal of community quality.
- **GSD framework hits 48k★** — confirms spec‑driven dev with parallel subagent waves is the dominant pattern for serious work.
- **Anthropic Cookbook** has matured with notebook tests, registry.yaml, and `make test-notebooks`. Recipes for Evaluator‑Optimizer and Orchestrator‑Workers are the primitives this whole pattern is built on.
- **Source map leak (Mar 31 2026)** revealed many unreleased Claude Code features — community has been reverse‑engineering since. Mostly relevant as a tea‑leaf reading exercise; nothing actionable yet.

---

## Recommendations

**Stage 1 — Install and pilot (this week)**
1. `claude mcp add serena -- uvx --from <serena-path> serena-mcp-server` and activate the project. Single biggest leverage move.
2. `/plugin install superpowers@superpowers-marketplace` — gives you the spec/plan/review discipline as scaffolding.
3. Install Semgrep plugin (full bundle: MCP + Hook + Skill).
4. Drop HAMY's 9‑agent `/code-review` slash command into `.claude/commands/code-review.md` and try it on a non‑critical PR. Diff its output against your manual review.
5. Run `npx repomix@latest --compress` to baseline your repo's token footprint and see if it fits a 1M‑context Opus call as a fallback.

**Stage 2 — Build the council (next 2 weeks)**
6. Author six project‑level subagents in `.claude/agents/`:
   `security-reviewer`, `architecture-reviewer`, `performance-reviewer`, `testing-reviewer`, `dx-reviewer`, `product-reviewer`. Each `tools: Read, Grep, Glob, Bash` plus `mcp__serena__*` for the architecture and performance ones, `mcp__semgrep__*` for security. Cap each prompt at ~150 lines, define explicit output schema.
7. Author a seventh subagent: `drift-auditor`. Its system prompt should:
   - Read `.review/requirements.yaml` (extracted from your planning structure).
   - For each requirement, attempt to locate implementing code via Serena `find_symbol` and Grep.
   - Apply the wmedia.es evidence rule: every status needs a file:line citation or it's UNVERIFIED.
   - Output a normalised JSON traceability matrix.
8. Build a `/council-review` slash command that orchestrates: pre‑flight static analysis → parallel dispatch of all seven subagents → verification pass → synthesis → write `COUNCIL_REVIEW.md`.
9. Add a **reverse drift** pass: list all public APIs / exported symbols / top‑level modules and ask "is this in the plan?". This catches the silent‑addition class of drift that requirement‑first auditing misses.

**Stage 3 — Hardening (within a month)**
10. Persist `COUNCIL_REVIEW.md` per run, diff successive reports, surface NEW / RESOLVED / STALE per ksimback's tech‑debt‑skill pattern.
11. Add a `PreToolUse` hook that blocks writes outside the planning doc's stated scope (Joshua McDonald's spec gate). Tighten or loosen based on false‑positive rate.
12. Add a `Stop` hook (prompt‑type, Haiku) that runs a one‑question check: "did this turn change a file outside the active spec's scope?" — cheap drift detection between formal reviews.
13. Calibrate model assignment: orchestrator/synthesiser on Opus, reviewers on Sonnet, verifiers on Sonnet, mass‑extraction tasks (requirements list, symbol dump) on Haiku. Track cost per run with `/usage`.
14. Once stable, consider the multi‑model "real council" upgrade — route the security and architecture reviewers to a non‑Anthropic model (GPT‑5.x or Gemini 3 Pro via the Codex/Gemini CLIs invoked from a subagent) for genuinely diverse perspectives. The MARS paper's caveat applies: only do this when the diversity is buying real signal, not just spend.

**Benchmarks that should change the recommendation**
- If `/ultrareview` becomes generally available with quotas suitable for repo audits (not just PRs), use it as the verification stage instead of building your own — it has a verified <1% false positive rate.
- If Anthropic ships a managed code‑review product that ingests planning docs (none exists today), reduce the bespoke drift‑auditor to a thin adapter.
- If your repo grows past ~50k LOC, switch the orchestrator from "read everything once" to "Aider repo‑map‑style ranked overview + targeted Serena queries" — this is the threshold where Claude's accuracy degrades on full‑repo dumps.
- If you observe >30% token spend on inter‑subagent rediscovery, consolidate static analysis into deterministic pre‑flight files and pass them by reference. The MARS paper's headline finding (~50% token reduction by avoiding reviewer chatter) is real.

---

## Caveats

- **The "council" pattern's empirical track record is mixed.** ICLR/NeurIPS 2025 work (Multi‑LLM Debate, Debate or Vote) shows multi‑agent debate often fails to beat strong single‑agent test‑time compute, and majority voting accounts for most claimed gains. Your council should therefore be **parallel + verified + deduped**, not debate‑style. The Anthropic Code Review and `/ultrareview` architectures already follow this — copy them, don't get clever.
- **Spec drift detection is genuinely unsolved.** Augment Code's analysis (`augmentcode.com/guides/claude-code-spec-driven-development`) catalogues documented cases of Claude Code skipping its own CLAUDE.md instructions even while its reasoning trace acknowledges the rule. Treat any drift report as "starts a conversation", not "ground truth". Always require evidence and surface UNVERIFIED items separately.
- **Subagent context inheritance is in flux.** Forked subagents (CLAUDE_CODE_FORK_SUBAGENT) and skill inheritance behaviour have changed across versions. The HAMY 9‑agent template, which I'm recommending as the starter, was written against a specific Claude Code version; verify subagent invocation works as expected in your version before scaling.
- **Hook configuration syntax is the most version‑sensitive surface.** Joshua McDonald's spec‑gate hook config is from Apr 2026; check the current Claude Code hooks reference before pasting. The conceptual model is durable; the JSON keys are not.
- **Several "best skill" recommendations are written by their own authors.** Wmedia.es, mejba.me, claudefa.st, and ofox.ai are blog/product sites that promote their own skills and tooling. The patterns they describe are sound (and corroborated elsewhere) but treat traffic‑bait benchmarks ("80% of PRs need no human comments", "1,445% surge in inquiries") as marketing, not evidence.
- **`/ultrareview` cost behaviour is volatile.** Several Reddit reports flag spend‑control gaps; cost per run varies $5–20+ and a stopped run still consumes a free run. Pro/Max free runs expire May 5 2026 and don't refresh.
- **Serena's install instructions deliberately steer away from MCP marketplaces** because outdated install commands proliferated. Always use the project's first‑party install path.
- **Repo packers (Repomix, gitingest) can leak secrets** if you don't run their built‑in scanners. Always enable Secretlint and review the diff before pasting into any LLM, especially for cloud‑hosted services like `/ultrareview` that bundle and upload your working tree.
- **Multi‑model councils introduce data‑residency and licensing complications.** If your code is sensitive, verify each model provider's data retention policy before routing reviewers across vendors. Anthropic's ZDR programme excludes `/ultrareview` and Code Review entirely.
- **None of this replaces a human reviewer for product judgement.** The council catches the things a careful human catches; it does not know your roadmap, your customers, or why you made a specific tradeoff. The official `/ultrareview` docs explicitly disclaim this and so should your output.