// product/ui/src/session/replay-into-thread.ts
//
// The assistant-ui-version-specific replay implementation. Single function;
// single file. Per D.t9-mount-rehydrate plan decision D.27: a library upgrade
// or API discovery is one file's worth of churn.
//
// What this file owns:
//   - Translating a `@swoop/common` `MessagePart[]` projection (B.t11's wire
//     shape) into the `ThreadMessageLike` content array assistant-ui 0.12.25
//     accepts via `ThreadRuntime.reset(initialMessages)`.
//   - Calling `runtime.thread.reset(...)` (the equivalent of Option A in the
//     plan §"How replay is actually played into the thread"). For the AI-SDK
//     runtime (`useChatRuntime`), `reset(initialMessages)` is the supported
//     surface for populating the thread with rehydrated history — same call
//     the "New conversation" path uses with no initial messages.
//
// What this file does NOT own:
//   - The fetch (`rehydrate.ts`).
//   - The lifecycle / strict-mode / observability emits (`use-rehydrate.ts`).
//   - Anything UX-shaped (`App.tsx`).
//
// Per HITL ratification 2026-05-12: empty replay is NOT a special case —
// a consented zero-turn rehydrated session is semantically a fresh chat.
// `replayPartsIntoThread` therefore short-circuits on `parts.length === 0`
// (calling `reset([])` would either no-op or kick a re-render with no value).
//
// Reasoning-strip invariant: reasoning parts MUST NOT appear in the projection
// (B.t11's translator filters them server-side per chunk B §2.4). We don't
// re-filter here — defence in depth lives in `parts/reasoning-guard.tsx`
// which the registry already wires.

import type { AssistantRuntime, ThreadMessageLike } from "@assistant-ui/react";
import type {
  CustomDataPart,
  MessagePart,
  ToolCallPart,
} from "@swoop/common";

/**
 * Synthetic message id for the rehydrated history. One id per replay; if a
 * future iteration carves history into per-turn messages, this becomes a
 * factory. Today (decision D.28) the entire projection collapses into one
 * synthetic assistant message — simpler, single source of truth, no boundary
 * detection.
 */
export const REHYDRATED_MESSAGE_ID = "swoop-rehydrated-history";

/**
 * Sentinel date for "this is replayed history" — epoch zero. Distinguishes
 * the rehydrated message from any live ones the visitor produces afterwards.
 */
const REHYDRATED_CREATED_AT = new Date(0);

/**
 * Replay a `MessagePart[]` projection into the assistant-ui thread by
 * resetting it with a single synthetic assistant message whose content is the
 * translated parts array.
 *
 * Per the plan §"What the rehydrated message looks like" — one synthetic
 * assistant message holds the entire replayed history. Boundary detection
 * (which turn was which) would be fiddly, error-prone, and unnecessary for
 * the JTBD (visitor sees their conversation; doesn't need pixel-identical
 * pre-refresh layout).
 *
 * No-ops if `parts.length === 0` per HITL ratification — empty replay is a
 * fresh chat, not a "Restoring…" affordance.
 */
export function replayPartsIntoThread(
  runtime: AssistantRuntime,
  parts: readonly MessagePart[],
): void {
  if (parts.length === 0) {
    // HITL ratification: empty replay === fresh chat. Standard empty state.
    return;
  }

  const content = parts.map(toAssistantUiContentPart).filter(isPresent);
  if (content.length === 0) {
    // Every part was filtered (e.g. an upstream surprise we don't render).
    // Treat as empty — same posture as the length-zero branch.
    return;
  }

  const message: ThreadMessageLike = {
    id: REHYDRATED_MESSAGE_ID,
    role: "assistant",
    content,
    createdAt: REHYDRATED_CREATED_AT,
    // Mark as complete so assistant-ui doesn't render a "thinking" indicator
    // for the synthetic message. The visitor sees the historic conversation,
    // not a frozen mid-stream state.
    status: { type: "complete", reason: "unknown" },
  };

  runtime.thread.reset([message]);
}

// ---------------------------------------------------------------------------
// Per-part translation
// ---------------------------------------------------------------------------

/**
 * `ThreadMessageLike.content` is `string | readonly Part[]`. We always build
 * the array form, so extract the element type via the array branch.
 *
 * Using `Extract` before the infer pattern unwraps the string branch — the
 * conditional inside infer gives `never` for that branch, which would
 * otherwise collapse the whole alias to `null`.
 */
type AssistantUiContentArray = Extract<
  ThreadMessageLike["content"],
  readonly unknown[]
>;
type AssistantUiContentPart = AssistantUiContentArray[number];

/**
 * Translate one orchestrator `MessagePart` into the assistant-ui content-part
 * shape. Returns `null` for parts we deliberately skip:
 *
 *   - `reasoning` — invariant violation if present (B.t4's translator strips
 *     reasoning unconditionally per chunk B §2.4). Defence-in-depth: skip
 *     here too rather than letting it reach the registry, where
 *     `parts/reasoning-guard.tsx` would throw in dev.
 *   - `tool-call` with `state: "input-streaming"` — replay only carries
 *     completed call pairs (`input-available` + `output-available`) per
 *     B.t11's projection contract. A streaming-input part in the projection
 *     would be a server bug; we collapse rather than surface a half-state.
 *
 * Everything else maps to assistant-ui's native shape:
 *   - `text`           → `{type: "text", text}`
 *   - `data-fyi`       → `{type: "data-fyi", data}` (DataPrefixedPart form
 *                        — assistant-ui registers `data.by_name.fyi`)
 *   - `tool-call`      → `{type: "tool-call", toolCallId, toolName, args,
 *                        result?, isError?}`
 *
 * `argsText` is left blank — it's only used by the live streaming-input UI;
 * a completed replayed tool-call has the full args already.
 */
function toAssistantUiContentPart(
  part: MessagePart,
): AssistantUiContentPart | null {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };

    case "reasoning":
      // Invariant: B.t4/B.t11 strip reasoning from outbound projections.
      // If we ever see one here it's a server bug; drop silently rather
      // than render a private chain-of-thought. The reasoning-guard in
      // `parts/reasoning-guard.tsx` is the dev-mode loud signal if any
      // reach the renderer through any other path.
      return null;

    case "data-fyi":
      // Assistant-ui registers under `data.by_name.fyi`; the prefixed-part
      // form `{type: "data-fyi", data}` is what the registry pattern-matches
      // against. Matches the wire shape the live SSE emits.
      return { type: "data-fyi", data: part.data };

    case "tool-call":
      return toToolCallContentPart(part);
  }
}

/**
 * Tool-call translation: only completed call pairs (input-available +
 * output-available) survive into the replay shape. An `input-streaming` in
 * the projection is unexpected and skipped (see §toAssistantUiContentPart).
 */
function toToolCallContentPart(
  part: ToolCallPart,
): AssistantUiContentPart | null {
  if (part.state === "input-streaming") {
    return null;
  }
  // `args` on the assistant-ui side is a JSON object (ReadonlyJSONObject).
  // The orchestrator's tool-call schemas guarantee object-shaped inputs for
  // every Puma tool today; if a future tool ships scalar inputs, wrap them
  // here. Cast keeps the type story honest without forking the union.
  const args = toReadonlyJSONObject(part.input);

  if (part.state === "input-available") {
    return {
      type: "tool-call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args,
      // No `result` yet — assistant-ui's tool-call widget renders the
      // "loading" state when result is absent. Mirrors the live SSE
      // intermediate where the call has been issued but no response yet.
      // Per the plan: this is the streaming-state widget UX for a tool that
      // was mid-execution when the orchestrator died.
    };
  }

  // output-available — completed call.
  return {
    type: "tool-call",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args,
    result: part.output,
    isError: part.isError === true ? true : undefined,
  };
}

// `ReadonlyJSONObject` is the deep-readonly JSON-value shape assistant-ui
// expects for tool-call args. Importing the named type from inside
// `assistant-stream/utils` would tie this file to a deep dep path (and isn't
// re-exported via @assistant-ui/react). We use `unknown` as the source
// shape and let the field cast narrow at the use site — same pragmatic
// posture the orchestrator-adapter takes for tool-call inputs flowing back.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolCallArgs = any;

/** Narrow `unknown` input to assistant-ui's ReadonlyJSONObject contract. */
function toReadonlyJSONObject(input: unknown): ToolCallArgs {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }
  // Wrap non-object inputs so the type holds. Tool widgets pattern-match on
  // their expected shape; an unexpected scalar will fail the widget's
  // safeParse — which is the right surface for "this shouldn't happen".
  return { value: input };
}

function isPresent<T>(x: T | null | undefined): x is T {
  return x != null;
}
