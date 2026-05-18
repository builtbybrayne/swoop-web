/**
 * view-transcript.ts — render a per-scenario JSONL event stream as a
 * self-contained HTML document an operator can open in any browser.
 *
 * The streaming JSONL (per planning/03-exec-h-t8-streaming-fix.md) is
 * correct: every observable event appended the instant it happens. That's
 * the right substrate for forensic inspection but dense to read. This view
 * collates SSE text frames into one Agent bubble per turn, shows the
 * Visitor/Agent conversation as the default surface, and tucks raw detail
 * (user-agent thinking, stop-judge decisions, tool-call args, raw event
 * dump) behind native <details> collapsibles.
 *
 * Pure function: takes an event array, returns an HTML string. No I/O.
 * Tests inject a fixture event array directly.
 *
 * Per planning/03-exec-h-t8-transcript-view.md Task 2 (HITL-ratified
 * 2026-05-18). Self-contained HTML: inline CSS, no external assets, no JS.
 */

import type {
  AgentResponseAggregatedEvent,
  AgentSseFrameEvent,
  AssertionEvaluatedEvent,
  ConsentGrantedEvent,
  ErrorEvent,
  HarnessEvent,
  JudgeInvokedEvent,
  JudgeRespondedEvent,
  ScenarioCompletedEvent,
  ScenarioStartedEvent,
  SessionCreatedEvent,
  StopJudgeInvokedEvent,
  StopJudgeRespondedEvent,
  TimeoutEvent,
  UserAgentInvokedEvent,
  UserAgentRespondedEvent,
  UserMessageSentEvent,
} from './events.js';

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Build a complete HTML document from a sequence of harness events.
 * Returns a string. Caller writes it to disk (cli-view.ts) or pipes
 * elsewhere.
 */
export function viewTranscript(events: readonly HarnessEvent[]): string {
  const model = buildViewModel(events);
  return renderDocument(model);
}

// ---------------------------------------------------------------------------
// View model — extract structured view state from the event stream.
// ---------------------------------------------------------------------------

interface ViewTurn {
  readonly turnIndex: number;
  readonly userMessage: string | null;
  readonly agentText: string;
  readonly toolCalls: ReadonlyArray<{ toolName: string; input: unknown }>;
  readonly userAgentInvoked?: UserAgentInvokedEvent;
  readonly userAgentResponded?: UserAgentRespondedEvent;
  readonly stopJudgeInvoked?: StopJudgeInvokedEvent;
  readonly stopJudgeResponded?: StopJudgeRespondedEvent;
  readonly agentResponseAggregated?: AgentResponseAggregatedEvent;
  readonly turnStartedAt?: string;
  readonly inlineEvents: ReadonlyArray<ErrorEvent | TimeoutEvent>;
}

interface ViewModel {
  readonly scenarioName: string;
  readonly file: string | null;
  readonly status: 'passed' | 'failed' | 'errored' | 'unknown';
  readonly shape: 'scripted' | 'agent' | 'unknown';
  readonly durationMs: number | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly summary: string | null;
  readonly sessionCreated?: SessionCreatedEvent;
  readonly consentGranted?: ConsentGrantedEvent;
  readonly scenarioCompleted?: ScenarioCompletedEvent;
  readonly turns: ReadonlyArray<ViewTurn>;
  readonly assertions: ReadonlyArray<AssertionEvaluatedEvent>;
  /** Judge invocations keyed by their position in the stream — folded into assertions in render. */
  readonly judgeInvocations: ReadonlyArray<{
    invoked: JudgeInvokedEvent;
    responded?: JudgeRespondedEvent;
  }>;
  /** Scenario-level errors (not inside a turn). */
  readonly errors: ReadonlyArray<ErrorEvent>;
  /** Every event verbatim — for the raw dump at the bottom. */
  readonly rawEvents: ReadonlyArray<HarnessEvent>;
}

function buildViewModel(events: readonly HarnessEvent[]): ViewModel {
  let started: ScenarioStartedEvent | undefined;
  let completed: ScenarioCompletedEvent | undefined;
  let sessionCreated: SessionCreatedEvent | undefined;
  let consentGranted: ConsentGrantedEvent | undefined;

  const turnMap = new Map<number, MutableTurn>();
  const assertions: AssertionEvaluatedEvent[] = [];
  const judgeInvocations: { invoked: JudgeInvokedEvent; responded?: JudgeRespondedEvent }[] = [];
  const scenarioErrors: ErrorEvent[] = [];

  function getTurn(idx: number): MutableTurn {
    let t = turnMap.get(idx);
    if (!t) {
      t = {
        turnIndex: idx,
        userMessage: null,
        agentTextParts: [],
        toolCalls: [],
        inlineEvents: [],
      };
      turnMap.set(idx, t);
    }
    return t;
  }

  for (const e of events) {
    switch (e.kind) {
      case 'scenario.started':
        started = e;
        break;
      case 'session.created':
        sessionCreated = e;
        break;
      case 'consent.granted':
        consentGranted = e;
        break;
      case 'scenario.completed':
        completed = e;
        break;
      case 'user_agent.invoked':
        getTurn(e.turnIndex).userAgentInvoked = e;
        break;
      case 'user_agent.responded':
        getTurn(e.turnIndex).userAgentResponded = e;
        break;
      case 'user.message.sent': {
        const t = getTurn(e.turnIndex);
        t.userMessage = e.message;
        if (!t.turnStartedAt) t.turnStartedAt = e.ts;
        break;
      }
      case 'agent.sse.frame': {
        const t = getTurn(e.turnIndex);
        if (!t.turnStartedAt) t.turnStartedAt = e.ts;
        if (e.partType === 'text' && typeof e.text === 'string') {
          t.agentTextParts.push(e.text);
        } else if (e.partType === 'tool-call' && typeof e.toolName === 'string') {
          t.toolCalls.push({ toolName: e.toolName, input: e.toolInput });
        }
        // Other frame events (done/error, fyi, etc.) are surfaced only in the
        // raw block — not in the conversation view.
        break;
      }
      case 'agent.response.aggregated':
        getTurn(e.turnIndex).agentResponseAggregated = e;
        break;
      case 'stop_judge.invoked':
        getTurn(e.turnIndex).stopJudgeInvoked = e;
        break;
      case 'stop_judge.responded':
        getTurn(e.turnIndex).stopJudgeResponded = e;
        break;
      case 'assertion.evaluated':
        assertions.push(e);
        break;
      case 'judge.invoked':
        judgeInvocations.push({ invoked: e });
        break;
      case 'judge.responded': {
        // Attach to the most recent un-responded invocation.
        const last = judgeInvocations[judgeInvocations.length - 1];
        if (last && !last.responded) {
          last.responded = e;
        } else {
          // Orphan responded — record as a fake invocation/responded pair.
          judgeInvocations.push({
            invoked: {
              kind: 'judge.invoked',
              ts: e.ts,
              scenarioName: e.scenarioName,
              rubric: '(unknown — orphan judge.responded)',
              finalUtterance: '',
              model: '(unknown)',
            },
            responded: e,
          });
        }
        break;
      }
      case 'error': {
        if (typeof e.turnIndex === 'number') {
          getTurn(e.turnIndex).inlineEvents.push(e);
        } else {
          scenarioErrors.push(e);
        }
        break;
      }
      case 'timeout': {
        if (typeof e.turnIndex === 'number') {
          getTurn(e.turnIndex).inlineEvents.push(e);
        }
        break;
      }
    }
  }

  const sortedTurnIndices = [...turnMap.keys()].sort((a, b) => a - b);
  const turns: ViewTurn[] = sortedTurnIndices.map((idx) => {
    const t = turnMap.get(idx)!;
    return {
      turnIndex: t.turnIndex,
      userMessage: t.userMessage,
      agentText: t.agentTextParts.join(''),
      toolCalls: t.toolCalls,
      userAgentInvoked: t.userAgentInvoked,
      userAgentResponded: t.userAgentResponded,
      stopJudgeInvoked: t.stopJudgeInvoked,
      stopJudgeResponded: t.stopJudgeResponded,
      agentResponseAggregated: t.agentResponseAggregated,
      turnStartedAt: t.turnStartedAt,
      inlineEvents: t.inlineEvents,
    };
  });

  const status = completed?.status ?? 'unknown';
  return {
    scenarioName:
      started?.scenarioName ?? events[0]?.scenarioName ?? '(unknown scenario)',
    file: started?.file ?? null,
    status,
    shape: started?.scenarioShape ?? 'unknown',
    durationMs: completed?.durationMs ?? null,
    startedAt: started?.ts ?? null,
    completedAt: completed?.ts ?? null,
    summary: completed?.summary ?? null,
    sessionCreated,
    consentGranted,
    scenarioCompleted: completed,
    turns,
    assertions,
    judgeInvocations,
    errors: scenarioErrors,
    rawEvents: events,
  };
}

interface MutableTurn {
  turnIndex: number;
  userMessage: string | null;
  agentTextParts: string[];
  toolCalls: { toolName: string; input: unknown }[];
  userAgentInvoked?: UserAgentInvokedEvent;
  userAgentResponded?: UserAgentRespondedEvent;
  stopJudgeInvoked?: StopJudgeInvokedEvent;
  stopJudgeResponded?: StopJudgeRespondedEvent;
  agentResponseAggregated?: AgentResponseAggregatedEvent;
  turnStartedAt?: string;
  inlineEvents: (ErrorEvent | TimeoutEvent)[];
}

// ---------------------------------------------------------------------------
// HTML rendering.
// ---------------------------------------------------------------------------

function renderDocument(model: ViewModel): string {
  const title = `${escapeHtml(model.scenarioName)} · transcript`;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
    '<body>',
    '<main>',
    renderHeader(model),
    renderLifecycle(model),
    renderConversation(model),
    renderAssertions(model),
    renderScenarioErrors(model),
    renderRawEvents(model),
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
}

function renderHeader(model: ViewModel): string {
  const badge = renderStatusBadge(model.status);
  const meta: string[] = [];
  if (model.file) meta.push(`<div><strong>File:</strong> <code>${escapeHtml(model.file)}</code></div>`);
  if (model.shape !== 'unknown')
    meta.push(`<div><strong>Shape:</strong> ${escapeHtml(model.shape)}</div>`);
  if (model.durationMs !== null)
    meta.push(`<div><strong>Duration:</strong> ${(model.durationMs / 1000).toFixed(2)}s</div>`);
  if (model.startedAt) meta.push(`<div><strong>Started:</strong> ${formatTimestamp(model.startedAt)}</div>`);
  if (model.completedAt)
    meta.push(`<div><strong>Completed:</strong> ${formatTimestamp(model.completedAt)}</div>`);
  return [
    '<header>',
    `<h1>${escapeHtml(model.scenarioName)} ${badge}</h1>`,
    `<div class="meta">${meta.join('')}</div>`,
    '</header>',
  ].join('');
}

function renderStatusBadge(status: ViewModel['status']): string {
  const map: Record<ViewModel['status'], string> = {
    passed: 'pass',
    failed: 'fail',
    errored: 'error',
    unknown: 'unknown',
  };
  const cls = map[status];
  return `<span class="badge badge-${cls}">${escapeHtml(status.toUpperCase())}</span>`;
}

function renderLifecycle(model: ViewModel): string {
  const items: string[] = [];
  if (model.sessionCreated) {
    items.push(
      `<li>${formatTimestamp(model.sessionCreated.ts)} — <strong>Session created:</strong> <code>${escapeHtml(model.sessionCreated.sessionId)}</code> · disclosure <code>${escapeHtml(model.sessionCreated.disclosureCopyVersion)}</code></li>`,
    );
  }
  if (model.consentGranted) {
    items.push(
      `<li>${formatTimestamp(model.consentGranted.ts)} — <strong>Consent granted:</strong> copy <code>${escapeHtml(model.consentGranted.copyVersion)}</code></li>`,
    );
  }
  if (model.scenarioCompleted) {
    items.push(
      `<li>${formatTimestamp(model.scenarioCompleted.ts)} — <strong>Scenario completed:</strong> ${escapeHtml(model.scenarioCompleted.status)} (${(model.scenarioCompleted.durationMs / 1000).toFixed(2)}s)</li>`,
    );
  }
  if (items.length === 0) return '';
  return [
    '<details class="lifecycle">',
    '<summary>Lifecycle</summary>',
    `<ul>${items.join('')}</ul>`,
    '</details>',
  ].join('');
}

function renderConversation(model: ViewModel): string {
  if (model.turns.length === 0) {
    return '<section class="conversation"><h2>Conversation</h2><p class="empty">(no turns captured)</p></section>';
  }
  return [
    '<section class="conversation">',
    '<h2>Conversation</h2>',
    model.turns.map(renderTurn).join('\n'),
    '</section>',
  ].join('\n');
}

function renderTurn(t: ViewTurn): string {
  const parts: string[] = [];
  parts.push(
    `<h3 class="turn-heading">Turn ${t.turnIndex}${t.turnStartedAt ? ` <span class="turn-ts">— ${formatTimestamp(t.turnStartedAt)}</span>` : ''}</h3>`,
  );

  // Optional user-agent details (agent-shape scenarios only).
  if (t.userAgentInvoked || t.userAgentResponded) {
    parts.push(renderUserAgentDetails(t.userAgentInvoked, t.userAgentResponded));
  }

  // Visitor bubble.
  if (t.userMessage !== null) {
    parts.push(
      `<div class="bubble bubble-visitor"><div class="bubble-role">Visitor</div><div class="bubble-text">${escapeHtml(t.userMessage)}</div></div>`,
    );
  }

  // Agent bubble.
  if (t.agentText.length > 0) {
    parts.push(
      `<div class="bubble bubble-agent"><div class="bubble-role">Agent</div><div class="bubble-text">${escapeHtml(t.agentText)}</div></div>`,
    );
  } else if (t.agentResponseAggregated) {
    // Edge: aggregated event reports utter text not surfaced via text-frame
    // events (shouldn't happen normally but defensive).
    parts.push(
      `<div class="bubble bubble-agent"><div class="bubble-role">Agent</div><div class="bubble-text">${escapeHtml(t.agentResponseAggregated.utterText)}</div></div>`,
    );
  }

  // Tool calls (collapsed with args).
  if (t.toolCalls.length > 0) {
    parts.push(renderToolCalls(t.toolCalls));
  }

  // Inline errors / timeouts.
  for (const ev of t.inlineEvents) {
    parts.push(renderInlineErrorOrTimeout(ev));
  }

  // Optional stop-judge details (agent-shape scenarios only).
  if (t.stopJudgeInvoked || t.stopJudgeResponded) {
    parts.push(renderStopJudgeDetails(t.stopJudgeInvoked, t.stopJudgeResponded));
  }

  return `<article class="turn">${parts.join('\n')}</article>`;
}

function renderUserAgentDetails(
  invoked: UserAgentInvokedEvent | undefined,
  responded: UserAgentRespondedEvent | undefined,
): string {
  const model = invoked?.model ?? responded?.anthropicRaw
    ? extractModelFromRaw(responded?.anthropicRaw) ?? invoked?.model ?? '(unknown)'
    : '(unknown)';
  const dur = responded ? `${(responded.durationMs / 1000).toFixed(2)}s` : '?';
  const summary = `user-agent · ${escapeHtml(String(model))} · ${dur}`;
  const body: string[] = [];
  if (invoked) {
    body.push(`<div><strong>Persona:</strong> <code>${escapeHtml(invoked.persona)}</code></div>`);
    body.push(`<div><strong>Goal:</strong> <code>${escapeHtml(invoked.goal)}</code></div>`);
  }
  if (responded) {
    body.push(`<div><strong>Generated message:</strong> <code>${escapeHtml(responded.message)}</code></div>`);
    body.push(`<details class="nested"><summary>Raw Anthropic response</summary><pre>${escapeHtml(prettyJson(responded.anthropicRaw))}</pre></details>`);
  }
  return [
    '<details class="ua">',
    `<summary>${summary}</summary>`,
    body.join(''),
    '</details>',
  ].join('');
}

function renderStopJudgeDetails(
  invoked: StopJudgeInvokedEvent | undefined,
  responded: StopJudgeRespondedEvent | undefined,
): string {
  const verdict = responded ? (responded.shouldStop ? 'YES (stop)' : 'NO (continue)') : '(no response)';
  const dur = responded ? `${(responded.durationMs / 1000).toFixed(2)}s` : '?';
  const model = invoked?.model ?? '(unknown)';
  const summary = `stop-judge · ${escapeHtml(verdict)} · ${escapeHtml(model)} · ${dur}`;
  const body: string[] = [];
  if (invoked) {
    body.push(`<div><strong>Latest agent response (snippet):</strong> <code>${escapeHtml(invoked.latestAgentResponse.slice(0, 200))}…</code></div>`);
  }
  if (responded) {
    body.push(`<details class="nested"><summary>Raw Anthropic response</summary><pre>${escapeHtml(prettyJson(responded.anthropicRaw))}</pre></details>`);
  }
  return [
    '<details class="sj">',
    `<summary>${summary}</summary>`,
    body.join(''),
    '</details>',
  ].join('');
}

function renderToolCalls(
  toolCalls: ReadonlyArray<{ toolName: string; input: unknown }>,
): string {
  const summary = toolCalls
    .map((tc) => tc.toolName)
    .reduce<Map<string, number>>((acc, name) => acc.set(name, (acc.get(name) ?? 0) + 1), new Map());
  const summaryLabel = [...summary.entries()]
    .map(([name, n]) => (n > 1 ? `${name} × ${n}` : name))
    .join(', ');
  const bodies = toolCalls
    .map(
      (tc) =>
        `<li><code>${escapeHtml(tc.toolName)}</code><pre>${escapeHtml(prettyJson(tc.input))}</pre></li>`,
    )
    .join('');
  return [
    '<details class="tool-calls">',
    `<summary>Tool calls (${toolCalls.length}) — ${escapeHtml(summaryLabel)}</summary>`,
    `<ul>${bodies}</ul>`,
    '</details>',
  ].join('');
}

function renderInlineErrorOrTimeout(ev: ErrorEvent | TimeoutEvent): string {
  if (ev.kind === 'error') {
    return `<blockquote class="error">⚠ <strong>Error</strong> at <code>${escapeHtml(ev.phase)}</code> — ${escapeHtml(ev.message)}</blockquote>`;
  }
  return `<blockquote class="timeout">⏱ <strong>Timeout</strong> at <code>${escapeHtml(ev.phase)}</code> after ${ev.timeoutMs}ms</blockquote>`;
}

function renderAssertions(model: ViewModel): string {
  if (model.assertions.length === 0) return '';
  // Build a map from rubric → judge invocation (if any) so we can attach
  // the raw judge response under judge_rubric assertion entries.
  const judgeByRubric = new Map<string, { invoked: JudgeInvokedEvent; responded?: JudgeRespondedEvent }>();
  for (const inv of model.judgeInvocations) {
    judgeByRubric.set(inv.invoked.rubric, inv);
  }
  const items = model.assertions
    .map((a) => {
      const icon = a.passed ? '✅' : '❌';
      const cls = a.passed ? 'pass' : 'fail';
      let extra = '';
      if (a.assertionKind === 'judge_rubric') {
        // Best-effort: surface the latest judge invocation's raw response if
        // exactly one exists, else attach the first match by rubric.
        const inv = model.judgeInvocations[0]; // simplification — judge_rubric assertions are typically 1:1
        if (inv?.responded) {
          extra = `<details class="nested"><summary>Raw judge response (${escapeHtml(inv.invoked.model)})</summary><pre>${escapeHtml(prettyJson(inv.responded.anthropicRaw))}</pre></details>`;
        }
      }
      return `<li class="assertion-${cls}"><span class="icon">${icon}</span> <code>${escapeHtml(a.assertionKind)}</code> — ${escapeHtml(a.reason)}${extra}</li>`;
    })
    .join('');
  return [
    '<section class="assertions">',
    '<h2>Assertions</h2>',
    `<ul>${items}</ul>`,
    '</section>',
  ].join('');
}

function renderScenarioErrors(model: ViewModel): string {
  if (model.errors.length === 0) return '';
  const items = model.errors
    .map(
      (e) =>
        `<blockquote class="error">⚠ <strong>Scenario error</strong> at <code>${escapeHtml(e.phase)}</code> — ${escapeHtml(e.message)}${e.stack ? `<details class="nested"><summary>Stack</summary><pre>${escapeHtml(e.stack)}</pre></details>` : ''}</blockquote>`,
    )
    .join('');
  return ['<section class="scenario-errors"><h2>Errors</h2>', items, '</section>'].join('');
}

function renderRawEvents(model: ViewModel): string {
  const lines = model.rawEvents
    .map((e) => escapeHtml(JSON.stringify(e)))
    .join('\n');
  return [
    '<details class="raw">',
    `<summary>Raw events (${model.rawEvents.length})</summary>`,
    `<pre>${lines}</pre>`,
    '</details>',
  ].join('');
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(ts: string): string {
  // Render the "HH:MM:SS.mmm" of an ISO timestamp for in-text use.
  // Full ISO is kept in the raw events block.
  const m = /T(\d{2}:\d{2}:\d{2}\.\d{3})Z$/.exec(ts);
  return m ? m[1] : ts;
}

function prettyJson(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function extractModelFromRaw(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = (raw as { model?: unknown }).model;
  return typeof m === 'string' ? m : undefined;
}

// ---------------------------------------------------------------------------
// Inline stylesheet.
// ---------------------------------------------------------------------------

const STYLES = `
  :root {
    --fg: #1a1a1a;
    --bg: #fafafa;
    --muted: #6b7280;
    --accent: #1d4ed8;
    --visitor-bg: #e8f1ff;
    --agent-bg: #f3f4f6;
    --pass: #16a34a;
    --fail: #dc2626;
    --error-bg: #fef2f2;
    --error-border: #dc2626;
    --code-bg: #f5f5f5;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--fg);
    background: var(--bg);
  }
  main {
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }
  header { margin-bottom: 1.5rem; }
  header h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
  header .meta { color: var(--muted); font-size: 0.9rem; }
  header .meta div { display: inline-block; margin-right: 1.5rem; }
  .badge {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 0.3rem;
    font-size: 0.75rem;
    font-weight: 600;
    vertical-align: middle;
    margin-left: 0.5rem;
  }
  .badge-pass { background: #dcfce7; color: var(--pass); }
  .badge-fail { background: #fee2e2; color: var(--fail); }
  .badge-error { background: #fef3c7; color: #b45309; }
  .badge-unknown { background: #e5e7eb; color: var(--muted); }

  h2 {
    font-size: 1.15rem;
    margin: 2rem 0 0.75rem;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.25rem;
  }
  h3.turn-heading {
    font-size: 1rem;
    margin: 1.5rem 0 0.5rem;
    color: var(--accent);
  }
  .turn-ts { color: var(--muted); font-weight: normal; font-size: 0.85rem; }

  .bubble {
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    border-radius: 0.5rem;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .bubble-visitor { background: var(--visitor-bg); }
  .bubble-agent { background: var(--agent-bg); }
  .bubble-role {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 0.35rem;
    font-weight: 600;
  }
  .bubble-text { font-size: 0.95rem; }

  details {
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 0.4rem;
  }
  details > summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.85rem;
    user-select: none;
  }
  details[open] > summary { margin-bottom: 0.5rem; }
  details.nested { background: #fafafa; }
  details.lifecycle, details.raw { margin-bottom: 1rem; }

  details.ua > summary { color: #7c3aed; }
  details.sj > summary { color: #0891b2; }
  details.tool-calls > summary { color: #ea580c; font-weight: 500; }

  pre {
    background: var(--code-bg);
    padding: 0.6rem 0.8rem;
    border-radius: 0.3rem;
    overflow-x: auto;
    font-size: 0.8rem;
    line-height: 1.4;
    margin: 0.4rem 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  code {
    background: var(--code-bg);
    padding: 0.05rem 0.3rem;
    border-radius: 0.2rem;
    font-size: 0.85em;
  }

  blockquote.error, blockquote.timeout {
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--error-border);
    background: var(--error-bg);
    border-radius: 0 0.3rem 0.3rem 0;
    font-size: 0.9rem;
  }
  blockquote.timeout { border-left-color: #f59e0b; background: #fffbeb; }

  .assertions ul { list-style: none; padding-left: 0; }
  .assertions li {
    padding: 0.4rem 0;
    border-bottom: 1px solid #eee;
    font-size: 0.95rem;
  }
  .assertions li:last-child { border-bottom: none; }
  .assertions .icon { margin-right: 0.4rem; }
  .assertion-pass { color: var(--fg); }
  .assertion-fail { color: var(--fg); }

  details.raw pre { font-size: 0.7rem; max-height: 60vh; overflow-y: auto; }

  .empty { color: var(--muted); font-style: italic; }
`;
