/**
 * Block parser — state-machine extraction of `<fyi>` blocks from a text stream.
 *
 * Spike outcome (decision B.9, decisions.md):
 *   Of the four Puma response-format block types (§2.5a) three map cleanly to
 *   ADK / genai natives:
 *     - `<reasoning>` -> ADK `THOUGHT` event + `Part.thought === true`
 *     - `<utter>`     -> ADK `CONTENT` event / `Part.text`
 *     - `<adjunct>`   -> ADK `TOOL_CALL` / `Part.functionCall`
 *   `<fyi>` has no native analogue — ADK's `ActivityEvent` is for runtime /
 *   status signals emitted by agents & tools, not model-authored side-channel
 *   notifications inline with visible output. So the parser's scope is ONE
 *   block type: `<fyi>`.
 *
 * Design constraints (planning/02-impl-agent-runtime.md §2.5a):
 *   - State-machine, NOT regex.
 *   - Accepts inline `<fyi>` (no newline required before/after).
 *   - Accepts 0, 1, or many blocks per stream.
 *   - Accepts partial blocks mid-stream (tag opened, not yet closed across
 *     multiple chunks).
 *   - A mention of `<fyi>` inside another block would naively confuse a
 *     depth-tracking parser; however, since we scope parsing to `<fyi>` only
 *     and the model's other block types ride native ADK channels (never
 *     reaching this parser's text stream), the "mention inside another block"
 *     failure mode does not apply to this narrower parser. The only textual
 *     concern is an `<fyi>` tag textually mentioned *inside* another `<fyi>`
 *     block — the parser treats nested `<fyi>` as literal text (flat — no
 *     depth counting) which is the desired UX.
 *   - Parser is resumable: call `feed(chunk)` any number of times, then
 *     `end()` once. Pending partial tags at `end()` are flushed as literal
 *     text (defensive — don't swallow data on a truncated stream).
 *
 * Emitted parts:
 *   - Text outside `<fyi>` blocks -> `TextPart` (type: 'text'). Coalesced per
 *     `feed()` call when possible (one TextPart per contiguous run).
 *   - Content inside `<fyi>...</fyi>` -> `CustomDataPart` (type: 'data-fyi')
 *     with `{ data: { message, timestamp } }` matching the shared schema in
 *     `@swoop/common`.
 *
 * Not in scope:
 *   - `<reasoning>`, `<utter>`, `<adjunct>` in free text — the prompt (chunk
 *     G) instructs the model to use ADK natives for those. If real-world
 *     behaviour shows the model emitting them as free text anyway, extend
 *     this parser then, guarded by a fresh decision log entry.
 *   - Attributes on the `<fyi>` tag (e.g. `<fyi severity="info">`). None
 *     today; extend the parser and the `DataFyiPart` schema together if that
 *     becomes a real requirement.
 */

import type { MessagePart, TextPart, DataFyiPart } from '@swoop/common';

/**
 * Internal state machine states.
 *
 * OUTSIDE : no tag in progress; accumulating text.
 * OPEN    : just saw `<`, looking for `fyi>` (open tag) or `/fyi>` (close) or
 *           other chars (revert to literal text).
 * INSIDE  : inside a `<fyi>` block, accumulating the message body.
 * CLOSE   : just saw `<` inside a block, looking for `/fyi>`.
 */
type State = 'OUTSIDE' | 'OPEN' | 'INSIDE' | 'CLOSE';

const OPEN_TAG = '<fyi>';
const CLOSE_TAG = '</fyi>';

export class BlockParser {
  private state: State = 'OUTSIDE';
  /** Buffer of text confirmed to be outside an `<fyi>` block. */
  private outsideBuf = '';
  /** Pending characters after `<` that might form an open/close tag. */
  private pendingTag = '';
  /** Buffer of content confirmed to be inside an `<fyi>` block. */
  private fyiBuf = '';
  /** Clock source for timestamps on emitted fyi parts; overridable for tests. */
  private readonly now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Feed a chunk of text. Returns the parts produced by consuming that chunk.
   * Parts may be empty (if the chunk ends mid-tag, the parser waits).
   */
  feed(chunk: string): MessagePart[] {
    const parts: MessagePart[] = [];
    for (const ch of chunk) {
      this.step(ch, parts);
    }
    // Only flush outside text at chunk boundary when the parser is settled
    // in OUTSIDE. If we're mid-tag (OPEN / CLOSE), the pending characters
    // may still turn out to be literal text that needs to coalesce with
    // outsideBuf into a single TextPart — defer flushing until the tag
    // resolves one way or the other.
    if (this.state === 'OUTSIDE') {
      this.flushOutside(parts);
    }
    return parts;
  }

  /**
   * Signal end of stream. Any unfinished tag buffer is flushed as literal
   * text; any open `<fyi>` body is flushed as a data-fyi part with whatever
   * content was accumulated (model truncated mid-block is rare but we don't
   * lose data).
   */
  end(): MessagePart[] {
    const parts: MessagePart[] = [];
    switch (this.state) {
      case 'OUTSIDE':
        // Pending partial-tag buffer at EOS is literal text.
        if (this.pendingTag) {
          this.outsideBuf += this.pendingTag;
          this.pendingTag = '';
        }
        this.flushOutside(parts);
        break;
      case 'OPEN':
        // Partial `<...` that never completed — treat as literal text.
        this.outsideBuf += '<' + this.pendingTag;
        this.pendingTag = '';
        this.flushOutside(parts);
        this.state = 'OUTSIDE';
        break;
      case 'INSIDE':
        // Unterminated `<fyi>...` — emit what we have; better than silently
        // dropping the content.
        this.flushFyi(parts);
        this.state = 'OUTSIDE';
        break;
      case 'CLOSE':
        // Partial `<fyi>...<` — the literal `<` + pending belongs to the
        // inner body. Fold it in, emit as fyi.
        this.fyiBuf += '<' + this.pendingTag;
        this.pendingTag = '';
        this.flushFyi(parts);
        this.state = 'OUTSIDE';
        break;
    }
    return parts;
  }

  // ---------------------------------------------------------------------------
  // State transitions, one character at a time.
  // ---------------------------------------------------------------------------

  private step(ch: string, parts: MessagePart[]): void {
    switch (this.state) {
      case 'OUTSIDE':
        if (ch === '<') {
          // Enter tentative-tag mode. Do NOT flush outsideBuf yet — if the
          // tag turns out to be a non-match (`<foo>`, `<fy...`, lone `<`),
          // the rejected characters belong to the same contiguous TextPart
          // as whatever preceded them. Flush only when we confirm `<fyi>`.
          this.state = 'OPEN';
          this.pendingTag = '';
        } else {
          this.outsideBuf += ch;
        }
        return;

      case 'OPEN': {
        this.pendingTag += ch;
        const candidate = '<' + this.pendingTag;
        if (OPEN_TAG === candidate) {
          // Confirmed `<fyi>` — flush the outside text accumulated *before*
          // this `<` and switch to INSIDE.
          this.flushOutside(parts);
          this.state = 'INSIDE';
          this.pendingTag = '';
          return;
        }
        if (OPEN_TAG.startsWith(candidate)) {
          // Still a viable prefix; keep waiting.
          return;
        }
        // Not an open tag. Fold the `<` + pending back into outsideBuf as
        // literal text. If the pending contains a fresh `<`, rescan from
        // there so `<<fyi>x</fyi>` still works.
        this.rejectOpenTag();
        return;
      }

      case 'INSIDE':
        if (ch === '<') {
          this.state = 'CLOSE';
          this.pendingTag = '';
        } else {
          this.fyiBuf += ch;
        }
        return;

      case 'CLOSE': {
        this.pendingTag += ch;
        const candidate = '<' + this.pendingTag;
        if (CLOSE_TAG === candidate) {
          // Confirmed `</fyi>` — emit the accumulated fyi body and return to
          // OUTSIDE.
          this.flushFyi(parts);
          this.state = 'OUTSIDE';
          this.pendingTag = '';
          return;
        }
        if (CLOSE_TAG.startsWith(candidate)) {
          // Still a viable prefix.
          return;
        }
        // Not a close tag — the `<` + pending is literal fyi body content.
        this.rejectCloseTag();
        return;
      }
    }
  }

  /**
   * Reject a partial open tag: fold the `<` + pending back into outsideBuf
   * as literal text. No flushing happens here — outside text stays
   * accumulating until either a confirmed `<fyi>` opens or the stream ends.
   *
   * If pendingTag itself contains a fresh `<`, rescan from there so patterns
   * like `<<fyi>x</fyi>` still emit the fyi correctly.
   */
  private rejectOpenTag(): void {
    const rejected = '<' + this.pendingTag;
    this.pendingTag = '';
    this.state = 'OUTSIDE';
    const rescanFrom = rejected.indexOf('<', 1);
    if (rescanFrom === -1) {
      this.outsideBuf += rejected;
      return;
    }
    this.outsideBuf += rejected.slice(0, rescanFrom);
    // Re-feed the trailing `<...` through the state machine. Because we're
    // now in OUTSIDE and the next char is `<`, this re-enters OPEN cleanly.
    const tail = rejected.slice(rescanFrom);
    const dummy: MessagePart[] = [];
    for (const ch of tail) {
      this.step(ch, dummy);
    }
    // From OUTSIDE, rescanning a `<...` tail can only accumulate state;
    // it cannot emit parts without first seeing a full `<fyi>` sequence
    // followed by a matching `</fyi>`. If this invariant is ever
    // violated, surface it loudly.
    if (dummy.length > 0) {
      throw new Error('BlockParser invariant violated: rescan from OUTSIDE produced parts');
    }
  }

  /**
   * Reject a partial close tag inside a fyi body: fold `<` + pendingTag back
   * into the fyi body buffer, then rescan if the pendingTag contained a
   * fresh `<` (so `<fyi>x<<y</fyi>` is handled — the second `<` starts a
   * new CLOSE attempt).
   */
  private rejectCloseTag(): void {
    const rejected = '<' + this.pendingTag;
    this.pendingTag = '';
    this.state = 'INSIDE';
    const rescanFrom = rejected.indexOf('<', 1);
    if (rescanFrom === -1) {
      this.fyiBuf += rejected;
      return;
    }
    this.fyiBuf += rejected.slice(0, rescanFrom);
    // Re-feed the trailing `<...` through the state machine.
    const tail = rejected.slice(rescanFrom);
    const dummy: MessagePart[] = [];
    for (const ch of tail) {
      this.step(ch, dummy);
    }
    // rejectCloseTag never produces outside parts — only fyi body accumulates.
    // If the rescan somehow emits parts (it shouldn't when starting from
    // INSIDE), that indicates a state-machine bug; assert.
    if (dummy.length > 0) {
      // Should never happen: from INSIDE we only transition to CLOSE or
      // accumulate into fyiBuf. Keep the assertion loud.
      throw new Error('BlockParser invariant violated: rescan from INSIDE produced parts');
    }
  }

  private flushOutside(parts: MessagePart[]): void {
    if (!this.outsideBuf) return;
    const part: TextPart = { type: 'text', text: this.outsideBuf };
    this.outsideBuf = '';
    parts.push(part);
  }

  private flushFyi(parts: MessagePart[]): void {
    const message = this.fyiBuf;
    this.fyiBuf = '';
    const part: DataFyiPart = {
      type: 'data-fyi',
      data: {
        message,
        timestamp: this.now().toISOString(),
      },
    };
    parts.push(part);
  }
}
