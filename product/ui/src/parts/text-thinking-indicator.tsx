// product/ui/src/parts/text-thinking-indicator.tsx
//
// Activity indicator: the three thinking dots PLUS one quiet, ephemeral
// status line about what the agent is doing right now ("Browsing trip
// ideas…"). Evolved from the original "Thinking…" dots per
// planning/03-exec-crosscut-goofy-goldstine-activity-status.md
// (D.goofy-goldstine-10/-11). File and export names kept — App.tsx mounts
// `TextThinkingIndicator` inside the assistant branch of `MessageView`,
// *after* `<MessagePrimitive.Parts>`.
//
// Show the dots iff ALL of:
//   - role === "assistant"               (don't show on visitor turns)
//   - status.type === "running"          (only while the message is in flight)
//   - no text part with non-empty text   (text hasn't started streaming yet)
//
// The original fourth condition — suppress while a tool call is pending —
// is deliberately DROPPED: it deferred to widget loaders that used to render
// in the chat column, but since the visual-sidebar relocation those loaders
// live in the sidebar, so a long tool call left the chat column showing
// nothing. The dots now cover the whole running-but-no-text window.
//
// Status line (single slot, latest signal wins — D.goofy-goldstine-10):
//   - Derived per render from the message's parts: the LATEST `tool-call`
//     part with no result yet maps toolName → copy via
//     cms/ui/tool-status.en.json (`_default` for unknown tools). Entirely
//     client-side — no orchestrator or wire change.
//   - When the in-flight tool CHANGES, we emit `tool-status` on the fyi
//     channel so any visible agent-authored `<fyi>` line (D.10) fades — the
//     deterministic signal is newer, it takes the slot.
//   - When an `<fyi>` appears (`fyi-appeared`), the fyi is the newer signal:
//     we suppress our tool-derived text (dots stay) until the NEXT tool
//     signal. Suppression is keyed to the toolCallId current at fyi-arrival,
//     so a new tool call lifts it naturally. Deliberate consequence: after
//     the fyi auto-fades (~3s) the tool text does NOT resurrect — ephemeral
//     signals don't come back, and re-showing stale copy mid-call would
//     flicker for no information gain. Dots alone are the honest state.
//   - Tool completes with no text yet → the derivation yields no pending
//     tool, so the text DROPS and the dots remain (the silent composing gap
//     keeps its original dots-only treatment). Chosen over "persist until
//     next signal" because the line is state-derived: it reflects what IS
//     in flight, never what was.
//   - First non-empty text token → the whole indicator (dots + line)
//     unmounts via the show derivation; the `text-arrived` channel signal
//     independently fades any fyi. Completed/historical messages render
//     nothing (status.type !== "running").
//
// Copy is content, not code (G.11): per-tool strings live in
// cms/ui/tool-status.en.json, loaded via Vite JSON import exactly like
// cms/errors/en.json in errors/error-banner.tsx (`getToolErrorCopy`).
//
// `data-swoop-part="thinking-indicator"` (container) and
// `data-swoop-part="activity-status"` (text span) let Swoop's brand team
// re-skin without touching React internals. `role="status"` +
// `aria-live="polite"` announce updates politely; the sr-only "Thinking…"
// fallback renders only when no status text is visible, so screen readers
// hear either the activity line or "Thinking…", never both.

import { useEffect, useState } from "react";
import { useMessage } from "@assistant-ui/react";
import { emitFyiChannel, subscribeFyiChannel } from "./fyi-channel";
// Vite natively resolves JSON imports; the cast satisfies TS without a
// runtime validation step (the file is authored-then-frozen content).
import statusCopyJson from "../../../cms/ui/tool-status.en.json";

// The $schema-notes key lives alongside the real entries; the lookup below
// skips meta keys ("$…") so a hypothetical tool named like one can't surface
// authoring notes in the UI.
const STATUS_COPY = statusCopyJson as unknown as Record<string, string>;

/**
 * Friendly present-progressive line for a tool name, falling back to the
 * `_default` entry for tools the copy file doesn't know (forward-safe for
 * tools that don't exist yet — D.goofy-goldstine-11).
 */
export function getToolStatusCopy(toolName: string): string {
  if (toolName && !toolName.startsWith("$") && !toolName.startsWith("_")) {
    const entry = STATUS_COPY[toolName];
    if (typeof entry === "string" && entry.length > 0) return entry;
  }
  return STATUS_COPY["_default"];
}

/**
 * Minimal structural slice of assistant-ui's `MessageState` that the
 * derivation reads. Kept local so tests can fabricate states without
 * depending on assistant-ui internals (the provider-scope lesson,
 * discoveries.md 2026-05-13: don't mock `useMessage` — test the pure
 * derivation and the view with real values instead).
 */
export interface ActivityMessageShape {
  role: string;
  status?: { type: string };
  content: ReadonlyArray<{
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    result?: unknown;
    isError?: boolean;
  }>;
}

/** Field separator for the encoded snapshot — NUL never occurs in tool names or call ids. */
const SEP = "\u0000";

/**
 * Pure derivation over the message state, returning a PRIMITIVE so
 * `useMessage`'s equality check doesn't re-render on every store tick:
 *
 *   ""                          — indicator hidden
 *   "show"                      — dots only (running, no text, no pending tool)
 *   `show␀<toolCallId>␀<name>`  — dots + status line for the latest
 *                                 still-pending tool-call part
 *
 * "Latest" = the last pending tool-call in part order; with parallel calls
 * the most recently started one wins the single slot.
 */
export function deriveActivitySnapshot(s: ActivityMessageShape): string {
  if (s.role !== "assistant") return "";
  if (s.status?.type !== "running") return "";

  let pendingId = "";
  let pendingName = "";
  for (const part of s.content) {
    if (part.type === "text") {
      // Any non-empty text part means streaming has started — the visible
      // text itself is now the activity signal, so hide entirely.
      if (typeof part.text === "string" && part.text.length > 0) {
        return "";
      }
    } else if (part.type === "tool-call") {
      // No result and no error → still in flight. Later pending parts
      // overwrite earlier ones (latest wins); completed parts don't clear
      // an earlier still-pending one.
      if (part.result === undefined && !part.isError) {
        pendingId = part.toolCallId ?? "";
        pendingName = part.toolName ?? "";
      }
    }
  }

  return pendingId || pendingName
    ? `show${SEP}${pendingId}${SEP}${pendingName}`
    : "show";
}

export interface ActivityIndicatorViewProps {
  /** Render the dots at all (assistant + running + no text yet). */
  show: boolean;
  /** toolCallId of the latest in-flight tool call, or null when none. */
  toolCallId: string | null;
  /** toolName of that call, or null when none. */
  toolName: string | null;
}

/**
 * Presentational + arbitration layer, separated from `useMessage` so tests
 * drive it with plain props. Owns the tool-derived side of the single status
 * slot shared with the D.10 `<fyi>` line (see file header).
 */
export function ActivityIndicatorView({
  show,
  toolCallId,
  toolName,
}: ActivityIndicatorViewProps) {
  // When an agent-authored fyi appears it takes the slot: remember WHICH
  // tool call we were narrating at that moment; only a different (newer)
  // tool call lifts the suppression. "(none)" covers fyis that arrive in
  // the composing gap (no tool in flight).
  const [suppressedFor, setSuppressedFor] = useState<string | null>(null);

  // A new in-flight tool is a NEW signal for the slot: tell the channel so
  // any visible fyi fades. Effect order matters and is relied upon: on a
  // toolCallId change React first runs the subscription cleanup below, so
  // we are NOT subscribed while emitting — we never suppress ourselves.
  useEffect(() => {
    if (!show || !toolCallId) return;
    emitFyiChannel("tool-status");
  }, [show, toolCallId]);

  // Listen for fyi arrivals while we're live; re-subscribe per toolCallId so
  // the handler closure always names the call it suppresses.
  useEffect(() => {
    if (!show) return;
    const unsubscribe = subscribeFyiChannel((event) => {
      if (event === "fyi-appeared") {
        setSuppressedFor(toolCallId ?? "(none)");
      }
    });
    return unsubscribe;
  }, [show, toolCallId]);

  if (!show) return null;

  const statusText =
    toolCallId && suppressedFor !== toolCallId
      ? getToolStatusCopy(toolName ?? "")
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-swoop-part="thinking-indicator"
      className="inline-flex items-center gap-1.5 py-1 text-slate-400"
    >
      <span aria-hidden="true" className="flex items-end gap-1">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
      </span>
      {statusText ? (
        <span
          data-swoop-part="activity-status"
          className="text-xs text-slate-400"
        >
          {statusText}
        </span>
      ) : (
        <span className="sr-only">Thinking…</span>
      )}
    </div>
  );
}

ActivityIndicatorView.displayName = "ActivityIndicatorView";

/**
 * App-facing wrapper: reads the current message via `useMessage(selector)`
 * (primitive-encoded snapshot, see `deriveActivitySnapshot`) and hands the
 * parsed fields to the view. Scopes naturally to whichever assistant message
 * is being rendered — completed messages derive "" and render nothing.
 */
export function TextThinkingIndicator() {
  const encoded = useMessage((s) =>
    deriveActivitySnapshot(s as unknown as ActivityMessageShape),
  );

  if (encoded === "") {
    return <ActivityIndicatorView show={false} toolCallId={null} toolName={null} />;
  }

  const [, toolCallId, toolName] = encoded.split(SEP);
  return (
    <ActivityIndicatorView
      show
      toolCallId={toolCallId || null}
      toolName={toolName || null}
    />
  );
}
