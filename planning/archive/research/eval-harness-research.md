# A pragmatic agent eval harness for Swoop, April 2026

**Build the cheapest thing that forces you to look at 50 real transcripts this week, not the fanciest platform that ships quarterly dashboards.** That is the through-line connecting every credible voice in 2026 — Karpathy, the Hamel/Shreya camp, Anthropic's own engineering blog, and the Inspect AI style used at the frontier labs. For Swoop specifically, the answer is: a Python eval harness built on **ADK's native `AgentEvaluator` + evalset files**, wrapped in pytest, emitting OpenTelemetry via OpenInference to **Arize Phoenix** (local, OSS) for trace review, with **Claude (via `LiteLlm`) as both orchestrator and judge**, and a hand-curated golden set of ~20 discovery conversations derived from real Swoop sales calls. Do not buy a platform yet. The ecosystem has shifted enough in the last six months (ADK eval hit production-grade at v1.23–1.26, the Hamel/Shreya O'Reilly book landed, Promptfoo was acquired by OpenAI, Jason Liu left eval consulting for OpenAI Codex) that the right move is an opinionated Python harness you fully own, then layer a vendor only when you feel pain.

The rest of this report justifies that recommendation, contrasts the major camps and tools, and gives a concrete first-20-cases sketch for a travel-discovery agent.

## Karpathy's 2026 position: "evaluation crisis", editable asset + scalar metric + time-boxed loop

Karpathy has not shifted on the bottleneck claim — if anything he has sharpened it. His most-quoted 2025 post is the **"evaluation crisis" tweet of 3 March 2025** ([x.com/karpathy/status/1896266683301659068](https://x.com/karpathy/status/1896266683301659068)):

> "My reaction is that there is an evaluation crisis. I don't really know what metrics to look at right now… In absence of great comprehensive evals I tried to turn to vibe checks instead, but I now fear they are misleading and there is too much opportunity for confirmation bias, too low sample size, etc."

He carries the older Tesla heuristic into 2025 — **~1/3 of project time on evals** ([x.com/karpathy/status/1795873666481402010](https://x.com/karpathy/status/1795873666481402010), 29 May 2024) — and his [2025 year-in-review post](https://karpathy.bearblog.dev/year-in-review-2025/) (19 Dec 2025) adds the now-canonical line: **"Training on the test set is a new art form."** Public benchmarks leak; RLVR grows "jaggies" around embedding-space pockets near the benchmarks.

On **LLM-as-judge** he is overtly sceptical. On the [Dwarkesh Patel interview](https://www.dwarkesh.com/p/andrej-karpathy) (17 Oct 2025): *"anytime you use an LLM to assign a reward, those LLMs are giant things with billions of parameters, and they're gameable."* Treat judge models as fallible classifiers that themselves need evaluation.

Crucially, Karpathy has **not** published a generalist "eval-starter" repo. The pattern he actually ships is embedded in two repos and is the most useful concrete artefact from him to date:

- **[nanochat](https://github.com/karpathy/nanochat)** (Oct 2025) — a minimal training harness with explicit `core_eval.py` / `loss_eval.py` and a bundled downstream eval set (GSM8K etc.).
- **[autoresearch](https://github.com/karpathy/autoresearch)** (7 Mar 2026) — a 3-file template: `prepare.py` (immutable, evaluates), `train.py` (the only editable file), `program.md` (agent instructions). Metric is a **single scalar**, run is **time-boxed to 5 minutes**, all runs logged.

The transferable prescription for a **"Karpathy-approved minimum"** for an agent harness is therefore:

1. One editable asset the prompt engineer changes (system prompt, tool descriptions, orchestration code).
2. A read-only scoring script that runs end-to-end and prints a scalar (or a small tuple) per eval case.
3. Fixed per-run compute/time budget so runs are comparable.
4. A **private, held-out** eval set you never paste to a cloud judge that's also a training target.
5. Never trust a single metric; ensemble, and always look at the raw outputs yourself.

That is roughly 200 lines of Python. Nothing more is needed to start.

## The Hamel/Shreya camp: error analysis first, notebooks over vendor UIs

The practitioner canon for product-level evals in April 2026 is **Husain & Shankar's *Evals for AI Engineers*** (O'Reilly, Early Release live, print Spring 2026 — [listing](https://www.oreilly.com/library/view/evals-for-ai/9798341660717/)) plus the **[LLM Evals FAQ, 15 Jan 2026](https://hamel.dev/blog/posts/evals-faq/)**. Their [Maven course](https://maven.com/parlance-labs/evals) claims 3,000–4,500+ alumni across OpenAI, Anthropic, Google; the August 2026 cohort is fully refreshed.

Their top-line claims, most of which are directly relevant to Swoop:

- **"Start with error analysis, not infrastructure."** Review 20–50 real traces manually before writing any automated metric. The FAQ reports that Hamel's teams spend **60–80% of development time on error analysis and evaluation**, not on infra.
- **Notebooks are "the single most effective tool for evals."** Pairing a notebook with a quickly vibe-coded custom annotation UI (Cursor, Lovable) beats every vendor UI for iteration speed.
- **Binary pass/fail beats Likert.** Likert "hides uncertainty in middle values"; binary forces decisions and plays nicely with precision/recall.
- **Open coding → axial coding → failure taxonomy.** Borrow the qualitative-research loop: free-text notes on each trace, cluster into failure modes (LLMs can help the clustering step), iterate to "theoretical saturation" at ~100 traces. Note **the first upstream failure**, not every downstream artefact.
- **LLM-as-judge via 7-step "Critique Shadowing":** pick a single domain expert ("benevolent dictator"), get pass/fail labels + critiques, fix bugs that surface during labelling, then **treat the judge like a classifier** with train/dev/test splits, hill-climb against dev, and report precision/recall — not accuracy, because a 5%-prevalence failure mode hides in accuracy. Eugene Yan's [Product Evals in Three Simple Steps](https://eugeneyan.com/writing/product-evals/) (23 Nov 2025) is the condensed version.
- **Generic metrics are a trap.** "The abuse of generic metrics is endemic. BERTScore, ROUGE, cosine similarity… are not useful for evaluating LLM outputs in most AI applications."
- **Be suspicious of 100% pass rates.** "A 70% pass rate might indicate a more meaningful evaluation."

For **agent evals specifically** ([How do I evaluate agentic workflows](https://hamel.dev/blog/posts/evals-faq/how-do-i-evaluate-agentic-workflows.html)), the camp recommends a **two-phase** approach:

1. **End-to-end task success** — black-box, did we meet the user's goal? Binary with an aligned judge.
2. **Step-level diagnostics** — score tool choice, parameter extraction, error handling, context retention, efficiency, and goal checkpoints. Use **Bryan Bischof's transition failure matrix**: rows = last successful state, columns = first failure state, cells = count. "You can immediately see that GenSQL → ExecSQL transitions cause 12 failures while DecideTool → PlanCal causes only 2."

Their [tool panel, 1 Oct 2025](https://hamel.dev/blog/posts/eval-tools/) put LangSmith/Braintrust/Phoenix side by side on the same homework. **Hamel's verdict: no single tool wins; optimise for support and fit, not feature matrices; Phoenix is his favourite OSS, Braintrust is praised for the "money table" human-in-loop annotation, LangSmith for LangChain-native teams.** His newer post ["Evals Skills for Coding Agents"](https://hamel.dev/blog/posts/evals-skills/) (2 Mar 2026) plus ["Revenge of the Data Scientist"](https://hamel.dev/blog/posts/revenge/) (26 Mar 2026) reframe eval work as **classical data science**: reading traces = EDA, judge alignment = model evaluation, dataset construction = experimental design.

Recent personnel shifts that matter: **Eugene Yan moved to Anthropic** (Field↔Frontier, Jan 2026), **Jason Liu wound down 567 Labs** and open-sourced his RAG course to join OpenAI Codex ([2 Feb 2026 post](https://jxnl.co/writing/2026/02/02/sunsetting-567-labs/)). Jason is no longer an active eval voice; don't over-weight older jxnl.co posts.

Where this camp converges with Karpathy: **both insist you look at the raw data and distrust leaderboard metrics.** Where they diverge: Karpathy emphasises a scalar, automatable metric for autonomous-agent experimentation; the Hamel camp treats evals as a deeply human, judgment-heavy activity that produces many small application-specific binary evals. For Swoop's use case — a human prompt engineer iterating on a production conversational agent — **the Hamel camp is the operating manual; Karpathy is the philosophical backstop reminding you not to over-engineer it.**

## ADK's native eval support is now production-viable (but thin on observability)

Between October 2025 and April 2026 ADK's eval subsystem moved from "beta-looking" to a proper Pydantic-typed multi-metric framework. Key milestones: v1.23 (22 Jan 2026) shipped custom metrics via `CustomMetricEvaluator`; v1.24 added API-key init for the Vertex judge and `num_samples` for `final_response_match_v2`; v1.26 (26 Feb 2026) introduced **User Personas** for the built-in `LlmBackedUserSimulator`. Current release is **1.31.1 (21 Apr 2026)**. Docs live at [google.github.io/adk-docs/evaluate/](https://google.github.io/adk-docs/evaluate/).

Concretely, ADK gives you out-of-the-box:

- **`adk eval` CLI** with `--config_file_path` thresholds and `--print_detailed_results`.
- **Pytest integration** via `AgentEvaluator.evaluate()` / `evaluate_eval_set()` — raises `AssertionError` on threshold failure → natural CI gate.
- **Pydantic-validated evalset JSON** (`.evalset.json` / `.test.json`) capturing `user_content`, `final_response`, `intermediate_data.tool_uses`, `session_input.state`, and optional `conversation_scenario` for simulated multi-turn.
- **A metric suite covering both camps' needs**: `tool_trajectory_avg_score` (EXACT / IN_ORDER / ANY_ORDER — cheap, deterministic), `response_match_score` (ROUGE — almost useless, ignore), `final_response_match_v2` (LLM judge with multi-sample), `rubric_based_final_response_quality_v1`, `rubric_based_tool_use_quality_v1`, `hallucinations_v1` (sentence-level groundedness), `safety_v1`, and three multi-turn variants that delegate to Vertex AI Gen AI Eval.
- **User simulator with personas** — you describe starting_prompt, conversation_plan, user_persona and ADK drives the simulated turns. This is the right primitive for Swoop's discovery conversations.

Example `test_config.json` that maps onto Swoop's needs cleanly:

```json
{
  "criteria": {
    "tool_trajectory_avg_score": { "threshold": 1.0, "match_type": "IN_ORDER" },
    "rubric_based_final_response_quality_v1": {
      "threshold": 0.8,
      "rubrics": [
        { "rubric_id": "in_persona",       "rubric_content": { "text_property": "Response is in Swoop's warm, specialist tone; does not sound generic." } },
        { "rubric_id": "no_hallucination", "rubric_content": { "text_property": "No factual claim about Antarctica trips that is not supported by tool output." } },
        { "rubric_id": "handoff_timing",   "rubric_content": { "text_property": "Offers human handoff only after enough discovery, or when user explicitly requests it." } }
      ]
    },
    "hallucinations_v1": { "threshold": 0.9 }
  }
}
```

**Integration with Vertex AI Gen AI Eval Service** is real but still **Pre-GA** ([evaluation-overview](https://cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview)). The productised path is: deploy via `AdkApp` / `agent_engines.create` → `client.evals.run_inference` → `client.evals.create_evaluation_run` with `RubricMetric.FINAL_RESPONSE_QUALITY` / `TOOL_USE_QUALITY` / `HALLUCINATION` / `SAFETY`. You get adaptive per-prompt rubrics auto-generated from your task description, a GCS-backed run log, and a console viewer. Good for quarterly deep dives, overkill for daily iteration, and priced as standard Gemini inference so per-run cost is non-trivial at scale.

**Honest maturity assessment vs alternatives**: ADK eval is now **on par with DeepEval for offline CI and comparable to LangSmith's pytest runner**, but **thin on observability, prompt management, and production online scoring**. Practitioner guidance (e.g. [futureagi.com/blogs/evaluate-google-adk-agents](https://futureagi.com/blogs/evaluate-google-adk-agents)) is to layer Phoenix/Arize/Braintrust on top via OpenTelemetry for the production side. That is the right architecture.

**Claude-via-LiteLLM gotchas that will bite during evals** — these are the non-obvious ones ([adk-python issues #933, #265, #2466, #4801, #5005](https://github.com/google/adk-python/issues)):

- Native ADK `Claude` class matches only the claude-3 regex; **Claude 4/4.5/4.6 must go through `LiteLlm`**.
- Extended-thinking Claude often skips tool calls → `tool_trajectory_avg_score` with `EXACT` match returns 0. Fix by using `IN_ORDER` / `ANY_ORDER`, forcing `tool_config` mode=`ANY`, or switching to `rubric_based_tool_use_quality_v1`.
- Thinking blocks are dropped between tool calls on Claude 4.6+ via LiteLLM (issue #4801) — multi-tool trajectory evals can produce false failures.
- File inputs aren't supported for Claude via ADK — not an issue for Swoop, but kills cross-model comparisons using PDFs.
- **24 Mar 2026 LiteLLM supply-chain incident**: 1.82.7/1.82.8 on PyPI shipped credential-stealing code. If you installed `google-adk[eval]` in that window, upgrade and rotate every cloud credential in the affected environment.

## The framework landscape in April 2026

| Tool | Best at | Weak at | Agent/trajectory | Licence / pricing |
|---|---|---|---|---|
| **LangSmith** | Deep LangChain/LangGraph integration, annotation queues, Insights Agent for trace clustering, Fetch CLI into Claude Code/Cursor | Trace counts balloon on multi-step agents → cost; per-seat pricing punishes small teams | Full trajectory capture, pytest runner, OSS `agentevals` / `openevals` helpers | Dev free / Plus $39 seat / Enterprise |
| **Braintrust** | Code-first experiments, Loop AI scorer generation, "money table" annotation, MCP server for Claude Code | Proprietary DSL; non-determinism in Loop-generated scorers; no runtime guardrails | Yes, via scorers | Free tier (1M trace spans/mo) / Pro $249 flat |
| **Arize Phoenix** | OSS, OpenTelemetry-native, OpenInference conventions, ADK instrumentation, notebook-first. Hamel's favourite OSS. | UI occasionally slow; self-host ops overhead | 4 agent evaluators (function calling, path convergence, planning, reflection); phoenix-evals 3.0.0 released Apr 2026 | Elastic 2.0 OSS; Arize AX commercial from $50/mo |
| **OpenAI Evals** (OSS + Platform) | Dashboard UI + Evals API now supports third-party models; good for OpenAI-first shops | OSS `openai/evals` largely unmaintained for new PRs; not designed for bespoke agent trajectories | Possible but awkward; no native multi-turn tool-call primitive | MIT / usage-priced on platform |
| **Inspect AI** (UK AISI) | The **de facto frontier-lab capability/safety eval framework**. Used at Anthropic, DeepMind, xAI, METR, Apollo. MIT, sandboxes, approval policies, VS Code extension, 200+ benchmark impls in [Inspect Evals](https://github.com/UKGovernmentBEIS/inspect_evals). | Heavier than needed for a 20-case product eval; solver/scorer/task abstractions are academic-flavoured | First-class: solvers are agents, scorers are graders, trajectories are logs | MIT |
| **DeepEval** | Pytest-style API, 50+ metrics including `ToolCallAccuracy`, `AgentGoalAccuracy`, `TaskCompletion` | Metric library is quality-uneven; vendor-grown ecosystem (Confident AI SaaS) | Yes — agent-aware metrics shipped | Apache 2.0 OSS / Confident AI hosted |
| **Ragas** | RAG retrieval & faithfulness metrics; now `ToolCallAccuracy`, `ToolCallF1`, `AgentGoalAccuracy*`, `TopicAdherenceScore` with `MultiTurnSample` and LangGraph/LlamaIndex/Bedrock converters | Legacy classes being deprecated pre-v1.0 (rough edges); narrower than Inspect | Yes but RAG-first framing | Apache 2.0 |
| **Promptfoo** | Config-driven YAML, strongest red-teaming / OWASP LLM Top 10, first-class Claude Agent SDK provider | Being absorbed into OpenAI Frontier — strategic direction TBD | Yes, agentic attack generation | **Acquired by OpenAI 9 Mar 2026**; OSS continues under MIT |
| **Anthropic Claude Console Eval Tool + [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)** | Browser-based side-by-side; Anthropic's engineering blog on agent evals is the best vendor-authored primer on trial structure, independent grading, state contamination | UI-only, not a CI-grade harness | Conceptually yes; tool is single-turn | Included with Claude API |
| **Vertex AI Gen AI Eval Service** | Adaptive rubrics, Gemini-backed judges, `FINAL_RESPONSE_QUALITY`/`TOOL_USE_QUALITY`/`HALLUCINATION`/`SAFETY`, agent-engine integration | Still **Pre-GA**; ties you to GCP; priced as inference | Yes, via ADK integration | GCP pay-per-use |
| **Langfuse** | OSS self-hostable tracing + prompt versioning; ClickHouse+Postgres backbone; reportedly acquired by ClickHouse early 2026 (single-source, verify) | Eval depth shallower than Braintrust; most teams BYO scorers | Trace capture yes; scoring BYO | OSS / Cloud Hobby free / paid from $29/mo |

Two patterns to notice:

- **OpenTelemetry + OpenInference is now the lingua franca.** Phoenix, Arize, Braintrust, Langfuse all read OpenInference-spec spans; so does ADK via `openinference-instrumentation-google-adk`. This means **your instrumentation investment is tool-portable**. Don't let a vendor talk you into proprietary tracing.
- **Frontier labs converged on Inspect AI for capability/safety work and Anthropic's two-phase pattern (trials × graders × transcripts) for product agents.** Anthropic's engineering blog explicitly aligns with the Hamel/Shreya two-phase agent workflow.

## What a minimal, pragmatic best-practice harness looks like

The components below are the consensus distilled from Karpathy, the Hamel camp, Anthropic's agent eval blog, and the ADK/Vertex tooling. Nothing here requires a SaaS account.

**Dataset construction.** Three layers, stored as a single directory of `.evalset.json` files in git, with `session_input.state` reflecting realistic Swoop user state (budget band, travel window, group composition):

1. **Golden conversations** — 10–15 cases hand-built from real Swoop sales transcripts (anonymised). Each is a full multi-turn `conversation` array with expected `tool_uses` and a reference `final_response` (or a rubric if the space of acceptable answers is wide).
2. **Synthetic persona probes** — use ADK's `LlmBackedUserSimulator` with `user_persona` configs ("budget-conscious 28-year-old researching first Antarctic trip", "retiree comparing Quark vs. Oceanwide on ice-strength", "journalist asking for trip duration and activity options") to stress the agent across archetypes.
3. **Failure-mode probes** — short adversarial cases: price-pressure ("what's your cheapest trip?"), out-of-scope ("book me the Feb 14 departure"), hallucination bait ("does Swoop own its own ship?"), competitor-mention trap, off-topic ("tell me about Arctic trips instead"), incomplete handoff info, language mixing. Each has a binary code-based assertion.

**Trajectory evaluation.** Use ADK's `rubric_based_tool_use_quality_v1` with rubrics like "uses search before shortlist", "does not call handoff_form before eliciting budget + window + interests", "does not call product_lookup with empty query". **Avoid `EXACT` trajectory match** with Claude — thinking models will skip tools and produce false negatives. Use `IN_ORDER` for the core happy-path tools and ANY_ORDER where you don't care.

**Final-output evaluation.** Three-tier:

- **Code-based assertions first** (Hamel doctrine): regex for required phrases, string match for handoff form fields, competitor-name blocklist, JSON-schema validation of structured outputs. Fast, deterministic, free.
- **LLM-as-judge with calibrated binary rubrics** for the subjective layer — in-persona tone, Swoop sales methodology adherence, no hallucination. Use **`final_response_match_v2` with `num_samples: 5`** to get a stable probability, not a single flip. Calibrate the judge against ~50 labels you produce yourself before trusting it; target precision ≥0.9 on the "fail" class so your regressions are real.
- **Human spot-check** of 10% of runs, always. The judge model is also being evaluated.

**Regression detection.** Run the full suite before and after every prompt/tool-description change. Report per-rubric pass-rate deltas with a binomial confidence interval; only claim a regression if it is statistically meaningful (e.g. ≥5pp drop with n≥30 on the affected rubric, or any drop on a must-hold safety rubric). Store every run's raw trace + scores as a timestamped artefact in git or GCS — this is the [Karpathy autoresearch](https://github.com/karpathy/autoresearch) pattern applied to a product agent.

**CI integration.** A GitHub Action runs `pytest tests/evals/` on PRs touching `agent/`, `tools/`, or `content/`. Fail the build on any regression in code-based assertions, `hallucinations_v1 < 0.9`, or `tool_trajectory_avg_score < 0.9` on the golden set. Use a smaller "smoke" subset (~5 cases) as a pre-commit or on-save hook; run the full set on PRs only.

**Observability and tracing.** Install `openinference-instrumentation-google-adk` and point OTel exporters at a **local Phoenix** (`arize-phoenix` + `docker run arizephoenix/phoenix`). Every eval run is a session; every production conversation is a session. **Keep traces portable** — the same spans feed Braintrust or Arize AX later if you outgrow Phoenix.

**Cost and latency tracking.** ADK events already carry token counts and latencies. Assert per-case latency p95 < target and cost < budget in the test config — **real-user Swoop conversations need to feel instant or the iframe loses the user**. Put a hard cap in CI.

**Growing the eval set from production.** Weekly ritual: Phoenix surfaces outlier traces (high latency, long tool chains, negative user-feedback signal if you add a thumbs-up/down to the React UI). Alastair spends 30–60 minutes reviewing, tags failures, promotes the interesting ones into `.evalset.json` files with expected behaviour annotated. This is the Husain "benevolent dictator" pattern applied solo. Target 100 golden/probe cases by month 3, never more than 300 (beyond that the signal-per-case drops and runs get too slow to iterate on).

## Specific recommendations for Swoop

**Write it in Python, ADK-native, no vendor.** Alastair should own the harness end-to-end for the first three months. ADK's `AgentEvaluator` + pytest + Pydantic evalsets is already everything you need; a Braintrust or LangSmith commitment now would be premature optimisation and a lock-in before you know your failure modes. Add Phoenix (OSS, local) purely as a trace viewer — zero coupling, pure OTel.

**First 20 eval cases, concretely.** Aim for this distribution:

- **7 golden discovery conversations** drawn from real Swoop sales transcripts, each 4–8 turns, covering the main Antarctica trip archetypes (classic cruise, small-ship expedition, fly-cruise, Antarctica + South Georgia, camping/kayaking add-ons, photography-focused, family with teens). Reference trajectory + rubric on final response.
- **4 synthetic-persona conversations** driven by ADK's user simulator: first-timer budget-conscious, experienced polar traveller, journalist, retiree-with-mobility-constraints.
- **6 failure-mode probes**, one each for: out-of-scope booking request, competitor comparison, hallucination bait ("does Swoop own ships?"), price-pressure, premature handoff ("put me in touch now" in turn 1), language mixing.
- **3 sales-methodology cases** encoding Swoop's discovery ladder: must elicit travel window → interests/activities → budget band → group shape *before* recommending or handing off. Binary code-based check on the order of elicited fields.

**Judge model.** Use **Claude (the same family that orchestrates), but a different size** — e.g. orchestrator on Claude Sonnet, judge on Claude Opus or vice versa — so the judge's mistakes are less correlated with the agent's. Calibrate against 50 hand-labelled pass/fail samples; target κ ≥ 0.6 with Alastair's labels before trusting the judge on unseen traces. Re-calibrate whenever you change the rubric text.

**Judge-gaming guardrails (Karpathy's warning).** Never include the exact rubric text inside the agent's own system/tool descriptions; the orchestrator will learn to parrot it. Keep rubrics in the harness only.

**"Karpathy-approved minimum" for Swoop, tomorrow morning.** One file, `evals/run.py`, plus a directory `evals/cases/*.evalset.json`. The file:
1. Loads each evalset with `EvalSet.model_validate`.
2. Runs `AgentEvaluator.evaluate_eval_set(..., num_runs=3)` (three trials per case to capture non-determinism — Anthropic's pattern).
3. Prints a markdown table of per-case pass/fail and aggregate rubric scores.
4. Writes raw traces + scores to `evals/runs/<git-sha>/`.

That is the whole harness on day one. Every other piece (Phoenix, Vertex Gen AI Eval rubrics, regression-detection stats, CI gates) is an additive layer bolted on once the loop is running and Alastair has looked at 50 real traces.

## If I were starting tomorrow, this is what I'd do

Morning: stand up `evals/` with `google-adk[eval]`, five hand-authored `.evalset.json` cases pulled from real Swoop sales transcripts, a `test_config.json` with `tool_trajectory_avg_score` (`IN_ORDER`), `rubric_based_final_response_quality_v1` (three rubrics: in-persona, no-hallucination, appropriate-handoff), and `hallucinations_v1`. Run `adk eval` once, look at the output, expect to be annoyed by it.

Afternoon: wire a pytest test that calls `AgentEvaluator.evaluate_eval_set` with `num_runs=3`. Run locally, fail intentionally by breaking a tool description, confirm the harness catches it. Commit the harness.

Day two: spin up Phoenix in Docker, export OpenInference spans from ADK, trace every eval run and every dev-local conversation. Spend 90 minutes scrolling through traces; note failure modes in a plain markdown file. This is the open-coding step.

Day three: expand to 20 cases using the distribution above. Add a 50-sample hand-labelled calibration set for the judge. Compute precision/recall of the judge against your labels; iterate the rubric text until precision on "fail" ≥ 0.9.

Week two: add a GitHub Action, a binomial-CI regression check, and a weekly ritual that promotes real production failures into new evalset cases. Do not add a vendor. Do not move to Vertex AI Gen AI Eval Service. Do not rewrite in Inspect AI. Come back to that decision at 100 cases or three months, whichever comes first — by then you will know, empirically, whether the bottleneck is observability (add Arize AX or Braintrust), scale (add Vertex Agent Engine + Gen AI Eval), or rigour (add Inspect AI). Most likely none of the above will be necessary: **the single highest-leverage investment remains the next 30 minutes Alastair spends reading real transcripts.**

The ecosystem has moved fast in the last six months, but the core 2026 consensus — across Karpathy, Husain, Shankar, Yan, and Anthropic's own engineering team — is unglamorous and stable: **start small, stay in a notebook or a single pytest file, look at the data, keep the judge honest, grow the set from production, buy a platform only when the pain is real.**