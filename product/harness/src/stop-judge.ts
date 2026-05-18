/**
 * Stop-judge — Haiku-backed per-turn termination evaluator.
 *
 * H.t8 — Task 2.
 *
 * Why this exists:
 *   The H.t8 scenario shape lets authors declare `terminationCriteria:
 *   {stopWhen: ['handoff form appears', ...]}` in natural language. Substring
 *   matching against the assistant's last utterance is brittle ("handoff form
 *   appears" almost never appears verbatim). A small LLM judge bridges the
 *   gap: a per-turn Haiku call answers "has any stop criterion been met?"
 *   with YES or NO.
 *
 * Cost / latency:
 *   Haiku 4.5 list price = ~$1/MTok input, ~$5/MTok output. Each call is
 *   under 1k tokens in + 5 tokens out → ~$0.001 per call. A 6-turn scenario
 *   is ~$0.006 in stop-judge cost; the 37-scenario suite is ~$0.22.
 *
 * Determinism:
 *   - max_tokens = 5 (just enough for "YES" / "NO" with whitespace).
 *   - temperature = 0 — we want stable yes/no decisions across re-runs.
 *   - Strict parser: anything other than YES/NO throws so operators see
 *     drift loudly instead of silently mis-stopping.
 *
 * Safety net:
 *   The runner enforces `maxTurns` as a hard cap regardless of this judge's
 *   verdict. The stop-judge is allowed to under-stop (keep going past a
 *   reasonable point), not over-stop. If the judge spuriously returns YES,
 *   the conversation ends early — but the conversation is still re-runnable
 *   from the YAML, so we'd notice and tighten the persona/criteria.
 */

import type { ConversationTurn } from './user-agent.js';
import type { TerminationCriteria } from './scenario.js';

export const DEFAULT_STOP_JUDGE_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Minimal client surface — same shape as `user-agent.ts`'s `AnthropicLike`,
 * re-declared here so the module is self-contained and tests don't have to
 * import from a sibling.
 */
export interface AnthropicLike {
  messages: {
    create(body: {
      model: string;
      system?: string;
      messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
      max_tokens: number;
      temperature?: number;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

export interface ShouldStopRequest {
  readonly client: AnthropicLike;
  readonly persona: string;
  readonly goal: string;
  readonly terminationCriteria: TerminationCriteria;
  readonly transcript: readonly ConversationTurn[];
  readonly latestAgentResponse: string;
  readonly model?: string;
}

/**
 * Build the system prompt for the stop-judge. Exported for test inspection.
 *
 * Shape: tells the judge what its job is + spells out the persona + goal +
 * stop criteria, then locks the response format to a single word.
 */
export function buildStopJudgeSystemPrompt(
  persona: string,
  goal: string,
  terminationCriteria: TerminationCriteria,
): string {
  const stopWhenLines =
    terminationCriteria.stopWhen && terminationCriteria.stopWhen.length > 0
      ? terminationCriteria.stopWhen.map((s) => `  - ${s}`).join('\n')
      : '  (none specified — only stop if the conversation has clearly reached its goal)';
  return [
    'You are a termination judge for a roleplay conversation.',
    '',
    'A user-agent LLM is playing a website visitor. Your job is to decide whether the conversation should stop now.',
    '',
    "--- The user-agent's character ---",
    persona.trim(),
    '',
    "--- The user-agent's goal ---",
    goal.trim(),
    '',
    '--- Termination criteria (any one is sufficient to stop) ---',
    `  - maxTurns: ${terminationCriteria.maxTurns} (the runner enforces this as a hard cap separately; do not factor it into your decision unless the transcript already shows that many turns)`,
    stopWhenLines,
    '',
    'You will receive the conversation so far plus the latest assistant response. Has ANY termination criterion been satisfied?',
    '',
    'Answer with exactly one word: YES or NO. No explanation, no punctuation, no other text.',
  ].join('\n');
}

/**
 * Build the user-role payload — the actual conversation snapshot the judge
 * evaluates. Exported for test inspection.
 *
 * Note: we send the whole transcript inline as a single user message rather
 * than via the structured `messages` array. The judge isn't roleplaying —
 * it's classifying. A single payload keeps Haiku token usage minimal +
 * the prompt readable for debugging.
 */
export function buildStopJudgeUserPayload(
  transcript: readonly ConversationTurn[],
  latestAgentResponse: string,
): string {
  const lines: string[] = ['--- Conversation so far ---'];
  if (transcript.length === 0) {
    lines.push('(no prior turns)');
  } else {
    let i = 1;
    for (const t of transcript) {
      lines.push(`Turn ${i}:`);
      lines.push(`  Visitor: ${t.user}`);
      lines.push(`  Assistant: ${t.agent}`);
      i += 1;
    }
  }
  lines.push('');
  lines.push('--- Latest assistant response (just now) ---');
  lines.push(latestAgentResponse);
  lines.push('');
  lines.push('Has any termination criterion been satisfied? Reply YES or NO.');
  return lines.join('\n');
}

/**
 * Ask the stop-judge whether the conversation should terminate now.
 *
 * Returns `true` to stop, `false` to continue. Throws on any unexpected
 * model output — silent fallback would mask drift (Haiku starting to emit
 * "Yes." or "true" instead of "YES").
 */
export async function shouldStop(req: ShouldStopRequest): Promise<boolean> {
  const system = buildStopJudgeSystemPrompt(
    req.persona,
    req.goal,
    req.terminationCriteria,
  );
  const userPayload = buildStopJudgeUserPayload(
    req.transcript,
    req.latestAgentResponse,
  );
  const res = await req.client.messages.create({
    model: req.model ?? DEFAULT_STOP_JUDGE_MODEL,
    system,
    messages: [{ role: 'user', content: userPayload }],
    max_tokens: 5,
    temperature: 0,
  });
  const text = extractTextContent(res.content).trim().toUpperCase();
  if (text === 'YES') return true;
  if (text === 'NO') return false;
  throw new Error(
    `[stop-judge] unexpected response: "${text}". Expected YES or NO.`,
  );
}

function extractTextContent(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
}
