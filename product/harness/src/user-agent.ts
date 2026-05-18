/**
 * User-agent — Anthropic-backed roleplay LLM that plays the website visitor.
 *
 * H.t8 — Task 2.
 *
 * The harness today scripts every user turn ahead of time (`turns: [{user:
 * '...'}, ...]`). That's fine for regression but useless for the "would this
 * agent handle a Skeptic / a Browser / a journalist?" coverage the validator
 * suite needs. H.t8 introduces the agent-as-user shape: a persona + goal +
 * termination criteria, with an LLM generating each user message in role.
 *
 * Design notes:
 *   - The role-flip is the load-bearing detail. From the user-agent's
 *     perspective, the **website visitor it's playing** is `assistant`
 *     (because that's what the user-agent is generating), and the **Swoop AI
 *     agent on the other side** is `user`. The naming is counter-intuitive
 *     but mirrors how Anthropic's Messages API expects chat to be shaped: the
 *     model's own outputs are `assistant`, everything coming back from the
 *     environment is `user`.
 *   - The persona is the system prompt. The conversation transcript is the
 *     `messages` array. First-turn generation has an empty transcript and
 *     synthesises an opening line from persona + goal.
 *   - We use `messages.create` non-streaming — the harness doesn't render a
 *     UI for the user side, so there's nothing to stream into.
 *
 * Dependency injection:
 *   The `AnthropicLike` interface mirrors the orchestrator's `ClaudeLlm`
 *   pattern (product/orchestrator/src/agent/claude-llm.ts) — tests inject a
 *   fake; production wires a real `Anthropic({apiKey})` instance from
 *   process.env.ANTHROPIC_API_KEY. This keeps tests deterministic + free of
 *   real-API calls.
 *
 * Cost: ~$0.01–0.03 per generated message at Sonnet 4.5 list price. A 6-turn
 * conversation runs $0.06–0.18; the 37-scenario suite is $2–5 per full run.
 */

import type { TerminationCriteria } from './scenario.js';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * A single turn in the conversation transcript, from the orchestrator's
 * point of view: `user` is what the website visitor (the user-agent) said,
 * `agent` is what the Swoop AI agent (the orchestrator) replied. The runner
 * appends to this as the conversation progresses; the user-agent reads it
 * (role-flipped) to generate the next user message.
 *
 * Kept narrow on purpose — the user-agent doesn't need tool calls, fyis, or
 * any structural detail to play the visitor. If a future scenario needs
 * those, extend here.
 */
export interface ConversationTurn {
  readonly user: string;
  readonly agent: string;
}

export const DEFAULT_USER_AGENT_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Minimal Anthropic client surface the user-agent depends on. Matches the
 * shape of the real SDK's `messages.create` for non-streaming requests.
 * Narrow on purpose so tests can stub it without dragging in the SDK's
 * deep type graph.
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

export interface UserAgentDeps {
  readonly client: AnthropicLike;
  readonly persona: string;
  readonly goal: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface NextMessageRequest {
  /** Full transcript so far. Empty on the first turn. */
  readonly transcript: readonly ConversationTurn[];
  /**
   * The most-recent assistant utterance the user-agent should react to.
   * Optional on the very first turn (there's no assistant yet) — the
   * user-agent generates an opener from persona + goal alone.
   */
  readonly latestAgentResponse?: string;
}

// ---------------------------------------------------------------------------
// Prompt construction.
// ---------------------------------------------------------------------------

/**
 * Build the system prompt the user-agent operates under. Keeping this in a
 * named function makes it testable + lets future scenarios override
 * substring expectations cleanly.
 */
export function buildSystemPrompt(persona: string, goal: string): string {
  return [
    'You are roleplaying a website visitor talking to Swoop Adventures\' AI assistant.',
    '',
    'Your character is described below. Stay in character at all times. Output ONLY the message you would send as this visitor — no narration, no quotes, no stage directions, no meta-commentary. Just the words you would type into the chat.',
    '',
    '--- Your character ---',
    persona.trim(),
    '',
    '--- Your goal in this conversation ---',
    goal.trim(),
    '',
    'Stay natural and human. React to what the assistant just said. Ask the questions a person with your character would actually ask. Do not break character to comment on the assistant\'s performance, the test, or yourself.',
  ].join('\n');
}

/**
 * Translate the conversation transcript (orchestrator-perspective: who said
 * what) into the role-flipped `messages` array the user-agent's LLM expects.
 *
 * Role-flip:
 *   - The visitor we are playing speaks as `assistant` in this LLM's eyes.
 *   - The Swoop agent replies are `user` — that's the environment talking
 *     back to us.
 *
 * On the very first turn (empty transcript, no latestAgentResponse), we
 * still need at least one `user`-role message because Anthropic's Messages
 * API requires the conversation to start with a user turn. We seed it with
 * a short directive ("It's your turn — what do you want to ask first?").
 */
export function buildMessages(
  transcript: readonly ConversationTurn[],
  latestAgentResponse: string | undefined,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // First-turn opener: no prior conversation. Kick the user-agent with a
  // simple "your move" prompt so Anthropic accepts the request.
  if (transcript.length === 0 && !latestAgentResponse) {
    out.push({
      role: 'user',
      content:
        "It's your turn. What do you want to say to the assistant first? Output only the message you would send — no narration.",
    });
    return out;
  }

  // Replay historical turns role-flipped. The orchestrator's `user` line is
  // what we said previously, so it becomes our `assistant` history.
  for (const t of transcript) {
    out.push({ role: 'assistant', content: t.user });
    out.push({ role: 'user', content: t.agent });
  }

  // Append the latest assistant response (the one we have NOT yet replied
  // to). The transcript stores past completed turns only.
  if (latestAgentResponse !== undefined) {
    out.push({ role: 'user', content: latestAgentResponse });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Stateless next-message generator. Reusable across turns; the caller
 * supplies the transcript so the runner stays the system of record for
 * conversation state.
 */
export class UserAgent {
  private readonly client: AnthropicLike;
  private readonly persona: string;
  private readonly goal: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly systemPrompt: string;

  constructor(deps: UserAgentDeps) {
    if (!deps.persona || deps.persona.trim().length === 0) {
      throw new Error('UserAgent requires a non-empty persona.');
    }
    if (!deps.goal || deps.goal.trim().length === 0) {
      throw new Error('UserAgent requires a non-empty goal.');
    }
    this.client = deps.client;
    this.persona = deps.persona;
    this.goal = deps.goal;
    this.model = deps.model ?? DEFAULT_USER_AGENT_MODEL;
    // 600 tokens per user message is plenty — even verbose-rambling personas
    // rarely exceed 200 words. Tunable if Cluster-5 verbose personas hit it.
    this.maxTokens = deps.maxTokens ?? 600;
    // Mid-range temperature: enough variety to feel human, not so much that
    // the persona drifts. The persona itself anchors style; temperature
    // shouldn't be doing the heavy lifting.
    this.temperature = deps.temperature ?? 0.8;
    this.systemPrompt = buildSystemPrompt(this.persona, this.goal);
  }

  /**
   * Generate the next user message. Returns the message text verbatim, with
   * surrounding whitespace trimmed. Empty / whitespace-only output throws
   * — a user-agent that refuses to speak is a bug worth surfacing loudly.
   */
  async nextMessage(req: NextMessageRequest): Promise<string> {
    const messages = buildMessages(req.transcript, req.latestAgentResponse);
    const res = await this.client.messages.create({
      model: this.model,
      system: this.systemPrompt,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    });
    const text = extractTextContent(res.content);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error(
        `[user-agent] model returned no text content (model=${this.model}). Persona may be triggering a refusal.`,
      );
    }
    return trimmed;
  }
}

/**
 * Concatenate every `text`-typed block in a content array. Tolerant of the
 * SDK's content-block discriminator: anything without `type: 'text'` is
 * ignored, anything with text shape gets joined verbatim.
 */
function extractTextContent(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
}

// Re-export termination type for convenience — runner + stop-judge both want
// it; co-locating the import path keeps the runner's import surface tidy.
export type { TerminationCriteria };
