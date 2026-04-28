/**
 * EventCapture — pluggable source of orchestrator events for the harness.
 *
 * Why this exists:
 *   H.t3 introduces event-based assertions (`handoff_event`, `disclosure_event`,
 *   plus indirect support for `triage_verdict` via `triage.decided`). The
 *   orchestrator emits structured events via `emitEvent` (F-a / F-b); the
 *   default sink writes one JSON line per event to stdout. The harness needs
 *   to read those events back to evaluate assertions.
 *
 * Choice of mechanism:
 *   The H.t3 brief said "the harness in CI starts the orchestrator as a child
 *   process, capturing stdout is straightforward". On closer inspection that's
 *   not how the scaffold landed: the harness CLI does NOT spawn the
 *   orchestrator (locally OR in CI per `.github/workflows/harness.yml`) — it
 *   speaks HTTP to a separately-started `:8080`. Threading orchestrator stdout
 *   capture into the harness CLI would require either (a) the harness owns
 *   the orchestrator child process (a bigger architectural shift than H.t3
 *   warrants), or (b) some side-channel (request-id correlation header +
 *   in-memory event collector on the orchestrator side, behind an eval-only
 *   route). Both are out of scope for the assertion catalogue.
 *
 *   The pragmatic compromise: model `EventCapture` as an interface with three
 *   implementations:
 *
 *     1. `MemoryEventCapture` — push events into a buffer; tests inject this
 *        directly. **This is the workhorse for H.t3's unit tests.**
 *     2. `NullEventCapture` — `eventsForSession()` always returns []. The CLI
 *        defaults to this so event-based assertions cleanly fail (or pass if
 *        polarity-inverted with `present: false`) without requiring extra
 *        wiring. Real CI scenarios that need event assertions will adopt one
 *        of the two below.
 *     3. `StreamingEventCapture` — accepts a Node.js `Readable` stream of
 *        newline-delimited JSON (the orchestrator's stdout when run as a
 *        child process); parses each line, validates against `EventSchema`,
 *        appends to an in-memory buffer keyed by sessionId. An outer harness
 *        runner (e.g. `scripts/run-with-orchestrator.sh` or a future
 *        `cli-with-orchestrator.ts`) wires it. Today no caller does — but the
 *        wiring is one `cli.ts` swap away.
 *
 *   Decision recorded as **H.14** in `planning/decisions.md`.
 *
 * Contract:
 *   `eventsForSession(sessionId)` returns events whose envelope `sessionId`
 *   matches. Events without a sessionId are excluded (they exist —
 *   `system`-actor events without a session — but H.t3's assertions are all
 *   per-session). Order is the order the events arrived at the capture; the
 *   `MemoryEventCapture#push` API plus the streaming sink both preserve
 *   arrival order.
 */

import { EventSchema, type Event } from '@swoop/common';

export interface EventCapture {
  /**
   * All events seen so far for the given session, in arrival order.
   * Implementations are free to return references to internal state — callers
   * must NOT mutate the returned array.
   */
  eventsForSession(sessionId: string): readonly Event[];
}

/**
 * Always-empty capture — the CLI's default. Event-based assertions will fail
 * (with a "no event captured" message) unless the scenario's polarity is
 * inverted (`present: false`).
 */
export class NullEventCapture implements EventCapture {
  eventsForSession(_sessionId: string): readonly Event[] {
    return [];
  }
}

/**
 * In-memory capture — tests push events directly.
 *
 * Also doubles as the buffer for `StreamingEventCapture` so the two share
 * one bucket of state.
 */
export class MemoryEventCapture implements EventCapture {
  private readonly events: Event[] = [];

  push(event: Event): void {
    this.events.push(event);
  }

  /**
   * Push from raw structured input. Validates against `EventSchema` first;
   * malformed events are discarded silently (the harness should not be more
   * strict than the producer's own `emitEvent` fallback). Returns true on
   * accept, false on reject.
   */
  pushRaw(raw: unknown): boolean {
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) return false;
    this.events.push(parsed.data);
    return true;
  }

  /** Drop everything. Test hygiene helper. */
  clear(): void {
    this.events.length = 0;
  }

  /** All captured events, in arrival order. Diagnostic / test helper. */
  all(): readonly Event[] {
    return this.events;
  }

  eventsForSession(sessionId: string): readonly Event[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
}

/**
 * Stream-fed capture — wraps a Node `Readable` of newline-delimited JSON
 * (i.e. the orchestrator's stdout when spawned as a child process). Each
 * line is JSON.parsed, validated against `EventSchema`, and pushed into an
 * underlying `MemoryEventCapture`. Bad lines are silently ignored — the
 * orchestrator's own `emitEvent` ensures every line on stdout is a valid
 * event JSON, but boot-time non-event log lines (e.g. early `console.error`
 * before the sink swap) need to be tolerated.
 *
 * Lifetime: callers are responsible for keeping the stream open for the
 * duration of the run; closing the stream stops capture but does not
 * invalidate the buffered events. There is no `dispose` because the buffer
 * is a per-run object that's discarded with the harness process.
 */
export class StreamingEventCapture implements EventCapture {
  private readonly memory = new MemoryEventCapture();

  constructor(stream?: NodeJS.ReadableStream) {
    if (stream) this.attach(stream);
  }

  /** Attach to a Readable stream of newline-delimited JSON event records. */
  attach(stream: NodeJS.ReadableStream): void {
    let buffer = '';
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (line.length === 0) continue;
        this.consumeLine(line);
      }
    });
    stream.on('end', () => {
      const tail = buffer.trim();
      buffer = '';
      if (tail.length > 0) this.consumeLine(tail);
    });
  }

  private consumeLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    this.memory.pushRaw(parsed);
  }

  eventsForSession(sessionId: string): readonly Event[] {
    return this.memory.eventsForSession(sessionId);
  }

  /** Test / diagnostic helper. */
  all(): readonly Event[] {
    return this.memory.all();
  }
}
