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
//      `safeParse(schema, value, { widgetType, toolName })` and either
//      receives a parsed payload or a debug envelope it threads into
//      `<WidgetMalformedPlaceholder />`.
//
//   3. Dev vs prod behaviour for the malformed placeholder:
//        - Production (`!import.meta.env.DEV`) → returns `null`. The
//          visitor sees nothing; the agent's prose continues uninterrupted.
//          A structured `console.warn` still fires inside `safeParse` so
//          Cloud Run stdout captures the drift for post-launch diagnosis.
//        - Development / test (`import.meta.env.DEV === true`) → renders a
//          rich diagnostic card naming the widget + tool, listing the Zod
//          issues, previewing the raw value, with a copy-to-clipboard
//          button. The existing `data-testid="widget-malformed"` is
//          preserved so widget tests keep passing.
//
//   4. Dev vs prod behaviour for the *silent* placeholder:
//        - Production → returns `null`. A `ui.widget_rendered` event tagged
//          `<widget>:silent:<reason-slug>` still fires so post-launch
//          analytics can count silent renders by tool.
//        - Dev / test → a muted inline "rendered silently" indicator naming
//          the widget, the tool, and the reason (e.g. "empty result", "no
//          canonical URLs"). Optional `hint` (count, raw value preview)
//          surfaces inline for diagnosis. `data-testid="widget-silent"`
//          for assertion targeting.
//      Widgets that previously `return null` for by-design empty results
//      now render `<WidgetSilentPlaceholder>` instead — same visitor-side
//      behaviour, but the developer sees what fired and why.

import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ZodIssue, ZodTypeAny, infer as zInfer } from "zod";
import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { emitUiEvent } from "../runtime/emit-ui-event";

/**
 * Identification + diagnostic context every widget passes through the shell.
 * Carried into `safeParse` (for the structured console.warn) and into
 * `<WidgetMalformedPlaceholder />` (for the dev debug card + the silent
 * prod telemetry signal).
 */
export interface WidgetContext {
  /** Internal widget identifier, e.g. "find-options". */
  readonly widgetType: string;
  /** The tool whose output this widget renders, e.g. "find_options". */
  readonly toolName: string;
}

/**
 * What `safeParse` returns on failure, threaded through to the placeholder.
 * `rawCandidate` is the post-envelope-unwrap value — i.e. the exact shape
 * Zod failed to parse, not the outer `{ok, value}` wrapper.
 */
export interface SafeParseFailureDebug {
  readonly issues: ReadonlyArray<ZodIssue>;
  readonly rawCandidate: unknown;
}

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
export function unwrapEnvelope(value: unknown): unknown {
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

/** Extract the parsed payload or a structured debug envelope. Always
 *  emits a structured `console.warn` on drift (visible in browser devtools
 *  + captured by Cloud Run stdout in production) so the post-launch
 *  diagnostic signal stays alive regardless of whether the visible
 *  malformed surface renders. Unwraps the connector's `{ok, value}`
 *  envelope transparently. */
export function safeParse<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
  context: WidgetContext,
):
  | { ok: true; data: zInfer<S> }
  | { ok: false; debug: SafeParseFailureDebug } {
  const candidate = unwrapEnvelope(value);
  const result = schema.safeParse(candidate);
  if (result.success) return { ok: true, data: result.data };
  if (typeof console !== "undefined") {
    console.warn(
      `[swoop.ui] ${context.widgetType} schema validation failed`,
      {
        widgetType: context.widgetType,
        toolName: context.toolName,
        issues: result.error.issues,
      },
    );
  }
  return {
    ok: false,
    debug: {
      issues: result.error.issues,
      rawCandidate: candidate,
    },
  };
}

export function WidgetLoadingPlaceholder({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="widget-loading"
      data-swoop-part="widget"
      data-swoop-widget-state="loading"
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

/**
 * The render-boundary "couldn't be displayed" surface.
 *
 * In production: renders nothing. Schema drift is diagnosed via the
 * structured `console.warn` in `safeParse` (captured by Cloud Run stdout)
 * and via an emitted `ui.widget_rendered` event tagged with a
 * `malformed` lifecycle state, so post-launch drift is visible in the
 * analytics stream even though the visitor sees no artefact.
 *
 * In dev / test: renders a rich diagnostic card naming the widget + tool,
 * listing the Zod issues, previewing the raw value, with a copy button.
 * The wrapping element keeps `data-testid="widget-malformed"` so the
 * existing widget-level tests (which assert presence/absence of the
 * placeholder) keep passing.
 */
export function WidgetMalformedPlaceholder(props: {
  readonly widgetType: string;
  readonly toolName: string;
  readonly debug?: SafeParseFailureDebug;
  /**
   * When `true`, the failure originated from the lifecycle gate (e.g.
   * `status.type === "incomplete"` or `isError === true`) rather than from
   * schema-parse. The dev surface labels it differently and there's no
   * debug payload to render.
   */
  readonly lifecycleFailure?: boolean;
}): ReactNode {
  // Telemetry: emit a render-event tagged as `malformed` so post-launch
  // analytics can spot drift regardless of whether the visible surface
  // rendered. Re-uses the existing `ui.widget_rendered` event (the only
  // additive change is the value of `widgetType` which already accepts
  // any string per the @swoop/common schema).
  //
  // We tag the widgetType with a `:malformed` suffix so downstream consumers
  // can filter without a new event kind — keeping us clear of the wire
  // schema changes happening in parallel worktrees.
  useEmitMalformedTelemetry({
    widgetType: props.widgetType,
    toolName: props.toolName,
    lifecycleFailure: Boolean(props.lifecycleFailure),
  });

  if (!import.meta.env.DEV) {
    return null;
  }
  return <DevMalformedDebug {...props} />;
}

/** Telemetry hook — fires once per mount. Kept narrow so the prod render
 *  path (return `null`) doesn't also pay for `useState`/event work above
 *  the early return. */
function useEmitMalformedTelemetry(params: {
  readonly widgetType: string;
  readonly toolName: string;
  readonly lifecycleFailure: boolean;
}): void {
  // Lazy fire-once: the malformed component is short-lived (re-mounts on
  // each render attempt). One emit per mount.
  const [emitted] = useState(() => {
    emitUiEvent({
      eventType: "ui.widget_rendered",
      payload: {
        widgetType: `${params.widgetType}:malformed${
          params.lifecycleFailure ? ":lifecycle" : ":schema"
        }`,
        toolName: params.toolName,
        turnIndex: 0,
      },
    });
    return true;
  });
  void emitted;
}

/**
 * Dev-only diagnostic surface. Names the widget + tool, lists Zod issues,
 * previews the raw candidate, and offers a copy-to-clipboard button for
 * pasting the full diagnostic into a bug report / Cursor.
 */
function DevMalformedDebug(props: {
  readonly widgetType: string;
  readonly toolName: string;
  readonly debug?: SafeParseFailureDebug;
  readonly lifecycleFailure?: boolean;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const fullDebug = {
    widgetType: props.widgetType,
    toolName: props.toolName,
    failure: props.lifecycleFailure ? "lifecycle" : "schema",
    issues: props.debug?.issues ?? null,
    rawCandidate: props.debug?.rawCandidate ?? null,
  };
  const debugText = JSON.stringify(fullDebug, null, 2);

  const onCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(debugText);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can reject under iframe-permissions contexts;
      // the developer can still read the rendered debug inline.
      setCopied(false);
    }
  };

  const rawPreview = truncateForPreview(props.debug?.rawCandidate);

  return (
    <div
      role="alert"
      data-testid="widget-malformed"
      data-swoop-part="widget"
      data-swoop-widget-state="malformed"
      data-swoop-widget={props.widgetType}
      data-swoop-dev="true"
      className="my-2 overflow-hidden rounded-md border-2 border-dashed border-amber-300 bg-amber-50 text-[12px] text-amber-950"
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-100/60 px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="rounded-sm bg-amber-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Dev
          </span>
          <span className="font-semibold">
            {props.widgetType}{" "}
            <span className="font-normal text-amber-700">
              ({props.toolName})
            </span>{" "}
            failed to render —{" "}
            {props.lifecycleFailure ? "lifecycle" : "schema parse"}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-amber-400 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
        >
          {copied ? "Copied" : "Copy debug"}
        </button>
      </div>
      {props.debug?.issues && props.debug.issues.length > 0 ? (
        <div className="border-b border-amber-200 px-3 py-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Zod issues
          </div>
          <ul className="space-y-0.5 font-mono text-[11px] leading-snug">
            {props.debug.issues.map((issue, idx) => (
              <li key={`${issue.path.join(".") || "$"}-${idx}`}>
                <span className="text-amber-700">
                  {issue.path.length > 0 ? issue.path.join(".") : "(root)"}
                </span>
                <span className="text-amber-500"> → </span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rawPreview !== null ? (
        <div className="px-3 py-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Raw value
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-amber-950/90">
            {rawPreview}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** JSON-stringify and truncate at ~300 chars. Returns `null` if there's
 *  nothing useful (lifecycle-failure case where no candidate exists). */
function truncateForPreview(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value, null, 2);
    if (!json) return null;
    if (json.length <= 300) return json;
    return `${json.slice(0, 300)}…  (truncated, ${json.length} chars)`;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Silent-render visibility (dev-only)
// ---------------------------------------------------------------------------

/**
 * The render-boundary "I fired but I'm not showing anything" surface.
 *
 * Used by widgets that return silent (e.g. empty results, no canonical URLs)
 * — instead of `return null`, render `<WidgetSilentPlaceholder>` so the
 * developer sees that the tool fired and why the widget chose silence.
 *
 * Production: returns `null` (visitor sees nothing; agent prose carries the
 * moment as today). A `ui.widget_rendered` event tagged
 * `<widget>:silent:<reason-slug>` still fires so post-launch analytics can
 * count silent renders by widget × tool × reason.
 *
 * Dev / test (`import.meta.env.DEV === true`): a quiet inline indicator
 * — slate-toned dotted border, "DEV" badge, "<widget> (<tool>) rendered
 * silently — <reason>" + optional hint preview. `data-testid="widget-silent"`.
 */
export function WidgetSilentPlaceholder(props: {
  readonly widgetType: string;
  readonly toolName: string;
  /** Short, human-friendly reason, e.g. "empty result" or "no canonical URLs". */
  readonly reason: string;
  /** Optional structured context for the developer (count, raw value, etc.). */
  readonly hint?: unknown;
}): ReactNode {
  useEmitSilentTelemetry({
    widgetType: props.widgetType,
    toolName: props.toolName,
    reason: props.reason,
  });

  if (!import.meta.env.DEV) {
    return null;
  }
  return <DevSilentIndicator {...props} />;
}

/** Lazy fire-once. Same shape as `useEmitMalformedTelemetry`. */
function useEmitSilentTelemetry(params: {
  readonly widgetType: string;
  readonly toolName: string;
  readonly reason: string;
}): void {
  const [emitted] = useState(() => {
    emitUiEvent({
      eventType: "ui.widget_rendered",
      payload: {
        widgetType: `${params.widgetType}:silent:${slugifyReason(
          params.reason,
        )}`,
        toolName: params.toolName,
        turnIndex: 0,
      },
    });
    return true;
  });
  void emitted;
}

/** Reason → kebab-case slug suitable for analytics filtering. */
function slugifyReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unspecified";
}

/**
 * Dev-only "tool fired silently" indicator. Visually quieter than the
 * malformed card — this isn't a failure, just a render-skip we want
 * visible during development so the conversation's "pause then continue"
 * shape is explainable.
 */
function DevSilentIndicator(props: {
  readonly widgetType: string;
  readonly toolName: string;
  readonly reason: string;
  readonly hint?: unknown;
}): ReactNode {
  const hintPreview = truncateForPreview(props.hint);
  return (
    <div
      role="note"
      data-testid="widget-silent"
      data-swoop-part="widget"
      data-swoop-widget-state="silent"
      data-swoop-widget={props.widgetType}
      data-swoop-dev="true"
      className="my-2 inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] leading-snug text-slate-600"
    >
      <span className="rounded-sm bg-slate-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
        Dev
      </span>
      <span>
        <span className="font-medium text-slate-700">{props.widgetType}</span>{" "}
        <span className="text-slate-400">({props.toolName})</span>{" "}
        rendered silently — <span className="italic">{props.reason}</span>
      </span>
      {hintPreview !== null ? (
        <code className="block w-full max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-500">
          {hintPreview}
        </code>
      ) : null}
    </div>
  );
}

/**
 * `tools.Fallback` for assistant-ui's part registry — renders for any tool
 * call whose `toolName` isn't in `toolWidgetComponents`. In prod silent; in
 * dev surfaces a "no widget registered" indicator so unregistered tool
 * calls don't disappear unannounced. Args + result are exposed via the
 * hint preview so the developer can decide whether a real widget is
 * warranted.
 */
export function UnregisteredToolFallback(props: {
  readonly toolName: string;
  readonly args?: unknown;
  readonly result?: unknown;
}): ReactNode {
  return (
    <WidgetSilentPlaceholder
      widgetType="(unregistered)"
      toolName={props.toolName}
      reason="no widget registered"
      hint={{ args: props.args, result: props.result }}
    />
  );
}

/**
 * Hook: fire `ui.widget_rendered` once per widget instance when the widget
 * actually renders its happy-path body. Widgets call this from their render
 * path AFTER the lifecycle gate passes and schema validation succeeds — so
 * the event accurately tracks widgets the visitor actually sees, not
 * loading / malformed placeholders.
 *
 * One emit per mount per (toolName, toolCallId). assistant-ui's
 * tool-call-part rendering is stable (same component lifetime for a given
 * tool call), so `useState(() => emit)` does the right thing here.
 */
export function useWidgetRenderedEvent(params: {
  readonly widgetType: string;
  readonly toolName: string;
  /**
   * Turn index the tool call lands on. Widgets don't always have this in
   * scope — assistant-ui doesn't thread it into ToolCallMessagePartProps
   * by default — so we accept an optional hint and fall back to 0. The
   * authoritative turn-index signal lives in orchestrator `tool.called` /
   * `tool.returned`; this UI event is the render-boundary correlator.
   */
  readonly turnIndex?: number;
}): void {
  const { widgetType, toolName, turnIndex } = params;
  const [emitted] = useState(() => {
    emitUiEvent({
      eventType: "ui.widget_rendered",
      payload: {
        widgetType,
        toolName,
        turnIndex: turnIndex ?? 0,
      },
    });
    return true;
  });
  void emitted;
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
  context: WidgetContext,
  loadingLabel?: string,
): ReactNode | null {
  const statusType = lifecycle.status?.type;
  // Complete is the only state in which `result` is reliably populated.
  if (statusType === "complete") {
    if (lifecycle.result === undefined) {
      return (
        <WidgetMalformedPlaceholder
          widgetType={context.widgetType}
          toolName={context.toolName}
          lifecycleFailure
        />
      );
    }
    return null;
  }
  if (statusType === "incomplete" || lifecycle.isError) {
    return (
      <WidgetMalformedPlaceholder
        widgetType={context.widgetType}
        toolName={context.toolName}
        lifecycleFailure
      />
    );
  }
  // "running" or anything we don't recognise → loading.
  return <WidgetLoadingPlaceholder label={loadingLabel} />;
}

/**
 * Shared component that wraps a widget's happy-path render and emits
 * `ui.widget_rendered` exactly once per mount. Widgets that want per-render
 * observability can also use `useWidgetRenderedEvent` directly; this wrapper
 * covers the common case where a widget's render body is a React element
 * tree returned by the top-level widget component.
 */
export function WidgetRenderTracker(props: {
  readonly widgetType: string;
  readonly toolName: string;
  readonly turnIndex?: number;
  readonly children: ReactNode;
}): ReactNode {
  useWidgetRenderedEvent({
    widgetType: props.widgetType,
    toolName: props.toolName,
    turnIndex: props.turnIndex,
  });
  return props.children;
}

// ---------------------------------------------------------------------------
// DevToolCallTrace — universal per-tool-call diagnostic surface (dev-only)
// ---------------------------------------------------------------------------

/**
 * A small collapsible diagnostic card that renders **below every tool call**
 * in dev mode. Distinct from `WidgetMalformedPlaceholder` (failure-only) and
 * `WidgetSilentPlaceholder` (in-widget silence) — this surface is universal:
 * it fires for *every* tool call, regardless of whether the widget renders
 * content, malformed, silent, or loading.
 *
 * Production: returns `null`. The wrapping HOC (`wrapWithDevTrace`) is a
 * no-op in prod so the trace component never mounts. No telemetry — the
 * existing per-widget `ui.widget_rendered` + malformed/silent suffixes
 * already cover server-bound observability.
 *
 * Dev / test: a one-line collapsed summary (DEV badge · toolName · status ·
 * duration · error flag if any). Click the `<summary>` to expand a full
 * diagnostic view: toolCallId, args (JSON), result (JSON), isError, raw
 * status.type, started/ended timestamps.
 *
 * Timing: client-side approximation. First mount = "tool call observed";
 * first complete with result = "ended". For very fast tool calls (cached
 * results that arrive complete on first render), duration shows as 0 ms.
 *
 * `data-testid="dev-tool-trace"` for assertion targeting.
 */
function DevToolCallTrace(props: {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly isError?: boolean | undefined;
  readonly status: { readonly type: string };
}): ReactNode {
  // `startedAt` is captured once on first render via a lazy-init ref — no
  // re-render needed, the value is stable across the widget's lifetime.
  const startedAtRef = useRef<number | null>(null);
  if (startedAtRef.current === null) {
    startedAtRef.current = Date.now();
  }
  const startedAt: number = startedAtRef.current;

  // `endedAt` is state (not a ref) so when the effect latches the end
  // timestamp, the component re-renders to display the duration. Without
  // this, a tool call that arrives complete on first render shows
  // "(pending)" forever — the effect runs but the ref change doesn't
  // schedule a re-render.
  const [endedAt, setEndedAt] = useState<number | null>(null);

  useEffect(() => {
    if (
      props.status.type === "complete" &&
      props.result !== undefined &&
      endedAt === null
    ) {
      setEndedAt(Date.now());
    }
  }, [props.status.type, props.result, endedAt]);

  const durationMs = endedAt !== null ? endedAt - startedAt : null;
  const hasError = Boolean(props.isError);

  const summary = [
    props.toolName,
    props.status.type,
    durationMs !== null ? `${durationMs} ms` : null,
    hasError ? "error" : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");

  // Full diagnostic payload for the Copy button. Mirrors the fields rendered
  // in the expanded body so a developer can paste the JSON into Claude Code /
  // a bug report / a debugger session and have everything they need.
  const [copied, setCopied] = useState(false);
  const copyPayload = JSON.stringify(
    {
      toolName: props.toolName,
      toolCallId: props.toolCallId,
      statusType: props.status.type,
      started: new Date(startedAt).toISOString(),
      ended: endedAt !== null ? new Date(endedAt).toISOString() : null,
      durationMs,
      isError: hasError,
      args: props.args,
      result: props.result,
    },
    null,
    2,
  );
  const onCopy = async (): Promise<void> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(copyPayload);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can reject under iframe-permissions contexts.
      // Developer can still expand the panel and copy fields manually.
      setCopied(false);
    }
  };

  return (
    <details
      data-testid="dev-tool-trace"
      data-swoop-part="widget"
      data-swoop-widget-state="dev-trace"
      data-swoop-tool={props.toolName}
      data-swoop-dev="true"
      className="my-2 rounded-md border border-slate-200 bg-white/60 text-[11px] text-slate-600 open:bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="rounded-sm bg-slate-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          Dev
        </span>
        <span aria-hidden="true" className="text-slate-300">
          ▸
        </span>
        <span className="font-mono text-[11px] text-slate-700">
          {summary}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {hasError ? (
            <span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700">
              isError
            </span>
          ) : null}
          <button
            type="button"
            data-testid="dev-tool-trace-copy"
            onClick={(ev) => {
              // The button lives inside `<summary>`, so a bare click would
              // both fire `onCopy` AND toggle the details panel open/closed.
              // We want copy-without-toggle.
              ev.preventDefault();
              ev.stopPropagation();
              void onCopy();
            }}
            title="Copy this tool call as JSON for review / debugging"
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </summary>
      <div className="border-t border-slate-200 px-2.5 py-2">
        <DevTraceField label="toolCallId" value={props.toolCallId} />
        <DevTraceField label="status.type" value={props.status.type} />
        <DevTraceField
          label="started"
          value={new Date(startedAt).toISOString()}
        />
        <DevTraceField
          label="ended"
          value={endedAt !== null ? new Date(endedAt).toISOString() : "(pending)"}
        />
        <DevTraceField
          label="durationMs"
          value={durationMs !== null ? String(durationMs) : "(pending)"}
        />
        <DevTraceField label="isError" value={hasError ? "true" : "false"} />
        <DevTraceJsonField label="args" value={props.args} />
        <DevTraceJsonField label="result" value={props.result} />
      </div>
    </details>
  );
}

function DevTraceField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactNode {
  return (
    <div className="flex gap-2 leading-snug">
      <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="font-mono text-[11px] text-slate-700">{value}</span>
    </div>
  );
}

/** JSON-rendered field — pretty-printed, scroll-on-overflow, no truncation
 *  (developer wants the full payload; the `<details>` collapse keeps the
 *  chat tidy when not needed). */
function DevTraceJsonField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: unknown;
}): ReactNode {
  let body: string;
  try {
    body =
      value === undefined ? "(undefined)" : JSON.stringify(value, null, 2);
  } catch {
    body = String(value);
  }
  return (
    <div className="mt-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <pre className="mt-0.5 max-h-64 overflow-auto rounded bg-slate-50 px-2 py-1 font-mono text-[10.5px] leading-snug text-slate-700">
        {body}
      </pre>
    </div>
  );
}

/**
 * Decorate a `ToolCallMessagePartComponent` with the universal dev trace.
 * The returned component renders the original widget unchanged, then
 * appends `<DevToolCallTrace>` below it. In production this HOC is a
 * pass-through (no wrapper component, no extra render work) — the wrapping
 * only happens when `import.meta.env.DEV` is truthy at module-load time.
 *
 * Intended for use by `parts/index.ts` when assembling the
 * `tools.by_name` + `tools.Fallback` registry, so every tool call gets the
 * trace regardless of which widget renders it.
 *
 * The HOC signature accepts the broader `ComponentType<ToolCallMessagePartProps>`
 * so it can wrap both real widgets (`ToolCallMessagePartComponent`) and
 * the registry's `Fallback` (same shape). Returns the same broader type.
 */
export function wrapWithDevTrace(
  toolName: string,
  Inner: ComponentType<ToolCallMessagePartProps>,
): ComponentType<ToolCallMessagePartProps> {
  if (!import.meta.env.DEV) {
    // Prod: no wrapper. Caller registers the original component verbatim.
    return Inner;
  }
  function WrappedWithDevTrace(
    props: ToolCallMessagePartProps,
  ): ReactNode {
    return (
      <>
        <Inner {...props} />
        <DevToolCallTrace
          toolName={props.toolName ?? toolName}
          toolCallId={props.toolCallId}
          args={props.args}
          result={props.result}
          isError={props.isError}
          status={props.status}
        />
      </>
    );
  }
  WrappedWithDevTrace.displayName = `WrappedWithDevTrace(${toolName})`;
  return WrappedWithDevTrace;
}

// Re-export the type alias so callers (e.g. parts/index.ts) can use the
// canonical assistant-ui type without re-importing it themselves.
export type { ToolCallMessagePartComponent };
