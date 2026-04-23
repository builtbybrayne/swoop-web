/**
 * Translator-local input typing for ADK events.
 *
 * The translator consumes `@google/adk` Event objects (which extend LlmResponse,
 * with `content?: { parts?: Part[] }` from `@google/genai`). We re-export those
 * shapes under translator-local names so tests and call sites can depend on the
 * translator's contract rather than reaching into ADK types directly.
 *
 * See planning/03-exec-agent-runtime-t4.md. Spike outcome (scenario 2) is
 * captured in decisions.md as B.9: ADK's native `Part.thought`, `Part.text`,
 * `Part.functionCall`, `Part.functionResponse` cover three of the four Puma
 * block types; `<fyi>` requires parsing from content text (§2.5a).
 */

import type { Event } from '@google/adk';

/**
 * The ADK event shape consumed by the translator.
 *
 * `Event extends LlmResponse` in @google/adk/dist/types/events/event.d.ts; the
 * translator never touches session/author/invocation fields, only the
 * LlmResponse surface (content / partial / turnComplete / errorCode /
 * errorMessage).
 */
export type AdkEvent = Event;

/**
 * A side-sink for parts that are removed from the outbound stream but still
 * need to reach session history (chunk B §2.6 — e.g. `<reasoning>` parts).
 *
 * The translator calls `onFiltered(part)` synchronously before discarding.
 * Session persistence (B.t2) owns the implementation; the translator only
 * holds the function pointer. A no-op default is used when the translator is
 * exercised in isolation (tests, local harnesses).
 */
export type FilteredPartSink = (part: import('@swoop/common').MessagePart) => void;
