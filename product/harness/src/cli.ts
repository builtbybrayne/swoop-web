/**
 * Harness CLI entrypoint (H.t1).
 *
 * Usage:
 *   npm --workspace @swoop/harness run eval
 *   npm --workspace @swoop/harness run eval -- --filter greeting
 *   npm --workspace @swoop/harness run eval -- --report-dir my-run
 *   npm --workspace @swoop/harness run eval -- --max-scenarios 5
 *
 * Contract:
 *   - Assumes an orchestrator is already listening at `ORCHESTRATOR_URL`
 *     (default `http://localhost:8080`). The harness does NOT spawn the
 *     orchestrator itself — CI does that in a separate step.
 *   - Always exits 0 during Puma pre-launch (Tier 3 H.13 non-gating). Authors
 *     and reviewers eyeball the markdown report. A later `--fail-on-error`
 *     flag will flip this once we're ready to gate.
 *   - Writes both `results.md` and `results.json` under
 *     `runs/<ISO-timestamp>/` (or `runs/<--report-dir>/` when supplied).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import { messageOf } from '@swoop/common';

import { OrchestratorClient } from './orchestrator-client.js';
import { StubJudge, type Judge } from './judge.js';
import {
  SonnetJudge,
  type AnthropicLike as SonnetAnthropicLike,
} from './sonnet-judge.js';
import { NullEventCapture } from './event-capture.js';
import { FileEventSink } from './events.js';
import { loadScenarios, type LoadedScenario } from './scenario.js';
import {
  runScenario,
  type AgentRuntimeFactory,
  type ScenarioResult,
} from './runner.js';
import { UserAgent, type AnthropicLike as UserAgentAnthropicLike } from './user-agent.js';
import { shouldStop, type AnthropicLike as StopJudgeAnthropicLike } from './stop-judge.js';
import { formatJson, formatMarkdown } from './report.js';

export type JudgeKind = 'sonnet' | 'stub';

interface CliArgs {
  readonly filter: string | null;
  readonly reportDir: string | null;
  readonly maxScenarios: number | null;
  readonly baseUrl: string | null;
  readonly judge: JudgeKind;
  /** True when the operator explicitly passed --judge. */
  readonly judgeExplicit: boolean;
  /**
   * Per-turn timeout in ms for OrchestratorClient. `null` → use the
   * library default (currently 180_000). Configurable via
   * `--turn-timeout-ms <n>` for ops who hit long agent-as-user turns.
   */
  readonly turnTimeoutMs: number | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let filter: string | null = null;
  let reportDir: string | null = null;
  let maxScenarios: number | null = null;
  let baseUrl: string | null = null;
  let judge: JudgeKind = 'sonnet';
  let judgeExplicit = false;
  let turnTimeoutMs: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--filter':
        filter = argv[++i] ?? null;
        break;
      case '--report-dir':
        reportDir = argv[++i] ?? null;
        break;
      case '--max-scenarios': {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n <= 0) {
          console.warn('[harness] --max-scenarios expects a positive number');
        } else {
          maxScenarios = n;
        }
        break;
      }
      case '--base-url':
        baseUrl = argv[++i] ?? null;
        break;
      case '--judge': {
        const v = argv[++i] ?? null;
        if (v === 'sonnet' || v === 'stub') {
          judge = v;
          judgeExplicit = true;
        } else {
          console.warn(
            `[harness] --judge expects "sonnet" or "stub" (got "${v}"); defaulting to "sonnet"`,
          );
        }
        break;
      }
      case '--turn-timeout-ms': {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n <= 0) {
          console.warn('[harness] --turn-timeout-ms expects a positive number');
        } else {
          turnTimeoutMs = n;
        }
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`[harness] unknown flag: ${arg}`);
        }
        break;
    }
  }
  return {
    filter,
    reportDir,
    maxScenarios,
    baseUrl,
    judge,
    judgeExplicit,
    turnTimeoutMs,
  };
}

function printHelp(): void {
  const help = [
    'Swoop harness CLI',
    '',
    'Usage:',
    '  npm --workspace @swoop/harness run eval [-- <flags>]',
    '',
    'Flags:',
    '  --filter <substring>      Only run scenarios whose name includes <substring>.',
    '  --report-dir <name>       Write the run under runs/<name>/ instead of runs/<ISO>/.',
    '  --max-scenarios <n>       Stop after running n scenarios (CI cost control).',
    '  --base-url <url>          Override the orchestrator URL (default $ORCHESTRATOR_URL or http://localhost:8080).',
    '  --judge sonnet|stub       Pick the judge for `judge_rubric` assertions + the optional top-level',
    '                            judge block. Default: sonnet (needs ANTHROPIC_API_KEY). Use stub for',
    '                            cost-free dry runs.',
    '  --turn-timeout-ms <n>     Per-turn timeout in ms for the orchestrator client (default 180000).',
    '                            Bump up if agent-as-user scenarios with long Dreamer turns hit aborts.',
    '  -h, --help                Show this message.',
    '',
    'Exit code is 0 even when scenarios fail (Tier 3 H.13 non-gating).',
  ].join('\n');
  console.log(help);
}

/**
 * Construct the judge implementation based on the CLI flag + environment.
 *
 * When `--judge sonnet` is requested (default) and an ANTHROPIC_API_KEY is
 * available, returns a `SonnetJudge`. Otherwise falls back to `StubJudge`
 * with a warning — silent fallback would mask why adversarial scenarios
 * suddenly start passing without real judging.
 */
function buildJudge(
  kind: JudgeKind,
  apiKey: string | undefined,
  judgeExplicit: boolean,
): Judge {
  if (kind === 'stub') {
    return new StubJudge();
  }
  if (!apiKey) {
    if (judgeExplicit) {
      console.warn(
        '[harness] --judge sonnet requested but ANTHROPIC_API_KEY is not set; falling back to StubJudge.',
      );
    } else {
      console.warn(
        '[harness] ANTHROPIC_API_KEY not set; falling back to StubJudge for judge_rubric assertions (pass --judge stub to suppress this warning).',
      );
    }
    return new StubJudge();
  }
  // Cast through unknown — the real SDK's MessageCreateParams accepts a
  // mutable MessageParam[]; our AnthropicLike declares readonly for test-
  // injection convenience. The runtime shape is identical; the orchestrator's
  // ClaudeLlm uses the same pattern (see product/orchestrator/src/agent/
  // claude-llm.ts).
  const client = new Anthropic({ apiKey }) as unknown as SonnetAnthropicLike;
  return new SonnetJudge({ client });
}

/**
 * Construct the agent-runtime factory the runner uses for userAgent
 * scenarios. Returns `null` when no API key is available — the runner will
 * error agent-scenarios cleanly in that case so scripted scenarios still
 * run.
 */
function buildAgentRuntimeFactory(
  apiKey: string | undefined,
): AgentRuntimeFactory | undefined {
  if (!apiKey) return undefined;
  // Same cast posture as buildJudge — the runtime shape is identical to our
  // narrow AnthropicLike interfaces; the type-level mismatch is the
  // readonly/mutable distinction on `messages`.
  const realClient = new Anthropic({ apiKey });
  const userAgentClient = realClient as unknown as UserAgentAnthropicLike;
  const stopJudgeClient = realClient as unknown as StopJudgeAnthropicLike;
  return {
    build(scenario) {
      const userAgent = new UserAgent({
        client: userAgentClient,
        persona: scenario.userAgent.persona,
        goal: scenario.userAgent.goal,
        model: scenario.userAgent.modelOverride,
      });
      return {
        userAgent,
        shouldStop: (req) =>
          shouldStop({
            client: stopJudgeClient,
            persona: scenario.userAgent.persona,
            goal: scenario.userAgent.goal,
            terminationCriteria: scenario.userAgent.terminationCriteria,
            transcript: req.transcript,
            latestAgentResponse: req.latestAgentResponse,
          }),
      };
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(here, '..');
  const scenariosDir = path.join(packageRoot, 'scenarios');

  console.log(`[harness] loading scenarios from ${scenariosDir}`);
  let scenarios: LoadedScenario[];
  try {
    scenarios = loadScenarios(scenariosDir);
  } catch (err) {
    const reason = messageOf(err);
    console.error(`[harness] failed to load scenarios: ${reason}`);
    process.exit(0);
    return;
  }

  if (args.filter) {
    const needle = args.filter.toLowerCase();
    scenarios = scenarios.filter((s) =>
      s.scenario.name.toLowerCase().includes(needle),
    );
  }
  if (args.maxScenarios !== null) {
    scenarios = scenarios.slice(0, args.maxScenarios);
  }

  console.log(`[harness] ${scenarios.length} scenario(s) to run`);
  if (scenarios.length === 0) {
    console.log('[harness] nothing to do; exiting cleanly.');
    process.exit(0);
    return;
  }

  const baseUrl =
    args.baseUrl ?? process.env.ORCHESTRATOR_URL ?? 'http://localhost:8080';
  const client = new OrchestratorClient({
    baseUrl,
    ...(args.turnTimeoutMs !== null ? { turnTimeoutMs: args.turnTimeoutMs } : {}),
  });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const judge = buildJudge(args.judge, apiKey, args.judgeExplicit);
  const agentRuntime = buildAgentRuntimeFactory(apiKey);
  // Default capture: NullEventCapture. Event-based assertions (handoff_event,
  // disclosure_event, triage_verdict) will fail with a "no event captured"
  // message until an outer wrapper plumbs a `StreamingEventCapture` against
  // the orchestrator's stdout. Decision H.14.
  const events = new NullEventCapture();

  // Per-event streaming: create the run output directory + per-scenario
  // subdir BEFORE the for-loop so each iteration can write to disk the moment
  // it has something. Per planning/03-exec-h-t8-streaming-fix.md (HITL-
  // ratified 2026-05-18).
  const runFolder = args.reportDir ?? timestampFolder();
  const outDir = path.join(packageRoot, 'runs', runFolder);
  const scenariosOutDir = path.join(outDir, 'scenarios');
  mkdirSync(scenariosOutDir, { recursive: true });
  console.log(`[harness] writing per-scenario JSONL + JSON to ${outDir}`);

  const results: ScenarioResult[] = [];
  for (const loaded of scenarios) {
    console.log(`[harness] running ${loaded.scenario.name} …`);
    const jsonlPath = path.join(scenariosOutDir, `${loaded.scenario.name}.jsonl`);
    const jsonPath = path.join(scenariosOutDir, `${loaded.scenario.name}.json`);
    const sink = new FileEventSink(jsonlPath);

    const result = await runScenario(loaded, {
      client,
      judge,
      events,
      agentRuntime,
      sink,
    });
    const badge =
      result.status === 'passed'
        ? 'PASS'
        : result.status === 'failed'
          ? 'FAIL'
          : 'ERROR';
    const suffix = result.error ? ` (${result.error})` : '';
    console.log(
      `[harness]   ${badge} ${result.name} in ${(result.durationMs / 1000).toFixed(2)}s${suffix}`,
    );
    results.push(result);

    // Stream this scenario's structured summary the instant it completes.
    writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');

    // Re-write the run-level rollup after each scenario — incremental
    // visibility for `tail`/`watch` while the run is in flight.
    const md = formatMarkdown(results);
    const json = formatJson(results);
    writeFileSync(path.join(outDir, 'results.md'), md, 'utf8');
    writeFileSync(
      path.join(outDir, 'results.json'),
      JSON.stringify(json, null, 2),
      'utf8',
    );
  }

  console.log('');
  console.log(formatMarkdown(results));
  console.log('');
  console.log(`[harness] report written to ${outDir}`);
  console.log(`[harness] per-scenario JSONL + JSON under ${scenariosOutDir}`);

  // Non-gating per H.13 — always exit 0.
  process.exit(0);
}

function timestampFolder(): string {
  // `2026-04-24T13-22-00Z` — filesystem-safe ISO-ish timestamp.
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

main().catch((err) => {
  // Truly unexpected — parse failure / programmer error. Log loudly but still
  // exit 0 so CI doesn't gate on harness-internal breakage during Puma
  // pre-launch. If this path fires, fix the harness.
  console.error('[harness] fatal error:', err);
  process.exit(0);
});
