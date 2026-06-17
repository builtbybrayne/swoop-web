/**
 * Memory agent factory (sm-1, sm-9, T3-3).
 *
 * Builds the Opus memory agent — a SEPARATE agent from the conversational
 * (Sonnet) orchestrator. It runs in its own isolated session (sm-9) so the
 * memory-management dialogue NEVER pollutes the staff member's test
 * conversation.
 *
 * Key invariants:
 *   - Same base prompt as the conversational agent (faithful context).
 *   - Plus a thin memory-mode wrapper (TODO(T3-5): voice/content pass by Al).
 *   - Plus the memory CRUD tools (exposed ONLY on this agent — never to visitors).
 *   - Model is a CONFIG value (decision B.5) — default claude-opus-4-8 but
 *     swappable without a code fork. The conversational agent is unchanged.
 *   - No SkillToolset — skills are conversational UX, not relevant to memory
 *     authoring. The base prompt already provides the product context the agent
 *     needs to reason about what to store.
 *
 * Seeding (sm-9 outcome):
 *   The memory agent receives the conversation-so-far via a TRANSCRIPT-SEEDED
 *   SEPARATE session. The orchestrator calls `seedMemorySession` once when
 *   entering memory mode: it creates a fresh InMemoryRunner session, then runs
 *   one synthetic "user" turn whose content is the transcript summary. Multi-turn
 *   memory iteration accumulates in the memory session; the test conversation's
 *   ADK event log stays completely clean.
 *
 * finish_memory (sm-3):
 *   The memory agent has access to a `finish_memory` FunctionTool. When it
 *   emits this tool call, the orchestrator intercepts it in the stream,
 *   flips session.mode back to 'conversation', and closes the memory session.
 *   The tool call itself is never forwarded to the connector — it is an
 *   orchestrator-internal signal.
 */

import {
  InMemoryRunner,
  LlmAgent,
  FunctionTool,
  type Runner,
} from '@google/adk';
import type { Content } from '@google/genai';
import { z } from 'zod';

import type { Config } from '../config/index.js';
import type { PromptLoader } from './prompt-loader.js';
import { ClaudeLlm } from './claude-llm.js';
import type { ConnectorClient } from '../connector/client.js';
import { buildMemoryTools } from '../connector/memory-tools.js';

/**
 * Default Opus model id for the memory agent (decision B.5 — config value,
 * not hardcoded). Can be overridden via MEMORY_AGENT_MODEL env var.
 */
export const DEFAULT_MEMORY_AGENT_MODEL = 'claude-opus-4-8';

/**
 * App name for the memory agent's isolated ADK session. Kept distinct from
 * the orchestrator's app name so ADK never conflates the two session scopes.
 */
export const MEMORY_AGENT_APP_NAME = 'puma-memory-agent';

/**
 * User id for memory agent sessions — same anonymous sentinel as the
 * orchestrator, since session isolation is by appName + sessionId.
 */
export const MEMORY_AGENT_USER_ID = 'staff';

// ---------------------------------------------------------------------------
// Memory-mode wrapper prompt.
//
// TODO(T3-5): This is a minimal placeholder. The voice/content pass is Al's
// editorial domain (G.7) and will be done as a separate T3-5 task. Do NOT
// polish this copy here.
//
// The placeholder communicates the critical behavioural rules:
//   1. You are in memory-management mode, not discovery mode.
//   2. You have CRUD tools for the memory store.
//   3. Confirm before saving — never write without an explicit yes.
//   4. When memory work is done, call finish_memory to return to the agent.
//   5. Do NOT describe specific past customers in memories (content hygiene).
// ---------------------------------------------------------------------------

export const MEMORY_MODE_WRAPPER = `
---

## TODO(T3-5): MEMORY MODE — placeholder wrapper (voice pass required)

You are currently in MEMORY MANAGEMENT MODE. The staff member wants to author,
edit, or review agent memories — facts you will persist so every future visitor
conversation loads them as authoritative knowledge.

RULES FOR THIS MODE:
1. You have memory CRUD tools: memory_store, memory_edit, memory_retire,
   memory_list_active, memory_show_history. Use them to carry out the request.
2. ALWAYS confirm before saving. Before calling memory_store or memory_edit,
   show the staff member what you're about to save and ask "Save this? (yes/no)".
   Only call the tool after an explicit yes.
3. DO NOT write memories about specific past customers. Memories must be
   general sales knowledge (e.g. seasonality, refugio availability, price
   ranges) — never descriptions of individual visitors.
4. When the memory work is done (the staff member says "done", "thanks",
   "back to testing", or returns to a visitor question), call finish_memory
   immediately. Also call it if unsure — it's recoverable.
5. If the staff member asks a discovery question (about destinations, trips,
   pricing), answer briefly then offer to return: "Shall I go back to the
   agent now?"

The conversation transcript so far is your context. The staff member can see
the same chat window — pick up naturally from where the conversation left off.
`.trim();

// ---------------------------------------------------------------------------
// finish_memory FunctionTool — orchestrator-internal signal.
//
// The orchestrator intercepts this tool call in the memory-agent stream and
// flips session.mode back to 'conversation'. It is never forwarded to the
// connector.
// ---------------------------------------------------------------------------

export const FINISH_MEMORY_TOOL_NAME = 'finish_memory';

/**
 * Build the finish_memory FunctionTool for wiring into the memory agent.
 * The execute callback is a no-op — the orchestrator intercepts the tool-call
 * event in the stream BEFORE ADK executes it (by reading the SSE parts), so
 * this callback is only reached in test scenarios that drive the agent directly.
 */
export function buildFinishMemoryTool(): FunctionTool {
  const inputSchema = z
    .object({
      summary: z.string().max(200).optional(),
    })
    .strict() as unknown as never;

  return new FunctionTool({
    name: FINISH_MEMORY_TOOL_NAME,
    description:
      'Signal that memory work is complete. Call this when the staff member ' +
      'has finished managing memories and you should hand back to the ' +
      'conversational agent. Also call if you are unsure whether to continue ' +
      'in memory mode — it is low-stakes and recoverable.',
    parameters: inputSchema,
    execute: async (_input: unknown) => {
      // The orchestrator intercepts this in the stream; this path is only
      // reached in unit tests driving the agent directly.
      return { status: 'ok' };
    },
  });
}

// ---------------------------------------------------------------------------
// Memory agent build result.
// ---------------------------------------------------------------------------

export interface BuildMemoryAgentResult {
  /**
   * The Opus memory agent. The caller creates a fresh InMemoryRunner per
   * memory session (sm-9: isolated session, not shared with Sonnet).
   */
  readonly agent: LlmAgent;
  /**
   * Factory: create a fresh Runner + seed it with the conversation transcript.
   * Returns the seeded Runner ready for the first staff memory turn.
   *
   * The seeding works via a synthetic "context" user turn (sm-9): the runner
   * starts a new ADK session, and the first real user message from the
   * orchestrator carries the transcript summary so the agent has context.
   * This is exactly the sm-9 spike outcome — no ADK event-seeding needed,
   * just a rich first message.
   */
  readonly createSeededRunner: (params: {
    sessionId: string;
    transcriptSummary: string;
  }) => Promise<{ runner: Runner; sessionId: string }>;
}

export interface BuildMemoryAgentParams {
  readonly config: Config;
  readonly promptLoader: PromptLoader;
  readonly connectorClient: ConnectorClient;
  /**
   * Staff token to thread through to the connector's memory tools (sm-4 dual
   * backstop). The token is bound at agent-build time per memory session; it
   * was already validated by the orchestrator before entering memory mode.
   */
  readonly staffToken: string;
  /**
   * Staff member name (from JWT claim) for attribution in memory records.
   */
  readonly staffName: string;
}

/**
 * Build the Opus memory agent.
 *
 * Called ONCE when the orchestrator first enters memory mode for a staff
 * session. The result is used for the duration of that memory session; a new
 * call on each memory-mode entry ensures a clean state.
 *
 * Not async — memory tools are synchronous wrappers over the connector client,
 * and the agent is stateless (the runner holds all state).
 */
export function buildMemoryAgent({
  config,
  promptLoader,
  connectorClient,
  staffToken,
  staffName,
}: BuildMemoryAgentParams): BuildMemoryAgentResult {
  const memoryModel = config.MEMORY_AGENT_MODEL ?? DEFAULT_MEMORY_AGENT_MODEL;

  const llm = new ClaudeLlm({
    model: memoryModel,
    apiKey: config.ANTHROPIC_API_KEY,
    // Memory authoring benefits from slightly more deliberate, less random
    // output — lower temperature than the conversational agent.
    temperature: 0.3,
    maxTokens: 2048,
  });

  // Memory CRUD tools — bound to this staff session's token/name (sm-4).
  // finish_memory is orchestrator-internal and never forwarded to the connector.
  const memoryTools = buildMemoryTools({
    client: connectorClient,
    staffToken,
    staffName,
  });

  const finishMemoryTool = buildFinishMemoryTool();

  const agent = new LlmAgent({
    name: 'puma_memory_agent',
    description:
      'Puma memory management agent (Opus). Staff-session-only. Runs in an isolated ' +
      'session seeded with the conversation transcript. Never reaches visitors.',
    model: llm,
    // InstructionProvider: base prompt (same product context as the
    // conversational agent) + the memory-mode wrapper (TODO(T3-5): voice pass).
    instruction: () => `${promptLoader.load()}\n\n${MEMORY_MODE_WRAPPER}`,
    // Memory CRUD tools + the finish_memory handback signal.
    // No SkillToolset — skills are discovery UX, irrelevant here.
    tools: [...memoryTools, finishMemoryTool],
  });

  /**
   * createSeededRunner: build a fresh isolated Runner + seed it via a
   * synthetic first user message carrying the conversation transcript.
   *
   * sm-9: The memory agent runs in its OWN session, not the shared ADK
   * session. This is the critical isolation that keeps the memory-management
   * dialogue out of the Sonnet conversational event log.
   */
  const createSeededRunner = async (params: {
    sessionId: string;
    transcriptSummary: string;
  }): Promise<{ runner: Runner; sessionId: string }> => {
    const memorySessionId = `${params.sessionId}__memory`;

    // Fresh InMemoryRunner per memory session — isolated from the
    // conversational runner (sm-9). The conversational runner's
    // InMemoryRunner / PgAdkSessionService is untouched.
    const runner = new InMemoryRunner({
      agent,
      appName: MEMORY_AGENT_APP_NAME,
    });

    // Seed the memory session so ADK knows it exists.
    await runner.sessionService.createSession({
      appName: MEMORY_AGENT_APP_NAME,
      userId: MEMORY_AGENT_USER_ID,
      sessionId: memorySessionId,
      state: {},
    });

    // Seed with the conversation transcript via the first synthetic message
    // (sm-9 spike outcome: no ADK event-seeding needed — just a rich first
    // user message the agent sees as conversational context).
    const seedMessage: Content = {
      role: 'user',
      parts: [
        {
          text:
            `[CONTEXT: You are now in memory management mode for a staff session. ` +
            `Here is the conversation so far between the staff member and the agent:\n\n` +
            `${params.transcriptSummary}\n\n` +
            `The staff member's next message will be their memory instruction.]`,
        },
      ],
    };

    // Consume the seed turn (agent's response to the context summary — may
    // be brief acknowledgement or silent). We drain the stream but don't
    // surface any of it to the user. This ensures ADK has the context in
    // the session's event log before the real staff turn arrives.
    const seedStream = runner.runAsync({
      userId: MEMORY_AGENT_USER_ID,
      sessionId: memorySessionId,
      newMessage: seedMessage,
    });
    // Drain the seed stream (we don't surface seed-turn output to the staff).
    for await (const _event of seedStream) {
      // intentionally empty — consume and discard
    }

    return { runner, sessionId: memorySessionId };
  };

  return { agent, createSeededRunner };
}

// ---------------------------------------------------------------------------
// Transcript summary builder.
//
// Produces a compact, readable summary of the conversation history for
// seeding the memory session. Keeps the context window small.
// ---------------------------------------------------------------------------

/**
 * Build a compact transcript summary from session conversation history entries.
 * Used to seed the memory agent's session so it has context (sm-9).
 */
export function buildTranscriptSummary(
  conversationHistory: ReadonlyArray<{
    role: string;
    blockType: string;
    text: string;
    turnIndex: number;
  }>,
): string {
  if (conversationHistory.length === 0) {
    return '(No conversation history yet — this is the start of the session.)';
  }

  // Include user messages and agent utter blocks (the visible conversation).
  // Skip reasoning, adjunct (tool calls), fyi — keep it readable.
  const visible = conversationHistory
    .filter(
      (e) =>
        e.blockType === 'user_message' ||
        e.blockType === 'utter',
    )
    .slice(-20); // cap at last 20 visible entries to keep context manageable

  if (visible.length === 0) {
    return '(Conversation exists but has no visible user/agent turns yet.)';
  }

  const lines = visible.map((e) => {
    const speaker = e.role === 'user' ? 'Staff member' : 'Agent';
    return `${speaker}: ${e.text.slice(0, 300)}${e.text.length > 300 ? '…' : ''}`;
  });

  return lines.join('\n\n');
}
