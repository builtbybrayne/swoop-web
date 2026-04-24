/**
 * Judge interface + stub implementation (H.t1).
 *
 * The scaffold does NOT wire a real model-as-judge. `StubJudge` returns a
 * pass-through verdict so the runner code path exists; H.t5 replaces it with
 * `AnthropicJudge` (Claude Opus 4.x per Tier 2 H.2) without touching callers.
 *
 * Scaffold scenarios all set `judge: null`, so the stub path never actually
 * executes. The surface exists purely so H.t5 is a one-class swap.
 */

export interface JudgeVerdict {
  readonly passed: boolean;
  readonly reasoning: string;
  readonly model?: string;
  readonly rawResponse?: string;
}

export interface Judge {
  evaluate(
    rubric: string,
    response: string,
    context?: unknown,
  ): Promise<JudgeVerdict>;
}

export class StubJudge implements Judge {
  async evaluate(_rubric: string, _response: string): Promise<JudgeVerdict> {
    return {
      passed: true,
      reasoning: 'stub — judge not wired (H.t5)',
    };
  }
}
