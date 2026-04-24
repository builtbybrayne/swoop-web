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

import { OrchestratorClient } from './orchestrator-client.js';
import { StubJudge } from './judge.js';
import { loadScenarios, type LoadedScenario } from './scenario.js';
import { runScenario, type ScenarioResult } from './runner.js';
import { formatJson, formatMarkdown } from './report.js';

interface CliArgs {
  readonly filter: string | null;
  readonly reportDir: string | null;
  readonly maxScenarios: number | null;
  readonly baseUrl: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let filter: string | null = null;
  let reportDir: string | null = null;
  let maxScenarios: number | null = null;
  let baseUrl: string | null = null;

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
  return { filter, reportDir, maxScenarios, baseUrl };
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
    '  -h, --help                Show this message.',
    '',
    'Exit code is 0 even when scenarios fail (Tier 3 H.13 non-gating).',
  ].join('\n');
  console.log(help);
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
    const reason = err instanceof Error ? err.message : String(err);
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
  const client = new OrchestratorClient({ baseUrl });
  const judge = new StubJudge();

  const results: ScenarioResult[] = [];
  for (const loaded of scenarios) {
    console.log(`[harness] running ${loaded.scenario.name} …`);
    const result = await runScenario(loaded, { client, judge });
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
  }

  const runFolder = args.reportDir ?? timestampFolder();
  const outDir = path.join(packageRoot, 'runs', runFolder);
  mkdirSync(outDir, { recursive: true });

  const md = formatMarkdown(results);
  const json = formatJson(results);
  writeFileSync(path.join(outDir, 'results.md'), md, 'utf8');
  writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(json, null, 2),
    'utf8',
  );

  console.log('');
  console.log(md);
  console.log('');
  console.log(`[harness] report written to ${outDir}`);

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
