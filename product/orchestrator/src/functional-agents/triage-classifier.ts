/**
 * Functional agent: pre-turn triage classifier (B.t7).
 *
 * Purpose — proof of the two-layer agent model (Tier 2 B §2.1, top-level
 * decision B.5): the main orchestrator delegates one narrow classification
 * call to a **separate agent running on a different, cheaper model**. Here,
 * "separate agent" is an ADK `LlmAgent` keyed on the `classifier` role in
 * the model registry, which resolves to `FUNCTIONAL_CLASSIFIER_MODEL`
 * (Haiku by default) — distinct from the orchestrator's Sonnet.
 *
 * Scope constraints (chunk B.t7 brief):
 *   - Runs BEFORE the orchestrator processes each user turn.
 *   - Advisory only — the orchestrator sees the verdict but makes its own
 *     call; the authoritative triage logic lands in the HITL flow-mapping
 *     session (chunk G.t0), at which point this placeholder is replaced.
 *   - Writes into `session.triage` to prove state threads through.
 *   - Scope-limited to one classification API: `classify(message, session)`.
 *
 * Output shape intentionally narrow:
 *   - `leaning_qualified`   — clear intent + budget/timing signals.
 *   - `leaning_backpacker`  — budget-constrained / DIY-oriented.
 *   - `leaning_low_value`   — vague browsing / not a prospect.
 *   - `unclear`             — default when the signal is weak.
 *
 * How we map this onto `@swoop/common`'s `TriageState` (discriminated
 * union on `verdict`):
 *   - `leaning_qualified`   → `verdict: "qualified"`   (reason placeholder).
 *   - `leaning_backpacker`  → `verdict: "referred_out"`.
 *   - `leaning_low_value`   → `verdict: "disqualified"`.
 *   - `unclear`             → `verdict: "none"`.
 *   Each carries `reasonCode: "triage_classifier_placeholder"` so downstream
 *   code can tell "placeholder advisory verdict" from "final HITL verdict"
 *   once G.t0 lands.
 *
 * Implementation path:
 *   - We build an ADK `LlmAgent` as the "layer-2 agent" so the shape matches
 *     the orchestrator's own factory (same ADK primitive, different model).
 *     This satisfies "real ADK agent, different model" from the Tier 3 plan.
 *   - We invoke it via the agent's own `ClaudeLlm.generateContentAsync`
 *     directly (no full `Runner` round-trip) — classification is one-shot,
 *     no tools, no multi-turn history, so the Runner loop would be pure
 *     overhead. The BaseLlm interface is the ADK contract; using it directly
 *     is still ADK execution, not a side channel.
 *
 * Observability: `console.log` for the model name on every classify() call,
 * so the two-layer split is visible in logs. When chunk F lands, this
 * switches to `emitEvent`.
 */

import type { Content } from '@google/genai';
import type { LlmRequest, LlmResponse } from '@google/adk';
import { LlmAgent } from '@google/adk';

import type { Config } from '../config/index.js';
import { getModelFor, type ModelConfig } from '../config/index.js';
import { ClaudeLlm } from '../agent/claude-llm.js';
import type { SessionState, TriageState } from '@swoop/common';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * Raw classifier output. Narrower than `TriageState` so the mapping is
 * auditable: we know what the classifier said, separate from how we chose
 * to persist it.
 */
export type TriagePosture =
  | 'leaning_qualified'
  | 'leaning_backpacker'
  | 'leaning_low_value'
  | 'unclear';

export interface ClassifyResult {
  readonly posture: TriagePosture;
  /** Model id that produced this verdict — for logs / observability. */
  readonly modelUsed: string;
  /** Free-form rationale from the model (short). Advisory. */
  readonly rationale: string;
}

export interface TriageClassifier {
  /**
   * Classify a single user message against the current session. Pure with
   * respect to the `SessionState` snapshot passed in — the caller applies
   * the result to the store.
   */
  classify(userMessage: string, session: SessionState): Promise<ClassifyResult>;

  /** Model id this classifier was built to call. For logging/assertions. */
  readonly modelId: string;
}

export interface BuildTriageClassifierParams {
  readonly config: Config;
  /**
   * Override the underlying `ClaudeLlm` — tests inject a stub so the
   * classifier can run without an Anthropic key.
   */
  readonly llm?: ClaudeLlmLike;
}

/**
 * Minimal shape we depend on from `ClaudeLlm`. Matches the real class's
 * `generateContentAsync` surface. Kept narrow so tests can stub it directly.
 */
export interface ClaudeLlmLike {
  readonly model: string;
  generateContentAsync(
    llmRequest: LlmRequest,
    stream?: boolean,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void>;
}

// ---------------------------------------------------------------------------
// Prompt — placeholder per brief. Replaced when G.t0 (HITL flow-mapping)
// lands the proper Puma triage logic.
// ---------------------------------------------------------------------------

const CLASSIFIER_SYSTEM_PROMPT = `You are Puma's pre-turn triage classifier — a lightweight placeholder.
Given a single user message from a visitor to Swoop Adventures' Patagonia discovery chat,
tag the visitor's current posture with ONE of these labels:

- leaning_qualified   — specific trip intent with budget/timing signals (e.g. "honeymoon Dec 2026, 2 weeks, £10k each").
- leaning_backpacker  — budget-constrained, DIY posture, gap-year tone ("cheapest", "on a budget", "hostels").
- leaning_low_value   — vague browsing, not a serious prospect ("just curious", "maybe one day").
- unclear             — signal is too weak to call.

Respond with ONLY a JSON object of this exact shape, no surrounding prose:
{"posture": "<label>", "rationale": "<one short sentence>"}

Your verdict is advisory — the orchestrator sees it but makes the final call.
When in doubt, pick "unclear". Do not invent signals that aren't in the message.`;

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build a triage classifier bound to the `classifier` role in the model
 * registry. Side-effect-free; call once at startup and reuse per request.
 *
 * Why a factory rather than a class export: the orchestrator owns one
 * Config + one ANTHROPIC_API_KEY for the process lifetime, so building a
 * single instance up front is the right lifecycle. Tests can still inject
 * a stub `llm` to avoid real API calls.
 */
export function buildTriageClassifier({
  config,
  llm,
}: BuildTriageClassifierParams): TriageClassifier {
  const modelConfig: ModelConfig = getModelFor(config, 'classifier');

  // Build the ADK `LlmAgent` shell so the classifier has the same shape as
  // the orchestrator agent (same primitive, different model). We don't
  // drive it through a Runner — we call the underlying `ClaudeLlm`
  // directly — but touching `LlmAgent` here anchors the "layer-2 agent"
  // claim: it's a real ADK agent object.
  const underlyingLlm: ClaudeLlmLike =
    llm ??
    new ClaudeLlm({
      model: modelConfig.model,
      apiKey: config.ANTHROPIC_API_KEY,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    });

  // The `LlmAgent` construction is deliberately kept: it asserts the
  // classifier is a full ADK agent, not a side helper. Even though we
  // don't run() it, future work (e.g. moving to a Runner + tool calls for
  // a richer classifier) reuses this object.
  const classifierAgent = new LlmAgent({
    name: 'puma_triage_classifier',
    description:
      'Pre-turn triage classifier — placeholder. Tags the visitor posture (qualified / backpacker / low-value / unclear) for the orchestrator to read. Replaced by the G.t0 HITL flow-mapping session.',
    model: underlyingLlm as unknown as ClaudeLlm,
    instruction: () => CLASSIFIER_SYSTEM_PROMPT,
    tools: [],
  });

  return {
    modelId: modelConfig.model,
    async classify(userMessage, session) {
      return runClassification({
        llm: underlyingLlm,
        modelConfig,
        userMessage,
        session,
        agentName: classifierAgent.name,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Classification runtime.
// ---------------------------------------------------------------------------

async function runClassification(params: {
  llm: ClaudeLlmLike;
  modelConfig: ModelConfig;
  userMessage: string;
  session: SessionState;
  agentName: string;
}): Promise<ClassifyResult> {
  const { llm, modelConfig, userMessage, session, agentName } = params;

  // Thin context window: the last two user utterances (if any) + the new
  // message. Keeps token usage small — the classifier is cheap-tier, we
  // don't need the full history for a one-shot tag.
  const priorUserTurns = session.conversationHistory
    .filter((e) => e.role === 'user')
    .slice(-2)
    .map((e) => e.text);

  const userContent = formatClassifierInput({
    priorUserTurns,
    currentMessage: userMessage,
  });

  const request: LlmRequest = {
    model: modelConfig.model,
    contents: [
      { role: 'system', parts: [{ text: CLASSIFIER_SYSTEM_PROMPT }] } as Content,
      { role: 'user', parts: [{ text: userContent }] } as Content,
    ],
    toolsDict: {},
    liveConnectConfig: {},
  } as LlmRequest;

  // One-shot: collect all LlmResponse fragments, concatenate the text
  // parts. No streaming to users — the classifier output is consumed by
  // the orchestrator before any SSE writes begin.
  let collectedText = '';
  for await (const resp of llm.generateContentAsync(request)) {
    const parts = resp.content?.parts ?? [];
    for (const p of parts) {
      // Ignore thought parts even if the cheap model emits them — the
      // rationale lives in the JSON body.
      if (p.thought === true) continue;
      if (typeof p.text === 'string') {
        collectedText += p.text;
      }
    }
    if (resp.errorCode) {
      // Classifier failure is not fatal — log and fall through to unclear.
      console.warn(
        `[orchestrator] triage classifier error (${resp.errorCode}): ${resp.errorMessage ?? '(no message)'}`,
      );
      return fallback('classifier_error', modelConfig.model);
    }
    if (resp.turnComplete) break;
  }

  console.log(
    `[orchestrator] ${agentName} classified turn (model=${modelConfig.model}, bytes=${collectedText.length})`,
  );

  const parsed = parseClassifierOutput(collectedText);
  if (!parsed) {
    return fallback('classifier_parse_failed', modelConfig.model);
  }
  return {
    posture: parsed.posture,
    rationale: parsed.rationale,
    modelUsed: modelConfig.model,
  };
}

/**
 * Format the user content the classifier sees. Keep the structure terse —
 * the cheap-tier model works best on a small surface.
 */
function formatClassifierInput(params: {
  readonly priorUserTurns: readonly string[];
  readonly currentMessage: string;
}): string {
  const lines: string[] = [];
  if (params.priorUserTurns.length > 0) {
    lines.push('Prior user messages (oldest first):');
    for (const t of params.priorUserTurns) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }
  lines.push(`Current user message: "${params.currentMessage}"`);
  lines.push('');
  lines.push('Return the JSON object as specified.');
  return lines.join('\n');
}

/**
 * Parse the classifier's JSON output. Defensive: the cheap model may wrap
 * the JSON in code fences or emit stray text — strip either before parse.
 */
function parseClassifierOutput(raw: string): { posture: TriagePosture; rationale: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Strip common wrappers: ``` / ```json fences.
  let body = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // If the model prefixed/suffixed the JSON with prose, grab the first
  // balanced {...} block.
  if (!body.startsWith('{')) {
    const match = body.match(/\{[\s\S]*\}/);
    if (!match) return null;
    body = match[0];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const posture = obj.posture;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';

  if (!isTriagePosture(posture)) return null;
  return { posture, rationale };
}

function isTriagePosture(v: unknown): v is TriagePosture {
  return (
    v === 'leaning_qualified' ||
    v === 'leaning_backpacker' ||
    v === 'leaning_low_value' ||
    v === 'unclear'
  );
}

function fallback(reason: string, modelUsed: string): ClassifyResult {
  return {
    posture: 'unclear',
    rationale: `fallback:${reason}`,
    modelUsed,
  };
}

// ---------------------------------------------------------------------------
// Mapping — TriagePosture → SessionState.triage.
// ---------------------------------------------------------------------------

/**
 * Placeholder reason code embedded in every triage write this classifier
 * makes. Downstream consumers (HITL flow-mapping in G.t0, observability in
 * chunk F) distinguish "advisory placeholder" from "real verdict" by
 * checking for this literal. Do not reuse in the real classifier.
 */
export const PLACEHOLDER_REASON_CODE = 'triage_classifier_placeholder';

/**
 * Apply a classifier result to a `SessionState.triage` slot. Pure — the
 * caller persists the returned state via its store. Timestamps come from
 * the injected clock so session updates can be deterministic in tests.
 */
export function applyTriageVerdict(params: {
  readonly session: SessionState;
  readonly result: ClassifyResult;
  readonly now: Date;
}): SessionState {
  const triage = postureToTriage(params.result, params.now);
  return { ...params.session, triage };
}

function postureToTriage(result: ClassifyResult, now: Date): TriageState {
  const decidedAt = now.toISOString();
  const reasonText = `advisory:${result.posture} — ${result.rationale}`;
  switch (result.posture) {
    case 'leaning_qualified':
      return {
        verdict: 'qualified',
        reasonCode: PLACEHOLDER_REASON_CODE,
        reasonText,
        decidedAt,
      };
    case 'leaning_backpacker':
      return {
        verdict: 'referred_out',
        reasonCode: PLACEHOLDER_REASON_CODE,
        reasonText,
        decidedAt,
      };
    case 'leaning_low_value':
      return {
        verdict: 'disqualified',
        reasonCode: PLACEHOLDER_REASON_CODE,
        reasonText,
        decidedAt,
      };
    case 'unclear':
    default:
      return { verdict: 'none' };
  }
}
