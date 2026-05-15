/**
 * Cost ledger + budget kill-switch.
 *
 * Per HITL ratification 2026-05-01 (Q1):
 *   - default `ENRICH_BUDGET_GBP=10` dev / £15 prod
 *   - soft warning at £5
 *   - hard cap aborts the run at the next batch boundary
 *
 * The ledger tracks per-pass + total spend so a runaway prompt is visible
 * immediately (Open Q12 in the plan).
 *
 * Pricing constants (2026-05 — verify against published pricing if anything
 * looks off):
 *
 *   Gemini-embedding-001: $0.15 / 1M input tokens (C.46 supersedes C.18)
 *   Anthropic Haiku 4.5:  $1.00 / 1M input tokens; $5.00 / 1M output tokens
 *   Batch API discount:   50% on Haiku (per HITL Q4 — batch processing for
 *                         all classifier passes)
 *
 * GBP conversion: 0.79 USD→GBP (rough, recorded in the ledger so a future
 * post-mortem can re-cost). Plan §"Cost guards" sets the per-pass budget.
 */

/** Conversion ratio at recording time. */
export const USD_TO_GBP = 0.79;

/** Gemini-embedding-001 input pricing (per 1M tokens, USD), per C.46. */
export const GEMINI_EMBEDDING_INPUT_PER_MILLION_USD = 0.15;

/** Anthropic Haiku 4.5 input pricing (per 1M tokens, USD), full-rate. */
export const HAIKU_INPUT_PER_MILLION_USD = 1.0;

/** Anthropic Haiku 4.5 output pricing (per 1M tokens, USD), full-rate. */
export const HAIKU_OUTPUT_PER_MILLION_USD = 5.0;

/** Batch API discount applied to Haiku passes — HITL Q4 ratified. */
export const BATCH_DISCOUNT = 0.5;

/** Default soft warning budget (GBP). */
export const DEFAULT_SOFT_WARNING_GBP = 5;

/** Default hard cap budget (GBP) — dev. */
export const DEFAULT_HARD_CAP_GBP_DEV = 10;

/** Default hard cap budget (GBP) — prod. */
export const DEFAULT_HARD_CAP_GBP_PROD = 15;

export type LedgerPassKey =
  | 'gemini:tag'
  | 'gemini:image'
  | 'gemini:faqitem'
  | 'gemini:blog_chunk'
  | 'gemini:inspire_passage'
  | 'gemini:customer_story'
  | 'gemini:trust_proof'
  | 'gemini:inform_chunk'
  | 'gemini:trip_card'
  | 'gemini:tour_card'
  | 'haiku:blog_post_job'
  | 'haiku:persona_summary'
  | 'haiku:image_annotation'
  | 'haiku:blog_tag_normalisation';

interface PassEntry {
  /** Tokens spent (input). For Voyage this is input only; for Haiku in/out separate. */
  inputTokens: number;
  outputTokens: number;
  /** Number of API requests (or batch items for batched calls). */
  requests: number;
  /** Estimated GBP cost so far in this pass. */
  gbp: number;
}

export interface CostSummary {
  /** Total estimated spend in GBP across all passes. */
  totalGbp: number;
  /** Per-pass breakdown. */
  perPass: Record<string, PassEntry>;
  /** Hard cap (GBP). */
  hardCapGbp: number;
  /** Soft warning threshold (GBP). */
  softWarningGbp: number;
  /** True iff the cap has been exceeded. */
  capExceeded: boolean;
  /** True iff the soft warning has fired. */
  softWarningFired: boolean;
}

export interface CostLedgerOptions {
  hardCapGbp?: number;
  softWarningGbp?: number;
  /** Inject for testing — defaults to console.warn / console.error. */
  warn?: (msg: string) => void;
  err?: (msg: string) => void;
}

/**
 * In-memory cost ledger. One per ETL run.
 *
 * Increment via `recordEmbedding` / `recordHaiku` after each batch. Call
 * `shouldAbort()` at batch boundaries to honour the kill-switch.
 */
export class CostLedger {
  private readonly perPass: Map<string, PassEntry> = new Map();
  readonly hardCapGbp: number;
  readonly softWarningGbp: number;
  private readonly warn: (msg: string) => void;
  private readonly err: (msg: string) => void;
  private softWarningFired = false;

  constructor(options: CostLedgerOptions = {}) {
    this.hardCapGbp = options.hardCapGbp ?? DEFAULT_HARD_CAP_GBP_DEV;
    this.softWarningGbp = options.softWarningGbp ?? DEFAULT_SOFT_WARNING_GBP;
    this.warn = options.warn ?? ((msg) => console.warn(msg));
    this.err = options.err ?? ((msg) => console.error(msg));
  }

  /**
   * Record an embedding-pass spend. Provider-neutral name (renamed from
   * `recordVoyage` in C.t9 / C.46) so future provider swaps don't break the
   * call sites a second time. Pass-key prefixes (`gemini:tag` etc.) remain
   * provider-specific because they're audit-trail data.
   */
  recordEmbedding(
    pass: LedgerPassKey,
    inputTokens: number,
    requests: number = 1,
  ): void {
    const usd =
      (inputTokens / 1_000_000) * GEMINI_EMBEDDING_INPUT_PER_MILLION_USD;
    this.add(pass, inputTokens, 0, requests, usd * USD_TO_GBP);
  }

  /**
   * Record a Haiku call. `batched=true` applies the 50% batch-API discount.
   * Pass `outputTokens=0` if the call hasn't returned yet (tracking input
   * cost only at submit time); update with `recordHaiku(..., outputTokens, ...)`
   * when results return.
   */
  recordHaiku(
    pass: LedgerPassKey,
    inputTokens: number,
    outputTokens: number,
    requests: number = 1,
    batched: boolean = true,
  ): void {
    const inputUsd = (inputTokens / 1_000_000) * HAIKU_INPUT_PER_MILLION_USD;
    const outputUsd = (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_MILLION_USD;
    const usd = (inputUsd + outputUsd) * (batched ? BATCH_DISCOUNT : 1);
    this.add(pass, inputTokens, outputTokens, requests, usd * USD_TO_GBP);
  }

  private add(
    pass: string,
    inputTokens: number,
    outputTokens: number,
    requests: number,
    gbp: number,
  ): void {
    const existing = this.perPass.get(pass) ?? {
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      gbp: 0,
    };
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.requests += requests;
    existing.gbp += gbp;
    this.perPass.set(pass, existing);

    const total = this.totalGbp();
    if (!this.softWarningFired && total >= this.softWarningGbp) {
      this.softWarningFired = true;
      this.warn(
        `[enrich/cost] soft warning: cumulative spend £${total.toFixed(4)} crossed soft threshold £${this.softWarningGbp.toFixed(2)}`,
      );
    }
    if (total >= this.hardCapGbp) {
      this.err(
        `[enrich/cost] HARD CAP REACHED: £${total.toFixed(4)} >= £${this.hardCapGbp.toFixed(2)}. Run will abort at next batch boundary.`,
      );
    }
  }

  totalGbp(): number {
    let sum = 0;
    for (const entry of this.perPass.values()) sum += entry.gbp;
    return sum;
  }

  /** True iff we should abort at the next batch boundary. */
  shouldAbort(): boolean {
    return this.totalGbp() >= this.hardCapGbp;
  }

  summary(): CostSummary {
    const perPass: Record<string, PassEntry> = {};
    for (const [k, v] of this.perPass) perPass[k] = { ...v };
    return {
      totalGbp: this.totalGbp(),
      perPass,
      hardCapGbp: this.hardCapGbp,
      softWarningGbp: this.softWarningGbp,
      capExceeded: this.shouldAbort(),
      softWarningFired: this.softWarningFired,
    };
  }
}

/**
 * Approximate token count for a string. 1 token ≈ 4 chars of English prose.
 *
 * We deliberately avoid pulling tiktoken / google-tokenizer — both are hefty
 * deps. Gemini's batchEmbedContents response carries no token usage either,
 * so the approximation is also the only signal we have on the embedding leg.
 * HITL Q5 (2026-05-12) ratified accepting the 1–2% drift; the ledger is a
 * cap-not-billing instrument.
 */
export function approxTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
