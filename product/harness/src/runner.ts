/**
 * Per-scenario execution.
 *
 * Orchestrates the full conversation:
 *   1. Create orchestrator session + grant tier-1 consent.
 *   2. Send each `turns[].user` message sequentially, collecting the
 *      aggregated response for each (utter text + tool calls + per-turn
 *      structural counts).
 *   3. Build a `RunContext` carrying the load-bearing state for assertion
 *      handlers: final utterance, captured tool calls (turn-stamped), per-
 *      turn structure, captured events (from `EventCapture`), and final
 *      triage state (when the runner can derive it).
 *   4. Evaluate every assertion against that context; the discriminated-
 *      union dispatch in `assertions.ts` handles the per-kind logic.
 *   5. Run the optional top-level `judge` block (separate from
 *      `judge_rubric` assertions) for backwards-compat with H.t1 scenarios.
 *   6. Return a structured result the reporter formats as markdown + JSON.
 *
 * Failure posture: a thrown error (network, orchestrator down, bad scenario)
 * becomes a scenario result with `status: "errored"` + a captured error
 * message. The CLI never crashes on a single scenario failure — that's H.13
 * non-gating realised.
 *
 * Final-triage derivation:
 *   The orchestrator does not (today) expose a `/session/:id` endpoint that
 *   surfaces triage state. The runner falls back to inspecting captured
 *   `triage.decided` events to derive the most-recent verdict. When events
 *   aren't being captured (default `NullEventCapture`) the final triage is
 *   `null` and `triage_verdict` assertions fail accordingly.
 */

import {
  evaluateAll,
  type AssertionOutcome,
  type CapturedToolCall,
  type FinalTriage,
  type RunContext,
  type TurnStructure,
} from './assertions.js';
import {
  NullEventCapture,
  type EventCapture,
} from './event-capture.js';
import type { Judge, JudgeVerdict } from './judge.js';
import type {
  AggregatedResponse,
  OrchestratorClient,
} from './orchestrator-client.js';
import type { LoadedScenario } from './scenario.js';

export type ScenarioStatus = 'passed' | 'failed' | 'errored';

export interface TurnResult {
  readonly user: string;
  readonly utterText: string;
  readonly toolCallCount: number;
  readonly rawPartCount: number;
  readonly structure: TurnStructure;
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
  readonly events?: EventCapture;
  readonly now?: () => number;
}

export async function runScenario(
  loaded: LoadedScenario,
  deps: RunScenarioDeps,
): Promise<ScenarioResult> {
  const { scenario, file } = loaded;
  const now = deps.now ?? (() => Date.now());
  const eventCapture: EventCapture = deps.events ?? new NullEventCapture();
  const startedAt = now();

  const turnResults: TurnResult[] = [];
  const perTurnStructure: TurnStructure[] = [];
  const allToolCalls: CapturedToolCall[] = [];
  let finalUtterance = '';
  let sessionId = '';

  try {
    const session = await deps.client.createSession();
    sessionId = session.sessionId;
    await deps.client.grantConsent(sessionId, session.disclosureCopyVersion);

    let turnIndex = 0;
    for (const turn of scenario.turns) {
      turnIndex += 1;
      const aggregated: AggregatedResponse = await deps.client.sendMessage(
        sessionId,
        turn.user,
      );
      perTurnStructure.push(aggregated.structure);
      for (const tc of aggregated.toolCalls) {
        allToolCalls.push({ ...tc, turnIndex });
      }
      turnResults.push({
        user: turn.user,
        utterText: aggregated.utterText,
        toolCallCount: aggregated.toolCalls.length,
        rawPartCount: aggregated.rawParts.length,
        structure: aggregated.structure,
      });
      finalUtterance = aggregated.utterText;
    }

    const events = eventCapture.eventsForSession(sessionId);
    const finalTriage = deriveFinalTriage(events);

    const context: RunContext = {
      sessionId,
      finalUtterance,
      perTurnStructure,
      toolCalls: allToolCalls,
      events,
      finalTriage,
    };

    const assertions = await evaluateAll(scenario.assertions, context, deps.judge);

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
      turns: turnResults,
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
      turns: turnResults,
      assertions: [],
      judge: null,
      error: message,
    };
  }
}

/**
 * Derive the session's final triage state from captured events. We use the
 * most recent `triage.decided` event for the session — chunk F's triage
 * classifier emits one per turn it runs.
 *
 * Returns `null` when no triage event was captured. Callers (the
 * `triage_verdict` handler) treat null as "no final triage available" and
 * fail the assertion with a clear message.
 */
function deriveFinalTriage(events: readonly import('@swoop/common').Event[]): FinalTriage | null {
  let latest: FinalTriage | null = null;
  for (const e of events) {
    if (e.eventType === 'triage.decided') {
      latest = {
        verdict: e.payload.verdict,
        reasonCode: e.payload.reasonCode,
      };
    }
  }
  return latest;
}
