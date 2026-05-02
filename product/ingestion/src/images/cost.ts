/**
 * Cost estimator for the C.t6 image annotation pipeline.
 *
 * Per HITL Q3 (2026-05-01): `--dry-run` is the default; `--max-budget=N`
 * is required to actually fire Vision calls. The estimator answers two
 * questions:
 *
 *   1. How many candidates does the filter match? (count from Postgres.)
 *   2. What's the projected USD spend for that many calls?
 *
 * Cost shape used in the estimate:
 *
 * Per-image cost is dominated by the image input (vision tokens) plus a
 * modest text-output cost (the JSON object is short — ~200 tokens). The
 * plan estimates ~$0.005 per image at live rates. We codify that as the
 * default per-call cost constant; an operator can override via the
 * `--per-call-usd=N` CLI flag if Anthropic's pricing has shifted.
 *
 * The Anthropic Message Batches API returns results within 24h at 50%
 * of live rates (per C.t3a ratification §4). Since C.t6 ratified Batches
 * as the chosen path (HITL Q5/§HITL ratification notes for §4 in C.t3a
 * apply transitively here), the estimator reports both numbers. The
 * `--max-budget=N` enforcement uses the Batches number — that's what
 * gets actually spent.
 *
 * No magic auto-stop on partial completion. The operator confirms before
 * each unbounded run; mid-run kill switches at batch boundaries are
 * implemented in run.ts (poll loop checks for cancellation between
 * batches).
 */

import type pg from 'pg';
import { countCandidates } from './candidates.js';

/** Per-image USD cost at live API rates. Mid-2026 rough estimate. */
export const DEFAULT_PER_CALL_USD = 0.005;

/** Anthropic Batches API discount (50% per published pricing). */
export const BATCHES_DISCOUNT = 0.5;

export interface CostEstimate {
  candidates: number;
  perCallUsdLive: number;
  perCallUsdBatches: number;
  totalUsdLive: number;
  totalUsdBatches: number;
}

/**
 * Compute the cost estimate against the live candidate count.
 *
 * `perCallUsdOverride` lets the operator pass a current-pricing override
 * via CLI without touching code; if absent we use DEFAULT_PER_CALL_USD.
 */
export async function estimateCost(
  client: pg.PoolClient,
  perCallUsdOverride?: number,
): Promise<CostEstimate> {
  const perCallUsdLive = perCallUsdOverride ?? DEFAULT_PER_CALL_USD;
  const perCallUsdBatches = perCallUsdLive * BATCHES_DISCOUNT;
  const candidates = await countCandidates(client);
  return {
    candidates,
    perCallUsdLive,
    perCallUsdBatches,
    totalUsdLive: round2(candidates * perCallUsdLive),
    totalUsdBatches: round2(candidates * perCallUsdBatches),
  };
}

/**
 * Render a human-readable summary suitable for stdout. The operator
 * scans this before passing `--max-budget=N`.
 */
export function formatCostEstimate(est: CostEstimate, opts?: { mode?: 'live' | 'batches' }): string {
  const mode = opts?.mode ?? 'batches';
  const enforced = mode === 'batches' ? est.totalUsdBatches : est.totalUsdLive;
  return [
    `[annotate] candidates: ${est.candidates.toLocaleString('en-US')} (description IS NULL OR TRIM(description) = '')`,
    `[annotate] estimated cost (live API):       $${est.totalUsdLive.toFixed(2)} USD @ $${est.perCallUsdLive.toFixed(4)}/call`,
    `[annotate] estimated cost (Batches API):    $${est.totalUsdBatches.toFixed(2)} USD @ $${est.perCallUsdBatches.toFixed(4)}/call (50% discount)`,
    `[annotate] enforced against --max-budget:   $${enforced.toFixed(2)} USD (${mode} mode)`,
  ].join('\n');
}

/**
 * Decide whether the projected spend fits the budget. Returns a tuple
 * of (ok, reason) — when not ok, the reason is the human-readable
 * explanation we surface to the operator.
 */
export function fitsBudget(
  estimate: CostEstimate,
  maxBudgetUsd: number,
  opts?: { mode?: 'live' | 'batches' },
): { ok: boolean; reason: string } {
  const mode = opts?.mode ?? 'batches';
  const projected = mode === 'batches' ? estimate.totalUsdBatches : estimate.totalUsdLive;
  if (projected <= maxBudgetUsd) {
    return {
      ok: true,
      reason: `projected $${projected.toFixed(2)} ≤ budget $${maxBudgetUsd.toFixed(2)} (${mode} mode).`,
    };
  }
  return {
    ok: false,
    reason:
      `projected $${projected.toFixed(2)} > budget $${maxBudgetUsd.toFixed(2)} (${mode} mode). ` +
      `Slice with --limit=N or raise --max-budget.`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
