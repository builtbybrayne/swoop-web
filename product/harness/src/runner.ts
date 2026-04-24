/**
 * Per-scenario execution (H.t1).
 *
 * Orchestrates the full conversation:
 *   1. Create orchestrator session + grant tier-1 consent.
 *   2. Send each `turns[].user` message sequentially, collecting the
 *      aggregated response for each.
 *   3. Evaluate `contains` / `not_contains` assertions against the FINAL
 *      turn's utter text.
 *   4. Return a structured result the reporter formats as markdown + JSON.
 *
 * Judge assertions (`scenario.judge != null`) run after the deterministic
 * pass. Scaffold scenarios all set `judge: null`, so `StubJudge` is never
 * actually invoked — the class is shaped here so H.t5 drops in without
 * touching the runner.
 *
 * Failure posture: a thrown error (network, orchestrator down, bad scenario)
 * becomes a scenario result with `status: "errored"` + a captured error
 * message. The CLI never crashes on a single scenario failure — that's H.13
 * non-gating realised.
 */

import { evaluateAll, type AssertionOutcome } from './assertions.js';
import type { Judge, JudgeVerdict } from './judge.js';
import type { OrchestratorClient, AggregatedResponse } from './orchestrator-client.js';
import type { LoadedScenario } from './scenario.js';

export type ScenarioStatus = 'passed' | 'failed' | 'errored';

export interface TurnResult {
  readonly user: string;
  readonly utterText: string;
  readonly toolCallCount: number;
  readonly rawPartCount: number;
}

export interface ScenarioResult {
  readonly file: string;
  readonly name: string;
  readonly description: string;
  readonly status: ScenarioStatus;
  readonly durationMs: number;
  readonly turns: readonly TurnResult[];
  readonly assertions: readonly AssertionOutcome[];
  readonly judge: JudgeVerdict | null;
  /** Populated when `status === 'errored'`. */
  readonly error?: string;
}

export interface RunScenarioDeps {
  readonly client: OrchestratorClient;
  readonly judge: Judge;
  readonly now?: () => number;
}

export async function runScenario(
  loaded: LoadedScenario,
  deps: RunScenarioDeps,
): Promise<ScenarioResult> {
  const { scenario, file } = loaded;
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const turns: TurnResult[] = [];
  let finalUtterance = '';

  try {
    const { sessionId, disclosureCopyVersion } = await deps.client.createSession();
    await deps.client.grantConsent(sessionId, disclosureCopyVersion);

    for (const turn of scenario.turns) {
      const aggregated: AggregatedResponse = await deps.client.sendMessage(
        sessionId,
        turn.user,
      );
      turns.push({
        user: turn.user,
        utterText: aggregated.utterText,
        toolCallCount: aggregated.toolCalls.length,
        rawPartCount: aggregated.rawParts.length,
      });
      finalUtterance = aggregated.utterText;
    }

    const assertions = evaluateAll(scenario.assertions, finalUtterance);

    let judgeVerdict: JudgeVerdict | null = null;
    if (scenario.judge) {
      judgeVerdict = await deps.judge.evaluate(
        scenario.judge.rubric,
        finalUtterance,
      );
    }

    const assertionsPassed = assertions.every((a) => a.passed);
    const judgePassed = judgeVerdict ? judgeVerdict.passed : true;
    const status: ScenarioStatus =
      assertionsPassed && judgePassed ? 'passed' : 'failed';

    return {
      file,
      name: scenario.name,
      description: scenario.description,
      status,
      durationMs: now() - startedAt,
      turns,
      assertions,
      judge: judgeVerdict,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      file,
      name: scenario.name,
      description: scenario.description,
      status: 'errored',
      durationMs: now() - startedAt,
      turns,
      assertions: [],
      judge: null,
      error: message,
    };
  }
}
