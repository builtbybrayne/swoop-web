// product/ui/src/parts/text-thinking-indicator.tsx
//
// Subtle "Thinking…" indicator that surfaces during the silent gap between
// the agent's tool calls completing and the first text token streaming in.
// Without it the visitor often believes the agent is done — the gap can be
// several seconds while the model composes its response.
//
// Placement: inside the assistant branch of `MessageView` in App.tsx, *after*
// `<MessagePrimitive.Parts>`. Reads the current message via
// `useMessage(selector)` so the visibility check scopes naturally to whichever
// assistant message is being rendered — older messages whose run has finished
// carry `status.type === "complete"` and the indicator suppresses itself.
//
// Show iff ALL of:
//   - role === "assistant"               (don't show on visitor turns)
//   - status.type === "running"          (only while the message is in flight)
//   - no text part with non-empty text   (text hasn't started streaming yet)
//   - no tool-call part still pending    (tool widget shows its own loader —
//                                         don't double-up activity signals)
//
// The third + fourth conditions together carve out the user's described
// failure mode: tools have rendered + completed, no text yet, agent is
// silently composing. The same logic also covers the brief pre-first-tool
// gap (parts list empty, status still running) — a small UX bonus.
//
// `data-swoop-part="thinking-indicator"` so Swoop's brand team can re-skin
// without touching React internals. `role="status"` + `aria-live="polite"`
// + sr-only label "Thinking…" make the indicator accessible.

import { useMessage } from "@assistant-ui/react";

/**
 * Returns `true` when the current assistant message is mid-run with no
 * visible text yet and no still-pending tool call. Pure derivation over
 * `MessageState` so the hook short-circuits cheaply on completed messages.
 */
export function TextThinkingIndicator() {
  const show = useMessage((s) => {
    if (s.role !== "assistant") return false;
    if (s.status?.type !== "running") return false;

    for (const part of s.content) {
      if (part.type === "text") {
        // Any non-empty text part means streaming has started — the visible
        // text itself is now the activity signal, so suppress.
        if (typeof part.text === "string" && part.text.length > 0) {
          return false;
        }
      } else if (part.type === "tool-call") {
        // A tool-call part with no result and no error is still in flight;
        // the widget's own `<WidgetLoadingPlaceholder>` covers that case.
        // Showing the global indicator alongside it would be a second,
        // redundant activity affordance.
        if (part.result === undefined && !part.isError) {
          return false;
        }
      }
    }

    return true;
  });

  if (!show) return null;

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
      <span className="sr-only">Thinking…</span>
    </div>
  );
}
