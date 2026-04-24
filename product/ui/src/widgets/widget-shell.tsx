// product/ui/src/widgets/widget-shell.tsx
//
// Shared plumbing for every widget:
//
//   1. Lifecycle gate — assistant-ui's tool-call component receives a
//      `status.type` that walks {"running" | "complete" | "incomplete" |
//      "requires-action"}. The tool `result` field is populated only when
//      the tool call resolves. Before that we show a subtle "loading…"
//      placeholder; after it, the widget body.
//
//   2. Schema validation at the render boundary — every widget calls
//      `validateOrPlaceholder(schema, result)` and either receives a parsed
//      payload or renders the malformed-content placeholder (no crash).
//
//   3. The error-state UX proper lands in D.t5; this shell's fallback is the
//      minimum bar so schema drift can't blow up the surface.

import type { ReactNode } from "react";
import type { ZodType } from "zod";
import { getToolErrorCopy } from "../errors";

/**
 * Narrow view of the assistant-ui `ToolCallMessagePartProps` fields we care
 * about. Keeping this internal sidesteps having to re-export the upstream
 * type when its shape evolves.
 */
export type ToolCallLifecycle<TResult = unknown> = {
  /** The validated tool output, once it arrives. */
  result?: TResult | undefined;
  /** Current tool-call lifecycle status. */
  status: { readonly type: string };
  /** Whether the tool call errored at the runtime level. */
  isError?: boolean | undefined;
};

/** Unwrap the orchestrator connector's `{ok, value}` envelope if present.
 *  The MCP connector adapter (chunk B.t3) wraps successful tool results as
 *  `{ok: true, value: <data>}` so it can carry structured errors through the
 *  same channel as values. That envelope is invisible to the widget's output
 *  schema — unwrap before parsing. */
function unwrapEnvelope(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "ok" in value &&
    (value as { ok: unknown }).ok === true &&
    "value" in value
  ) {
    return (value as { value: unknown }).value;
  }
  return value;
}

/** Extract the parsed payload or null. Logs the validation error to console
 *  in dev so schema drift is visible without swallowing. Unwraps the
 *  connector's `{ok, value}` envelope transparently. */
export function safeParse<T>(
  schema: ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false } {
  const candidate = unwrapEnvelope(value);
  const result = schema.safeParse(candidate);
  if (result.success) return { ok: true, data: result.data };
  if (typeof console !== "undefined") {
    console.warn("[swoop.ui] widget schema validation failed", result.error.issues);
  }
  return { ok: false };
}

export function WidgetLoadingPlaceholder({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="widget-loading"
      className="my-2 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
      />
      <span>{label}</span>
    </div>
  );
}

/** The render-boundary "couldn't be displayed" card. Copy lives in
 *  cms/errors/en.json under `tool_error` so D.t5 and this share one source.
 *  Visual pattern kept inline (amber card) — tool-call failures don't
 *  warrant the full ErrorBanner because the rest of the conversation is
 *  still useful; just this piece failed. */
export function WidgetMalformedPlaceholder() {
  const copy = getToolErrorCopy();
  return (
    <div
      role="alert"
      data-testid="widget-malformed"
      className="my-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <div className="font-medium">{copy.title}</div>
      <div className="text-[13px] leading-5 opacity-90">{copy.body}</div>
    </div>
  );
}

/**
 * Guard: if the tool call isn't in `output-available`-equivalent state, render
 * the loading placeholder. Otherwise return null so the caller renders its
 * widget body.
 *
 * assistant-ui's status.type walks:
 *   running → (while the tool args stream in and/or the tool runs)
 *   complete → tool produced a result
 *   requires-action → awaiting human input (not used in Puma; falls through)
 *   incomplete → the turn ended before the tool resolved (show fallback)
 */
export function renderLifecycleGate(
  lifecycle: ToolCallLifecycle<unknown>,
  loadingLabel?: string,
): ReactNode | null {
  const statusType = lifecycle.status?.type;
  // Complete is the only state in which `result` is reliably populated.
  if (statusType === "complete") {
    if (lifecycle.result === undefined) {
      // Complete but empty result — treat as malformed.
      return <WidgetMalformedPlaceholder />;
    }
    return null;
  }
  if (statusType === "incomplete" || lifecycle.isError) {
    return <WidgetMalformedPlaceholder />;
  }
  // "running" or anything we don't recognise → loading.
  return <WidgetLoadingPlaceholder label={loadingLabel} />;
}
