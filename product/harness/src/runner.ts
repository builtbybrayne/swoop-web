/**
 * Per-scenario execution.
 *
 * Two code paths, one return shape:
 *
 *   1. **Scripted (H.t1):** `scenario.turns: [{user: '...'}, ...]` — send each
 *      pre-authored turn to the orchestrator sequentially.
 *
 *   2. **Agent-as-user (H.t8):** `scenario.userAgent: {persona, goal,
 *      terminationCriteria, modelOverride?}` — an injected `UserAgent` LLM
 *      generates each user message in role; an injected `shouldStop` Haiku
 *      judge decides per-turn whether to terminate. Hard cap at
 *      `terminationCriteria.maxTurns` regardless of judge output (the judge is
 *      allowed to under-stop, not over-stop).
 *
 * Both paths:
 *   1. Create orchestrator session + grant tier-1 consent.
 *   2. Aggregate per-turn response (utter text + tool calls + structure).
 *   3. Build a `RunContext` carrying the load-bearing state for assertion
 *      handlers: final utterance, captured tool calls (turn-stamped), per-
 *      turn structure, captured events (from `EventCapture`), and final
 *      triage state (when the runner can derive it).
 *   4. Evaluate every assertion against that context.
 *   5. Run the optional top-level `judge` block.
 *   6. Return a structured result the reporter formats as markdown + JSON.
 *
 * Failure posture: a thrown error (network, orchestrator down, bad scenario,
 * user-agent refusal, stop-judge surprise) becomes a scenario result with
 * `status: "errored"` + a captured error message. The CLI never crashes on a
 * single scenario failure (H.13 non-gating).
 *
 * Final-triage derivation:
 *   The orchestrator does not (today) expose a `/session/:id` endpoint that
 *   surfaces triage state. The runner falls back to inspecting captured
 *   `triage.decided` events to derive the most-recent verdict. When events
 *   aren't being captured (default `NullEventCapture`) the final triage is
 *   `null` and `triage_verdict` assertions fail accordingly.
 */

import { messageOf } from '@swoop/common';

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
import {
  isAgentScenario,
  type AgentScenario,
  type LoadedScenario,
  type Scenario,
  type ScriptedScenario,
} from './scenario.js';
import type { ConversationTurn } from './user-agent.js';

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

// ---------------------------------------------------------------------------
// Agent-as-user dependency surface (injected by the CLI; mocked by tests).
//
// We define narrow interfaces here rather than importing `UserAgent` /
// `shouldStop` concrete types so the runner stays decoupled from the SDK and
// tests can inject deterministic fakes without dragging Anthropic into the
// test surface.
// ---------------------------------------------------------------------------

export interface UserAgentLike {
  nextMessage(req: {
    transcript: readonly ConversationTurn[];
    latestAgentResponse?: string;
  }): Promise<string>;
}

export interface ShouldStopFn {
  (req: {
    transcript: readonly ConversationTurn[];
    latestAgentResponse: string;
  }): Promise<boolean>;
}

/**
 * Factory the runner uses to build per-scenario agent + stop-judge instances.
 * The CLI supplies a real factory that wires Anthropic clients + the
 * scenario's persona/goal/criteria; tests supply a fake factory that returns
 * deterministic stubs.
 *
 * Returning `null` means "this runtime cannot run agent scenarios" — the
 * runner errors the scenario cleanly so the CLI keeps going.
 */
export interface AgentRuntimeFactory {
  build(scenario: AgentScenario):
    | {
        userAgent: UserAgentLike;
        shouldStop: ShouldStopFn;
      }
    | null;
}

export interface RunScenarioDeps {
  readonly client: OrchestratorClient;
  readonly judge: Judge;
  readonly events?: EventCapture;
  readonly now?: () => number;
  /**
   * Optional — when omitted, scripted scenarios still run normally and
   * agent-as-user scenarios error out cleanly. The CLI wires this when an
   * `ANTHROPIC_API_KEY` is available.
   */
  readonly agentRuntime?: AgentRuntimeFactory;
}

export async function runScenario(
  loaded: LoadedScenario,
  deps: RunScenarioDeps,
): Promise<ScenarioResult> {
  if (isAgentScenario(loaded.scenario)) {
    return runAgentScenario(loaded, loaded.scenario, deps);
  }
  return runScriptedScenario(loaded, loaded.scenario, deps);
}

// ---------------------------------------------------------------------------
// Scripted scenario codepath — unchanged from H.t1 / H.t3 in observable
// behaviour. Lifted into its own function so the agent codepath sits beside
// it cleanly.
// ---------------------------------------------------------------------------

async function runScriptedScenario(
  loaded: LoadedScenario,
  scenario: ScriptedScenario,
  deps: RunScenarioDeps,
): Promise<ScenarioResult> {
  const { file } = loaded;
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

    return await finaliseResult({
      scenario,
      file,
      startedAt,
      now,
      turnResults,
      perTurnStructure,
      allToolCalls,
      finalUtterance,
      sessionId,
      eventCapture,
      judge: deps.judge,
    });
  } catch (err) {
    return erroredResult(scenario, file, startedAt, now, turnResults, err);
  }
}

// ---------------------------------------------------------------------------
// Agent-as-user scenario codepath — H.t8.
// ---------------------------------------------------------------------------

async function runAgentScenario(
  loaded: LoadedScenario,
  scenario: AgentScenario,
  deps: RunScenarioDeps,
): Promise<ScenarioResult> {
  const { file } = loaded;
  const now = deps.now ?? (() => Date.now());
  const eventCapture: EventCapture = deps.events ?? new NullEventCapture();
  const startedAt = now();

  const turnResults: TurnResult[] = [];
  const perTurnStructure: TurnStructure[] = [];
  const allToolCalls: CapturedToolCall[] = [];
  let finalUtterance = '';
  let sessionId = '';

  try {
    if (!deps.agentRuntime) {
      throw new Error(
        '[harness] agent-as-user scenario but no agentRuntime supplied (set ANTHROPIC_API_KEY and wire the CLI factory).',
      );
    }
    const runtime = deps.agentRuntime.build(scenario);
    if (!runtime) {
      throw new Error(
        '[harness] agentRuntime.build returned null for an agent scenario',
      );
    }

    const session = await deps.client.createSession();
    sessionId = session.sessionId;
    await deps.client.grantConsent(sessionId, session.disclosureCopyVersion);

    const maxTurns = scenario.userAgent.terminationCriteria.maxTurns;
    const transcript: ConversationTurn[] = [];

    let turnIndex = 0;
    while (turnIndex < maxTurns) {
      turnIndex += 1;
      // Generate the next user message from the user-agent. The user-agent
      // receives the full transcript so far; `buildMessages` inside the
      // user-agent role-flips it (visitor lines → assistant role; agent
      // replies → user role) and naturally terminates on a `user` role line,
      // so we don't need a separate `latestAgentResponse` trailer here.
      const userMessage = await runtime.userAgent.nextMessage({
        transcript,
      });

      // Send to orchestrator + capture aggregated response.
      const aggregated: AggregatedResponse = await deps.client.sendMessage(
        sessionId,
        userMessage,
      );
      perTurnStructure.push(aggregated.structure);
      for (const tc of aggregated.toolCalls) {
        allToolCalls.push({ ...tc, turnIndex });
      }
      turnResults.push({
        user: userMessage,
        utterText: aggregated.utterText,
        toolCallCount: aggregated.toolCalls.length,
        rawPartCount: aggregated.rawParts.length,
        structure: aggregated.structure,
      });
      finalUtterance = aggregated.utterText;
      transcript.push({ user: userMessage, agent: aggregated.utterText });

      // Hard cap reached? Don't bother asking the stop-judge.
      if (turnIndex >= maxTurns) break;

      // Ask the stop-judge whether to terminate. Pass transcript-minus-last
      // + latest assistant response so the judge prompt isolates the new
      // utterance cleanly (matches the `shouldStop` interface).
      const stop = await runtime.shouldStop({
        transcript: transcript.slice(0, -1),
        latestAgentResponse: aggregated.utterText,
      });
      if (stop) break;
    }

    return await finaliseResult({
      scenario,
      file,
      startedAt,
      now,
      turnResults,
      perTurnStructure,
      allToolCalls,
      finalUtterance,
      sessionId,
      eventCapture,
      judge: deps.judge,
    });
  } catch (err) {
    return erroredResult(scenario, file, startedAt, now, turnResults, err);
  }
}

// ---------------------------------------------------------------------------
// Shared finalisation: event derivation, assertion eval, top-level judge.
// ---------------------------------------------------------------------------

interface FinaliseArgs {
  scenario: Scenario;
  file: string;
  startedAt: number;
  now: () => number;
  turnResults: readonly TurnResult[];
  perTurnStructure: readonly TurnStructure[];
  allToolCalls: readonly CapturedToolCall[];
  finalUtterance: string;
  sessionId: string;
  eventCapture: EventCapture;
  judge: Judge;
}

async function finaliseResult(args: FinaliseArgs): Promise<ScenarioResult> {
  const events = args.eventCapture.eventsForSession(args.sessionId);
  const finalTriage = deriveFinalTriage(events);

  const context: RunContext = {
    sessionId: args.sessionId,
    finalUtterance: args.finalUtterance,
    perTurnStructure: args.perTurnStructure,
    toolCalls: args.allToolCalls,
    events,
    finalTriage,
  };

  const assertions = await evaluateAll(
    args.scenario.assertions,
    context,
    args.judge,
  );

  let judgeVerdict: JudgeVerdict | null = null;
  if (args.scenario.judge) {
    judgeVerdict = await args.judge.evaluate(
      args.scenario.judge.rubric,
      args.finalUtterance,
    );
  }

  const assertionsPassed = assertions.every((a) => a.passed);
  const judgePassed = judgeVerdict ? judgeVerdict.passed : true;
  const status: ScenarioStatus =
    assertionsPassed && judgePassed ? 'passed' : 'failed';

  return {
    file: args.file,
    name: args.scenario.name,
    description: args.scenario.description,
    status,
    durationMs: args.now() - args.startedAt,
    turns: args.turnResults,
    assertions,
    judge: judgeVerdict,
  };
}

function erroredResult(
  scenario: Scenario,
  file: string,
  startedAt: number,
  now: () => number,
  turnResults: readonly TurnResult[],
  err: unknown,
): ScenarioResult {
  return {
    file,
    name: scenario.name,
    description: scenario.description,
    status: 'errored',
    durationMs: now() - startedAt,
    turns: turnResults,
    assertions: [],
    judge: null,
    error: messageOf(err),
  };
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
