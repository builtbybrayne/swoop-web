/**
 * Report formatters (H.t1).
 *
 * `formatMarkdown` → human-readable PR comment body.
 * `formatJson`     → stable machine-readable shape archived per run.
 *
 * Deterministic ordering everywhere: scenarios keep their input order (files
 * sorted alphabetically by the loader); assertions keep authored order. No
 * colour codes — CI consumes the markdown verbatim.
 */

import type { ScenarioResult } from './runner.js';

export interface RunSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly durationMs: number;
}

export function summarise(results: readonly ScenarioResult[]): RunSummary {
  const durationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    errored: results.filter((r) => r.status === 'errored').length,
    durationMs,
  };
}

export function formatMarkdown(results: readonly ScenarioResult[]): string {
  const summary = summarise(results);
  const lines: string[] = [];

  // Marker used by the PR-comment update-in-place logic in the CI workflow.
  lines.push('<!-- swoop-harness-report -->');
  lines.push('# Swoop harness report');
  lines.push('');
  lines.push(
    `**${summary.passed} passed** · **${summary.failed} failed** · **${summary.errored} errored** · ${summary.total} total · ${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  lines.push('');
  lines.push(
    '_Non-gating during Puma pre-launch (Tier 2 H.4 / Tier 3 H.13). Failures here do not block merge._',
  );
  lines.push('');

  for (const r of results) {
    const emoji =
      r.status === 'passed' ? 'PASS' : r.status === 'failed' ? 'FAIL' : 'ERROR';
    lines.push(`## [${emoji}] ${r.name}`);
    lines.push('');
    lines.push(`_${r.description.trim()}_`);
    lines.push('');
    lines.push(`- file: \`${relativeish(r.file)}\``);
    lines.push(`- duration: ${(r.durationMs / 1000).toFixed(2)}s`);
    lines.push(`- turns: ${r.turns.length}`);
    if (r.error) {
      lines.push(`- error: \`${r.error}\``);
    }

    if (r.assertions.length > 0) {
      lines.push('');
      lines.push('**Assertions**');
      for (const a of r.assertions) {
        const prefix = a.passed ? 'ok' : 'fail';
        lines.push(`- [${prefix}] \`${a.kind}\` — ${a.message}`);
      }
    } else if (!r.error) {
      lines.push('- no assertions (stub scenario)');
    }

    if (r.judge) {
      lines.push('');
      lines.push('**Judge**');
      lines.push(
        `- ${r.judge.passed ? 'ok' : 'fail'} — ${r.judge.reasoning}${r.judge.model ? ` _(model: ${r.judge.model})_` : ''}`,
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

export interface JsonReport {
  readonly summary: RunSummary;
  readonly generatedAt: string;
  readonly results: readonly ScenarioResult[];
}

export function formatJson(
  results: readonly ScenarioResult[],
  now: Date = new Date(),
): JsonReport {
  return {
    summary: summarise(results),
    generatedAt: now.toISOString(),
    results,
  };
}

/**
 * Best-effort relative path for friendlier markdown. Strips everything up to
 * and including the last `product/` occurrence. Non-matching paths come
 * through unchanged.
 */
function relativeish(absPath: string): string {
  const marker = '/product/';
  const idx = absPath.lastIndexOf(marker);
  return idx === -1 ? absPath : absPath.slice(idx + 1);
}
